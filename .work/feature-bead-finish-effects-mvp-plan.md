# Feature Plan — Bead Finish Effects, MVP (transparency + matte/shiny)

## Context

User asked whether bead colors could show more than flat hue — semi-transparency, color flecks, different lusters, matte vs. shiny. Full real-world bead finishes (Miyuki's own catalog uses terms like Transparent, Opaque, Matte, Luster, AB/Aurora Borealis, Silver-Lined, Color-Lined, Ceylon, Picasso) are a real taxonomy, but building bespoke rendering for all of them at once is open-ended scope. This plan is the **MVP slice**: transparency (an alpha value) plus a binary matte/shiny luster. The companion doc, `.work/feature-bead-finish-effects-full-plan.md`, covers the rest (AB/metallic/ceylon lusters, silver-lined/color-lined/fleck/picasso overlays) as later work.

**Load-bearing decision carried from that discussion**: the data model below is written as the *eventual full* shape from the start (`alphaPercent`, `luster`, plus reserved-but-unused `overlay`/`overlayHex` fields). Only the MVP's `luster` values (`'matte'|'shiny'`) and no `overlay` values are actually implemented here. This means the full-feature plan never needs a schema migration or a field rename — it only adds new enum values and new renderer branches on top of what already exists. Confirm this reasoning holds before deviating from either plan's field names.

## Data model

`customColors` records (`src/storage/customColorStore.js`) gain four fields, defaulted at the read layer rather than migrated/rewritten — the same "spread stored data over defaults" idiom already fixed once in `driveSyncStore.js`'s `getDriveSyncMeta` (see CLAUDE.md's Phase Status history for that precedent) and used by `preferences.actualSizeCalibration`/`defaultDropCount` elsewhere in this app:

```js
{
  id, beadTypeKey, name, hex,
  alphaPercent: 100,   // 0-100, 100 = fully opaque (default). Lower = more transparent.
  luster: 'matte',     // 'matte' | 'shiny' in this MVP. 'ab' | 'metallic' | 'ceylon' reserved
                       // for the full-feature plan — never written or offered by this MVP.
  overlay: 'none',     // reserved for the full-feature plan. Always 'none' here — no UI,
                       // no renderer branch, just a placeholder field so later work doesn't
                       // need a migration.
  overlayHex: null,    // reserved alongside overlay, same reasoning.
  order, createdAt, updatedAt,
}
```

**No `DB_VERSION` bump.** This is a purely additive, optional field set with default-at-read — not a design-record shape change, which is the thing this app's `DB_VERSION` bumps exist to protect (they trip the pre-migration Drive-backup warning specifically because a bad *design* migration is catastrophic). `customColors` isn't a design record and nothing here is destructive or requires a one-time rewrite, so it follows the `preferences`-field precedent (no bump), not the `migrateDesign.js`/`dropCount` precedent (bump + migration step).

Defaulting happens once, centrally, in `customColorStore.js`:

```js
const DEFAULT_APPEARANCE = { alphaPercent: 100, luster: 'matte', overlay: 'none', overlayHex: null };

export async function listCustomColorsSorted(db, beadTypeKey) {
  const all = await getAll(db, STORE);
  return all
    .filter((c) => c.beadTypeKey === beadTypeKey)
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ ...DEFAULT_APPEARANCE, ...c }));
}
```

