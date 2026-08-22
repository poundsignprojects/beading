# Refactor: make internal row/col naming mean what it should have meant from the start

**Planning only — no implementation in this session, per explicit user request.**

**This reconsiders a past explicit decision.** The session that fixed `wordChart.js`'s grouping-axis bug (`.work/fix-print-row-col-label-plan.md`) deliberately chose *not* to rename `row`/`col` throughout the codebase: "those are opaque address pairs everywhere except `wordChart.js`, and `appState.rows`/`appState.cols` are persisted IndexedDB field names, so a true rename would need a real data migration for no behavioral gain." That reasoning held at the time. It no longer does, for two reasons: (1) the row/col-vs-UI-label mismatch has since directly caused a real, reproducible bug (see the isRaised/resize-stagger fix earlier this session) rather than just being ugly; and (2) the workaround has compounded — there are now *three* independent display-layer label-swap layers papering over the same root confusion (grid Rows/Cols, the resize dialog's anchor-side legends, and the Bead Catalog's Width/Height fields), each one a place a future change can silently reintroduce a bug the way this session's did.

## Context

User, after the isRaised fix: *"It feels like we have workaround on top of workaround with the orientation shift and cols vs rows relabeling. Do you think it would be helpful to rework things so they are what they should have been at the beginning?"* Agreed this is worth doing, but flagged it as a real, riskier refactor (touches most of `src/`, needs a data migration for every saved design) rather than a quick cleanup — this plan is that refactor, scoped and derived from reading the actual current code, not guessed at.

## Current semantics (derived from the actual code, not the comments — see note below)

Empirically, from `peyoteCellOriginMm`/`peyoteRowCells`/`generatePeyoteGrid` in `src/grid/peyote.js`:

- `row` (and the `rows` count) = a bead's position *along* one physical stitching pass. `xMm = row * beadHeightMm` — this axis renders **horizontally** on screen, and there are `rows`-many beads along one pass.
- `col` (and the `cols` count) = *which* physical stitching pass (thread row) a bead belongs to. `yMm = col * beadWidthMm + stagger-offset` — this axis renders **vertically**, and there are `cols`-many passes stacked up.

So internally, `rows` drives the pattern's **width** and `cols` drives its **height** — backwards from what "rows" and "cols" mean in a spreadsheet, in ordinary peyote-pattern language, and (already) in this app's own UI. That mismatch is why three separate display-layer translation layers exist:

1. **Settings dialog** (`index.html`): `<label>Cols <input id="rows"...>` and `<label>Rows <input id="cols"...>` — the DOM id and the visible label are swapped on purpose.
2. **Resize dialog** (`src/ui/resizeDialog.js`): `ROW_SIDE_TO_ANCHOR`/`COL_SIDE_TO_ANCHOR` plus fieldset legends reading "Add/remove **columns** on" for the row-anchor fieldset and "Add/remove **rows** on" for the col-anchor fieldset.
3. **Print header** (`src/ui/printView.js:35`): `` `${appState.rows} cols × ${appState.cols} rows` `` — reads `appState.rows` but labels it "cols."

(Note on the code's own comments: `peyote.js`'s prose above `peyoteCellOriginMm` claims "within a row, beads step by bead *width*; row-to-row spacing uses bead *height*" — this is backwards from what the formula actually computes, most likely a stale leftover from one of the several past edits to this file. Don't trust that comment when implementing; trust the formula and `peyoteRowCells`' own construction, verified above.)

## The fix: swap what `row`/`col`/`rows`/`cols` mean, everywhere

