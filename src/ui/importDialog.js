// Three-step Loomerly PDF import flow (file pick -> preview -> color assignment),
// triggered from libraryView.js's "Import" button. Mounted once at boot (like
// editorView.js's Photo Trace file picker) rather than wrapped in a single Promise per
// invocation — a native <input type="file">'s picker has no reliably cross-browser
// "the user cancelled" event, so a design that awaits one Promise across the whole flow
// (file pick through confirm) would hang forever whenever a user opens the picker and
// backs out of it without choosing a file. Success is reported via callbacks.onImported
// instead; cancelling at any step (including the native picker) just does nothing.

import { extractPdfPageTexts } from '../import/pdfText.js';
import { parseLoomerlyExport } from '../import/loomerlyParser.js';
import { buildGridFromLoomerly, guessBeadType, computeImportWarnings } from '../import/loomerlyImport.js';
import { createCustomColor, listCustomColorsSorted } from '../storage/customColorStore.js';
import { createDesign, saveDesign } from '../storage/designStore.js';

const BEAD_TYPE_SOURCE_LABEL = {
  header: 'read from this file’s color list',
  'size-guess': 'guessed from finished size',
  default: 'default guess (no size info in this file)',
};

function deriveDesignName(file) {
  const base = file.name.replace(/\.pdf$/i, '').trim();
  return base.length > 0 ? base : 'Imported Pattern';
}

