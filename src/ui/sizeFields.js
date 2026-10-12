// Shared pattern-size entry, used by both the New Pattern dialog and Pattern
// Settings' resize controls: a size can be typed as bead counts (rows/cols) or
// as a physical measurement (inches or mm), and picked from / saved to a list
// of saved sizes. Whatever is typed, the result handed back is always
// {rows, cols} — a measurement is only ever an input convenience, converted
// through the stitch type's own grid math for the bead type in play (see
// sizeConversion.js), never stored on a design.
//
// Self-contained like the dialog modules: builds its own markup inside the
// container it's given and talks to its caller only through the callbacks
// passed in.

import { gridSizeMm, rowsColsForSizeMm } from '../grid/sizeConversion.js';
import { mmToInches, inchesToMm, formatLength } from '../units/convert.js';
import { generateId } from '../storage/id.js';

const UNIT_OPTIONS = [
  { value: 'beads', label: 'Rows × Cols' },
  { value: 'in', label: 'Inches' },
  { value: 'mm', label: 'Millimeters' },
];
// Displayed precision per unit. Both are finer than half the smallest bead
// dimension, so a displayed size always converts back to the same bead counts.
const PRECISION = { in: 2, mm: 1 };

export function normalizeSizeUnit(unit) {
  return unit === 'in' || unit === 'mm' ? unit : 'beads';
}

// A saved size keeps what was typed, in the unit it was typed in:
// { id, name, unit, a, b } — a/b are rows/cols for 'beads', width/height
// otherwise (matching the two fields' own order in each mode).
export function sizePresetLabel(preset) {
  const size = preset.unit === 'beads'
    ? `${preset.a} rows × ${preset.b} cols`
    : `${preset.a} × ${preset.b} ${preset.unit}`;
  return preset.name ? `${preset.name} — ${size}` : size;
}