Every other reader (palette swatches, Manage Colors rows, `resolveSwatchAppearance` below, the edit dialog's seeded initial values) trusts `appState.customColors` entries are already fully populated — no `?? 100`/`?? 'matte'` scattered through render code. `createCustomColor` explicitly sets all four fields (with parameter defaults) so a freshly created color is never missing them either.

## Shared rendering: `src/render/beadFill.js` (new)

Today, "fill this bead" is a flat `ctx.fillStyle = hex; ctx.fill()` duplicated in `canvasRenderer.js`'s `drawGrid` (src/render/canvasRenderer.js:114-121) and `thumbnailRenderer.js`'s `renderThumbnailDataUrl` (src/render/thumbnailRenderer.js:40-43). Both get a new shared painter instead of each growing their own alpha/shine logic independently.

**This is the final design, arrived at through several rejected approaches against a live preview artifact, not the first idea that was tried.** In order: a diagonal linear sweep (too broad/flat); a small radial corner-spot (an improvement, but a floating blob unrelated to the bead's own shape); an ellipse-based cap (structurally wrong — an ellipse's near and far edges always curve in *opposite* directions, which reads as a lens bulging in the middle rather than a real glossy highlight that recedes near the bead's own corners); a rounded-rect cap softened with `ctx.shadowBlur` (shadowBlur tried twice, for two different shapes, and both times a blur radius large enough to look "soft" ended up dominating the whole shape rather than just softening its edge — there's no usable middle ground to tune, so it was dropped in favor of a purely geometric alternative both times). The design below — a filled cap clipped to an inset copy of the bead's own path, with a gradient whose peak can sit anywhere along it and fades symmetrically to each side, using an eased *curve* rather than blur for softness — is what survived that process.

```js
// src/render/beadFill.js
import { hexToRgba, clamp01 } from '../palette/colorConversion.js';

// Every constant below was chosen interactively against a live preview
// artifact (not guessed) — see this plan's own session history for the
// rejected alternatives above and the two real bugs found along the way:
// (1) an asymmetric fade formula that visibly dragged the peak toward one
// side as softness increased, unrelated to where the peak itself sat —
// fixed by parameterizing both sides of the fade by distance-from-peak
// using the identical curve, which is what addPeakFade below does; (2)
// ctx.shadowBlur's "soft or dominates the whole shape, nothing in between"
// failure mode, described above — softness here is a gradient curve shape
// instead, with no blur involved anywhere.
const SHINE_INSET_TOP_BOTTOM_FRACTION = 0.10; // margin from the true edge, scaled off the bead's height
const SHINE_INSET_SIDES_FRACTION = 0.10;      // margin from the true edge, scaled off the bead's width
const SHINE_CORE_POSITION_FRACTION = 0.29;    // where the brightest point sits: 0 = top of the inset box, 1 = bottom
const SHINE_CORE_EXTENT_FRACTION = 0;         // how far the full-brightness plateau extends to each side of the peak — 0 means a single bright point, not a held plateau
const SHINE_FADE_EXTENT_FRACTION = 0.17;      // how much further the fade continues beyond the plateau, to each side
const SHINE_SOFTNESS = 0.02;                  // 0 = linear falloff; higher = lingers near peak longer before dropping off. Near-linear was the chosen look, not a soft cushioned edge.
const SHINE_PEAK_ALPHA = 0.82;                // the highlight's own opacity — independent of the bead's own alphaPercent, see below. Deliberately not 1 — fully opaque read as too stark once actually compared side by side.
const SHINE_COLOR_HEX = '#ffffff';
const PEAK_FADE_STEPS = 8; // resolution of the manually-added stops approximating the eased curve

// Paints only the fill — outline stroking and the missing-color X marker stay
// in each caller (canvasRenderer.js), since neither depends on finish.
export function paintBeadFill(ctx, x, y, w, h, radiusPx, appearance) {
  const { hex, alphaPercent, luster } = appearance;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radiusPx);
  ctx.fillStyle = hexToRgba(hex, alphaPercent);
  ctx.fill();

  if (luster === 'shiny') {
    paintShineCap(ctx, x, y, w, h, radiusPx);
  }
}

// Clips to a smaller, inset copy of the bead's own roundRect path — so the
// highlight's ends automatically curve to match the bead's rounded
// corners, sharp on a Delica or round on a Rocaille, with no per-bead-type
// logic — then fills that region with a gradient whose brightest point
// sits at SHINE_CORE_POSITION_FRACTION and fades out symmetrically to each
// side of it, not just downward from the top edge. Drawn directly with its
// own fixed alpha, never derived from or scaled by the bead's own
// alphaPercent — that's what keeps it genuinely opaque-looking regardless
// of how transparent the bead body itself is: alpha compositing at a fixed
// value doesn't get diluted by whatever it happens to be drawn on top of.
function paintShineCap(ctx, x, y, w, h, radiusPx) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radiusPx);
  ctx.clip();

  const insetTBPx = h * 0.5 * SHINE_INSET_TOP_BOTTOM_FRACTION;
  const insetLRPx = w * 0.5 * SHINE_INSET_SIDES_FRACTION;
  const insetX = x + insetLRPx;
  const insetY = y + insetTBPx;
  const insetW = Math.max(w - insetLRPx * 2, 1);
  const insetH = Math.max(h - insetTBPx * 2, 1);
  const insetRadius = Math.max(radiusPx - Math.min(insetTBPx, insetLRPx), 0);

  ctx.beginPath();
  ctx.roundRect(insetX, insetY, insetW, insetH, insetRadius);
  ctx.clip();

  const plateauStart = clamp01(SHINE_CORE_POSITION_FRACTION - SHINE_CORE_EXTENT_FRACTION);
  const plateauEnd = clamp01(SHINE_CORE_POSITION_FRACTION + SHINE_CORE_EXTENT_FRACTION);
  const fadeInStart = clamp01(plateauStart - SHINE_FADE_EXTENT_FRACTION);
  const fadeOutEnd = clamp01(plateauEnd + SHINE_FADE_EXTENT_FRACTION);

  const gradient = ctx.createLinearGradient(insetX, insetY, insetX, insetY + insetH);
  addPeakFade(gradient, plateauStart, fadeInStart);
  gradient.addColorStop(plateauStart, shineRgba(SHINE_PEAK_ALPHA));
  gradient.addColorStop(plateauEnd, shineRgba(SHINE_PEAK_ALPHA));
  addPeakFade(gradient, plateauEnd, fadeOutEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(insetX, insetY, insetW, insetH);
  ctx.restore();
}

// Adds stops for one side of the fade, parameterized by distance from the
// peak (0 at offsetNearPeak, 1 at offsetFar) rather than by "how far along
// this call's own direction" — that distinction is what guarantees the
// fade-in side (above the peak) and fade-out side (below it) are true
// mirror images of each other regardless of the softness curve applied.
// Works correctly whichever of offsetNearPeak/offsetFar is numerically
// larger, so the same function serves both sides without an explicit
// direction flag.
function addPeakFade(gradient, offsetNearPeak, offsetFar) {
  const exponent = 1 + SHINE_SOFTNESS * 5; // 1 = linear, 6 = lingers near peak longer before dropping off
  const lo = Math.min(offsetNearPeak, offsetFar);
  const hi = Math.max(offsetNearPeak, offsetFar);
  const span = Math.abs(offsetFar - offsetNearPeak);
  for (let i = 0; i <= PEAK_FADE_STEPS; i++) {
    const offset = lo + (i / PEAK_FADE_STEPS) * (hi - lo);
    const d = span < 1e-6 ? 0 : clamp01(Math.abs(offset - offsetNearPeak) / span);
    const alpha = SHINE_PEAK_ALPHA * (1 - Math.pow(d, exponent));
    gradient.addColorStop(clamp01(offset), shineRgba(alpha));
  }
}

function shineRgba(alpha) {
  return hexToRgba(SHINE_COLOR_HEX, alpha * 100); // hexToRgba takes 0-100, alpha here is 0-1
}
```

Verified visually before landing here — an interactive preview artifact ran this exact algorithm (including a Delica-vs-Rocaille comparison at the two bead types' real `widthMm`/`heightMm`/`cornerRadiusFraction` from `beadSpecs.js`'s `DEFAULT_BEAD_CATALOG`, and a checkerboard/dark/custom canvas-background toggle used specifically to confirm the peak alpha genuinely doesn't wash out against a transparent bead body) so every constant above was chosen by looking at it, not guessed from a description. If the real implementation's rendering looks different from that preview once wired into `canvasRenderer.js` for any reason (different scale, different corner-radius handling, etc.), that's a discrepancy worth tracking down, not a variance to shrug off — the preview was built specifically to be algorithm-accurate.

**Scope note**: the preview artifact also exposed Radial and Linear gradient shapes, a rotatable "Wraps toward" angle, and (briefly) a side "Overglow" rim light, as exploration tools for arriving at the design above — none of those survived into the final choice (Contour, angle fixed at 0°) and none of them ship. This MVP's `luster` stays the simple `'matte' | 'shiny'` binary the data model already commits to (see "Data model" above) — there is no user-facing choice of highlight shape, position, or a second glow layer. If a future need for a different orientation or a second finish variant comes up, that's new scope to plan separately, not a gap in this one.

New pure helpers in `src/palette/colorConversion.js` (alongside the existing `hexToRgb`/`rgbToHex`/etc.):

```js
export function hexToRgba(hex, alphaPercent = 100) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alphaPercent / 100)})`;
}

// Precomposits alphaPercent's blend against a plain white backing, returning
// a flat OPAQUE hex — the apparent color once alpha-blended over white — for
// DOM swatch elements (see "DOM swatches must not use CSS alpha" below).
export function alphaOverWhite(hex, alphaPercent = 100) {
  const { r, g, b } = hexToRgb(hex);
  const a = clamp01(alphaPercent / 100);
  const blend = (channel) => Math.round(channel * a + 255 * (1 - a));
  return rgbToHex({ r: blend(r), g: blend(g), b: blend(b) });
}
```

`hexToRgba` is for **canvas** rendering only (`paintBeadFill`), where the compositing order is guaranteed by code (`drawGrid`/`renderThumbnailDataUrl` always fill an explicit `#fff` background before drawing any cell, every frame — true alpha compositing is correct and safe there, and stays correct if a non-white canvas background or a layer between the fill and the bead were ever introduced later). `alphaOverWhite` is for **DOM** swatches, for the reason below.

### DOM swatches must not use CSS alpha — real bug found while grounding this plan against the actual CSS

Checked the real stylesheet rather than assuming: `.color-swatch` sits inside `#side-panel` (background `#f8f8f8`, not white), `.color-manage-swatch` sits inside `.color-manage-row` (background `#fff`), and `#color-picker-swatch` sits in an unstyled `<dialog>` (relies on the browser's default background, not an explicit one). Setting `style.backgroundColor = hexToRgba(...)` on any of these composites against whatever's actually behind that element in the page — which differs across all three — not against white. The same semi-transparent color would visibly render as three different shades across the palette, Manage Colors, and the picker dialog, and none of them would reliably match what the canvas shows (which always composites against a hard-coded white fill). This is exactly the kind of thing that reads as "broken" on first real use, not a cosmetic nit.

**Fix**: every DOM swatch element sets a plain, opaque `background-color: alphaOverWhite(hex, alphaPercent)` instead of any `rgba()` value — deterministic regardless of ancestor background, and pinned to "swatch previews assume a white backing," which is true everywhere this app's canvas actually renders (Decision #6-adjacent: this app has no dark canvas mode). This applies to the palette swatches, Manage Colors rows, and the color picker dialog's own live preview swatch — update the "Data flow for editing appearance" section below accordingly: every `el.style.background = ...`/`el.style.backgroundColor = ...` assignment in that section uses `alphaOverWhite(hex, alphaPercent)`, not `hexToRgba(hex, alphaPercent)`.

### Shine legibility at small swatch sizes

A narrow highlight band reads fine on a full-size canvas bead but is marginal at `.color-manage-swatch`'s 1.5rem (24px) size, and possibly marginal at `.color-swatch`'s 2.75rem (44px) too — genuinely unclear without looking at it, not assumed either way (`SHINE_CORE_EXTENT_FRACTION = 0` means the brightest part of the real design is a single line, not a broad area, which is exactly the kind of detail that can vanish at small sizes). Add a small corner-badge indicator for any non-`'matte'` luster as a legibility fallback, reusing this app's existing vendored-icon convention (`src/ui/icons.js`) rather than inventing a new asset pipeline — a small icon (e.g. a sparkle/glint glyph) absolutely-positioned in one corner of `.color-swatch`/`.color-manage-swatch`/`#color-picker-swatch` whenever `luster !== 'matte'`. Confirm during verification (step 3 below) whether the gradient alone is legible enough at each size before deciding whether the badge is actually needed at both sizes, one, or neither — this is a "look at it and decide" item, not committed in advance.

## Widening `resolveColor`'s contract

`drawGrid`, `renderThumbnailDataUrl`, and `drawPastePreviewOverlay` all take a `resolveColor(colorId)` callback that today returns a bare hex string or `null` (dangling reference). It needs to return `{hex, alphaPercent, luster} | null` instead — `null` keeps meaning exactly what it means today (a colorId with no matching `customColors` entry; every existing missing-color-X-marker/fallback-color code path is unaffected).

`src/palette/colorLibrary.js`:
- `UNASSIGNED_SWATCH` gains `alphaPercent: 100, luster: 'matte'` (still fully opaque/matte — an unassigned placeholder cell shouldn't itself look transparent or shiny).
- New `resolveSwatchAppearance(customColors, colorId)`:
  ```js
  export function resolveSwatchAppearance(customColors, colorId) {
    if (colorId === null) return UNASSIGNED_SWATCH;
    const swatch = customColors.find((c) => c.id === colorId);
    return swatch ? { hex: swatch.hex, alphaPercent: swatch.alphaPercent, luster: swatch.luster } : null;
  }
  ```
- **Delete `resolveSwatchHex` outright** once every call site below is migrated — grep confirms exactly four current call sites (`editorView.js:207`, `printView.js:188`, `main.js:96`, `main.js:586`), all of which are switching to `resolveSwatchAppearance`. No caller will be left wanting a bare hex string, so keeping it around would be dead code (per this project's own "delete unused code outright" convention).

Call sites to update:
- `src/ui/editorView.js:206-208` — `resolveColor(colorId)` now returns `resolveSwatchAppearance(appState.customColors, colorId)`. This is the function passed into `drawGrid`/`drawPastePreviewOverlay`/(indirectly) thumbnail generation for the live editor, so all three pick up the new contract from one change.
- `src/render/canvasRenderer.js`'s `drawGrid` (around line 114): replace the flat `ctx.fillStyle = hex ?? MISSING_COLOR_FILL_STYLE; ...fill()/stroke()` with a branch — `resolveColor(cell.colorId)` returning non-null calls `paintBeadFill(ctx, beadX, beadY, beadWidthPx, beadHeightPx, radiusPx, appearance)`; returning `null` keeps today's flat white fill + red X exactly as-is (finish concepts don't apply to a color that doesn't resolve). Outline stroking is untouched either way.
- `src/render/thumbnailRenderer.js` (around line 40): same swap — `paintBeadFill(ctx, x, y, w, h, Math.min(w, h) * cornerRadiusFraction, resolveColor(cell.colorId) ?? { hex: MISSING_COLOR_FALLBACK_HEX, alphaPercent: 100, luster: 'matte' })`. A dangling reference still just falls back to the flat fallback color at thumbnail scale — no X marker there today, and this MVP doesn't add one.
- `src/render/pastePreviewOverlay.js` (line 26): **deliberately does not adopt shine/alpha.** The paste ghost already has its own `PASTE_PREVIEW_ALPHA = 0.9` applied to the whole preview as a "this isn't committed yet" affordance — layering the color's own alpha/shine on top would compound two different kinds of translucency and read as muddy, not informative. Just narrow the read: `ctx.fillStyle = resolveColor(colorId)?.hex ?? MISSING_COLOR_FALLBACK_HEX;` (unwraps `.hex` from the now-object return, otherwise unchanged).
- `src/ui/printView.js:188` and `main.js:96`/`main.js:586` — these feed `renderThumbnailDataUrl` for the library grid thumbnail and the print reference image. Swap `(colorId) => resolveSwatchHex(appState.customColors, colorId)` for `(colorId) => resolveSwatchAppearance(appState.customColors, colorId)` at all three.
- `src/ui/printView.js`'s own `resolveSwatch`/materials-table swatch (lines 21-23, 79-89) is **out of scope for this MVP** — it already reads the full color record directly (not through `resolveColor`), so it needs no contract change, and the small CSS swatch next to a letter code isn't where finish needs to be legible. Left as a flat-hex CSS background, unchanged.

## Data flow for editing appearance

`src/ui/colorPickerDialog.js`'s `promptColorPicker` gains three more optional params and two more resolved fields:

- `initialAlphaPercent = 100`, `initialLuster = 'matte'` — seed the new controls.
- `showAppearanceControls = true` — when `false`, hides the opacity slider/presets and the luster toggle entirely, and the call resolves with the original `{hex, name?}` shape (no `alphaPercent`/`luster` keys at all), unchanged from before this plan. **Needed from the start**, not a later addition: this dialog is about to gain a second caller that only ever wants a plain opaque hex — the canvas-background toggle's custom-color picker (see "Canvas background toggle" below) — and the full-feature plan's `overlayHex` accent-color picker will be a third. All three "just pick a hex" callers pass `showAppearanceControls: false`; the Add/Edit Color flow is the only caller that omits it (defaults to `true`).
- Resolves with `{hex, name?, alphaPercent, luster}` when `showAppearanceControls` is true, or plain `{hex, name?}` when false.

New markup in `#color-picker-dialog` (`index.html`): an opacity `<input type="range" min="0" max="100">` with a live "N%" label, and a two-button Matte/Shiny toggle group (radio-button semantics, styled like other icon-button groups in this app). Both update the dialog's own live preview swatch (`swatchEl`) — set `swatchEl.style.backgroundColor = alphaOverWhite(currentHex(), alphaPercent)` (**not** `hexToRgba` — see "DOM swatches must not use CSS alpha" above) instead of the current flat `swatchEl.style.background = hex`, and toggle a `swatch-shiny` CSS class that layers a highlight via `background-image: linear-gradient(to bottom, transparent 12%, rgba(255,255,255,0.82) 29%, transparent 46%)` — a direct CSS analog of `paintBeadFill`'s own `SHINE_FADE_EXTENT_FRACTION`/`SHINE_CORE_POSITION_FRACTION`/`SHINE_PEAK_ALPHA` constants, not an independently-invented look — when luster is `'shiny'` (pure CSS, no canvas — this dialog element is a DOM `<div>`, not a canvas), plus the corner shine-badge from above if verification finds the spot alone isn't legible at this size either.

**Presets, on top of the sliders (confirmed direction — presets are a shortcut into the same fields, never a separate stored mode).** Two small chip rows above the opacity slider and the luster toggle, respectively — mirroring the two real underlying axes rather than one flat list of named finishes:

- **Opacity presets**: `Opaque` (sets the slider to 100) / `Transparent` (sets it to a reasonable default, e.g. 50). Clicking a chip just moves the slider to that value and updates the live preview exactly as if it had been dragged there — the slider remains freely adjustable afterward, so a chip is a starting point, not a lock. (The full-feature plan below adds a third, `Translucent`, once there's a meaningful band between the two.)
- **Luster presets**: at this MVP's scale (only `matte`/`shiny` exist), this is just the existing Matte/Shiny toggle group itself — there's no separate "preset vs. raw control" distinction yet, since the toggle already *is* the full set of named options. This distinction only becomes meaningful once the full-feature plan's `ab`/`metallic`/`ceylon`/overlay values exist (see that doc).

No new resolved fields or hooks — `promptColorPicker` still resolves `{hex, name?, alphaPercent, luster}` exactly as specified above; presets only change how the dialog's own internal state gets set before the user hits Add/Done.

`src/ui/editorView.js`:
- `handleAddColorClick` (~line 1084): pass `result.alphaPercent`/`result.luster` through to `hooks.onCustomColorAdded({ name, hex, alphaPercent, luster })`.
- `handleColorEditClick` (~line 1091): seed the dialog with `initialAlphaPercent: color.alphaPercent, initialLuster: color.luster`. The resolved call currently goes through `hooks.onCustomColorHexChanged(id, result.hex)` — **rename this hook to `onCustomColorAppearanceChanged(id, { hex, alphaPercent, luster })`** everywhere (editorView.js's call site, and `main.js`'s hook registration/handler at main.js:352 and main.js:470) — it's no longer just a hex change, and a plain rename keeps the intent honest rather than stretching the old name.
- `renderColorPalette` (~line 346-388) and `buildColorManageRow` (~line 390-452): both currently do `el.style.background = swatch.hex` / `color.hex`. Change to `el.style.backgroundColor = alphaOverWhite(swatch.hex, swatch.alphaPercent)` (import `alphaOverWhite` — **not** `hexToRgba`, per the compositing note above) plus a `swatch-shiny` class toggle when `luster === 'shiny'` (and the corner shine-badge, if verification finds it's needed at these sizes), applied to `.color-swatch` and `.color-manage-swatch` — so the palette and the manage list both preview what you're actually about to draw with, not just its base hue, and match each other and the canvas exactly.

`main.js`:
```js
async function handleCustomColorAdded({ name, hex, alphaPercent, luster }) {
  const created = await createCustomColor(appState.db, { beadTypeKey: appState.beadTypeKey, name, hex, alphaPercent, luster });
  appState.customColors.push(created);
}

async function handleCustomColorAppearanceChanged(id, { hex, alphaPercent, luster }) {
  const color = appState.customColors.find((c) => c.id === id);
  if (!color) return;
  const saved = await saveCustomColor(appState.db, { ...color, hex, alphaPercent, luster });
  const idx = appState.customColors.findIndex((c) => c.id === id);
  appState.customColors[idx] = saved;
}
```

`src/storage/customColorStore.js`'s `createCustomColor` gains the new params with defaults:
```js
export async function createCustomColor(db, { beadTypeKey, name, hex, alphaPercent = 100, luster = 'matte', overlay = 'none', overlayHex = null }) {
  // ...existing order/id logic...
  const color = { id: generateId(), beadTypeKey, name, hex, alphaPercent, luster, overlay, overlayHex, order, createdAt: now, updatedAt: now };
  await put(db, STORE, color);
  return color;
}
```

## Carrying appearance through existing color-cloning flows

Two places already clone a color into a new record and must carry the new fields along, or a copy silently loses its finish:

- `main.js`'s `handleCustomColorCopiedToBeadType` (lines 187-191, Part B of `.work/feature-bead-catalog-and-conversion-plan.md`'s "Copy to another bead type"): currently calls `createCustomColor(appState.db, { beadTypeKey: targetBeadTypeKey, name: color.name, hex: color.hex })`. Add `alphaPercent: color.alphaPercent, luster: color.luster, overlay: color.overlay, overlayHex: color.overlayHex`.
- Convert Bead Type's "copy this color over" mapping option (Part C of the same plan, `handleBeadTypeConvertConfirmed` in main.js) also calls `createCustomColor` per copied color — audit this call site during implementation and apply the identical fix. Not yet confirmed exactly which line, since it wasn't read for this plan; treat as a required check, not optional.

`src/state/beadTypeConversion.js`'s `remapColorwayColorIds` only remaps `colorId` references onto an existing target color — it never touches a color's own hex/alpha/luster, so it needs no change.

## Canvas background toggle (added per user request, pairs directly with transparency)

Confirmed direction: **swatches (palette, Manage Colors, picker preview) always stay pinned to white** — `alphaOverWhite` needs no generalization, and none of the "make swatches follow the live background" complexity discussed earlier is being built. Only the **live pattern canvas** itself gets a configurable background — white (default) / a fixed dark tone / a checkerboard / a custom color — so a transparent bead can be previewed against something other than white while working, without touching how any DOM swatch renders.

This lands naturally as an MVP-stage feature rather than something deferred to the full-feature plan: it only needs the canvas's already-true `rgba()` alpha compositing (already in this plan, via `paintBeadFill`/`hexToRgba`), and nothing about it depends on the full plan's overlay/texture-cache work. Any luster/overlay effects the full plan adds later inherit this for free, since they're just more drawing on top of whatever this background fill already painted.

### Data model

New flat fields on `preferences` (`src/storage/preferencesStore.js`'s `DEFAULT_PREFERENCES`), following the same global-preference convention as `showBeadOutlines`/`actualSizeCalibration`/`printStartDirection` — no `DB_VERSION` bump, same reasoning as this plan's other additive preference fields:

```js
canvasBackgroundMode: 'white', // 'white' | 'dark' | 'checkerboard' | 'custom'
canvasBackgroundHex: null,     // only meaningful when mode === 'custom'; retained even if the
                                // user switches away and back, so re-selecting Custom doesn't
                                // lose their last pick
```

This is a **global** preference, not per-design — matches every other "how I like to view things while working" toggle already in this app (units, outlines, ruler), not a property of the pattern data itself.

### Rendering: `src/render/canvasRenderer.js`

`drawGrid` currently hardcodes `BACKGROUND_STYLE = '#fff'` for its very first `ctx.fillRect`. Replace that single fill with a small dispatch on a new trailing `canvasBackground = { mode: 'white' }` param:

```js
const DARK_BACKGROUND_STYLE = '#242424'; // a fixed dark neutral, not pure black — pure black
// tends to make alpha-blended colors read as muddier/harder to judge than a dark gray does.
const CHECKERBOARD_LIGHT = '#ffffff';
const CHECKERBOARD_DARK = '#cccccc';
const CHECKERBOARD_TILE_PX = 12; // fixed screen-pixel size, not scaled by zoom — this is an
// abstract "this is transparent" indicator (the standard image-editor convention), not a
// to-scale rendering of anything physical, so it should stay a constant on-screen size.

// Cached per canvas context (not module-global) via a WeakMap, since a CanvasPattern is only
// ever needed by the one live pattern-canvas context in practice today, but keying by ctx
// rather than assuming a singleton keeps this correct if that ever changes.
const checkerPatternCache = new WeakMap();
function getCheckerPattern(ctx) {
  let pattern = checkerPatternCache.get(ctx);
  if (pattern) return pattern;
  const tile = document.createElement('canvas');
  tile.width = tile.height = CHECKERBOARD_TILE_PX * 2;
  const tileCtx = tile.getContext('2d');
  tileCtx.fillStyle = CHECKERBOARD_LIGHT;
  tileCtx.fillRect(0, 0, tile.width, tile.height);
  tileCtx.fillStyle = CHECKERBOARD_DARK;
  tileCtx.fillRect(0, 0, CHECKERBOARD_TILE_PX, CHECKERBOARD_TILE_PX);
  tileCtx.fillRect(CHECKERBOARD_TILE_PX, CHECKERBOARD_TILE_PX, CHECKERBOARD_TILE_PX, CHECKERBOARD_TILE_PX);
  pattern = ctx.createPattern(tile, 'repeat');
  checkerPatternCache.set(ctx, pattern);
  return pattern;
}

function paintCanvasBackground(ctx, cssWidth, cssHeight, canvasBackground) {
  const { mode, hex } = canvasBackground;
  if (mode === 'checkerboard') {
    ctx.fillStyle = getCheckerPattern(ctx);
  } else if (mode === 'dark') {
    ctx.fillStyle = DARK_BACKGROUND_STYLE;
  } else if (mode === 'custom' && hex) {
    ctx.fillStyle = hex;
  } else {
    ctx.fillStyle = BACKGROUND_STYLE; // 'white', or a 'custom' mode with no hex chosen yet
  }
  ctx.fillRect(0, 0, cssWidth, cssHeight);
}
```

`drawGrid` calls `paintCanvasBackground(ctx, cssWidth, cssHeight, canvasBackground)` in place of its current two-line fill. Nothing else in `drawGrid` changes — every cell fill, the shine highlight spot, the outline stroke, the missing-color X marker, and the reference-photo overlay all draw on top of this exactly as they already do today against the hardcoded white fill.

**Deliberately unaffected, matching the swatch decision's own reasoning** ("a canonical reference, not tied to a momentary preview choice"): `thumbnailRenderer.js`'s `renderThumbnailDataUrl` (library grid thumbnails, the print reference image) keeps its own hardcoded `THUMBNAIL_BACKGROUND_STYLE = '#fff'` unconditionally — no new param, no change at all. Same for `printView.js`'s materials-table swatch — printed output sits on white-ish paper regardless of any on-screen preview toggle.

**Worth a look, not solved here**: the empty-cell dot (`EMPTY_CELL_DOT_STYLE = '#999'`) and the missing-color X marker (a white-filled cell with a red `#c0392b` X) are both tuned for contrast against a white background. They'll likely still read fine against dark/checkerboard, and a poorly-chosen custom color could theoretically clash with the X's red — flagged for an eyeball check during verification, not a formula to solve in advance.

### Wiring

`src/ui/editorView.js`'s `render()` reads the two preference fields (defaulting via `?? 'white'`/`?? null`, same idiom as this app's other optional preference fields) and passes them through as the new `canvasBackground` object on every `drawGrid` call — no new `appState` field needed, since this reads directly from `appState.preferences` at render time, same as `showBeadOutlines` already does.

New "Canvas Background" section in `#preferences-dialog` (`index.html`) — this app's preferences dialog already exists specifically as "the first step toward consolidating scattered global toggles into one preferences modal" (built for Actual Size calibration), so this is exactly where a new global display preference belongs, not a new top-bar button:

- A `<select>` with White / Dark / Checkerboard / Custom Color.
- A swatch button, shown only when Custom Color is selected, that opens `promptColorPicker({ showAppearanceControls: false, showNameField: false, initialHex: appState.preferences.canvasBackgroundHex ?? '#ffffff' })` — the exact "plain hex only" mode added above. Opening a `<dialog>` from inside another already-open `<dialog>` is already a proven pattern in this app (the Bead Catalog dialog opens from inside the Settings dialog, confirmed working in that feature's own verification pass) — expected to work the same way here, but still verify directly rather than assuming.
- Both the `<select>` and the color picker's result apply and persist immediately (`hooks.onPreferencesChanged({ canvasBackgroundMode, canvasBackgroundHex })` + `scheduleRedraw()`), matching `showBeadOutlines`'s immediate-apply convention rather than Actual Size Calibration's live-preview-then-Save/Cancel pattern — there's no "abort mid-drag" scenario here worth a separate commit step, picking a mode or a color *is* the final action.

### `node:test` coverage (additional)

- A small pure helper worth extracting for testability — `resolveCanvasBackgroundFillStyle({mode, hex})` returning either a flat hex string or a `'checkerboard'` sentinel (the actual `CanvasPattern`/`WeakMap` machinery stays in `canvasRenderer.js`, canvas-dependent and untested, same precedent as the rest of that module) — covering: white/dark/custom-with-hex/custom-without-hex(falls back to white)/checkerboard.

### Verification (additional)

1. Each mode, sampled away from any drawn cell, produces the expected flat color; checkerboard produces at least two distinct colors across a small sampled grid of points (not a flat fill).
2. Draw one semi-transparent bead, then cycle through all four modes — pixel-sample the bead itself each time and confirm it visibly composites differently (this is the actual point of the feature). For checkerboard specifically, confirm the bead's own sampled color differs depending on which underlying checker square a given screen point lands on — i.e. the alpha genuinely blends with the pattern beneath it, not just an average color.
3. Confirm the palette, Manage Colors, and picker-dialog swatches are completely unaffected by every mode change — still pinned to white, per this session's explicit decision.
4. Confirm the library thumbnail grid and the print reference image are unaffected by every mode change too.
5. The preference persists across reload and applies immediately on the next render — no design close/reopen required.
6. Opening the custom-color picker from inside the already-open Preferences dialog, then closing just the color picker (Cancel or Confirm), leaves Preferences itself still open and functional.

## `node:test` coverage

- `src/test/palette/colorConversion.test.js`: new cases for `hexToRgba` and `alphaOverWhite` (known-value round trips, `alphaPercent` clamping at 0/100/out-of-range; a case confirming `alphaOverWhite` at `alphaPercent: 100` returns the input hex unchanged, and at `alphaPercent: 0` returns pure white regardless of input hex).
- `src/test/palette/colorLibrary.test.js`: replace the existing `resolveSwatchHex` cases with `resolveSwatchAppearance` equivalents (unassigned/found/dangling-reference cases, plus confirming the returned object's `alphaPercent`/`luster` match the input record).
- `src/test/storage/customColorStore.test.js` — still not applicable; no IndexedDB in Node, same precedent as `designStore.js`/`beadCatalogStore.js` having no coverage there either. Verify via Playwright instead.
- `beadFill.js` — canvas-context-dependent, no coverage, same precedent as `canvasRenderer.js` itself having none.

## Verification (headless Chromium, Playwright, local `python3 -m http.server`)

Following this project's established convention (exact cell-click coordinates computed by reimplementing `peyoteCellOriginMm`/`fitViewportToGrid`'s math directly in the driver script, not approximated):

1. Add a color at 50% opacity, draw a cell with it, pixel-sample the cell's center — confirm it reads as a blend toward the white background rather than the pure hex (e.g. roughly halfway between the chosen color and white).
2. Add a color with Shiny luster, draw a cell, pixel-sample along the vertical centerline at the peak's own position (≈29% down the bead's inset height) vs. near the top edge and near the vertical center of the bead — confirm the peak position reads brightest, and that both the region above and below it are visibly dimmer (the fade is genuinely symmetric and localized around the peak, not a corner blob or a one-directional ramp from the top).
3. Confirm a Matte color's cell has no such gradient (uniform color across sampled points, modulo anti-aliasing at the very edge).
3a. Add a semi-transparent color and compare its rendered color across all four surfaces — the palette swatch, the Manage Colors row swatch, the color picker's own preview, and an actual drawn canvas cell — confirm all four read as the identical composited color (the real bug this plan's compositing fix addresses; check by sampling each surface's actual pixel color, not just eyeballing). Separately confirm the shine gradient/badge treatment for a Shiny color is legible at both the palette (44px) and Manage Colors (24px) swatch sizes, and decide from that observation whether the corner badge is actually needed at one, both, or neither size.
4. Edit an existing color's opacity/luster via Manage Colors — confirm the change applies to already-placed cells using that color (color is looked up by id at render time, so no separate "reapply" step should be needed) and persists across a reload.
5. Copy a semi-transparent/shiny color to another bead type's palette — confirm the copy keeps the same `alphaPercent`/`luster`, not reset to defaults.
6. Re-run the existing large-pattern performance fixture (the ~5,000-cell grid reused by several prior phases' verification scripts) with a mix of shiny/transparent colors placed — confirm render time doesn't regress meaningfully versus an all-matte-opaque baseline. Not exhaustive perf tuning — just a sanity check that per-cell gradient creation isn't pathological, since this is the first per-cell gradient this codebase has ever drawn. Real caching work (if needed at all) is deferred to the full-feature plan's texture-caching stage, which exists specifically for the more expensive overlay effects.
7. Confirm the library thumbnail grid and the print view's reference image both reflect alpha/shine (they share `renderThumbnailDataUrl` with the live canvas).
8. Confirm the missing-color X-marker path (a dangling `colorId`) is completely unaffected — still flat white + red X, no `paintBeadFill` involved.
9. Confirm the paste-preview ghost still renders as a flat, translucent stamp (deliberately not shiny/differently-transparent) — regression check against the "deliberately excluded" decision above.

## Not in scope for this MVP (see the full-feature plan)

AB/iridescent, metallic, and ceylon lusters; silver-lined/color-lined/fleck/picasso overlays; the shared texture-cache layer those need; upgrading the picker's Matte/Shiny toggle into a fuller `<select>`; any treatment of the print materials-table's small legend swatch.
