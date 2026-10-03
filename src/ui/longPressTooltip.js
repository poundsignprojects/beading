// iOS/iPadOS Safari never shows the native `title` tooltip on tap or
// long-press — only desktop's mouse hover does. Icon-only controls (no
// visible text — .icon-btn, color swatches) rely on `title` as their only
// label, so touch/Pencil users have no way to learn what an unfamiliar icon
// does. This shows a small on-screen bubble after holding a press for
// LONG_PRESS_MS, using that element's own `title`, and suppresses the click
// that would otherwise follow release — a long press means "tell me what
// this does," not "do it," mirroring how a mouse hover-then-click are two
// separate steps. Release before the threshold and the control behaves
// exactly as it always has.
//
// No per-element wiring needed: eligibility is checked at press time by
// walking up to the nearest `[title]` ancestor and testing whether it has
// any visible text of its own (an .icon-text-btn like "Back to Library"
// keeps its label and is excluded). Newly-rendered rows (library list,
// Manage Colors, Bead Catalog) are covered automatically since nothing is
// pre-scanned or cached.
//
// A second, related role (added for the Mirror/Rotate selection-controls
// consolidation): registerLongPressMenu(el, getItems) opts a specific
// element OUT of the plain-tooltip path and INTO opening a real actionMenu.js
// popup instead — same long-press timing/click-suppression machinery, just a
// different thing happens at the moment the press resolves. getItems is
// called fresh every time (not cached), so a menu always reflects current
// state (e.g. which item is currently disabled) with no separate "refresh"
// call needed anywhere.
//
// A third variant, opted into via { showTooltip: true } (used by the color
// swatches): shows BOTH at once — the element's own `title` as a plain-
// tooltip bubble above it, and the action menu below — rather than either/
// or. The tooltip's lifetime is then tied to the menu's own (hidden via the
// menu's onClose, not on pointerup) so the two read as one paired popup —
// see tooltipTiedToOpenMenu below. Every other registerLongPressMenu caller
// (Mirror/Rotate/Select's own long-press menus) already explains the
// long-press gesture itself in its `title` ("long-press or right-click for
// more options"), so showing that as a tooltip at the moment the gesture
// just resolved would be redundant — they're left at menu-only.

import { openActionMenu } from './actionMenu.js';
import { currentTopLayerContainer } from './topLayerContainer.js';

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10; // finger drift past this cancels the pending tooltip — treat it as a scroll/drag, not a hold
const AUTO_HIDE_MS = 4000; // backstop in case a pointerup/cancel is somehow missed

let tooltipEl = null;
let pressTimer = null;
let autoHideTimer = null;
let pressTarget = null;
let startX = 0;
let startY = 0;
let suppressClickOn = null;
let tooltipTiedToOpenMenu = false; // see the showTooltip combo note above
const menuRegistry = new WeakMap(); // Element -> {getItems, showTooltip}, see registerLongPressMenu below

export function registerLongPressMenu(el, getItems, { showTooltip = false } = {}) {
  menuRegistry.set(el, { getItems, showTooltip });
}

function findLongPressTarget(el) {
  const menuTarget = el.closest?.('[data-has-menu]');
  if (menuTarget && menuRegistry.has(menuTarget)) return menuTarget;
  const candidate = el.closest?.('[title]');
  if (!candidate || !candidate.title) return null;
  return candidate.textContent.trim() === '' ? candidate : null;
}

function ensureTooltipEl() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'long-press-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.hidden = true;
  }
  return tooltipEl;
}

function showTooltip(target, text) {
  const el = ensureTooltipEl();
  const container = currentTopLayerContainer();
  if (el.parentElement !== container) container.appendChild(el);
  el.textContent = text;
  el.hidden = false;

  const targetRect = target.getBoundingClientRect();
  const tooltipRect = el.getBoundingClientRect();
  let left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - tooltipRect.width - 4));
  let top = targetRect.top - tooltipRect.height - 8;
  if (top < 4) top = targetRect.bottom + 8; // flip below when there's no room above (e.g. top-bar controls)
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  clearTimeout(autoHideTimer);
  autoHideTimer = setTimeout(hideTooltip, AUTO_HIDE_MS);
}

function hideTooltip() {
  clearTimeout(autoHideTimer);
  if (tooltipEl) tooltipEl.hidden = true;
}

// Shared by the long-press timer and the right-click handler below — resolves
// one registered {getItems, showTooltip} entry into whatever should actually
// happen (menu alone, or tooltip+menu paired together).
function triggerRegisteredMenu(target, registered) {
  if (registered.showTooltip) {
    showTooltip(target, target.title);
    tooltipTiedToOpenMenu = true;
    openActionMenu(target, registered.getItems(), {
      onClose: () => {
        tooltipTiedToOpenMenu = false;
        hideTooltip();
      },
    });
  } else {
    openActionMenu(target, registered.getItems());
  }
}

function clearPressTimer() {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function handlePointerDown(e) {
  if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return; // mouse already gets the native hover tooltip
  const target = findLongPressTarget(e.target);
  if (!target) return;
  pressTarget = target;
  startX = e.clientX;
  startY = e.clientY;
  clearPressTimer();
  pressTimer = setTimeout(() => {
    pressTimer = null;
    if (!pressTarget) return;
    const registered = menuRegistry.get(pressTarget);
    if (registered) {
      triggerRegisteredMenu(pressTarget, registered);
    } else {
      showTooltip(pressTarget, pressTarget.title);
    }
    suppressClickOn = pressTarget;
  }, LONG_PRESS_MS);
}

function handlePointerMove(e) {
  if (!pressTarget || !pressTimer) return; // already resolved (fired or cancelled) — nothing left to track
  if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_CANCEL_PX) {
    clearPressTimer();
    pressTarget = null;
  }
}

function handlePointerEnd() {
  clearPressTimer();
  pressTarget = null;
  // A tooltip paired with a still-open menu (see showTooltip's combo note
  // above) outlives the finger lift — it hides via the menu's own onClose
  // instead, so the two disappear together rather than the name vanishing
  // while the link stays.
  if (!tooltipTiedToOpenMenu) hideTooltip();
}

// Capturing so this runs before the target's own click listener; suppresses
// only the one click that would otherwise follow a long-press-triggered
// tooltip, then gets out of the way for every click after.
function handleClickCapture(e) {
  if (!suppressClickOn) return;
  if (suppressClickOn === e.target || suppressClickOn.contains(e.target)) {
    e.preventDefault();
    e.stopPropagation();
  }
  suppressClickOn = null;
}

// Long-press is touch/pen only (handlePointerDown's own pointerType guard) —
// a mouse gets the native title hover tooltip instead, but that leaves no
// mouse-accessible path to a registered menu's other items at all. This dev
// project is used from a Mac trackpad/mouse as well as the iPad (see
// CLAUDE.md), so right-click doubles as the desktop equivalent: same menu,
// standard "more options" convention, no long-press needed.
function handleContextMenu(e) {
  const menuTarget = e.target.closest?.('[data-has-menu]');
  const registered = menuTarget && menuRegistry.get(menuTarget);
  if (!registered) return;
  e.preventDefault();
  triggerRegisteredMenu(menuTarget, registered);
}

let initialized = false;

export function initLongPressTooltips() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('pointerdown', handlePointerDown, { passive: true });
  document.addEventListener('pointermove', handlePointerMove, { passive: true });
  document.addEventListener('pointerup', handlePointerEnd, { passive: true });
  document.addEventListener('pointercancel', handlePointerEnd, { passive: true });
  document.addEventListener('click', handleClickCapture, true);
  document.addEventListener('contextmenu', handleContextMenu);
}
