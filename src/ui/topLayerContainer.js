// Shared by longPressTooltip.js, actionMenu.js, and toast.js: a plain
// document.body child renders BEHIND an open native <dialog>'s own
// ::backdrop (the dialog's top-layer promotion covers its whole subtree, but
// not siblings appended elsewhere) — so anything that can be triggered from
// inside a dialog (Bead Catalog's row menu, a color-delete-blocked toast,
// etc.) must be appended as a descendant of that dialog instead. Picks the
// topmost open <dialog> if any are open, else document.body.
export function currentTopLayerContainer() {
  const openDialogs = document.querySelectorAll('dialog[open]');
  return openDialogs.length > 0 ? openDialogs[openDialogs.length - 1] : document.body;
}
