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

function findLongPressTarget(el) {
  const candidate = el.closest?.('[title]');
  if (!candidate || !candidate.title) return null;
  return candidate.textContent.trim() === '' ? candidate : null;
}

// A tooltip for a control inside an open native <dialog> must be appended
// inside that dialog (not document.body): a <dialog>'s top-layer promotion
// covers its whole subtree, painting above its own ::backdrop, but a
// sibling element appended to body is NOT in that top layer and would
// render invisibly behind the backdrop instead.
function currentTooltipContainer() {
  const openDialogs = document.querySelectorAll('dialog[open]');
  return openDialogs.length > 0 ? openDialogs[openDialogs.length - 1] : document.body;
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

function showTooltip(target) {
  const el = ensureTooltipEl();
  const container = currentTooltipContainer();
  if (el.parentElement !== container) container.appendChild(el);
  el.textContent = target.title;
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
    showTooltip(pressTarget);
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
  hideTooltip();
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

let initialized = false;

export function initLongPressTooltips() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('pointerdown', handlePointerDown, { passive: true });
  document.addEventListener('pointermove', handlePointerMove, { passive: true });
  document.addEventListener('pointerup', handlePointerEnd, { passive: true });
  document.addEventListener('pointercancel', handlePointerEnd, { passive: true });
  document.addEventListener('click', handleClickCapture, true);
}
