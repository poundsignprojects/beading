# Feature Plan — Bead Finish Effects, Full Feature (later implementation)

## Context

This is the follow-on to `.work/feature-bead-finish-effects-mvp-plan.md`, which ships transparency (`alphaPercent`) and a binary matte/shiny `luster`. This doc assumes that MVP has already shipped: `customColors` records already carry `alphaPercent`/`luster`/`overlay`/`overlayHex`, `src/render/beadFill.js`'s `paintBeadFill` already exists and is already wired into `canvasRenderer.js`/`thumbnailRenderer.js`, and `resolveSwatchAppearance` is already the one contract every renderer's `resolveColor` callback returns.

**Because the MVP deliberately wrote the full data model up front**, this plan touches only the renderer and the UI — no new schema fields, no migration, no `DB_VERSION` bump. That framing should hold; if it turns out not to (e.g. a value needs a shape the MVP's fields can't express), that's worth stopping and re-deciding rather than forcing it in.

Real Miyuki finish names this aims to approximate, stylistically rather than photorealistically: Transparent (MVP), Matte/Luster (MVP's matte/shiny), AB (Aurora Borealis — rainbow iridescence), metallic, Ceylon (pearl-like soft sheen), Silver-Lined, Color-Lined, Picasso (mottled/fleck), and generically "with color flecks." Set expectations once, explicitly: this is a stylized canvas approximation for planning/preview purposes, not a rendering pipeline aiming for photographic accuracy.

## Data model — filling in the reserved fields

```js
{
  // unchanged from the MVP:
  id, beadTypeKey, name, hex, alphaPercent, order, createdAt, updatedAt,

  luster: 'matte',        // 'matte' | 'shiny' (MVP) | 'ab' | 'metallic' | 'ceylon' (this plan)
  overlay: 'none',        // 'none' (MVP) | 'silver-lined' | 'color-lined' | 'fleck' | 'picasso' (this plan)
  overlayHex: null,       // accent color for 'color-lined'/'fleck'/'picasso'; unused for 'none'/'silver-lined'
}
```

`overlayHex` defaults to `null` (meaning "not yet chosen") when a user first picks an overlay that needs one — the picker UI should offer a sensible default (e.g. white, black, or a computed contrasting shade of `hex`) rather than leaving it null indefinitely. A small pure helper, `contrastingAccent(hex)` in `colorConversion.js` (converts to HSV, flips lightness/value to whichever of near-black/near-white contrasts more), is a reasonable default-picker; exact algorithm is an implementation-time call, not load-bearing.

`customColorStore.js`'s `DEFAULT_APPEARANCE` (from the MVP) needs no change — it already defaults `overlay: 'none'`/`overlayHex: null` for every pre-existing record.

## Canvas background toggle — inherited from the MVP, nothing to redo here

The MVP plan adds a live-canvas background toggle (white/dark/checkerboard/custom color), motivated by previewing transparency against something other than white. Every effect in this doc — Tier 1's gradients and Tier 2's cached textures alike — is drawn on top of whatever that background fill already painted, exactly like the MVP's own `shiny` gradient already is, so nothing here needs its own awareness of the toggle. Swatches (palette, Manage Colors, picker preview, and this doc's own canvas-based live-preview recommendation) stay pinned to white regardless of the live canvas's background — confirmed explicitly, not left ambiguous — so an overlay/luster preview always shows "how this looks on white," consistent with the MVP's swatch decision.

## Two rendering tiers, split by cost

**Tier 1 — parametric, gradient-only (cheap, no caching needed).** The MVP's `luster: 'shiny'` branch in `paintBeadFill` is a small radial highlight spot near one upper corner (`SHINE_SPOT_X_FRACTION`/`SHINE_SPOT_Y_FRACTION`/`SHINE_SPOT_RADIUS_FRACTION`/`SHINE_SPOT_CORE_ALPHA`/`SHINE_SPOT_MID_ALPHA` — chosen by eye against a live preview, not guessed; see that plan's own note on this). The three new luster values are variations on that same spot mechanism — different stops/colors/size at the same corner position, not fundamentally new machinery. `silver-lined` is the one exception, called out below.

