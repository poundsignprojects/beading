// Prompts for a new pattern's name, stitch type, bead type, drop count (peyote
// only), and starting size — all chosen up front, replacing the old instant-
// create-from-whatever-the-last-defaults-were flow (see .work/feature-multi-
// drop-peyote-plan.md). Self-contained like resizeDialog.js/convertBeadTypeDialog.js
// — reads/writes only the #new-pattern-dialog markup, no hooks into main.js; the
// caller (main.js's handleCreate) does the actual creation after this resolves.
// Resize remains available afterward for changing size on an already-created
// design — this dialog just also lets the user pick a starting size instead of
// always inheriting whatever the last design used. The size itself is entered
// through the shared sizeFields.js (bead counts or a measurement, plus saved
// sizes), the same control Pattern Settings uses for a resize.

import { beadTypeSelectOptions, findBeadType } from '../palette/beadSpecs.js';
import { mountSizeFields } from './sizeFields.js';

// Resolves with { name, stitchType, beadTypeKey, dropCount, rows, cols } on
// Create, or null on Cancel/Esc. defaults: { name, stitchType, beadTypeKey,
// dropCount, rows, cols, sizeUnit, sizeNote } — seeded from preferences by the
// caller. size: { getDisplayUnit, getPresets, onPresetsChanged, onUnitChanged }
// — sizeFields.js's own callbacks, passed straight through.
export function promptNewPattern({ beadCatalog, defaults, size }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('new-pattern-dialog');
    const form = document.getElementById('new-pattern-form');
    const nameInput = document.getElementById('new-pattern-name');
    const stitchTypeSelect = document.getElementById('new-pattern-stitch-type');
    const beadTypeSelect = document.getElementById('new-pattern-bead-type');
    const dropCountLabel = document.getElementById('new-pattern-drop-count-label');
    const dropCountInput = document.getElementById('new-pattern-drop-count');
    const dimensionsEl = document.getElementById('new-pattern-dimensions');
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
    const sizeFields = mountSizeFields(dimensionsEl, {
      rows: defaults.rows,
      cols: defaults.cols,
      unit: defaults.sizeUnit,
      note: defaults.sizeNote,
      getGeometry: () => ({
        stitchType: stitchTypeSelect.value,
        bead: findBeadType(beadCatalog, beadTypeSelect.value),
      }),
      ...size,
    });

    function updateDropCountVisibility() {
      dropCountLabel.hidden = stitchTypeSelect.value !== 'peyote';
    }
    updateDropCountVisibility();

    function onGeometryChange() {
      updateDropCountVisibility();
      sizeFields.refresh();
    }

    function cleanup() {
      stitchTypeSelect.removeEventListener('change', onGeometryChange);
      beadTypeSelect.removeEventListener('change', onGeometryChange);
      sizeFields.unmount();
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
      // Read before cleanup() empties the bead-type select the conversion needs.
      const { rows, cols } = sizeFields.getRowsCols();
      const result = {
        name: nameInput.value.trim(),
        stitchType: stitchTypeSelect.value,
        beadTypeKey: beadTypeSelect.value,
        dropCount: stitchTypeSelect.value === 'peyote'
          ? Math.max(1, Math.round(Number(dropCountInput.value)) || 1)
          : 1,
        rows,
        cols,
      };
      cleanup();
      dialog.close();
      resolve(result);
    }

    stitchTypeSelect.addEventListener('change', onGeometryChange);
    beadTypeSelect.addEventListener('change', onGeometryChange);
    cancelButton.addEventListener('click', onCancel);
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('cancel', onCancel);

    dialog.showModal();
  });
}
