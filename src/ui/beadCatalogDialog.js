// "Manage Bead Types…" CRUD dialog — Part A of
// .work/feature-bead-catalog-and-conversion-plan.md. Structurally like Manage
// Colors (drag-reorder via pointer-capture-on-container, prompt-based rename,
// usage-guarded delete) but its own <dialog> rather than a side-panel section,
// since editing the bead catalog is an infrequent, catalog-wide action rather
// than a per-design one. Owns only the #bead-catalog-dialog markup; every
// mutation round-trips through the injected hooks, which are responsible for
// both persisting to beadCatalogStore.js and updating appState.beadCatalog in
// place (same convention as editorView.js's onCustomColor* hooks in main.js).
//
// hooks:
//   onBeadTypeCreated({name, widthMm, heightMm, cornerRadiusFraction, holeMm, diameterMm}) -> Promise<beadType>
//   onBeadTypeSaved(beadType) -> Promise<beadType>
//   onBeadTypeDeleted(id) -> Promise<void>
//   onBeadTypeReordered(id, newOrder) -> Promise<void>
//   onCatalogChanged() -> void — fired after any successful mutation, so
//                         editorView.js can refresh the top-bar bead-type <select>.

import { findPatternsUsingBeadType } from '../palette/beadTypeUsage.js';
import { orderForInsertAt } from '../state/designOrder.js';
import { createIcon } from './icons.js';

const NEW_BEAD_TYPE_DEFAULTS = { widthMm: 1.6, heightMm: 1.3, cornerRadiusFraction: 0, holeMm: null, diameterMm: null };
const MIN_GEOMETRY_MM = 0.1; // widthMm/heightMm drive grid math — must stay positive