After this refactor: `rows` = how many physical stitching passes are stacked (height-driving, matches the UI's existing "Rows" label), `cols` = how many beads wide each pass is (width-driving, matches "Cols"). This is a **pure, mechanical identifier swap** — every place currently named `row`/`rows` becomes `col`/`cols` and vice versa, consistently, with **no change to any formula, spacing constant, or arithmetic**. Given consistent renaming at every call site, a specific bead's actual computed `xMm`/`yMm` position is bit-for-bit unchanged — only which English word is attached to which axis changes. This is the same design principle this session used for the `isRaised` fix: prefer a change that's mechanically checkable (rename + re-run everything, confirm identical output) over one that requires re-deriving geometry by hand.

Concretely, in `peyoteCellOriginMm`, the parameter currently called `row` becomes `col` and vice versa; the formula body's arithmetic (`row * beadHeightMm`, `col * beadWidthMm + offset`) doesn't change at all — the *values* passed in as the new `col` are exactly the values that used to be passed in as `row`, so nothing about a real bead's position moves.

## Data migration (the genuinely risky part)

The rename alone changes nothing about rendering *if* every stored integer is updated to match. It doesn't, automatically: an already-saved design's `rows`/`cols` fields and every `"row,col"` cell key were written under the *old* meaning. Without migration, loading an old design under the new code would silently transpose it 90° (old `rows: 7, cols: 20` gets read as new `rows: 7` — now meaning *height* — producing a 20-wide-by-7-tall pattern instead of the correct 7-wide-by-20-tall one).

**Two options considered:**

- **Boundary translation** (translate old→new on every load, new→old on every save, storage format never changes) — rejected. This doesn't fix anything, it just relocates the translation layer from "display labels" to "the storage boundary." Still a workaround forever, which defeats the point of this refactor.
- **One-time migration, using this project's existing "migrate on read" pattern** (`migrateDesign.js`, already used for the Phase 6 colorway wrap, the bead-catalog rename fixup, and `driveSyncStore.js`'s `getDriveSyncMeta`) — chosen. After every design has been read once under the new code, storage genuinely matches the new (correct) convention forever after — no permanent translation layer anywhere.

**Design**, added as a new step in `src/storage/migrateDesign.js`, run *after* the existing legacy-`cellEntries`-wrap step (the axis swap assumes `shapeEntries`/`colorways` already exist):

```js
function swapRowColInKey(key) {
  const [a, b] = key.split(',');
  return `${b},${a}`;
}

// axisVersion: 2 marks a record whose rows/cols and every cell key's row/col
// components have already been swapped to the corrected convention (see
// .work/refactor-row-col-axis-naming-plan.md). Absent/1 means the pre-refactor
// convention — every record saved before this shipped.
function migrateAxisConvention(record) {
  if (record.axisVersion === 2) return record;
  return {
    ...record,
    rows: record.cols,
    cols: record.rows,
    shapeEntries: record.shapeEntries.map(swapRowColInKey),
    colorways: record.colorways.map((cw) => ({
      ...cw,
      colorEntries: cw.colorEntries.map(([key, colorId]) => [swapRowColInKey(key), colorId]),
    })),
    axisVersion: 2,
  };
}
```

