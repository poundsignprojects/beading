// Custom color picker — replaces the native <input type="color"> everywhere in
// the app. That native input is what rendered as two genuinely different OS
// pickers (macOS's full color panel vs. iPadOS's much more limited sheet) —
// a page can't choose which one Safari shows, so the only way to make Mac and
// iPad match is to stop using the OS picker at all and draw our own. Self-
// contained like resizeDialog.js/copyColorDialog.js — reads/writes only the
// #color-picker-dialog markup, no hooks into main.js.
//
// Unlike the native input this replaces, there's a real "done" signal here
// (the Add/Done button) — so nothing is applied to the caller's data until
// confirm, and Cancel just discards. That's why this needed no equivalent of
// the old "Undo Color Change" button/live-apply-while-dragging machinery: that
// existed specifically because the native picker gave no reliable dismissal
// signal to hang a commit on.

import { hexToHsv, hsvToHex, isValidHex, normalizeHex, clamp01, alphaOverWhite } from '../palette/colorConversion.js';

// Where the "Transparent" opacity preset chip sets the slider to — a
// reasonable starting point, not a lock; the slider stays freely adjustable
// after clicking it, same as every other preset chip in this app.
const TRANSPARENT_OPACITY_PRESET = 50;

// Wires pointer-driven dragging on `el` (mouse, touch, and pen all go through
// the same Pointer Events path — consistent with the rest of this app's
// interaction code, e.g. pointerRouter.js). Pointer capture means el keeps
// receiving move/up events for that pointer regardless of where it travels,
// so a drag doesn't get lost if the finger/cursor leaves the element's bounds.
function bindDrag(el, onPoint) {
  let activePointerId = null;
  function handleDown(e) {
    activePointerId = e.pointerId;
    el.setPointerCapture(activePointerId);
    onPoint(e.clientX, e.clientY);
    e.preventDefault();
  }
  function handleMove(e) {
    if (e.pointerId !== activePointerId) return;
    onPoint(e.clientX, e.clientY);
  }
  function handleUp(e) {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
  }
  el.addEventListener('pointerdown', handleDown);
  el.addEventListener('pointermove', handleMove);
  el.addEventListener('pointerup', handleUp);
  el.addEventListener('pointercancel', handleUp);
  return () => {
    el.removeEventListener('pointerdown', handleDown);
    el.removeEventListener('pointermove', handleMove);
    el.removeEventListener('pointerup', handleUp);
    el.removeEventListener('pointercancel', handleUp);
  };
}

