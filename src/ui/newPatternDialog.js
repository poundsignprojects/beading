// Prompts for a new pattern's name, stitch type, bead type, drop count (peyote
// only), and starting size — all chosen up front, replacing the old instant-
// create-from-whatever-the-last-defaults-were flow (see .work/feature-multi-
// drop-peyote-plan.md). Self-contained like resizeDialog.js/convertBeadTypeDialog.js
// — reads/writes only the #new-pattern-dialog markup, no hooks into main.js; the
// caller (main.js's handleCreate) does the actual creation after this resolves.
// Resize remains available afterward for changing size on an already-created
// design — this dialog just also lets the user pick a starting size instead of
// always inheriting whatever the last design used.

import { beadTypeSelectOptions } from '../palette/beadSpecs.js';

// Resolves with { name, stitchType, beadTypeKey, dropCount, rows, cols } on
// Create, or null on Cancel/Esc. defaults: { name, stitchType, beadTypeKey,
// dropCount, rows, cols } — seeded from preferences by the caller.
export function promptNewPattern({ beadCatalog, defaults }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('new-pattern-dialog');
    const form = document.getElementById('new-pattern-form');
    const nameInput = document.getElementById('new-pattern-name');
    const stitchTypeSelect = document.getElementById('new-pattern-stitch-type');
    const beadTypeSelect = document.getElementById('new-pattern-bead-type');
    const dropCountLabel = document.getElementById('new-pattern-drop-count-label');
    const dropCountInput = document.getElementById('new-pattern-drop-count');
    const rowsInput = document.getElementById('new-pattern-rows');
    const colsInput = document.getElementById('new-pattern-cols');
    const cancelButton = document.getElementById('new-pattern-cancel');

    nameInput.value = defaults.name ?? '';
    stitchTypeSelect.value = defaults.stitchType;
    beadTypeSelect.replaceChildren(
      ...beadTypeSelectOptions(beadCatalog).map(({ value, label }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
      })
    );
    beadTypeSelect.value = defaults.beadTypeKey;
    dropCountInput.value = String(defaults.dropCount ?? 1);
    rowsInput.value = String(defaults.rows);
    colsInput.value = String(defaults.cols);

    function updateDropCountVisibility() {
      dropCountLabel.hidden = stitchTypeSelect.value !== 'peyote';
    }
    updateDropCountVisibility();

    function cleanup() {
      stitchTypeSelect.removeEventListener('change', updateDropCountVisibility);
      cancelButton.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('cancel', onCancel);
      beadTypeSelect.replaceChildren();
    }
    function onCancel(e) {
      e?.preventDefault();
      cleanup();
      dialog.close();
      resolve(null);
    }
    function onSubmit(e) {
      e.preventDefault();
      const result = {
        name: nameInput.value.trim(),
        stitchType: stitchTypeSelect.value,
        beadTypeKey: beadTypeSelect.value,
        dropCount: stitchTypeSelect.value === 'peyote'
          ? Math.max(1, Math.round(Number(dropCountInput.value)) || 1)
          : 1,
        rows: Math.max(1, parseInt(rowsInput.value, 10) || 1),
        cols: Math.max(1, parseInt(colsInput.value, 10) || 1),
      };
      cleanup();
      dialog.close();
      resolve(result);
    }

    stitchTypeSelect.addEventListener('change', updateDropCountVisibility);
    cancelButton.addEventListener('click', onCancel);
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('cancel', onCancel);

    dialog.showModal();
  });
}
