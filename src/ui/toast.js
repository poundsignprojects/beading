// Non-blocking replacement for the purely-informational window.alert() calls
// (a blocked delete explaining why, "nothing to crop to," etc.) — everything
// that actually needs a yes/no decision or text entry stays a real
// window.confirm()/window.prompt(), left untouched. Single-slot, like
// longPressTooltip.js's tooltipEl / driveReconnectBanner.js's banner: a
// second showToast() call replaces whatever's currently showing rather than
// stacking, and it dismisses either by its own close button or a generous
// auto-hide backstop (8s — longer than the tooltip's, since these messages
// tend to be denser, e.g. a list of pattern names).

import { currentTopLayerContainer } from './topLayerContainer.js';

const AUTO_HIDE_MS = 8000;

let toastEl = null;
let messageEl = null;
let hideTimer = null;

function ensureToastEl() {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.hidden = true;

    messageEl = document.createElement('span');
    messageEl.id = 'toast-message';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.id = 'toast-close';
    closeButton.textContent = '×'; // ×
    closeButton.setAttribute('aria-label', 'Dismiss');
    closeButton.addEventListener('click', hideToast);

    toastEl.append(messageEl, closeButton);
  }
  return toastEl;
}

export function hideToast() {
  clearTimeout(hideTimer);
  if (toastEl) toastEl.hidden = true;
}

export function showToast(message) {
  const el = ensureToastEl();
  const container = currentTopLayerContainer();
  if (el.parentElement !== container) container.appendChild(el);
  messageEl.textContent = message;
  el.hidden = false;

  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideToast, AUTO_HIDE_MS);
}
