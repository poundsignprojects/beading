# CLAUDE.md — Bead Pattern Designer

This file gives Claude Code persistent context for this project. Read it at the start of every session. Update it (especially the Phase Status section) as work progresses, so the next session picks up accurately.

## Project Overview

A custom web app replacing a commercial app called "the prior app" for designing seed bead patterns (peyote, brick stitch, square stitch, bead looming). Built from scratch — not a clone, not reverse-engineered — based on a feature list and workflow requirements gathered directly from the user. Runs in Safari on iPad (installable to home screen), used for personal, non-commercial purposes only.

## User Context

- Professional web developer background, and experienced working with AI coding tools (has used Cursor, Cline).
- Primary device for actual use: iPad (with Apple Pencil). Development happens on a Mac laptop.
- Uses zsh for shell commands.
- Wants to be asked before large code/content output — explain intent first, then proceed on confirmation. (This applies to chat collaboration generally; use judgment on how it maps to normal Claude Code workflow.)
- Wants a professional, honest recommendation first, even if it's more work — not the easiest path. Discuss modifications after that, not instead of it.
- No hyperbole, no unnecessary compliments/praise.

## Why This App Exists (origin of requirements)

the prior app's specific pain points that this app must fix:
1. Preferences don't persist across designs — must set grid/tool preferences per-file, every time.
2. No manual control over the order designs are displayed in a library view.
3. Colorways (same pattern, different color mapping) require full duplicate files — wasteful and error-prone.
4. Easy to lose current state — no autosave, must remember to manually duplicate before experimenting.
5. Closing/switching designs takes too many steps.

## Core Decisions Log

| # | Decision |
|---|---|
| 1 | Platform: web app (HTML/CSS/JS, no framework), not native — installable to iPad home screen via Safari. Native (SwiftUI + Xcode + Cursor/Cline) is a possible future path if wanted later, but web app ships faster and de-risks the design/logic decisions first. |
| 2 | No UI component library (no React, Tailwind, shadcn, etc.) — interface is mostly custom canvas interaction; plain HTML/CSS is sufficient and keeps the dependency surface small. |
| 3 | Rendering: HTML5 Canvas for the grid, not DOM elements per bead (patterns can be thousands of cells — canvas handles zoom/pan/redraw far better). |
| 4 | Storage: IndexedDB for local persistence (not localStorage — size limits and synchronous API are a problem at pattern scale). |
| 5 | Backup/cloud: not required for v1. Plan is manual export/import of a JSON file first (simple, user controls the file), real sync layered on later once the data model is stable. |
| 6 | Internal units: always millimeters (mm), matching the bead spec source data. Imperial (inches) is a **display-layer-only** conversion — never store or calculate internally in inches. This must be built into Phase 1, not retrofitted. |
| 7 | Bead types in scope: Miyuki Delica and Miyuki Rocaille only, both starting at size 11/0. Toho and Preciosa are out of scope for now. |
| 8 | Colorways = same grid, different color-to-cell mapping only. Not different bead counts or sizes. |
| 9 | Draw tool = two interactions: (a) tap for single bead placement, (b) drag/continuous stroke for line drawing across cells. Both required, not just one. |
| 10 | Photo-to-pattern auto-conversion is explicitly NOT a priority. Photo trace overlay (background reference image, adjustable transparency, user draws over it manually) IS wanted — much simpler feature, don't conflate the two. |
| 11 | First stitch type to build: peyote. Others (brick, square, loom) come later, after peyote's grid engine and tools are validated. |
| 12 | v1 must-have tools, in priority order: draw, erase, print/export instructions. Fill, color-replace, cut/copy, mirror are v1.x — after the must-haves work well, not before. |

## Bead Specs (source: official Miyuki site, miyuki-beads.co.jp/english/seed/01.html — verified via screenshot of their official size chart)

| Type | Size | Diameter (mm) | Hole (mm) |
|---|---|---|---|
| Round Rocaille | 11/0 | 2.0 | 0.8 |
| Delica (DB) | 11/0 | 1.6 | 0.8 |

**Known gap, unresolved as of last session:** Miyuki's official chart gives only one diameter figure per bead — no separate width vs. height. Grid rendering needs both (this is what makes peyote/brick rows render as offset rather than square). Secondary, non-Miyuki sources suggest approximate figures below, but these are **not verified against an authoritative source** and should be treated as provisional until confirmed (e.g. by direct caliper measurement or a second manufacturer source):
- Delica 11/0: ~1.6mm wide × ~1.3mm tall (estimated)
- Rocaille 11/0: ~2.0mm wide × ~1.3–1.5mm tall (estimated, rocailles are flatter than their diameter suggests)

Store these as named, easily-editable constants (not hardcoded magic numbers scattered through grid math) so they can be corrected without a rewrite once verified.

## Architecture

Vanilla JS, ES modules, no build step, no framework, no bundler.

```
/src
  /grid          — grid math: peyote/brick/square/loom coordinate generation, bead aspect ratios
  /render        — canvas drawing, pan/zoom, viewport logic
  /tools         — draw, erase, fill, color-replace, cut/copy, mirror (one file per tool)
  /palette       — bead color data (Delica/Rocaille specs, color libraries)
  /storage       — IndexedDB wrapper, save/load, autosave
  /export        — word chart generation, print layout
  /units         — mm <-> inch conversion helpers (display layer only)
  main.js        — app shell, wires modules together, event handling
index.html
style.css
CLAUDE.md        — this file
```

## Best Practices To Follow

