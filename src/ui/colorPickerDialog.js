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

import {
  hexToHsv, hsvToHex, isValidHex, normalizeHex, clamp01, hexToRgba, hsvToHsl, hslToHsv, hslToHex,
} from '../palette/colorConversion.js';

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

function clampHueDeg(value) {
  return Math.min(360, Math.max(0, value));
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
  initialMode = 'hsv', onModeChanged,
} = {}) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('color-picker-dialog');
    const titleEl = document.getElementById('color-picker-title');
    const closeButton = document.getElementById('color-picker-close');
    const modeSwitchButton = document.getElementById('color-picker-mode-switch');
    const modeLabelHsv = document.getElementById('color-picker-mode-label-hsv');
    const modeLabelHsl = document.getElementById('color-picker-mode-label-hsl');
    const hsvControlsEl = document.getElementById('color-picker-hsv-controls');
    const hslControlsEl = document.getElementById('color-picker-hsl-controls');
    const svEl = document.getElementById('color-picker-sv');
    const svThumb = document.getElementById('color-picker-sv-thumb');
    const hueEl = document.getElementById('color-picker-hue');
    const hueThumb = document.getElementById('color-picker-hue-thumb');
    const hslHRange = document.getElementById('color-picker-hsl-h-range');
    const hslHNumber = document.getElementById('color-picker-hsl-h-number');
    const hslSRange = document.getElementById('color-picker-hsl-s-range');
    const hslSNumber = document.getElementById('color-picker-hsl-s-number');
    const hslLRange = document.getElementById('color-picker-hsl-l-range');
    const hslLNumber = document.getElementById('color-picker-hsl-l-number');
    const swatchEl = document.getElementById('color-picker-swatch');
    const hexInput = document.getElementById('color-picker-hex-input');
    const appearanceEl = document.getElementById('color-picker-appearance');
    const opacityRange = document.getElementById('color-picker-opacity-range');
    const opacityValueLabel = document.getElementById('color-picker-opacity-value');
    const lusterMatteButton = document.getElementById('color-picker-luster-matte');
    const lusterShinyButton = document.getElementById('color-picker-luster-shiny');
    const nameInput = document.getElementById('color-picker-name-input');
    const cancelButton = document.getElementById('color-picker-cancel');
    const confirmButton = document.getElementById('color-picker-confirm');

    let hsv = hexToHsv(isValidHex(initialHex) ? normalizeHex(initialHex) : '#ff0000');
    let alphaPercent = clamp01(initialAlphaPercent / 100) * 100;
    let luster = initialLuster === 'shiny' ? 'shiny' : 'matte';
    let mode = initialMode === 'hsl' ? 'hsl' : 'hsv';
    // HSL's own saturation is mathematically meaningless at l=0 (black) or
    // l=1 (white) — hslToHsv collapses ANY s to hsv.s=0 there, since no s
    // value changes what a fully-black/white color looks like. Left alone,
    // that makes the S slider snap to 0 the instant L reaches an extreme and
    // stay there once L comes back, which reads as "S got reset." This
    // remembers the last real (non-degenerate) S so it can be shown/reused
    // once L moves off the extreme again — updated in render() whenever S is
    // well-defined, read from setHslChannel/render() whenever it isn't.
    let stickySaturation = hsvToHsl(hsv).s;

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

    // Re-derives every control (SV square, hue bar, HSL sliders, hex field,
    // swatch) from `hsv`, the single source of truth. A text-entry field that
    // currently has focus (hex or one of the HSL number boxes) is skipped, so
    // typing into it isn't fought by a reformat on every keystroke — it's
    // brought back in sync on blur instead, once focus has moved on.
    function render() {
      const hex = currentHex();
      svEl.style.setProperty('--picker-hue', hsv.h);
      svThumb.style.left = `${hsv.s * 100}%`;
      svThumb.style.top = `${(1 - hsv.v) * 100}%`;
      hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
      // A real translucent fill (not alphaOverWhite's precomposited-against-
      // white opaque hex, used everywhere else a swatch appears) — this is
      // the one DOM swatch in the app that owns its own fixed backdrop (the
      // checkerboard set in CSS, layered underneath via --swatch-fill), so
      // unlike a palette/Manage-Colors swatch sitting on an unpredictable
      // ambient background, true alpha compositing here is safe and is the
      // whole point (it's what actually shows the checkerboard through).
      swatchEl.style.setProperty('--swatch-fill', hexToRgba(hex, alphaPercent));

      const hsl = hsvToHsl(hsv);
      const atSaturationExtreme = hsl.l <= 0 || hsl.l >= 1;
      if (!atSaturationExtreme) stickySaturation = hsl.s;
      // Show/derive-gradients-from the remembered S while L sits at an
      // extreme (see stickySaturation's own comment) — the real hsl.s here
      // is always exactly 0 in that regime, which isn't what should display.
      const displayS = atSaturationExtreme ? stickySaturation : hsl.s;

      const hRounded = Math.round(hsl.h);
      const sRounded = Math.round(displayS * 1000) / 10;
      const lRounded = Math.round(hsl.l * 1000) / 10;
      hslHRange.value = String(hRounded);
      hslSRange.value = String(sRounded);
      hslLRange.value = String(lRounded);
      // Saturation's track previews gray-to-vivid at the CURRENT hue/lightness;
      // lightness's previews black-to-hue-color-to-white at the current
      // hue/saturation — each track always shows what dragging it would do,
      // not a fixed gradient (only hue's own track, set in CSS, is fixed).
      hslSRange.style.background =
        `linear-gradient(to right, ${hslToHex({ h: hsl.h, s: 0, l: hsl.l })}, ${hslToHex({ h: hsl.h, s: 1, l: hsl.l })})`;
      hslLRange.style.background =
        `linear-gradient(to right, #000, ${hslToHex({ h: hsl.h, s: displayS, l: 0.5 })}, #fff)`;

      if (document.activeElement !== hexInput) hexInput.value = hex;
      if (document.activeElement !== hslHNumber) hslHNumber.value = String(hRounded);
      if (document.activeElement !== hslSNumber) hslSNumber.value = sRounded.toFixed(1);
      if (document.activeElement !== hslLNumber) hslLNumber.value = lRounded.toFixed(1);
    }

    function updateModeButtons() {
      const isHsl = mode === 'hsl';
      modeSwitchButton.setAttribute('aria-pressed', String(isHsl));
      modeLabelHsv.classList.toggle('color-picker-mode-label-active', !isHsl);
      modeLabelHsl.classList.toggle('color-picker-mode-label-active', isHsl);
      hsvControlsEl.hidden = mode !== 'hsv';
      hslControlsEl.hidden = mode !== 'hsl';
    }

    // The toggle click IS the final action for the mode preference (persisted
    // immediately via onModeChanged, same "no separate save step" convention
    // canvas background's own mode select already uses) — it's remembered
    // for next time regardless of whether this particular color pick is
    // later confirmed or cancelled.
    function setMode(next) {
      if (mode === next) return;
      mode = next;
      updateModeButtons();
      onModeChanged?.(mode);
    }

    function handleModeSwitchClick() {
      setMode(mode === 'hsv' ? 'hsl' : 'hsv');
    }

    function setFromSvPoint(clientX, clientY) {
      const rect = svEl.getBoundingClientRect();
      hsv = {
        ...hsv,
        s: clamp01((clientX - rect.left) / rect.width),
        v: 1 - clamp01((clientY - rect.top) / rect.height),
      };
      render();
    }

    function setFromHuePoint(clientX) {
      const rect = hueEl.getBoundingClientRect();
      hsv = { ...hsv, h: clamp01((clientX - rect.left) / rect.width) * 360 };
      render();
    }

    // Applies one changed HSL channel on top of the OTHER two channels' exact
    // current values (re-derived fresh from `hsv` each time, never accumulated
    // from a slider's own last reading) — h passes through the hsv<->hsl
    // round trip untouched, so dragging s/l can't drift h, and vice versa.
    // s specifically starts from stickySaturation, not the real (possibly
    // forced-to-0) hsl.s — this is what makes moving L away from 0/100 bring
    // back the s the user actually had, instead of a flat gray/white.
    function setHslChannel(channel, rawValue) {
      const hsl = hsvToHsl(hsv);
      const baseS = hsl.l <= 0 || hsl.l >= 1 ? stickySaturation : hsl.s;
      const updated = { h: hsl.h, s: baseS, l: hsl.l };
      if (channel === 'h') updated.h = clampHueDeg(rawValue);
      else if (channel === 's') {
        updated.s = clamp01(rawValue / 100);
        stickySaturation = updated.s;
      } else updated.l = clamp01(rawValue / 100);
      hsv = hslToHsv(updated);
    }

    function handleHslHRangeInput() {
      setHslChannel('h', Number(hslHRange.value));
      render();
    }
    function handleHslSRangeInput() {
      setHslChannel('s', Number(hslSRange.value));
      render();
    }
    function handleHslLRangeInput() {
      setHslChannel('l', Number(hslLRange.value));
      render();
    }
    function handleHslHNumberInput() {
      const raw = Number(hslHNumber.value);
      if (Number.isNaN(raw)) return;
      setHslChannel('h', raw);
      render();
    }
    function handleHslSNumberInput() {
      const raw = Number(hslSNumber.value);
      if (Number.isNaN(raw)) return;
      setHslChannel('s', raw);
      render();
    }
    function handleHslLNumberInput() {
      const raw = Number(hslLNumber.value);
      if (Number.isNaN(raw)) return;
      setHslChannel('l', raw);
      render();
    }
    // Shared by all three number fields — reformats to the canonical rounded
    // value now that focus has moved on, mirroring handleHexBlur below.
    function handleHslNumberBlur() {
      render();
    }

    function handleHexInput() {
      const raw = hexInput.value.trim();
      if (isValidHex(raw)) {
        hsv = hexToHsv(normalizeHex(raw));
        render();
      }
    }

    function handleHexBlur() {
      // Reformats to the canonical 6-digit lowercase form, or reverts an
      // invalid/incomplete value back to the last valid color.
      render();
    }

    function handleOpacityRangeInput() {
      alphaPercent = Number(opacityRange.value);
      updateOpacityLabel();
      render();
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
      modeSwitchButton.removeEventListener('click', handleModeSwitchClick);
      hslHRange.removeEventListener('input', handleHslHRangeInput);
      hslSRange.removeEventListener('input', handleHslSRangeInput);
      hslLRange.removeEventListener('input', handleHslLRangeInput);
      hslHNumber.removeEventListener('input', handleHslHNumberInput);
      hslSNumber.removeEventListener('input', handleHslSNumberInput);
      hslLNumber.removeEventListener('input', handleHslLNumberInput);
      hslHNumber.removeEventListener('blur', handleHslNumberBlur);
      hslSNumber.removeEventListener('blur', handleHslNumberBlur);
      hslLNumber.removeEventListener('blur', handleHslNumberBlur);
      hexInput.removeEventListener('input', handleHexInput);
      hexInput.removeEventListener('blur', handleHexBlur);
      opacityRange.removeEventListener('input', handleOpacityRangeInput);
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
    modeSwitchButton.addEventListener('click', handleModeSwitchClick);
    hslHRange.addEventListener('input', handleHslHRangeInput);
    hslSRange.addEventListener('input', handleHslSRangeInput);
    hslLRange.addEventListener('input', handleHslLRangeInput);
    hslHNumber.addEventListener('input', handleHslHNumberInput);
    hslSNumber.addEventListener('input', handleHslSNumberInput);
    hslLNumber.addEventListener('input', handleHslLNumberInput);
    hslHNumber.addEventListener('blur', handleHslNumberBlur);
    hslSNumber.addEventListener('blur', handleHslNumberBlur);
    hslLNumber.addEventListener('blur', handleHslNumberBlur);
    hexInput.addEventListener('input', handleHexInput);
    hexInput.addEventListener('blur', handleHexBlur);
    opacityRange.addEventListener('input', handleOpacityRangeInput);
    lusterMatteButton.addEventListener('click', handleLusterMatte);
    lusterShinyButton.addEventListener('click', handleLusterShiny);
    cancelButton.addEventListener('click', onCancel);
    closeButton.addEventListener('click', onCancel);
    confirmButton.addEventListener('click', onConfirm);
    nameInput.addEventListener('keydown', onNameKeydown);
    dialog.addEventListener('cancel', onCancel);

    updateOpacityLabel();
    updateLusterButtons();
    updateModeButtons();
    render();
    dialog.showModal();
  });
}
