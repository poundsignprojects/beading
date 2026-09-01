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
import { createIcon } from './icons.js';
import { promptColorwayPicker } from './colorwayPickerDialog.js';

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
  const viewListButton = document.getElementById('library-view-list');
  const viewGalleryButton = document.getElementById('library-view-gallery');
  const colorwaysToggle = document.getElementById('library-colorways-toggle');

  let currentDesigns = [];
  let currentViewMode = 'list';
  let currentShowColorways = false;
  let drag = null; // { pointerId, rowEl, designId } or null

  function buildRow(design) {
    const row = document.createElement('li');
    row.className = 'library-row';
    row.dataset.designId = design.id;

    // Everything below used to be direct children of `row` itself; wrapped in
    // its own flex-row container so List mode can stack an optional colorway
    // list (see buildColorwayListItem) beneath it within the same <li> —
    // keeping a design's colorway cards physically attached to it through a
    // drag-reorder, since a nested child moves with its parent for free.
    // Gallery mode's own CSS makes this wrapper the column-flex container that
    // `.library-row` itself used to be (its absolute-positioned children —
    // the drag handle, the colorway-count badge — still resolve against
    // `.library-row`'s own position:relative, since this wrapper has no
    // position of its own to intercept them).
    const main = document.createElement('div');
    main.className = 'library-row-main';

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'icon-btn library-drag-handle';
    handle.setAttribute('aria-label', 'Reorder');
    handle.title = 'Drag to reorder';
    handle.append(createIcon('grip-vertical'));

    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'library-row-thumb';
    thumb.setAttribute('aria-label', `Open ${design.name}`);
    thumb.addEventListener('click', () => callbacks.onOpen(design.id));
    if (design.thumbnailDataUrl) {
      const img = document.createElement('img');
      img.src = design.thumbnailDataUrl;
      img.alt = '';
      thumb.append(img);
    }
    // else: stays empty, styled as a neutral placeholder box via CSS — no
    // broken-image icon risk for a design never opened+saved under this feature.

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'library-row-info';
    info.addEventListener('click', () => callbacks.onOpen(design.id));

    const name = document.createElement('span');
    name.className = 'library-row-name';
    name.textContent = design.name;

    const beadType = document.createElement('span');
    beadType.className = 'library-row-beadtype';
    beadType.textContent = `${callbacks.resolveBeadTypeName(design.beadTypeKey)} — ${callbacks.resolveStitchTypeLabel(design.stitchType)}`;

    const updated = document.createElement('span');
    updated.className = 'library-row-updated';
    updated.textContent = relativeTime(design.updatedAt);

    info.append(name, beadType, updated);

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'icon-btn library-row-action';
    renameButton.setAttribute('aria-label', 'Rename');
    renameButton.title = 'Rename';
    renameButton.append(createIcon('pencil'));
    renameButton.addEventListener('click', () => callbacks.onRename(design.id));

    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.className = 'icon-btn library-row-action';
    duplicateButton.setAttribute('aria-label', 'Duplicate');
    duplicateButton.title = 'Duplicate';
    duplicateButton.append(createIcon('copy-plus'));
    duplicateButton.addEventListener('click', () => callbacks.onDuplicate(design.id));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'icon-btn library-row-action';
    deleteButton.setAttribute('aria-label', 'Delete');
    deleteButton.title = 'Delete';
    deleteButton.append(createIcon('trash-2'));
    deleteButton.addEventListener('click', () => {
      if (window.confirm(DELETE_CONFIRM_MESSAGE)) callbacks.onDelete(design.id);
    });

    const actions = document.createElement('div');
    actions.className = 'library-row-actions';
    actions.append(renameButton, duplicateButton, deleteButton);

    main.append(handle, thumb, info);
    if (design.colorways.length > 1) main.append(buildColorwayBadge(design));
    main.append(actions);
    row.append(main);

    // List mode only: an initially empty container, populated asynchronously
    // (see attachColorwayCards) when the colorways toggle is on and this
    // design has more than one — CSS hides it via :empty, so it costs nothing
    // for the common single-colorway case. Gallery mode ignores this entirely
    // and instead gets separate sibling <li> tiles, so its cards render as
    // actual grid cells "next to" this one rather than stacked beneath it.
    const colorwayList = document.createElement('div');
    colorwayList.className = 'library-colorway-list';
    row.append(colorwayList);

    return row;
  }

  // Small, non-draggable preview of one colorway — List mode's version, an
  // indented row beneath the design's own row. Gallery mode uses
  // buildColorwayGalleryTile instead (see attachColorwayCards).
  function buildColorwayListItem(design, colorway) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'library-colorway-list-item';
    item.setAttribute('aria-label', `Open colorway ${colorway.name}`);

    const thumb = document.createElement('div');
    thumb.className = 'library-colorway-list-item-thumb';
    if (colorway.thumbnailDataUrl) {
      const img = document.createElement('img');
      img.src = colorway.thumbnailDataUrl;
      img.alt = '';
      thumb.append(img);
    }

    const name = document.createElement('span');
    name.className = 'library-colorway-list-item-name';
    name.textContent = colorway.name;

    item.append(thumb, name);
    item.addEventListener('click', () => callbacks.onOpenColorway(design.id, colorway.id));
    return item;
  }

  // Gallery mode's version of the same preview — its own grid tile (a sibling
  // <li>, not nested in the design's own <li>) so it renders as an actual grid
  // cell next to the design's tile, per the feature's own "next to the main
  // card" ask. Not `.library-row`, so drag-reorder's sibling queries (which
  // look for that exact class) never treat it as a draggable row or a valid
  // drop target.
  function buildColorwayGalleryTile(design, colorway) {
    const tile = document.createElement('li');
    tile.className = 'library-colorway-tile';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'library-colorway-tile-inner';
    button.setAttribute('aria-label', `Open colorway ${colorway.name}`);

    const thumb = document.createElement('div');
    thumb.className = 'library-colorway-tile-thumb';
    if (colorway.thumbnailDataUrl) {
      const img = document.createElement('img');
      img.src = colorway.thumbnailDataUrl;
      img.alt = '';
      thumb.append(img);
    }

    const name = document.createElement('span');
    name.className = 'library-colorway-tile-name';
    name.textContent = colorway.name;

    button.append(thumb, name);
    button.addEventListener('click', () => callbacks.onOpenColorway(design.id, colorway.id));
    tile.append(button);
    return tile;
  }

  // Fetches and attaches a design's colorway previews once renderList has
  // already placed its main row/tile — kept out of renderList's own synchronous
  // pass since the preview thumbnails need an async DB read (customColors are
  // scoped per bead type, see handleRequestColorwayPreviews in main.js). If a
  // newer renderList call has already replaced rowEl by the time this
  // resolves, rowEl is simply detached — .after()/querySelector on a detached
  // node are silent no-ops, not errors, so no generation-counter guard is
  // needed here.
  async function attachColorwayCards(design, rowEl) {
    const colorways = await callbacks.onRequestColorwayPreviews(design.id);
    if (currentViewMode === 'gallery') {
      rowEl.after(...colorways.map((cw) => buildColorwayGalleryTile(design, cw)));
    } else {
      const wrap = rowEl.querySelector('.library-colorway-list');
      if (wrap) wrap.replaceChildren(...colorways.map((cw) => buildColorwayListItem(design, cw)));
    }
  }

  // Only shown when a pattern actually has more than one colorway — surfaces
  // that fact directly in the list (the original ask), and opens a small
  // picker with a rendered preview per colorway so "open it" means landing
  // on that exact colorway, not just the design's own stored default.
  function buildColorwayBadge(design) {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'icon-text-btn library-row-colorway-badge';
    badge.setAttribute('aria-label', `${design.colorways.length} colorways`);
    badge.title = `${design.colorways.length} colorways`;
    const count = document.createElement('span');
    count.textContent = String(design.colorways.length);
    badge.append(createIcon('layers'), count);
    badge.addEventListener('click', async () => {
      const colorways = await callbacks.onRequestColorwayPreviews(design.id);
      const chosenId = await promptColorwayPicker({ designName: design.name, colorways });
      if (chosenId) callbacks.onOpenColorway(design.id, chosenId);
    });
    return badge;
  }

  function renderList(designs) {
    currentDesigns = designs;
    const rows = designs.map(buildRow);
    listEl.replaceChildren(...rows);
    emptyMessageEl.hidden = designs.length > 0;
    if (currentShowColorways) {
      designs.forEach((design, i) => {
        if (design.colorways.length > 1) attachColorwayCards(design, rows[i]);
      });
    }
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

  // List mode only ever compares Y (a single vertical column). Gallery mode wraps
  // into a 2D grid, so within a tile's own row band the X position also matters —
  // otherwise dragging left/right within a row could never reorder within that
  // row, only jump to the row above/below. Falls back to the Y-only check outside
  // that band, covering drags across a row-wrap boundary.
  function isBeforeTarget(pointerX, pointerY, rect, viewMode) {
    if (viewMode !== 'gallery') return pointerY < rect.top + rect.height / 2;
    const withinRowBand = pointerY >= rect.top && pointerY <= rect.bottom;
    return withinRowBand
      ? pointerX < rect.left + rect.width / 2
      : pointerY < rect.top + rect.height / 2;
  }

  function handleListPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const siblings = [...listEl.querySelectorAll('.library-row')].filter((r) => r !== drag.rowEl);
    const target = siblings.find((sibling) => {
      const rect = sibling.getBoundingClientRect();
      return isBeforeTarget(e.clientX, e.clientY, rect, currentViewMode);
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

  // Row markup is identical in both modes (only CSS changes), so this never
  // re-renders rows itself — except
  // when colorway cards are showing, since List's nested indented items and
  // Gallery's sibling grid tiles are genuinely different markup, not a CSS-only
  // difference, and need rebuilding when switching between the two.
  function setViewMode(mode) {
    currentViewMode = mode;
    listEl.classList.toggle('gallery-mode', mode === 'gallery');
    viewListButton.setAttribute('aria-pressed', String(mode === 'list'));
    viewGalleryButton.setAttribute('aria-pressed', String(mode === 'gallery'));
    if (currentShowColorways) renderList(currentDesigns);
  }

  // Whether multi-colorway designs show their colorways inline as their own
  // cards (List: indented beneath; Gallery: sibling tiles next to it — see
  // attachColorwayCards). Off by default; doesn't re-render on its own the way
  // setViewMode's click handler does below, since a caller setting this before
  // the library's first renderList (see main.js's boot()) shouldn't trigger a
  // wasted render against an empty design list.
  function setShowColorways(value) {
    currentShowColorways = value;
    colorwaysToggle.setAttribute('aria-pressed', String(value));
  }

  viewListButton.addEventListener('click', () => {
    setViewMode('list');
    callbacks.onViewModeChanged('list');
  });
  viewGalleryButton.addEventListener('click', () => {
    setViewMode('gallery');
    callbacks.onViewModeChanged('gallery');
  });
  colorwaysToggle.addEventListener('click', () => {
    const next = !currentShowColorways;
    setShowColorways(next);
    renderList(currentDesigns);
    callbacks.onShowColorwaysChanged(next);
  });

  listEl.addEventListener('pointerdown', handleListPointerDown);
  listEl.addEventListener('pointermove', handleListPointerMove);
  listEl.addEventListener('pointerup', handleListPointerUp);
  listEl.addEventListener('pointercancel', handleListPointerUp);
  newButton.addEventListener('click', () => callbacks.onCreate());

  return { renderList, setViewMode, setShowColorways };
}