`migrateDesign(record)` becomes `migrateAxisConvention(migrateLegacyColorways(record))` (renaming today's inline logic into its own step for clarity). `designStore.js`'s `listDesignsSorted` already re-saves any record migration changed — no new wiring needed there.

**Other things that need the identical treatment, found by checking every place `rows`/`cols`/cell-keys are persisted:**

- `src/storage/preferencesStore.js` — `defaultRows`/`defaultCols` (the "last resize becomes the new default size" fields) need the same swap, gated on the same kind of `axisVersion` marker on the single global preferences record. `getPreferences` is the natural place, mirroring `migrateDesign`'s pattern.
- **Google Drive backups** (`src/sync/*`) — need no separate code changes. Restore already runs every incoming design through `migrateDesign()` (confirmed in CLAUDE.md's Phase Status for the cloud-sync feature: "every incoming design is run through the existing `migrateDesign()`"), so an old-format backup pulled from Drive gets migrated exactly the same way an old local record does, automatically. Worth a dedicated verification step anyway (see below) since it's a real path, not just an inferred one.
- **New records** (`createDesign`, `createConvertedDesign` in `designStore.js`) should stamp `axisVersion: 2` directly — no reason to route a brand-new record through migration logic.
- `photoTraces` records (`xMm`/`yMm`/`widthMm`/`heightMm`, world-mm placement/scale) — **no migration needed.** These are physical mm positions, not row/col indices; since the rename doesn't change any `xMm`/`yMm` arithmetic (see above), a stored photo placement remains valid as-is.
- `customColors`/`beadCatalog` records — no row/col-shaped data, unaffected.

## File-by-file scope

**Pure rename, mechanically checkable, no logic change:**
- `src/grid/peyote.js` — `peyoteCellOriginMm`, `generatePeyoteGrid`, `peyoteCellAtPoint`/`peyoteCellAtPointClamped`/`peyoteCellAtPointUnbounded`, `peyoteNeighbors`, `isRaised`.
- `src/state/cellStore.js`, `historyStore.js`, `strokePatch.js`, `resizeGrid.js` — these already treat row/col as a fully symmetric, opaque pair (confirmed by reading each — no axis-specific branching anywhere). Identifier rename only; genuinely zero logic risk.
- `src/tools/drawTool.js`, `eraseTool.js`, `fillTool.js`, `colorReplaceTool.js`, `cutCopyTool.js` — same: symmetric, opaque. Rename only.
- `src/render/canvasRenderer.js`, `selectionOverlay.js`, `pastePreviewOverlay.js`, `thumbnailRenderer.js` — all just call through `peyoteCellOriginMm` consistently; rename only (includes `canvasRenderer.js`'s `rowRange`/`colRange` visible-range culling variables).
- `src/interaction/pointerRouter.js` — forwards `gridParams.rows`/`gridParams.cols` opaquely; rename only.
- `src/state/appState.js`, `src/storage/designStore.js` — field name identifiers only (`rows`/`cols` stay the field *names*, their *meaning* is what changes — see migration above).

**Rename + a real simplification:**
- `src/export/wordChart.js` — `peyoteRowCount`/`peyoteRowCells` exist *specifically* to hide the old row/col inversion from this file ("so `wordChart.js` never has to know peyote's row/col are inverted"). Once `rows` genuinely means "how many physical passes," a physical row's cells are just "every cell with this `rows`-index, `cols`-index 0..cols-1" — direct enumeration, no translation helper needed. Recommend simplifying `buildWordChart` to drop the indirection entirely rather than keeping now-pointless wrapper functions; flag as a judgment call for implementation time, not required for correctness.

**Rename + fixing a real correctness bug found during this investigation:**
- `src/tools/mirrorTool.js` — `applyMirror`'s `'horizontal'` currently flips `col` (today's vertical/height axis) and `'vertical'` flips `row` (today's horizontal/width axis) — this reads backwards from what the button labels imply *right now*, independent of the rename (confirmed by reading `flippedCoord` against the axis semantics derived above, not yet verified empirically in the browser — do that first when implementing, before assuming this needs a fix). If confirmed, this is a real, separate bug (Mirror Horizontal doing a top-bottom flip) worth fixing in the same pass since this file is already being touched and re-tested — but it's conceptually independent of the rename and should be a clearly separate, callable-out change (own commit/step), not silently folded in.

**Where the label-swap layers get deleted (the actual payoff):**
- `index.html` — swap which `id` (`rows`/`cols`) sits next to which visible label, so they finally match; same for the resize dialog's fieldset legends/ids.
- `src/ui/resizeDialog.js` — `ROW_SIDE_TO_ANCHOR`/`COL_SIDE_TO_ANCHOR` and their explanatory comment (documenting the swap) can be simplified — the anchor-side mapping itself still exists (UI "side" choice → `'start'`/`'end'`/`'both'`), but no longer needs to *also* silently swap which fieldset means which axis.
- `src/ui/editorView.js` — `rowsInput`/`colsInput` variable names finally match the DOM elements they hold; settings dialog labels need no more swap comment.
- `src/ui/printView.js:35` — `` `${appState.rows} cols × ${appState.cols} rows` `` becomes a straightforward `` `${appState.rows} rows × ${appState.cols} cols` ``.

**Storage/migration (see dedicated section above):**
- `src/storage/migrateDesign.js`, `src/storage/preferencesStore.js`.

**Tests** (every test file for a touched module needs updating — this is the bulk of the mechanical work): `peyote.test.js`, `wordChart.test.js`, `cellStore.test.js`, `historyStore.test.js`, `strokePatch.test.js`, `resizeGrid.test.js`, `migrateDesign.test.js` (new axis-swap coverage — the main *new* test writing, not just relabeling), `colorReplaceTool.test.js`, `cutCopyTool.test.js`, `drawTool.test.js`, `eraseTool.test.js`, `fillTool.test.js`, `mirrorTool.test.js`. `snapshot.test.js`'s row/col mentions are incidental (symmetric `rows: 2, cols: 2` fixtures) and don't need changes.

**CLAUDE.md** — a real documentation pass, not just a footnote: mark the "Grid orientation transpose" and its "Superseded" follow-up Phase Status entries as further superseded by this refactor (keep them, per this file's own history-preserving convention — add a pointer, don't delete); update the wordchart-fix entry's "Deliberately NOT renaming row/col... for no behavioral gain" line to note it was revisited and why; add a new Phase Status entry once implemented describing the final corrected convention so a future session doesn't have to re-derive any of this.

## Related issues found during this investigation, not in scope here

- **Bead Catalog Width/Height fields** (`src/ui/beadCatalogDialog.js`) have their own, separately-caused display-layer label swap: `widthMm` drives a bead's on-screen *height* today and `heightMm` drives its *width* (confirmed in CLAUDE.md's own Phase Status — this was found and fixed with the identical "swap the label, not the data" band-aid). This is the same disease but a **different root cause** — it's about which physical bead dimension (`widthMm`/`heightMm`) maps to which screen axis, not about which grid index (`row`/`col`) does. The row/col rename in this plan does **not** fix it (verified: the formula that decides "within-row spacing uses which bead dimension" doesn't change under a pure row/col relabel). Fixing it for real would mean renaming `widthMm`↔`heightMm` throughout `beadSpecs.js`/`beadCatalogStore.js`/every renderer, plus its own migration for the `beadCatalog` store — real, separate scope, and CLAUDE.md already flags the underlying numbers themselves as provisional/unverified, so bundling a rename with an already-uncertain data source seems like the wrong moment. Recommend a dedicated follow-up plan if wanted, not folding it in here.

## Explicitly scoped out

- Not touching `beadWidthMm`/`beadHeightMm` or any bead-dimension-to-axis assignment — see above.
- Not attempting to fix or re-verify the actual bead measurement *values* (CLAUDE.md's Bead Specs section already flags width/height as provisional) — orthogonal to this refactor.
- Not building a stitch-type-agnostic abstraction beyond what already exists — this app is still peyote-only everywhere.
- No object store additions/removals — this is a record-shape migration like the Phase 6 colorway wrap. **Superseded by the Backup Safety section below**: `DB_VERSION` itself does get a deliberate bump, not because the schema needs it, but to reuse an existing safety mechanism that's keyed off it.

## Backup safety

The migration in `migrateDesign.js` isn't read-only — `designStore.js`'s `listDesignsSorted` re-saves every record it migrates. So the first time the new code loads the library, it silently rewrites every saved design's `rows`/`cols`/cell keys in place, before anyone has looked at whether it came out right. Four layers, addressing four different points where that could go wrong:

**1. Manual, off-app checkpoint — a process step, not code.** Before the new code is ever loaded (i.e. before this refactor is deployed to the device that has the real data), use the existing "Export Backup File" flow (`src/sync/localBackupFile.js`, reachable from the Backup & Sync dialog today) to write a JSON snapshot to disk, and set that file aside somewhere the app can't touch — a Files app folder, AirDropped to the Mac, etc. Nothing about this refactor can corrupt a file that isn't open in the app. This is the actual last line of defense if everything else here fails, so it happens first, before implementation even starts, not as a build-order step.

**2. Give this migration the retained Drive checkpoint the version-bump path already has.** Checked directly: `main.js`'s `attemptPreMigrationDriveBackup()` only fires when `existingDb.version < CURRENT_DB_VERSION` (`db.js`) — i.e. it's wired to schema version bumps, not to "a migration is about to run" in general. Since this refactor doesn't need a new object store, the plan as first written wouldn't have bumped `DB_VERSION`, and this existing safety net would never fire for it. Fix: bump `DB_VERSION` (6 → 7) anyway, purely to trip that check — confirmed safe to do with zero schema changes, since `db.js`'s `onupgradeneeded` handler is already written as a set of idempotent `if (!db.objectStoreNames.contains(...))` guards; a version bump with no new store-creation lines added is a no-op there, it only exists to make the upgrade transaction (and therefore `attemptPreMigrationDriveBackup`'s version check) fire. This reuses `runPreMigrationBackup`'s existing, already-tested retained-checkpoint path (`pre-migration-backups/{ISO timestamp}/` on Drive, a copy no routine push can ever overwrite) instead of building a parallel one-off mechanism for this migration specifically.

**3. Hold the automatic "push on design close" until a human has looked.** `main.js`'s `pushBackupIfConnected()` (fired from `backToLibrary()` on every design close) would otherwise overwrite the live per-device Drive backup with freshly-migrated data the moment the user closes the first design after updating — before they've had any chance to notice something's wrong. Add a `pendingAxisMigrationReview` flag to `driveSyncStore.js`'s meta (same store, same `{...DEFAULT_META, ...stored}` merge-on-read convention already fixed there this session for exactly this reason — a field a stored row predates must default in, not come back `undefined`). Set it from `boot()`: have `listDesignsSorted` (or a thin wrapper around it) report whether it actually ran the axis-swap step on anything, not just the pre-existing legacy-colorway-wrap step, and set the flag only if so — a brand-new install or a library that's already fully on `axisVersion: 2` never sets it, so this adds no friction for anyone not affected. While the flag is set, `pushBackupIfConnected()` skips the silent push and shows a variant of the existing reconnect banner instead (`driveReconnectBanner.js`'s pattern, reused, not duplicated) reading something like "This update changed how patterns are stored — check that your patterns still look right, then back up manually when ready," pointing at the Backup & Sync dialog. The flag clears the moment the user does an explicit **Back Up Now** click in `backupDialog.js` (a real decision to proceed, not a passive timeout) — never automatically.

