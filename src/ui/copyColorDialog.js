// "Copy to…" target picker for a Manage Colors row (Part B of
// .work/feature-bead-catalog-and-conversion-plan.md) — palettes stay independent
// per bead type (Phase 8), so copying a color into another bead type's palette
// needs an explicit target. A small dialog listing every *other* bead type as a
// button; picking one copies the color into that bead type's own independent
// palette (a new, separate customColors row) and leaves the source color/palette
// untouched. Self-contained like resizeDialog.js — reads/writes only the
// #copy-color-dialog markup, no hooks into main.js; the caller does the actual
// copy after this resolves.
//
// Resolves with the chosen bead type's id on confirm, null on cancel/Esc.
export function promptCopyColorTarget({ color, beadCatalog, currentBeadTypeKey }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('copy-color-dialog');
    const titleEl = document.getElementById('copy-color-title');
    const listEl = document.getElementById('copy-color-list');
    const cancelButton = document.getElementById('copy-color-cancel');

    titleEl.textContent = `Copy "${color.name}" to…`;
    const others = beadCatalog.filter((b) => b.id !== currentBeadTypeKey);

    function cleanup() {
      cancelButton.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      listEl.replaceChildren();
    }
    function onCancel(e) {
      e?.preventDefault();
      cleanup();
      dialog.close();
      resolve(null);
    }
    function finish(targetBeadTypeKey) {
      cleanup();
      dialog.close();
      resolve(targetBeadTypeKey);
    }

    if (others.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No other bead types yet.';
      listEl.replaceChildren(empty);
    } else {
      listEl.replaceChildren(
        ...others.map((beadType) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'copy-color-target';
          button.textContent = beadType.name;
          button.addEventListener('click', () => finish(beadType.id));
          return button;
        })
      );
    }

    cancelButton.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);

    dialog.showModal();
  });
}
