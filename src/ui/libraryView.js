// Renders the design list into #library-view and owns pointer-based drag-reorder
// (mirrors pointerRouter.js's pointer-event style: track a gesture centrally and
// route by state, rather than one listener set per row). Talks to main.js only
// through injected callbacks — never reaches into appState directly (CLAUDE.md's
// "modules read/write through defined functions").
//
// Pointer capture is taken on listEl (the list container), not on the row/handle
// being dragged: capturing the dragged element itself breaks the moment the drag
// reorders it via insertBefore — browsers release capture when the captured
// element is reparented mid-gesture. listEl never moves, so its capture survives
// the whole drag.

import { orderForInsertAt } from '../state/designOrder.js';

const DELETE_CONFIRM_MESSAGE = 'Delete this pattern? This cannot be undone.';

function relativeTime(epochMs) {
  const diffMin = Math.round((Date.now() - epochMs) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function mountLibraryView(callbacks) {
  const listEl = document.getElementById('library-list');
  const newButton = document.getElementById('library-new');
  const emptyMessageEl = document.getElementById('library-empty-message');

  let currentDesigns = [];
  let drag = null; // { pointerId, rowEl, designId } or null

  function buildRow(design) {
    const row = document.createElement('li');
    row.className = 'library-row';
    row.dataset.designId = design.id;

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'library-drag-handle';
    handle.setAttribute('aria-label', 'Reorder');
    handle.textContent = '☰';

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'library-row-info';
    info.addEventListener('click', () => callbacks.onOpen(design.id));

    const name = document.createElement('span');
    name.className = 'library-row-name';
    name.textContent = design.name;

    const updated = document.createElement('span');
    updated.className = 'library-row-updated';
    updated.textContent = relativeTime(design.updatedAt);

    info.append(name, updated);

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'library-row-action';
    renameButton.setAttribute('aria-label', 'Rename');
    renameButton.textContent = '✎';
    renameButton.addEventListener('click', () => callbacks.onRename(design.id));

    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.className = 'library-row-action';
    duplicateButton.setAttribute('aria-label', 'Duplicate');
    duplicateButton.textContent = '⎘';
    duplicateButton.addEventListener('click', () => callbacks.onDuplicate(design.id));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'library-row-action';
    deleteButton.setAttribute('aria-label', 'Delete');
    deleteButton.textContent = '✖';
    deleteButton.addEventListener('click', () => {
      if (window.confirm(DELETE_CONFIRM_MESSAGE)) callbacks.onDelete(design.id);
    });

    row.append(handle, info, renameButton, duplicateButton, deleteButton);
    return row;
  }

  function renderList(designs) {
    currentDesigns = designs;
    listEl.replaceChildren(...designs.map(buildRow));
    emptyMessageEl.hidden = designs.length > 0;
  }

  function handleListPointerDown(e) {
    const handle = e.target.closest('.library-drag-handle');
    if (!handle) return;
    const rowEl = handle.closest('.library-row');
    if (!rowEl) return;
    drag = { pointerId: e.pointerId, rowEl, designId: rowEl.dataset.designId };
    listEl.setPointerCapture(e.pointerId);
    rowEl.classList.add('dragging');
  }

  function handleListPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const siblings = [...listEl.querySelectorAll('.library-row')].filter((r) => r !== drag.rowEl);
    const target = siblings.find((sibling) => {
      const rect = sibling.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    if (target) listEl.insertBefore(drag.rowEl, target);
    else listEl.appendChild(drag.rowEl);
  }

  function handleListPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { rowEl, designId } = drag;
    rowEl.classList.remove('dragging');
    if (listEl.hasPointerCapture?.(e.pointerId)) listEl.releasePointerCapture(e.pointerId);
    drag = null;

    const targetIndex = [...listEl.querySelectorAll('.library-row')].indexOf(rowEl);
    const sortedExcludingDragged = currentDesigns.filter((d) => d.id !== designId);
    const newOrder = orderForInsertAt(sortedExcludingDragged, targetIndex);
    callbacks.onReorder(designId, newOrder);
  }

  listEl.addEventListener('pointerdown', handleListPointerDown);
  listEl.addEventListener('pointermove', handleListPointerMove);
  listEl.addEventListener('pointerup', handleListPointerUp);
  listEl.addEventListener('pointercancel', handleListPointerUp);
  newButton.addEventListener('click', () => callbacks.onCreate());

  return { renderList };
}
