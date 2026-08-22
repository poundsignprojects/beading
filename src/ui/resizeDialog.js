// Prompts for which side absorbs a rows/cols change and shows a live "N beads will
// be removed" warning as the user picks sides, so shrinking always requires an
// explicit, informed confirmation (never a silent loss) while growing is a single
// quick confirm. Self-contained like printView.js — reads/writes only the
// #resize-dialog markup, no hooks into main.js.

import { countCellsLost } from '../state/resizeGrid.js';

// UI radios express which SIDE gets the new/removed cells (matches how rows/cols
// are actually laid out on screen — rows run top-bottom, cols run left-right, see
// peyote.js). resizeCells/countCellsLost only know 'start'|'end'|'both', where
// 'start' = existing content anchored at index 0 (change happens at the far end).
const ROW_SIDE_TO_ANCHOR = { bottom: 'start', top: 'end', both: 'both' };
const COL_SIDE_TO_ANCHOR = { right: 'start', left: 'end', both: 'both' };

function selectedRadioValue(form, name) {
  return form.querySelector(`input[name="${name}"]:checked`).value;
}

// Resolves with { rowAnchor, colAnchor } on confirm, or null on cancel/Esc.
// Only called when at least one of rowDelta/colDelta is non-zero.
export function promptResizeOptions({ cells, oldRows, oldCols, newRows, newCols }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('resize-dialog');
    const form = document.getElementById('resize-form');
    const warningEl = document.getElementById('resize-warning');
    const rowFieldset = document.getElementById('resize-row-anchor');
    const colFieldset = document.getElementById('resize-col-anchor');
    const cancelButton = document.getElementById('resize-cancel');
    const confirmButton = document.getElementById('resize-confirm');

    const rowChanged = newRows !== oldRows;
    const colChanged = newCols !== oldCols;
    rowFieldset.hidden = !rowChanged;
    colFieldset.hidden = !colChanged;

    function currentAnchors() {
      return {
        rowAnchor: rowChanged ? ROW_SIDE_TO_ANCHOR[selectedRadioValue(form, 'row-side')] : 'start',
        colAnchor: colChanged ? COL_SIDE_TO_ANCHOR[selectedRadioValue(form, 'col-side')] : 'start',
      };
    }

    function updateWarning() {
      const { rowAnchor, colAnchor } = currentAnchors();
      const lost = countCellsLost(cells, oldRows, oldCols, newRows, newCols, rowAnchor, colAnchor);
      warningEl.hidden = lost === 0;
      warningEl.textContent = lost === 0
        ? ''
        : `This will permanently remove ${lost} placed bead${lost === 1 ? '' : 's'}.`;
      confirmButton.textContent = lost === 0 ? 'Resize' : 'Remove & Resize';
      confirmButton.classList.toggle('destructive', lost > 0);
    }

    function cleanup() {
      form.removeEventListener('change', updateWarning);
      cancelButton.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('cancel', onCancel);
    }

    function onCancel(e) {
      e?.preventDefault();
      cleanup();
      dialog.close();
      resolve(null);
    }

    function onSubmit(e) {
      e.preventDefault();
      const anchors = currentAnchors();
      cleanup();
      dialog.close();
      resolve(anchors);
    }

    form.addEventListener('change', updateWarning);
    cancelButton.addEventListener('click', onCancel);
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('cancel', onCancel);

    updateWarning();
    dialog.showModal();
  });
}
