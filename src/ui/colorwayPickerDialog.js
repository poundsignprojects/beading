// Lets the user pick which of a design's colorways to open directly, from the
// library's colorway badge (see libraryView.js — shown only when a design has
// more than one). Self-contained like copyColorDialog.js — reads/writes only
// the #colorway-picker-dialog markup, no hooks into main.js. Preview thumbnails
// are supplied already-rendered by the caller (main.js), since generating them
// needs a DB read (per-bead-type customColors) this module has no business
// making itself.
//
// Resolves with the chosen colorway's id on confirm, null on cancel/Esc.
export function promptColorwayPicker({ designName, colorways }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('colorway-picker-dialog');
    const titleEl = document.getElementById('colorway-picker-title');
    const listEl = document.getElementById('colorway-picker-list');
    const cancelButton = document.getElementById('colorway-picker-cancel');

    titleEl.textContent = `${designName} — Colorways`;

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
    function finish(colorwayId) {
      cleanup();
      dialog.close();
      resolve(colorwayId);
    }

    listEl.replaceChildren(
      ...colorways.map((cw) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'colorway-picker-row';

        const thumb = document.createElement('div');
        thumb.className = 'colorway-picker-thumb';
        if (cw.thumbnailDataUrl) {
          const img = document.createElement('img');
          img.src = cw.thumbnailDataUrl;
          img.alt = '';
          thumb.append(img);
        }

        const name = document.createElement('span');
        name.className = 'colorway-picker-name';
        name.textContent = cw.name;

        button.append(thumb, name);
        button.addEventListener('click', () => finish(cw.id));
        return button;
      })
    );

    cancelButton.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);

    dialog.showModal();
  });
}