// Resolves with { hex, name, alphaPercent, luster } on confirm when
// showAppearanceControls is true (alphaPercent/luster included; name omitted
// when showNameField is false), or plain { hex, name? } when
// showAppearanceControls is false — the original, pre-finish-effects shape,
// unchanged for any caller that just wants a hex (e.g. the canvas-background
// custom-color picker). Resolves null on cancel/Esc.
export function promptColorPicker({
  initialHex = '#ff0000', title, confirmLabel, showNameField = false, initialName = '',
  showAppearanceControls = true, initialAlphaPercent = 100, initialLuster = 'matte',
} = {}) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('color-picker-dialog');
    const titleEl = document.getElementById('color-picker-title');
    const closeButton = document.getElementById('color-picker-close');
    const svEl = document.getElementById('color-picker-sv');
    const svThumb = document.getElementById('color-picker-sv-thumb');
    const hueEl = document.getElementById('color-picker-hue');
    const hueThumb = document.getElementById('color-picker-hue-thumb');
    const swatchEl = document.getElementById('color-picker-swatch');
    const hexInput = document.getElementById('color-picker-hex-input');
    const appearanceEl = document.getElementById('color-picker-appearance');
    const opacityRange = document.getElementById('color-picker-opacity-range');
    const opacityValueLabel = document.getElementById('color-picker-opacity-value');
    const opacityOpaqueButton = document.getElementById('color-picker-opacity-opaque');
    const opacityTransparentButton = document.getElementById('color-picker-opacity-transparent');
    const lusterMatteButton = document.getElementById('color-picker-luster-matte');
    const lusterShinyButton = document.getElementById('color-picker-luster-shiny');
    const nameInput = document.getElementById('color-picker-name-input');
    const cancelButton = document.getElementById('color-picker-cancel');
    const confirmButton = document.getElementById('color-picker-confirm');

    let hsv = hexToHsv(isValidHex(initialHex) ? normalizeHex(initialHex) : '#ff0000');
    let alphaPercent = clamp01(initialAlphaPercent / 100) * 100;
    let luster = initialLuster === 'shiny' ? 'shiny' : 'matte';

    titleEl.textContent = title ?? (showNameField ? 'Add Color' : 'Edit Color');
    confirmButton.textContent = confirmLabel ?? (showNameField ? 'Add' : 'Done');
    nameInput.hidden = !showNameField;
    nameInput.value = initialName;
    appearanceEl.hidden = !showAppearanceControls;
    opacityRange.value = String(alphaPercent);

    function currentHex() {
      return hsvToHex(hsv);
    }

    function updateOpacityLabel() {
      opacityValueLabel.textContent = `${Math.round(alphaPercent)}%`;
    }

    function updateLusterButtons() {
      lusterMatteButton.setAttribute('aria-pressed', String(luster === 'matte'));
      lusterShinyButton.setAttribute('aria-pressed', String(luster === 'shiny'));
      swatchEl.classList.toggle('swatch-shiny', luster === 'shiny');
    }

    // Updates everything except the hex text field — used while the hex field
    // itself is being typed into, so we don't fight the user's cursor by
    // reformatting on every keystroke.
    function updateVisuals() {
      const hex = currentHex();
      svEl.style.setProperty('--picker-hue', hsv.h);
      svThumb.style.left = `${hsv.s * 100}%`;
      svThumb.style.top = `${(1 - hsv.v) * 100}%`;
      hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
      // DOM swatch previews are pinned to a white backing regardless of where
      // this dialog itself renders (see colorConversion.js's alphaOverWhite) —
      // a plain rgba() would composite differently against whatever's really
      // behind this element. When appearance controls are hidden, alphaPercent
      // stays at its 100 default, so this is just the opaque hex either way.
      swatchEl.style.backgroundColor = alphaOverWhite(hex, alphaPercent);
    }

    function updateDisplay() {
      updateVisuals();
      hexInput.value = currentHex();
    }

    function setFromSvPoint(clientX, clientY) {
      const rect = svEl.getBoundingClientRect();
      hsv = {
        ...hsv,
        s: clamp01((clientX - rect.left) / rect.width),
        v: 1 - clamp01((clientY - rect.top) / rect.height),
      };
      updateDisplay();
    }

    function setFromHuePoint(clientX) {
      const rect = hueEl.getBoundingClientRect();
      hsv = { ...hsv, h: clamp01((clientX - rect.left) / rect.width) * 360 };
      updateDisplay();
    }

    function handleHexInput() {
      const raw = hexInput.value.trim();
      if (isValidHex(raw)) {
        hsv = hexToHsv(normalizeHex(raw));
        updateVisuals();
      }
    }

    function handleHexBlur() {
      // Reformats to the canonical 6-digit lowercase form, or reverts an
      // invalid/incomplete value back to the last valid color.
      hexInput.value = currentHex();
    }

    // Presets are a shortcut into the same slider/toggle fields, never a
    // separate stored mode — clicking one just moves the control to that
    // value exactly as if it had been dragged/tapped there, and it stays
    // freely adjustable afterward.
    function handleOpacityRangeInput() {
      alphaPercent = Number(opacityRange.value);
      updateOpacityLabel();
      updateVisuals();
    }
    function handleOpacityOpaquePreset() {
      alphaPercent = 100;
      opacityRange.value = '100';
      updateOpacityLabel();
      updateVisuals();
    }
    function handleOpacityTransparentPreset() {
      alphaPercent = TRANSPARENT_OPACITY_PRESET;
      opacityRange.value = String(TRANSPARENT_OPACITY_PRESET);
      updateOpacityLabel();
      updateVisuals();
    }
    function handleLusterMatte() {
      luster = 'matte';
      updateLusterButtons();
    }
    function handleLusterShiny() {
      luster = 'shiny';
      updateLusterButtons();
    }

    function cleanup() {
      unbindSv();
      unbindHue();
      hexInput.removeEventListener('input', handleHexInput);
      hexInput.removeEventListener('blur', handleHexBlur);
      opacityRange.removeEventListener('input', handleOpacityRangeInput);
      opacityOpaqueButton.removeEventListener('click', handleOpacityOpaquePreset);
      opacityTransparentButton.removeEventListener('click', handleOpacityTransparentPreset);
      lusterMatteButton.removeEventListener('click', handleLusterMatte);
      lusterShinyButton.removeEventListener('click', handleLusterShiny);
      cancelButton.removeEventListener('click', onCancel);
      closeButton.removeEventListener('click', onCancel);
      confirmButton.removeEventListener('click', onConfirm);
      nameInput.removeEventListener('keydown', onNameKeydown);
      dialog.removeEventListener('cancel', onCancel);
    }

    function onCancel(e) {
      e?.preventDefault();
      cleanup();
      dialog.close();
      resolve(null);
    }

    function onConfirm() {
      if (showNameField) {
        const name = nameInput.value.trim();
        if (!name) {
          nameInput.focus();
          return;
        }
        cleanup();
        dialog.close();
        resolve(showAppearanceControls ? { hex: currentHex(), name, alphaPercent, luster } : { hex: currentHex(), name });
        return;
      }
      cleanup();
      dialog.close();
      resolve(showAppearanceControls ? { hex: currentHex(), alphaPercent, luster } : { hex: currentHex() });
    }

    function onNameKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    }

    const unbindSv = bindDrag(svEl, setFromSvPoint);
    const unbindHue = bindDrag(hueEl, (x) => setFromHuePoint(x));
    hexInput.addEventListener('input', handleHexInput);
    hexInput.addEventListener('blur', handleHexBlur);
    opacityRange.addEventListener('input', handleOpacityRangeInput);
    opacityOpaqueButton.addEventListener('click', handleOpacityOpaquePreset);
    opacityTransparentButton.addEventListener('click', handleOpacityTransparentPreset);
    lusterMatteButton.addEventListener('click', handleLusterMatte);
    lusterShinyButton.addEventListener('click', handleLusterShiny);
    cancelButton.addEventListener('click', onCancel);
    closeButton.addEventListener('click', onCancel);
    confirmButton.addEventListener('click', onConfirm);
    nameInput.addEventListener('keydown', onNameKeydown);
    dialog.addEventListener('cancel', onCancel);

    updateOpacityLabel();
    updateLusterButtons();
    updateDisplay();
    dialog.showModal();
  });
}