**4. Verify before trusting, and know what to look at.** Spot-check a handful of real patterns after updating, before ever clicking Back Up Now — specifically any with an odd row or column count (the ones whose stagger visibly changes are the ones most likely to reveal a migration bug at a glance) and anything with a distinctive, memorable shape. This is a manual step, not automatable, since it's checking against the user's own memory of what the pattern should look like — but it's exactly what layer 3 buys time for.

Net effect: even in the worst case (the migration has a real bug nobody catches until after Back Up Now is clicked), there are still two independent, untouched-by-the-bug copies to recover from — the manual export from layer 1, and the retained pre-migration Drive checkpoint from layer 2 — neither of which any code path in this refactor ever writes to again.

## Build order

0. **Before any code changes**: (a) manual local backup export (Backup Safety layer 1), set aside off-app; (b) capture the golden-reference test design required by Verification step 3 below — build it and screenshot/pixel-sample it against the *current, unmodified* app, save the fixture, **before touching any source file**. Doing this after step 1 defeats the point of it (the reference has to predate the change it's checking).
1. `src/grid/peyote.js` rename (the foundation everything else calls through) + its test file. Verify old vs. new produce identical `xMm`/`yMm` for consistently-swapped inputs (a mechanical/scriptable check, not hand-verification).
2. `src/storage/migrateDesign.js` axis-swap step + `preferencesStore.js` equivalent + new tests — the highest-risk piece, build and test in isolation before touching anything that depends on it rendering correctly.
3. Backup safety layers 2 and 3: `db.js`'s `DB_VERSION` bump, `driveSyncStore.js`'s `pendingAxisMigrationReview` flag, `pushBackupIfConnected()`'s hold-and-banner, `backupDialog.js`'s flag-clear on manual Back Up Now — built and tested alongside the migration itself (step 2), not deferred to the end, since it needs to be live *before* this ever runs against real data.
4. Opaque pass-through layers: `cellStore.js`/`historyStore.js`/`strokePatch.js`/`resizeGrid.js`, the tools, the renderers, `pointerRouter.js` — mechanical, low-risk, but there are many of them; do as one sweep with the full test suite run after.
5. `wordChart.js` simplification + its tests.
6. `mirrorTool.js` — verify the suspected horizontal/vertical bug empirically first, fix if confirmed, as its own clearly-labeled step.
7. UI layer: `index.html`, `resizeDialog.js`, `editorView.js`, `printView.js` — delete the label-swap workarounds now that the underlying values finally match.
8. `designStore.js` — stamp `axisVersion: 2` on newly-created records.
9. CLAUDE.md documentation pass.

## Verification plan

Given this session's own experience getting a pixel-comparison check tautologically wrong earlier (a check that used the app's *own* current formula to validate itself passed even against the buggy code) — verification here must not fall into the same trap. Concretely:

