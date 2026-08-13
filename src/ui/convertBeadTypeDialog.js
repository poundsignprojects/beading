// Prompts for how each color actually used in the current design should map onto
// the target bead type's own palette, when switching bead type on a non-empty
// design (Part C of .work/feature-bead-catalog-and-conversion-plan.md's Convert
// Bead Type flow). Self-contained like resizeDialog.js/copyColorDialog.js — reads/
// writes only the #convert-bead-type-dialog markup, no hooks into main.js; the
// caller (editorView.js's handleBeadTypeChange) does the actual conversion after
// this resolves.
//
// usedColors: [{id, name, hex}] — every color actually used across every colorway
// of the current design.
// targetColors: [{id, name, hex}] — the target bead type's own existing palette.
//
// Resolves with:
//   { mappings: [
//       {sourceColorId, action: 'map', targetColorId} |
//       {sourceColorId, action: 'copy', name, hex}
//     ] }
//   on confirm, null on cancel/Esc. A 'copy' mapping carries the source color's
// own name/hex along — the caller needs them to actually create the new color in
// the target palette, and this dialog is the only place that already has them.
const COPY_ACTION_VALUE = '__copy__';

export function promptConvertBeadType({ usedColors, targetColors, targetBeadTypeName }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('convert-bead-type-dialog');
    const titleEl = document.getElementById('convert-bead-type-title');
    const listEl = document.getElementById('convert-bead-type-list');
    const form = document.getElementById('convert-bead-type-form');
    const cancelButton = document.getElementById('convert-bead-type-cancel');

    titleEl.textContent = `Convert to ${targetBeadTypeName}`;

    function buildRow(color) {
      const row = document.createElement('div');
      row.className = 'convert-bead-type-row';

      const swatch = document.createElement('span');
      swatch.className = 'convert-bead-type-swatch';
      swatch.style.background = color.hex;

      const name = document.createElement('span');
      name.className = 'convert-bead-type-name';
      name.textContent = color.name;

      const select = document.createElement('select');
      select.dataset.sourceColorId = color.id;
      for (const target of targetColors) {
        const option = document.createElement('option');
        option.value = target.id;
        option.textContent = target.name;
        select.append(option);
      }
      const copyOption = document.createElement('option');
      copyOption.value = COPY_ACTION_VALUE;
      copyOption.textContent = 'Copy this color over (create new)';
      select.append(copyOption);

      // Default to an exact hex match in the target palette when one exists;
      // otherwise there's nothing sensible to map onto, so default to copying
      // the color over instead.
      const exactMatch = targetColors.find((t) => t.hex.toLowerCase() === color.hex.toLowerCase());
      select.value = exactMatch ? exactMatch.id : COPY_ACTION_VALUE;

      row.append(swatch, name, select);
      return row;
    }

    listEl.replaceChildren(...usedColors.map(buildRow));

    function cleanup() {
      cancelButton.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('cancel', onCancel);
      listEl.replaceChildren();
    }
    function onCancel(e) {
      e?.preventDefault();
      cleanup();
      dialog.close();
      resolve(null);
    }
    function onSubmit(e) {
      e.preventDefault();
      const mappings = usedColors.map((color) => {
        const select = listEl.querySelector(`select[data-source-color-id="${color.id}"]`);
        if (select.value === COPY_ACTION_VALUE) {
          return { sourceColorId: color.id, action: 'copy', name: color.name, hex: color.hex };
        }
        return { sourceColorId: color.id, action: 'map', targetColorId: select.value };
      });
      cleanup();
      dialog.close();
      resolve({ mappings });
    }

    cancelButton.addEventListener('click', onCancel);
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('cancel', onCancel);

    dialog.showModal();
  });
}