- `'ab'` (iridescent): instead of a white-centered spot, a radial spot cycling through 3-4 hues derived from the base color via `hsvToRgb`/`rgbToHsv` (already in `colorConversion.js`) — e.g. rotate hue by +40°/+80°/+120° at low alpha across the same gradient stops. Reads as a subtle rainbow glint rather than a literal color change.
- `'metallic'`: a smaller, higher-contrast spot (smaller `SHINE_SPOT_RADIUS_FRACTION`, higher `SHINE_SPOT_CORE_ALPHA`) plus a slightly darkened/desaturated base fill (multiply the base color toward gray before the spot) — mimics a harder, more reflective surface than plain "shiny."
- `'ceylon'`: the opposite tuning — a wide, low-alpha, low-contrast spot (soft pearlescent glow, no sharp highlight edge).
- `'silver-lined'`: genuinely a different *shape*, not just different spot parameters — a bright, narrow band down the bead's short axis (mimicking light passing through/reflecting off a silver-lined hole) rather than a corner spot at all.

The three spot variants extend `paintBeadFill`'s existing `if (luster === 'shiny')`-style branch into a small per-luster spec table (position/radius/alpha/hue-stops keyed by luster name) rather than a growing if/else chain — worth factoring that way from the start of this stage, e.g.:

```js
const LUSTER_SPOTS = {
  shiny: (hex) => ({ /* white stops, current MVP constants */ }),
  ab: (hex) => ({ /* hue-rotated stops */ }),
  metallic: (hex) => ({ /* smaller radius, higher core alpha */ }),
  ceylon: (hex) => ({ /* larger radius, lower core alpha */ }),
};
// 'silver-lined' draws a linear band, not a radial spot — a separate branch,
// not a row in this table, since its geometry genuinely differs.
```

**Tier 2 — textured, needs per-swatch caching.** `'color-lined'`, `'fleck'`, and `'picasso'` are fundamentally about scattered dots/mottling of a second color (or random darker/lighter patches) across the bead's surface — not expressible as a smooth gradient. Regenerating random noise per cell per frame doesn't scale to a several-thousand-cell pattern, so this tier needs a caching layer:

### `src/render/beadTextureCache.js` (new)

- Generates a small offscreen `<canvas>` bitmap once per unique `(hex, overlay, overlayHex)` combination, at a fixed reference resolution (e.g. 64×64px) — independent of the bead's actual on-screen size at any zoom level.
- Caches the result in a plain `Map` keyed by a string (`` `${hex}|${overlay}|${overlayHex}` ``). A handful of colors × a few overlay types is a tiny number of cache entries for this app's realistic scale — no eviction logic needed; editing a color's hex/overlay just produces a new key, the old entry is simply never looked up again.
- `paintBeadFill`'s overlay branch, once a texture exists for the given appearance, draws the base fill as today (flat or gradient per the luster) and then `ctx.drawImage(cachedCanvas, x, y, w, h)` — scaling a cached bitmap via `drawImage` is cheap regardless of zoom, so cost is dominated by generating the bitmap once per unique combination, not by how many cells use it or how zoomed in the view is.
- **Determinism matters**: the noise pattern for a given `(hex, overlay, overlayHex)` should look the same every time it's generated (not flicker/reshuffle on every redraw if the cache were ever cleared, e.g. after a bead-type switch or reload) — use a small seeded PRNG (seed derived from the cache key string, e.g. a simple string hash) rather than `Math.random()`. This also makes the generation function pure and unit-testable: given the same seed, the same dot positions/sizes come out, checkable with `node:test` even though the actual canvas drawing isn't.
- Speckle generation itself, per overlay type:
  - `'fleck'`/`'color-lined'`: N small dots (count/size tuned by eye) of `overlayHex` scattered at seeded-random positions across the 64×64 tile, each with a small random alpha/radius jitter so they don't look stamped.
  - `'picasso'`: larger, softer, lower-contrast mottled patches (a few overlapping low-alpha blobs) rather than sharp dots — a more "surface texture" look than "flecks."