- Grid math and tool logic as pure functions (state in, state out) — separate from canvas rendering and DOM/event handling. Keeps core logic testable and reasoning-friendly across sessions.
- Internal units always mm. Conversion to inches happens only at the point of display (readouts, labels) — never propagate converted values back into stored/calculated state.
- One central app-state object; modules read/write through defined functions, not by reaching into each other's internals.
- Comments explain *why*, especially for grid offset math — not restating *what* the code visibly does.
- Commits should map to phase boundaries (see below), so repo history documents the build progression.
- Bead physical specs live as named constants in `/palette`, not inline magic numbers, since at least one dimension is still provisional (see Bead Specs gap above).

## Phase Plan

1. **Phase 1 — Peyote grid engine.** Grid math only: given bead width/height ratio, generate correct offset-row peyote layout, render on canvas, support pinch-zoom/pan. No drawing yet. mm-based internally, inches toggle for size readout (Decision #6) built in from the start.
2. **Phase 2 — Draw + erase.** Tap placement, drag-to-draw (Decision #9), erase, Delica/Rocaille color palettes wired in.
3. **Phase 3 — Save/load + project library.** Autosave to IndexedDB, reorderable design list (manual ordering), global persistent preferences (fixes prior-app pain point #1 and #2).
4. **Phase 4 — Print/export instructions.** Row-by-row word chart generation, printable layout.
5. **Phase 5 — Colorways.** Same-grid/alternate-palette variant (Decision #8), lightweight relative to a full duplicate (fixes prior-app pain point #3).
6. **Phase 6 — Remaining tools.** Fill, color-replace, cut/copy, mirror, photo trace overlay with adjustable transparency (Decision #10).
7. **Later / optional, not yet scheduled.** Brick/square/loom grid types, cloud sync (Decision #5), native app rebuild if still wanted.

## Phase Status

*(Update this section at the end of each session — what's done, what's in progress, what the next session should pick up.)*

- Status as of last session: **Phase 2 complete.** Built per `.work/phase-2-implementation-plan.md`'s file breakdown and build order:
  - `src/palette/colorLibrary.js` — placeholder 16-swatch palette (NOT verified Miyuki color numbers — see "Open question" in the Phase 2 plan; proceeded with the plan's own recommendation to build the mechanism now and swap in real catalog data later, since that's a data-only change).
  - `src/state/cellStore.js` — pure `Map<"row,col", { colorId }>` helpers (`cellKey`/`setCell`/`clearCell`/`getCell`).
  - `src/grid/peyote.js` — added `peyoteCellAtPoint` (inverse of `peyoteCellOriginMm`), round-trip tested against it for every cell in a sample grid, both even and odd rows.
  - `src/tools/drawTool.js` / `src/tools/eraseTool.js` — pure `applyDrawAtCell`/`applyEraseAtCell`, each returns whether a cell actually changed so redraws are skipped on no-op drag re-entry.
  - `src/render/canvasRenderer.js` — `drawPeyoteGrid` now takes optional `cells`/`resolveColor` params and fills occupied cells before stroking outlines; stays ignorant of what a "color library" is.
  - `src/interaction/dragTrace.js` — `interpolatedWorldPoints`, fills in intermediate points between pointermove samples so fast drags don't skip cells.
  - `src/interaction/panZoom.js` renamed to `pointerRouter.js` per the plan's centralized-routing decision: two touch/pen pointers → pan/zoom (unchanged math), exactly one touch/pen pointer or mouse-left-drag → draw/erase, Space+mouse-left-drag → pan (dev fallback), plain wheel → pan, ctrl+wheel → zoom-to-cursor. A second touch pointer landing mid-stroke cancels the draw stroke and hands off to pan/zoom.
  - `main.js`/`index.html`/`style.css` — `appState` extended with `tool`, `selectedColorId`, `cells`; draw/erase tool buttons, a color swatch strip (rebuilt on bead-type change), and a Clear button wired in. Regenerating the grid or switching bead type clears `cells` with a `confirm()` guard when non-empty (prior-app pain point #4).
  - `node:test` coverage: 37 tests passing (`cellStore`, `peyote` incl. `peyoteCellAtPoint` round-trip, `drawTool`, `eraseTool`, `dragTrace`, plus Phase 1's existing suites).
  - Verified in headless Chromium (Playwright, driven via a synthetic script against a local `python3 -m http.server`, same approach as Phase 1 since no project run-skill exists yet): mouse tap places exactly one bead, erase tool clears it, selecting a palette swatch changes the drawn color, mouse-drag paints a continuous line with no gaps, Clear button empties the pattern (confirm auto-accepted), plain wheel pans the view, ctrl+wheel zooms, synthetic single-finger touch (dispatched `PointerEvent`s with `pointerType: 'touch'`) draws a cell, and a second synthetic touch landing mid-stroke hands off to pan/zoom without leaving a stray bead between the two fingers. Also verified: a dense scribbled drag on a 300×200 grid that deliberately exits/re-enters the canvas and grid bounds completes (~1.1s) with no thrown errors, and rapid tool-switching mid-drag doesn't throw.
  - **Not yet verified on physical iPad** — real touch/Pencil gesture feel (draw precision at actual finger/Pencil contact size, two-finger pan/zoom vs. one-finger draw disambiguation, no Safari scroll/bounce conflicts) still needs hands-on testing per the plan's step 9; Mac-only synthetic-pointer testing cannot fully substitute for genuine multi-touch input.
  - No project-level run skill exists yet for this app; still recommend `/run-skill-generator` to capture the dev-server + Playwright verification loop (used again this phase) so future sessions don't re-derive it from scratch.
  - Next step: physical iPad verification of Phases 1 and 2 together, then start Phase 3 (autosave to IndexedDB, reorderable design list, global persistent preferences) per the phase plan.