// options: { rows, cols, unit, note, getGeometry, getDisplayUnit, getPresets,
// onPresetsChanged, onUnitChanged }. getGeometry returns { stitchType, bead }
// for whatever the size is being entered against — read fresh each time, since
// the New Pattern dialog's bead/stitch type can change while this is showing.
export function mountSizeFields(container, options) {
  const { getGeometry, getDisplayUnit, getPresets, onPresetsChanged, onUnitChanged } = options;
  let unit = normalizeSizeUnit(options.unit);

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const unitSelect = el('select');
  unitSelect.setAttribute('aria-label', 'Size entered in');
  for (const { value, label } of UNIT_OPTIONS) {
    const option = el('option', null, label);
    option.value = value;
    unitSelect.append(option);
  }
  const unitLabel = el('label', 'size-fields-unit', 'Size in ');
  unitLabel.append(unitSelect);

  const inputA = el('input');
  const inputB = el('input');
  const labelTextA = el('span');
  const labelTextB = el('span');
  const labelA = el('label');
  const labelB = el('label');
  for (const input of [inputA, inputB]) {
    input.type = 'number';
    // inputmode keeps the iPad keyboard on its number layout even though a
    // measurement needs a decimal point.
    input.inputMode = 'decimal';
  }
  labelA.append(labelTextA, inputA);
  labelB.append(labelTextB, inputB);
  const valuesRow = el('div', 'size-fields-values');
  valuesRow.append(labelA, labelB);

  const hint = el('p', 'size-fields-hint');
  const note = el('p', 'size-fields-note', options.note ?? '');
  note.hidden = !options.note;

  const presetSelect = el('select');
  presetSelect.setAttribute('aria-label', 'Saved sizes');
  const presetSaveButton = el('button', null, 'Save Size');
  presetSaveButton.type = 'button';
  presetSaveButton.title = 'Save the size entered above to this list';
  const presetDeleteButton = el('button', null, 'Remove');
  presetDeleteButton.type = 'button';
  const presetsRow = el('div', 'size-fields-presets');
  presetsRow.append(presetSelect, presetSaveButton, presetDeleteButton);

  container.replaceChildren(unitLabel, valuesRow, hint, note, presetsRow);
  container.classList.add('size-fields');

  function applyUnitToInputs() {
    unitSelect.value = unit;
    const beads = unit === 'beads';
    labelTextA.textContent = beads ? 'Rows ' : 'Width ';
    labelTextB.textContent = beads ? 'Cols ' : 'Height ';
    for (const input of [inputA, inputB]) {
      input.min = beads ? '1' : '0';
      input.step = beads ? '1' : 'any';
    }
  }

  function lengthToMm(value) {
    return unit === 'in' ? inchesToMm(value) : value;
  }

  function getRowsCols() {
    const a = Number(inputA.value);
    const b = Number(inputB.value);
    if (unit === 'beads') {
      return { rows: Math.max(1, Math.round(a) || 1), cols: Math.max(1, Math.round(b) || 1) };
    }
    const { stitchType, bead } = getGeometry();
    return rowsColsForSizeMm(lengthToMm(a), lengthToMm(b), stitchType, bead);
  }

  function updateHint() {
    const { rows, cols } = getRowsCols();
    const { stitchType, bead } = getGeometry();
    const { widthMm, heightMm } = gridSizeMm(rows, cols, stitchType, bead);
    if (unit === 'beads') {
      const displayUnit = getDisplayUnit();
      hint.textContent = `${formatLength(widthMm, displayUnit)} × ${formatLength(heightMm, displayUnit)}`;
    } else {
      // A measurement rarely lands on a whole bead — show what it rounds to.
      hint.textContent = `${rows} rows × ${cols} cols (${formatLength(widthMm, unit, PRECISION[unit])} × ${formatLength(heightMm, unit, PRECISION[unit])})`;
    }
  }

  function setRowsCols(rows, cols) {
    if (unit === 'beads') {
      inputA.value = String(rows);
      inputB.value = String(cols);
    } else {
      const { stitchType, bead } = getGeometry();
      const { widthMm, heightMm } = gridSizeMm(rows, cols, stitchType, bead);
      const show = (mm) => (unit === 'in' ? mmToInches(mm) : mm).toFixed(PRECISION[unit]);
      inputA.value = show(widthMm);
      inputB.value = show(heightMm);
    }
    updateHint();
    // The fields now hold the caller's size, not whichever saved size was picked.
    if (presetSelect.value) renderPresets();
  }

  function renderPresets(selectedId = '') {
    const presets = getPresets();
    const placeholder = el('option', null, presets.length ? 'Saved sizes…' : 'No saved sizes yet');
    placeholder.value = '';
    presetSelect.replaceChildren(placeholder, ...presets.map((preset) => {
      const option = el('option', null, sizePresetLabel(preset));
      option.value = preset.id;
      return option;
    }));
    presetSelect.value = selectedId;
    presetSelect.disabled = presets.length === 0;
    presetDeleteButton.disabled = !presetSelect.value;
  }

  function setUnit(newUnit, { notify }) {
    if (newUnit === unit) return;
    unit = newUnit;
    applyUnitToInputs();
    if (notify) onUnitChanged?.(unit);
  }

  function handleUnitChange() {
    // Carry the size already entered across, re-expressed in the new unit.
    const { rows, cols } = getRowsCols();
    setUnit(normalizeSizeUnit(unitSelect.value), { notify: true });
    setRowsCols(rows, cols);
    renderPresets();
  }

  function handleValueInput() {
    updateHint();
    // The fields no longer necessarily match whichever saved size was picked.
    if (presetSelect.value) renderPresets();
  }

  function handlePresetChange() {
    const preset = getPresets().find((p) => p.id === presetSelect.value);
    presetDeleteButton.disabled = !preset;
    if (!preset) return;
    setUnit(normalizeSizeUnit(preset.unit), { notify: true });
    inputA.value = String(preset.a);
    inputB.value = String(preset.b);
    updateHint();
  }

  function handlePresetSave() {
    let a = Number(inputA.value);
    let b = Number(inputB.value);
    if (unit === 'beads') ({ rows: a, cols: b } = getRowsCols());
    if (!(a > 0) || !(b > 0)) return;
    const name = window.prompt('Name this size (optional):', '');
    if (name === null) return;
    const preset = { id: generateId(), name: name.trim(), unit, a, b };
    onPresetsChanged([...getPresets(), preset]);
    renderPresets(preset.id);
  }

  function handlePresetDelete() {
    const preset = getPresets().find((p) => p.id === presetSelect.value);
    if (!preset) return;
    if (!window.confirm(`Remove the saved size "${sizePresetLabel(preset)}"?`)) return;
    onPresetsChanged(getPresets().filter((p) => p.id !== preset.id));
    renderPresets();
  }

  unitSelect.addEventListener('change', handleUnitChange);
  inputA.addEventListener('input', handleValueInput);
  inputB.addEventListener('input', handleValueInput);
  presetSelect.addEventListener('change', handlePresetChange);
  presetSaveButton.addEventListener('click', handlePresetSave);
  presetDeleteButton.addEventListener('click', handlePresetDelete);

  applyUnitToInputs();
  setRowsCols(options.rows, options.cols);
  renderPresets();

  return {
    getRowsCols,
    setRowsCols,
    // Call when the bead/stitch type the size is entered against changes: a
    // typed measurement stays as typed, only what it converts to is recomputed.
    refresh: updateHint,
    unmount() {
      container.replaceChildren();
      container.classList.remove('size-fields');
    },
  };
}