## UI changes

- `colorPickerDialog.js`'s Matte/Shiny two-button toggle (MVP) becomes a `<select>` with all values (Matte, Shiny, AB/Iridescent, Metallic, Ceylon/Pearl) — a two-button group doesn't scale to 5 options.
- New `overlay` `<select>` (None, Silver-Lined, Color-Lined, Fleck, Picasso), defaulting to None/hidden-if-None consistent with how this app already conditionally shows fields (e.g. the New Pattern dialog's Drops field hiding for non-peyote).
- When `overlay` is `'color-lined'` or `'fleck'` (the two that use `overlayHex`), reveal a small "Accent Color" swatch button that opens a **second, nested** `promptColorPicker` call scoped to just picking a hex (no name field, no alpha/luster of its own — `overlayHex` is a plain color) — reuses the existing dialog rather than building a second picker UI.
- The dialog's own live preview swatch needs to reflect the full appearance now, not just alpha+shiny — since it's a DOM element rather than canvas, either (a) keep approximating with layered CSS gradients/`background-image` per luster/overlay (workable for the Tier 1 gradient lusters, harder to fake convincingly for real speckle), or (b) render the live preview into a tiny actual `<canvas>` inside the dialog using the real `paintBeadFill`/texture-cache path, so what you see while picking is pixel-identical to what you'll get on the grid. **Recommend (b)** once Tier 2 exists — a CSS approximation of real fleck texture will visibly diverge from the canvas rendering, undermining the point of a live preview, and it also sidesteps the MVP's `alphaOverWhite`-vs-`hexToRgba` compositing distinction entirely: a real `<canvas>` element paints its own explicit white background first, the same guarantee `drawGrid`/`renderThumbnailDataUrl` already rely on, so there's no ancestor-background dependency left to get wrong.
- Manage Colors rows and the main palette swatches (both DOM elements, not canvas) face the same choice — recommend switching both from `<span style="background">` to a tiny inline `<canvas>` rendered once via `paintBeadFill`/the texture cache, once Tier 2 ships, for the same reason.

### Preset chips (confirmed direction, carried forward from the MVP plan)

The MVP ships two small preset chip rows above the raw controls — Opacity (`Opaque`/`Transparent`) and, trivially, the Matte/Shiny toggle itself (not yet distinct from "raw control" at only 2 values). Both rows genuinely earn their keep at this stage, once there are enough named values that scrolling a `<select>` is slower than recognizing a real SKU name:

- **Opacity presets** gain a third chip, `Translucent` (a mid-band default, e.g. ~65%, between Opaque's 100 and Transparent's ~35) — still just moving the same slider to a canonical value, freely adjustable after.
- **Surface-treatment presets** becomes a real chip row for the first time, since the underlying control is now a `<select>` with 5 luster values plus a separate overlay `<select>` with 4 more — a flat combinatorial explosion nobody should have to assemble by hand for a common named finish. Chips: `Matte`, `Luster` (sets `luster: 'shiny'`), `AB` (`luster: 'ab'`), `Silver-Lined` (`overlay: 'silver-lined'`), `Color-Lined` (`overlay: 'color-lined'`, prompts for `overlayHex` if not already set), `Picasso` (`overlay: 'picasso'`). Each chip sets only the field(s) it corresponds to — `luster` and `overlay` are independent, so e.g. clicking `AB` then separately clicking `Color-Lined` composes them (`luster: 'ab', overlay: 'color-lined'`), matching how real combined finishes like "Transparent AB" actually work. Clicking a chip is a shortcut into the `<select>`s below, never a separate stored "preset id" — the resolved shape is still just `{hex, name?, alphaPercent, luster, overlay, overlayHex}`, identical to picking the same values by hand from the dropdowns.
- `Metallic`/`Ceylon` chips are straightforward additions to the same row — omitted from the list above only because they were already named in the Tier 1 section, not because they're excluded.

## Carrying appearance through existing flows

Same audit as the MVP plan, now covering `overlay`/`overlayHex` too: color-to-another-bead-type copy (`handleCustomColorCopiedToBeadType`), Convert Bead Type's "copy this color over" mapping option, and any other place a color record gets cloned rather than referenced by id.

## Print/export — still untouched, with one optional nice-to-have

The printed word chart remains letter-coded (A/B/C…), not colored — none of this changes that, matching this app's existing print-instructions design. `printView.js`'s small materials-table legend swatch (a CSS `<span>`) is still out of scope for correctness, but could optionally pick up the same CSS-gradient approximation used for the Tier 1 lusters as a cheap visual nicety — genuinely optional, not required, since a printed page is monochrome-adjacent anyway (typically printed on a home printer, where subtle finish rendering may not even reproduce).

## `node:test` coverage

- `beadTextureCache.js`'s seeded-PRNG dot-generation function: pure, testable — same seed produces identical dot positions/sizes across calls; different `(hex, overlay, overlayHex)` keys produce different (or at least independently-seeded) patterns.
- `colorConversion.js`'s new `contrastingAccent` (or equivalent): known-value cases (a light color returns a dark accent and vice versa).
- Tier 1 spec table: if extracted as pure data (`LUSTER_SPOTS`), a smoke test confirming every `luster` value used by the UI/data model has a corresponding table entry (catches a value being added to one without the other).

## Verification

Extends the MVP plan's Playwright approach:

1. Each Tier 1 luster (`ab`/`metallic`/`ceylon`/`silver-lined`) pixel-sampled at two points within one bead, confirming a genuine gradient (not a no-op flat fill) and confirming visually distinct from `shiny`.
2. Each Tier 2 overlay (`color-lined`/`fleck`/`picasso`) — confirm the rendered bead is **not** uniform (multiple distinct colors/alphas sampled across its area), and confirm the *same* `(hex, overlay, overlayHex)` combination used on two different cells produces the identical texture (same cache entry, not independently re-randomized per cell — which would look like uncontrolled noise rather than a consistent "this is what this color looks like").
3. Dedicated performance pass on the large (~5,000-cell) fixture with textured colors specifically (the MVP's perf check only covered Tier 1 gradients) — confirm the texture cache is actually being hit (e.g. instrument a call counter during the test run, or time a first-render-with-cold-cache vs. a second-render-with-warm-cache and confirm the second is meaningfully faster) rather than regenerating noise per cell.
4. Editing an existing color's overlay/accent color updates already-placed cells on next render (same "looked up by id at render time" property the MVP already relies on) and invalidates correctly (the *old* cache entry for the previous hex/overlay combination is simply unused going forward, not actively cleared — confirm this doesn't leak into a wrong-looking render, i.e. confirm the *new* combination's key actually differs and gets its own fresh entry).
5. Real iPad/Retina pass — explicit, not deferred further this time. Subtle effects (fine fleck texture, a soft ceylon sheen) are exactly the kind of thing that can look fine in a screenshot and read as noise or invisible at actual screen resolution/pixel density. Do this before considering the feature done, not as a someday follow-up.

## Explicitly out of scope, even here

True photorealistic rendering (raytraced highlights, real refraction for transparency, physically-based "how light bounces off a coated bead" simulation) — this remains a stylized, cheap-to-render approximation aimed at helping a designer preview/plan a piece, not a rendering engine. If that line ever needs to move, it's a different, much larger project, not an extension of this one.