export function mountBeadCatalogDialog(appState, hooks) {
  const dialog = document.getElementById('bead-catalog-dialog');
  const listEl = document.getElementById('bead-catalog-list');
  const addButton = document.getElementById('bead-catalog-add');
  const closeButton = document.getElementById('bead-catalog-close');

  let drag = null; // { pointerId, rowEl, beadTypeId } or null, mirrors colorManageList's drag shape

  function numberField(label, field, value, step, min) {
    const wrap = document.createElement('label');
    wrap.className = 'bead-catalog-field';
    wrap.append(document.createTextNode(label));
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    if (min !== undefined) input.min = String(min);
    input.value = value === null || value === undefined ? '' : String(value);
    input.addEventListener('change', () => {
      const raw = input.value.trim();
      handleFieldChange(wrap.dataset.beadTypeId, field, raw === '' ? null : parseFloat(raw));
    });
    wrap.append(input);
    return wrap;
  }

  function buildRow(beadType) {
    const row = document.createElement('li');
    row.className = 'bead-catalog-row';
    row.dataset.beadTypeId = beadType.id;

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'icon-btn bead-catalog-drag-handle';
    handle.setAttribute('aria-label', 'Reorder');
    handle.title = 'Drag to reorder';
    handle.append(createIcon('grip-vertical'));

    const name = document.createElement('span');
    name.className = 'bead-catalog-name';
    name.textContent = beadType.name;

    // Display-layer-only label swap, same rationale/precedent as the rows/cols
    // label swap documented in resizeDialog.js: peyote.js's row axis renders
    // on-screen HORIZONTALLY but is spaced by beadHeightMm, and its col axis
    // renders VERTICALLY but is spaced by beadWidthMm (see peyoteCellOriginMm/
    // canvasRenderer.js — no transpose happens in worldToScreen, so this is a
    // real effect, not just a labeling quirk). Left as-is, a "Width" field bound
    // to widthMm would visibly control a bead's on-screen HEIGHT, not width —
    // confusing in exactly the way the rows/cols mislabeling was. So the visible
    // "W" label is bound to the heightMm field (it's what actually widens the
    // pattern on screen) and "H" to widthMm — the field/data-model names
    // (widthMm/heightMm, still the real physical measurements per CLAUDE.md's
    // Bead Specs table) are untouched, only which label sits next to which input.
    const widthField = numberField('W', 'heightMm', beadType.heightMm, 0.05, MIN_GEOMETRY_MM);
    const heightField = numberField('H', 'widthMm', beadType.widthMm, 0.05, MIN_GEOMETRY_MM);
    const cornerField = numberField('Corner', 'cornerRadiusFraction', beadType.cornerRadiusFraction ?? 0, 0.01, 0);
    const holeField = numberField('Hole', 'holeMm', beadType.holeMm, 0.05, 0);
    const diameterField = numberField('Ø', 'diameterMm', beadType.diameterMm, 0.05, 0);
    for (const field of [widthField, heightField, cornerField, holeField, diameterField]) {
      field.dataset.beadTypeId = beadType.id;
    }

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'icon-btn bead-catalog-action';
    renameButton.setAttribute('aria-label', 'Rename');
    renameButton.title = 'Rename';
    renameButton.append(createIcon('pencil'));
    renameButton.addEventListener('click', () => handleRename(beadType.id));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'icon-btn bead-catalog-action';
    deleteButton.setAttribute('aria-label', 'Delete');
    deleteButton.title = 'Delete';
    deleteButton.append(createIcon('trash-2'));
    deleteButton.addEventListener('click', () => handleDelete(beadType.id));

    row.append(handle, name, widthField, heightField, cornerField, holeField, diameterField, renameButton, deleteButton);
    return row;
  }

  function renderList() {
    listEl.replaceChildren(...appState.beadCatalog.map(buildRow));
  }

  // widthMm/heightMm drive grid math and must stay positive — an invalid edit
  // (blank or <= 0) is rejected and the field reverts to its prior value on the
  // next renderList() rather than being persisted.
  async function handleFieldChange(id, field, value) {
    const beadType = appState.beadCatalog.find((b) => b.id === id);
    if (!beadType) return;
    let nextValue = value;
    if ((field === 'widthMm' || field === 'heightMm') && (nextValue === null || nextValue <= 0)) {
      nextValue = beadType[field];
    }
    await hooks.onBeadTypeSaved({ ...beadType, [field]: nextValue });
    renderList();
    hooks.onCatalogChanged();
  }

  async function handleRename(id) {
    const beadType = appState.beadCatalog.find((b) => b.id === id);
    if (!beadType) return;
    const newName = window.prompt('Rename bead type', beadType.name);
    if (!newName || !newName.trim()) return;
    await hooks.onBeadTypeSaved({ ...beadType, name: newName.trim() });
    renderList();
    hooks.onCatalogChanged();
  }

  function handleDelete(id) {
    const usage = findPatternsUsingBeadType(appState.designs, id);
    if (usage.length > 0) {
      const lines = usage.map((u) => u.designName).join('\n');
      window.alert(
        `This bead type is used in ${usage.length} pattern${usage.length === 1 ? '' : 's'} and can't be deleted:\n\n${lines}`
      );
      return;
    }
    if (appState.beadCatalog.length <= 1) {
      window.alert('At least one bead type must remain.');
      return;
    }
    if (!window.confirm('Delete this bead type?')) return;
    hooks.onBeadTypeDeleted(id).then(() => {
      renderList();
      hooks.onCatalogChanged();
    });
  }

  async function handleAdd() {
    const name = window.prompt('New bead type name');
    if (!name || !name.trim()) return;
    await hooks.onBeadTypeCreated({ name: name.trim(), ...NEW_BEAD_TYPE_DEFAULTS });
    renderList();
    hooks.onCatalogChanged();
  }

  function handleListPointerDown(e) {
    const handle = e.target.closest('.bead-catalog-drag-handle');
    if (!handle) return;
    const rowEl = handle.closest('.bead-catalog-row');
    if (!rowEl) return;
    drag = { pointerId: e.pointerId, rowEl, beadTypeId: rowEl.dataset.beadTypeId };
    listEl.setPointerCapture(e.pointerId);
    rowEl.classList.add('dragging');
  }
  function handleListPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const siblings = [...listEl.querySelectorAll('.bead-catalog-row')].filter((r) => r !== drag.rowEl);
    const target = siblings.find((sibling) => {
      const rect = sibling.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    if (target) listEl.insertBefore(drag.rowEl, target);
    else listEl.appendChild(drag.rowEl);
  }
  function handleListPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { rowEl, beadTypeId } = drag;
    rowEl.classList.remove('dragging');
    if (listEl.hasPointerCapture?.(e.pointerId)) listEl.releasePointerCapture(e.pointerId);
    drag = null;

    const targetIndex = [...listEl.querySelectorAll('.bead-catalog-row')].indexOf(rowEl);
    const sortedExcludingDragged = appState.beadCatalog.filter((b) => b.id !== beadTypeId);
    const newOrder = orderForInsertAt(sortedExcludingDragged, targetIndex);
    hooks.onBeadTypeReordered(beadTypeId, newOrder).then(() => {
      renderList();
      hooks.onCatalogChanged();
    });
  }

  function handleClose() {
    dialog.close();
  }

  addButton.addEventListener('click', handleAdd);
  closeButton.addEventListener('click', handleClose);
  listEl.addEventListener('pointerdown', handleListPointerDown);
  listEl.addEventListener('pointermove', handleListPointerMove);
  listEl.addEventListener('pointerup', handleListPointerUp);
  listEl.addEventListener('pointercancel', handleListPointerUp);

  function open() {
    renderList();
    dialog.showModal();
  }

  function unmount() {
    addButton.removeEventListener('click', handleAdd);
    closeButton.removeEventListener('click', handleClose);
    listEl.removeEventListener('pointerdown', handleListPointerDown);
    listEl.removeEventListener('pointermove', handleListPointerMove);
    listEl.removeEventListener('pointerup', handleListPointerUp);
    listEl.removeEventListener('pointercancel', handleListPointerUp);
  }

  return { open, unmount };
}