1. **Full `node:test` suite** after every step in the build order, not just at the end — same discipline as every other session in this project.
2. **Rename correctness, mechanically**: for a range of `(row, col, rows, cols)` inputs, confirm `peyoteCellOriginMm`'s output is byte-identical before/after the rename when call sites are swapped consistently (scriptable, no hand-rederivation needed).
3. **Migration correctness, non-tautologically**: before making any code change, use the *current, unmodified* app to create a real test design (asymmetric `rows`≠`cols`, at least one odd count, several distinct-colored cells at known positions) and capture its rendered canvas (screenshot / pixel samples at known screen positions) as a **golden reference**, saved to a fixture file — captured from the real running app, not recomputed from any formula. After implementing, seed a fresh IndexedDB with that same design's *pre-refactor-shaped* record (real `rows`/`cols`/cell keys, no `axisVersion` field) directly, load it under the new code, and confirm the rendered canvas matches the golden reference. This is the load-bearing check: it proves the migration produces the same visible pattern, using ground truth captured before any change existed to bias the check.
4. **Idempotency**: confirm loading an already-migrated (`axisVersion: 2`) record a second time doesn't re-swap it (a swap-of-a-swap would silently corrupt every design on a second app load if this were missed).
5. **Cross-device/cloud path**: seed a fake pre-refactor-shaped Drive backup and confirm `restoreFromDeviceBackup` produces the correctly-migrated result too, not just the local-IndexedDB path. **Note for whoever implements this**: CLAUDE.md's Phase Status describes past sessions doing this via Node's built-in `node:test` `mock.module()` API to fake out `googleDriveClient.js`'s exported functions and exercise `backupSync.js` against an in-memory fake Drive — but those scripts were never committed (confirmed: no file in this repo uses `mock.module`, there's no `backupSync.test.js`). Reconstruct the approach from `mock.module`'s own docs and `backupSync.js`'s actual exports rather than searching for a reusable fixture that doesn't exist — and consider committing it as a real test file this time, since this plan is the second time it would have been useful to have.
6. **End-to-end UI pass** (headless Chromium): create/resize/draw/undo/print/mirror/fill/copy-paste on a fresh design under the new code and confirm all still work; specifically re-run this session's `isRaised`-stability check (odd-delta column resize no longer flips stagger) to confirm the rename didn't regress the fix that motivated this whole refactor.
7. **Settings dialog / resize dialog / print header labels** — confirm visually that `id`, visible label, and underlying value now all agree (no more swap needed to make sense of the UI).
8. **Backup safety mechanisms themselves, before trusting them**: confirm the `DB_VERSION` bump alone (no schema change) actually trips `attemptPreMigrationDriveBackup` and produces a real retained Drive checkpoint (same fake-Drive approach as verification step 5 — see its note on reconstructing rather than reusing); confirm `pushBackupIfConnected()` genuinely skips the push and shows the review banner while `pendingAxisMigrationReview` is set, and that a manual Back Up Now both clears the flag and performs the push; confirm the flag is *not* set at all for a fresh install or an already-`axisVersion:2` library (no false-positive friction).
9. Real iPad pass — deferred like every other feature in this project's history, but flagged as especially warranted here given the migration touches every one of the user's real saved designs.

## Risks

- **The migration is the one place a real mistake could corrupt or misrender the user's actual saved patterns.** Mitigated by: building it as an isolated, independently-tested step before anything else depends on it (build order #2); the non-tautological golden-reference verification above; the Backup Safety section's four independent layers; and the fact that this project already has a working precedent for exactly this class of change (Phase 6's colorway wrap migrated every existing design's shape with no reported data loss).
- **Volume of touched files** (~25 source files + their tests) means more surface area for a stray missed call site than any single bug fix this project has done — the "opaque pass-through" files (build order #4) are the most numerous but lowest-risk; the highest-risk file (`migrateDesign.js`) is also the smallest and most isolated.
- Recommend doing this as its own dedicated session/commit, not folded into unrelated work, so a revert is clean if something is found wrong after the fact.

## Status: plan only, not implemented

Nothing in this plan has been built. Ready to implement in a future session.