export function mountImportDialog(db, callbacks) {
  const fileInput = document.getElementById('import-file-input');
  const dialog = document.getElementById('import-dialog');
  const errorStep = document.getElementById('import-step-error');
  const errorMessageEl = document.getElementById('import-error-message');
  const errorCloseButton = document.getElementById('import-error-close');
  const previewStep = document.getElementById('import-step-preview');
  const statsEl = document.getElementById('import-preview-stats');
  const beadTypeSelect = document.getElementById('import-bead-type-select');
  const beadTypeSourceEl = document.getElementById('import-bead-type-source');
  const warningsEl = document.getElementById('import-warnings');
  const colorsTbody = document.getElementById('import-colors-tbody');
  const previewCancelButton = document.getElementById('import-preview-cancel');
  const previewContinueButton = document.getElementById('import-preview-continue');
  const colorsStep = document.getElementById('import-step-colors');
  const colorAssignList = document.getElementById('import-color-assign-list');
  const colorsCancelButton = document.getElementById('import-colors-cancel');
  const colorsConfirmButton = document.getElementById('import-colors-confirm');

  let parsed = null;
  let grid = null;
  let file = null;
  let pickedColor = new Map(); // code -> { type: 'existing', id } | { type: 'new', hex }

  function showStep(step) {
    errorStep.hidden = step !== 'error';
    previewStep.hidden = step !== 'preview';
    colorsStep.hidden = step !== 'colors';
  }

  function showError(message) {
    errorMessageEl.textContent = message;
    showStep('error');
    if (!dialog.open) dialog.showModal();
  }

  function renderPreview() {
    const beadTypeKey = beadTypeSelect.value;
    const beadTypeGuess = guessBeadType(parsed);
    statsEl.replaceChildren();
    const stats = [
      ['Rows (width)', String(grid.rows)],
      ['Cols (height)', String(grid.cols)],
      ['Stated finished size', parsed.meta.finishedSizeIn ?? '(not stated)'],
      ['Stated total beads', String(parsed.meta.totalBeads)],
      ['Reconstructed beads', String(grid.shapeEntries.length)],
    ];
    for (const [label, value] of stats) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      statsEl.append(dt, dd);
    }
    beadTypeSourceEl.textContent = BEAD_TYPE_SOURCE_LABEL[beadTypeGuess.source] ?? '';

    const warnings = computeImportWarnings(parsed, grid, beadTypeKey);
    warningsEl.replaceChildren();
    warningsEl.hidden = warnings.length === 0;
    for (const warning of warnings) {
      const li = document.createElement('li');
      li.textContent = warning;
      warningsEl.append(li);
    }

    colorsTbody.replaceChildren();
    for (const color of parsed.colors) {
      const tr = document.createElement('tr');
      for (const value of [color.code, color.catalogNumber ?? '—', color.name ?? '—', String(color.count ?? '—')]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      colorsTbody.append(tr);
    }
  }

  async function handleFileChange() {
    const selected = fileInput.files[0];
    fileInput.value = ''; // allow re-selecting the same file later
    if (!selected) return;
    file = selected;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pageTexts = await extractPdfPageTexts(arrayBuffer);
      const parseResult = parseLoomerlyExport(pageTexts);
      if (parseResult.error) return showError(parseResult.error);

      const gridResult = buildGridFromLoomerly(parseResult);
      if (gridResult.error) return showError(gridResult.error);

      parsed = parseResult;
      grid = gridResult;
      const guess = guessBeadType(parsed);
      beadTypeSelect.value = guess.beadTypeKey;
      renderPreview();
      showStep('preview');
      dialog.showModal();
    } catch (err) {
      showError(`Could not read this PDF (${err.message}).`);
    }
  }

  // Lets the user reuse a color they've already built for this bead type (Phase 8's
  // customColorStore) instead of always having to re-pick a hex from scratch — each
  // row shows that palette as clickable swatches (same look/behavior as the editor's
  // own color palette) plus a native color-picker tile for a genuinely new color.
  // Picking an existing swatch reuses its real customColors id directly in
  // handleConfirm rather than creating a near-duplicate entry.
  async function renderColorAssignStep() {
    pickedColor = new Map();
    colorAssignList.replaceChildren();
    colorsConfirmButton.disabled = true;

    const existingColors = await listCustomColorsSorted(db, beadTypeSelect.value);

    for (const color of parsed.colors) {
      const li = document.createElement('li');
      li.className = 'import-color-assign-row';

      const label = document.createElement('span');
      label.className = 'import-color-label';
      label.textContent = `${color.code} — ${color.catalogNumber ?? ''} ${color.name ?? '(unnamed)'} (Count: ${color.count ?? '?'})`;

      const picker = document.createElement('div');
      picker.className = 'import-color-swatch-picker';

      const swatchButtons = [];
      let customInput;

      function selectChoice(choice) {
        pickedColor.set(color.code, choice);
        colorsConfirmButton.disabled = pickedColor.size < parsed.colors.length;
        for (const btn of swatchButtons) {
          btn.setAttribute('aria-pressed', String(choice.type === 'existing' && btn.dataset.colorId === choice.id));
        }
        customInput.classList.toggle('active', choice.type === 'new');
      }

      for (const existing of existingColors) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'color-swatch';
        button.title = existing.name;
        button.style.background = existing.hex;
        button.dataset.colorId = existing.id;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => selectChoice({ type: 'existing', id: existing.id }));
        swatchButtons.push(button);
        picker.append(button);
      }

      customInput = document.createElement('input');
      customInput.type = 'color';
      customInput.className = 'import-color-custom-input';
      customInput.title = 'Custom color';
      customInput.addEventListener('input', () => selectChoice({ type: 'new', hex: customInput.value }));
      picker.append(customInput);

      li.append(label, picker);
      colorAssignList.append(li);
    }
  }

  function handleCancel(e) {
    e?.preventDefault();
    dialog.close();
  }

  async function handleConfirm() {
    colorsConfirmButton.disabled = true;
    const beadTypeKey = beadTypeSelect.value;

    const colorIdByCode = new Map();
    for (const color of parsed.colors) {
      const choice = pickedColor.get(color.code);
      if (choice.type === 'existing') {
        colorIdByCode.set(color.code, choice.id);
      } else {
        const created = await createCustomColor(db, {
          beadTypeKey,
          name: color.name ?? color.catalogNumber ?? color.code,
          hex: choice.hex,
        });
        colorIdByCode.set(color.code, created.id);
      }
    }

    const colorEntries = grid.colorEntries.map(([key, code]) => [key, colorIdByCode.get(code) ?? null]);

    const design = await createDesign(db, {
      name: deriveDesignName(file),
      beadTypeKey,
      rows: grid.rows,
      cols: grid.cols,
    });
    const activeColorway = design.colorways[0];
    const saved = await saveDesign(db, {
      ...design,
      shapeEntries: grid.shapeEntries,
      colorways: [{ ...activeColorway, colorEntries }],
    });

    dialog.close();
    callbacks.onImported(saved);
  }

  fileInput.addEventListener('change', handleFileChange);
  errorCloseButton.addEventListener('click', handleCancel);
  previewCancelButton.addEventListener('click', handleCancel);
  previewContinueButton.addEventListener('click', () => {
    renderColorAssignStep().then(() => showStep('colors'));
  });
  beadTypeSelect.addEventListener('change', renderPreview);
  colorsCancelButton.addEventListener('click', handleCancel);
  colorsConfirmButton.addEventListener('click', handleConfirm);
  dialog.addEventListener('cancel', handleCancel);

  return {
    openFilePicker() {
      fileInput.value = '';
      fileInput.click();
    },
  };
}
