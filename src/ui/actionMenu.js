// Small popup menu anchored to a trigger element — shared by two different
// triggers: longPressTooltip.js's long-press/right-click (for a tool-rail
// button that consolidates several variants, e.g. Mirror/Rotate) and a plain
// click on a row's "⋯" overflow button (color/layer/colorway/bead-catalog
// rows). Both just call openActionMenu(anchorEl, items) — this module
// doesn't know or care which triggered it.
//
// items: [{ label, icon?, disabled?, destructive?, onSelect }]
//   - icon is a name passed straight to icons.js's createIcon().
//   - destructive renders the label in the same red used elsewhere for
//     dangerous actions (#resize-confirm.destructive).
//   - disabled items render (so the option is still visible/explained by its
//     label) but don't fire onSelect.
//
// Singleton, like longPressTooltip.js's own tooltipEl — opening a second
// menu closes whatever's already open first.

import { createIcon } from './icons.js';
import { currentTopLayerContainer } from './topLayerContainer.js';

let menuEl = null;
let currentOnClose = null;

function ensureMenuEl() {
  if (!menuEl) {
    menuEl = document.createElement('div');
    menuEl.id = 'action-menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.hidden = true;
  }
  return menuEl;
}

export function closeActionMenu() {
  if (!menuEl || menuEl.hidden) return;
  menuEl.hidden = true;
  menuEl.replaceChildren();
  document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  document.removeEventListener('keydown', handleKeydown, true);
  const onClose = currentOnClose;
  currentOnClose = null;
  if (onClose) onClose();
}

function handleOutsidePointerDown(e) {
  if (menuEl && !menuEl.contains(e.target)) closeActionMenu();
}

function handleKeydown(e) {
  if (e.key !== 'Escape') return;
  // Consume the keypress — closing the menu should be the only effect of this
  // Escape, not also fall through to (e.g.) editorView.js's own Escape
  // handler and deselect whatever the menu was open over.
  e.preventDefault();
  e.stopPropagation();
  closeActionMenu();
}

function positionMenu(anchorEl) {
  const anchorRect = anchorEl.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();
  let left = anchorRect.left;
  left = Math.max(4, Math.min(left, window.innerWidth - menuRect.width - 4));
  let top = anchorRect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - 4) {
    top = anchorRect.top - menuRect.height - 6; // flip above when there's no room below
  }
  top = Math.max(4, top);
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

export function openActionMenu(anchorEl, items, { onClose } = {}) {
  closeActionMenu(); // singleton — fires the previous menu's own onClose, if any
  const el = ensureMenuEl();
  currentOnClose = onClose ?? null;

  const container = currentTopLayerContainer();
  if (el.parentElement !== container) container.appendChild(el);
  el.replaceChildren();

  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.className = 'action-menu-item' + (item.destructive ? ' action-menu-item-destructive' : '');
    btn.disabled = !!item.disabled;
    if (item.icon) btn.append(createIcon(item.icon));
    const label = document.createElement('span');
    label.textContent = item.label;
    btn.append(label);
    btn.addEventListener('click', () => {
      closeActionMenu();
      if (!item.disabled) item.onSelect?.();
    });
    el.append(btn);
  }

  el.hidden = false;
  positionMenu(anchorEl);

  // Bound after this tick so the very click/tap that opened the menu can't
  // also register as the "outside" tap that immediately closes it again.
  setTimeout(() => {
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    document.addEventListener('keydown', handleKeydown, true);
  }, 0);
}
