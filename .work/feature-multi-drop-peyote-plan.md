# Multi-drop peyote + New Pattern dialog — implementation plan

## Goal

1. Peyote designs get a per-design **drop count** (1 or more) — the number of
   beads picked up together at each stitch. Existing designs can have their
   drop count changed after the fact.
2. The library's "+ New" button opens a dialog to choose pattern type (stitch
   type), bead type, drop count (peyote only), and the pattern's name, instead
   of instant-creating a design from whatever the last-used defaults were.

## Decisions confirmed with the user before writing this plan

- **Drop geometry**: an N-drop group is N beads picked up together at one
  stitch, sitting **side-by-side within one thread pass**, all at the same
  raised/recessed stagger level — each bead in the group stays individually
  colorable. This is standard N-drop peyote (BeadTool/Fun & Function's
  "drop" setting means the same thing). Confirmed over the alternative
  (beads stacked across separate passes), which was rejected.
- **Converting an existing design's drop count**: **reinterpret in place** —
  same bead positions and colors, same column count, only the raised/recessed
  grouping and the printed stitching instructions change. Fully
  non-destructive. This is a live, undo-free property of an open design (like
  toggling bead outlines), *not* a clone-based conversion the way Bead Type
  and Stitch Type conversions are. Confirmed over the alternative (resampling
  the picture by duplicating/merging columns, which was rejected — that would
  have needed a clone-based flow like Convert Bead Type).

The "reinterpret in place" answer is what keeps this feature's blast radius
small: because a bead's color is stored independently of drop grouping,
changing `dropCount` never touches `shapeEntries`/`colorEntries` at all — it's
purely a change to which columns share a stagger level, recomputed fresh from
column index every time. Resize, crop, rotate, mirror, cut/copy/paste, fill,
and color-replace all continue to work exactly as they do today, with the one
exception documented in "Known limitations" below.

## Geometric derivation

### Current (dropCount = 1) structure, for reference

`src/grid/peyote.js`'s `isRaised(col, cols, flipped)` currently alternates
every single column: `positiveMod2(col) === (flipped ? 0 : 1)`. Column parity
alone decides whether a bead renders at the "raised" level (offset 0) or the
"recessed" level (offset `+beadWidthMm/2`) within its row. `peyoteNeighbors`
encodes the resulting adjacency: two columns are never at the same level
(period-2 alternation), so every left/right neighbor is a diagonal
relationship bridging half a level via one of two possible rows.

### Generalizing to dropCount ≥ 1

Group columns into contiguous runs of `dropCount`, via `dropGroup(col,
dropCount) = Math.floor(col / dropCount)`, and alternate raised/recessed
**per group** instead of per column:

```js
function dropGroup(col, dropCount) {
  return Math.floor(col / dropCount);
}

export function isRaised(col, cols, flipped = false, dropCount = 1) {
  return positiveMod2(dropGroup(col, dropCount)) === (flipped ? 0 : 1);
}
```

For `dropCount = 1`, `dropGroup(col, 1) === col`, so this is byte-for-byte the
existing rule — every call site defaults `dropCount` to 1 and nothing that
doesn't opt in changes behavior.

`Math.floor` on a negative `col` still groups correctly (verified by hand):
for `dropCount = 2`, `col = -2` and `col = -1` both give `dropGroup = -1` (the
same group), matching `col = 0`/`col = 1` both giving `dropGroup = 0` — groups
tile cleanly across zero, which matters because `peyoteCellAtPointUnbounded`
and the paste-ghost overlay already call these functions with negative
columns.

**`peyoteCellOriginMm` does not need its `xMm` formula to change.** Each bead
in a drop group still occupies its own column slot (`xMm: col *
beadHeightMm`) — a group is N full beads sitting immediately next to each
other at the same height, not one wide "super-bead." Only the Y-offset
(`rowOffsetMm`, still exactly `0` or `beadWidthMm / 2` — the amplitude is
unchanged, only which columns share which value changes) comes from the new
`isRaised`. Same reasoning means `generatePeyoteGrid`'s bounding-box formula
(`widthMm = cols * beadHeightMm`, `heightMm = rows * beadWidthMm +
beadWidthMm / 2`) needs **no change at all** — the max stagger overhang is
still exactly half a bead-width, regardless of group size.

`peyoteCellAtPoint`/`peyoteCellAtPointClamped`/`peyoteCellAtPointUnbounded`
all compute `rowOffsetMm` via `isRaised` the same way `peyoteCellOriginMm`
does — thread `dropCount` through identically, no other change.

### `peyoteNeighbors` needs real restructuring, not just a threaded parameter

Today, `col - 1` and `col + 1` are *always* the opposite stagger level from
`col` (period-2), so both left and right neighbors are always the
diagonal/bridging relationship. With `dropCount > 1`, a neighbor in the same
drop group (e.g. `col` and `col + 1` both in group `k`) is a **direct
same-row, same-level** neighbor (two beads strung side by side on the same
pass, physically touching) — not a diagonal one. Only a neighbor that crosses
a group boundary is still the diagonal/bridging relationship.

```js
export function peyoteNeighbors(row, col, cols, flipped = false, dropCount = 1) {
  const sameGroup = (otherCol) => dropGroup(otherCol, dropCount) === dropGroup(col, dropCount);
  const [a, b] = isRaised(col, cols, flipped, dropCount) ? [row - 1, row] : [row, row + 1];

  const leftNeighbors = sameGroup(col - 1) ? [[row, col - 1]] : [[a, col - 1], [b, col - 1]];
  const rightNeighbors = sameGroup(col + 1) ? [[row, col + 1]] : [[a, col + 1], [b, col + 1]];

  return [[row - 1, col], [row + 1, col], ...leftNeighbors, ...rightNeighbors];
}
```

For `dropCount = 1`, `sameGroup(col - 1)`/`sameGroup(col + 1)` are always
`false` (adjacent columns are never the same "group" of size 1), so this
collapses to exactly the current 6-neighbor formula.

Hand-verified for symmetry on a `dropCount = 2` example (group0 = cols
{0,1}, group1 = cols {2,3}, alternating recessed/raised): `(row,0)` and
`(row,1)` list each other as same-row neighbors (both `sameGroup` checks
true, mutually) — matches. `(row,1)` and `(row,2)` (a group boundary) use the
diagonal `[a,b]` relationship computed from each side's own `isRaised`
state — this needs a dedicated symmetry property test (not just hand-checked
examples) before trusting it; see Verification.

This is the one function in this feature where getting the derivation wrong
would silently corrupt flood fill (colorReplace/fillTool's connectivity) —
treat its test coverage as load-bearing, not optional.

### Everything downstream of `isRaised`/`peyoteNeighbors` needs no other change

- **`generatePeyoteGrid`**: unaffected (see above).
- **Resize/crop** (`src/state/resizeGrid.js`'s `resizeCells`/`cropCells`):
  unaffected for the *cell data* — a resize/crop only ever adds, removes, or
  shifts columns; drop grouping recomputes fresh from whatever column indices
  remain, with no stored per-cell group metadata to keep in sync. One
  exception: the existing `compensatedStaggerFlipped` col-shift compensation
  needs generalizing — see "Known limitations."
- **Rotation** (`src/state/rotateGrid.js`): a 90°/270° rotation already
  resets `staggerFlipped` to `false` rather than trying to compensate it,
  with the stated reasoning "a rotation is a wholesale new coordinate set,
  not a shift." The same reasoning applies to `dropCount`: leave it
  completely unchanged through any rotation (90°/180°/270°) — it continues to
  describe "how many beads per stitch along whichever axis is now the
  beads-per-pass axis," exactly like `stitchType`/`beadTypeKey` already pass
  through rotation untouched. No code change needed in `rotateGrid.js`.
- **Cut/copy/paste** (`src/tools/cutCopyTool.js`): clipboard operations work
  on raw `(row, col, colorId)` triples with relative offsets and never call
  `isRaised`/`peyoteNeighbors` — unaffected.
- **Fill/color-replace** (`src/tools/fillTool.js`/`colorReplaceTool.js`):
  `fillTool.js` already takes an injected `neighborsFn` from
  `gridEngine.js`'s resolved engine — once `peyoteNeighbors` is dropCount-aware
  and threaded through `gridEngine.js`, flood fill automatically treats
  same-group beads as connected, which is the physically correct behavior (no
  code change needed in `fillTool.js` itself).
- **Selection overlay / paste-preview overlay / canvas renderer's visible-range
  culling**: all key off `engine.cellOrigin`/the constant half-bead-width max
  offset, neither of which changed shape — no change needed, but audit
  `canvasRenderer.js`'s culling margin math at implementation time to confirm
  it doesn't hardcode an assumption about the *period* of the stagger (only
  its amplitude, which is unchanged).
- **Mirror Vertical**: `mirrorTool.js`'s own comment already states
  `isRaised` depends only on `col`, never `row` — reversing row order can
  never affect stagger. Still true, still no dropCount interaction.

### Mirror Horizontal needs its even/odd guard generalized

Today, `editorView.js`'s `updateSelectionButtons` disables Mirror Horizontal
when the selection width is even, because reversing column order within an
odd-width selection preserves every swapped pair's stagger parity, while an
even-width selection flips it (derivable: for a selection of width `w`,
reversing index `i` to `w - 1 - i` keeps the same parity iff `w` is odd,
since `i` and `w - 1 - i` sum to `w - 1`, which is even iff `w` is odd).

Generalized for `dropCount`: what must be preserved isn't column parity but
**group** parity. A selection of width `w` divides cleanly into whole groups
only when `w % dropCount === 0`; let `numGroups = w / dropCount`. Reversing
column order maps group `g`'s whole column range onto group `(numGroups - 1 -
g)`'s column range (verified algebraically: the first column of group `g`,
`g * dropCount`, maps to `w - 1 - g * dropCount`, which equals the *last*
column of group `numGroups - 1 - g`). Group `g` and group `numGroups - 1 - g`
have the same parity for every `g` iff `numGroups - 1` is even, i.e.
**`numGroups` is odd**.

So the generalized, backward-compatible condition is:

```js
// src/tools/mirrorTool.js
export function canMirrorHorizontally(width, dropCount) {
  return width % dropCount === 0 && (width / dropCount) % 2 === 1;
}
```

For `dropCount = 1`: `width % 1 === 0` is always true, and `(width / 1) % 2
=== 1` is just "width is odd" — exactly today's rule. This condition should
be pulled out as its own pure, exported, tested function (it currently lives
inline as `widthEven`/`blocksEvenWidthMirror` in `editorView.js`'s DOM code,
untested) so it can get direct `node:test` coverage instead of only being
exercised through Playwright.

`editorView.js`'s `updateSelectionButtons` changes from:
```js
const widthEven = hasSelection && (selection.colEnd - selection.colStart + 1) % 2 === 0;
const blocksEvenWidthMirror = appState.stitchType === 'peyote' && widthEven;
```
to:
```js
const width = hasSelection ? selection.colEnd - selection.colStart + 1 : 0;
const blocksMirror = appState.stitchType === 'peyote' && hasSelection && !canMirrorHorizontally(width, appState.dropCount);
```
(`dropCount` is meaningless for square stitch, same as today's `stitchType
=== 'peyote'` guard — square stitch's `dropCount` is always `1` and this
branch is skipped for it entirely anyway.)

`mirrorTool.js`'s own header comment (currently: "reversing col order on an
even-width selection would land content on the wrong physical stagger")
needs updating to describe the group-based generalization, referencing this
plan for the derivation.

## Data model

### New field: `dropCount` (integer ≥ 1)

- Stored on every design record (`design.dropCount`), meaningful only when
  `stitchType === 'peyote'` — square-stitch designs also carry `dropCount: 1`
  for schema uniformity (avoids `undefined`-guarding it everywhere; the
  square grid engine simply never reads it).
- `appState.dropCount` (new field in `src/state/appState.js`, default `1`,
  right next to `staggerFlipped`).
- Stashed onto `appState.gridParams.dropCount` inside `editorView.js`'s
  `rebuildGridParams()`, the same way `staggerFlipped`/`stitchType` already
  are — not part of `generateGrid`'s own signature since it doesn't affect
  the bounding box.
- `src/grid/gridEngine.js`'s `peyoteEngine` wrapper functions thread
  `p.dropCount` through to every peyote function that now accepts it
  (`cellOrigin`, `cellAtPoint`, `cellAtPointClamped`, `cellAtPointUnbounded`,
  `neighbors`). `squareEngine` is untouched — its underlying functions never
  gained a `dropCount` parameter, since the concept doesn't apply.

### Migration (`src/storage/migrateDesign.js`)

New fifth step, `migrateDropCount`, appended after `migrateStitchType` (same
"gated on field presence, independent of other gates" idiom as every prior
step):

```js
function migrateDropCount(record) {
  if (record.dropCount !== undefined) return record;
  return { ...record, dropCount: 1 };
}
```

Every design saved before this feature existed was implicitly 1-drop — no
data ambiguity here, unlike some of this codebase's earlier stagger-related
migrations. `createDesign`/`createConvertedDesign` (`designStore.js`) both
stamp `dropCount` explicitly on new records, never routed through migration
(matching `staggerFlipped`/`stitchType`'s own precedent).

### `src/storage/designStore.js`

- `createDesign(db, { name, beadTypeKey, stitchType = 'peyote', dropCount =
  1, rows, cols })` — new `dropCount` param, stamped on the record.
- `createConvertedDesign(db, { ..., dropCount = 1, ... })` — new param,
  passed through by both `handleBeadTypeConvertConfirmed` (preserve
  `appState.dropCount` — bead type never changes stitch geometry) and
  `handleStitchTypeConvertConfirmed` (preserve `appState.dropCount` only when
  the *target* is peyote; reset to `1` when converting to square stitch, for
  cleanliness — inert either way, but avoids a stale drop count lingering on
  a square-stitch design that could resurface confusingly if that design is
  later converted back to peyote).
- `duplicateDesign` needs **no change** — its existing `...original` spread
  already carries `dropCount` over verbatim.

### `src/storage/preferencesStore.js`

`DEFAULT_PREFERENCES` gains `defaultDropCount: 1` ("last-used becomes the new
default," same role as `defaultBeadTypeKey`/`defaultStitchType`/
`defaultRows`/`defaultCols`).

**Caveat worth flagging explicitly**: `getPreferences` returns an
already-stored preferences row *verbatim* (not merged over
`DEFAULT_PREFERENCES`) whenever one exists — so an existing user's stored
preferences row, saved before this feature shipped, will come back with
`defaultDropCount: undefined`, not silently falling back to `1`. This is the
same class of bug already found and fixed once in this codebase for
`driveSyncStore.js`'s `getDriveSyncMeta` (a stored row can silently predate a
field added later). Rather than change `getPreferences`'s merge behavior
broadly (out of scope, could have unintended effects on unrelated fields),
follow the narrower precedent already used elsewhere in this codebase for
the same situation (e.g. `showRuler`'s "explicit `!== false`" read) — read
`prefs.defaultDropCount ?? 1` at the one or two places it's actually
consumed (`main.js`'s `handleCreate`/the new dialog's default-seeding), not
by trusting the stored object to already have it.

### `src/storage/db.js`

Bump `DB_VERSION` from 8 to 9, with a comment matching the established
convention (no object-store schema change — this is a record-shape change
handled by `migrateDesign.js` on read — but the version bump alone still
trips `main.js`'s `attemptPreMigrationDriveBackup()` pre-migration warning,
the same safety net every prior schema-affecting change has gotten).

## Word chart / print output (`src/export/wordChart.js`, `src/ui/printView.js`)

Because run-length encoding only cares about color equality within a
raised/non-raised half-pass, **the printed chart's run format needs no
change at all** — a run like `"4A"` already correctly represents "4
same-colored beads in a row on this pass," and a stitcher who knows the
pattern is N-drop simply picks them up N at a time as they go. Only the
*grouping that decides which columns land in the raised vs. non-raised
bucket* changes, which is exactly what threading `dropCount` into `isRaised`
already provides for free.

- `buildWordChart(cells, rows, cols, stitchType = 'peyote', flipped = false,
  dropCount = 1)` — new trailing param, passed to `splitByPosition`.
- `splitByPosition(rowCells, cols, flipped, dropCount)` — its one `isRaised`
  call becomes `isRaised(cell.col, cols, flipped, dropCount)`.
- `printView.js`'s call site: `buildWordChart(appState.cells, appState.rows,
  appState.cols, appState.stitchType, appState.staggerFlipped,
  appState.dropCount)`.
- **Header line should state the drop count** so a printed pattern is
  self-describing for the stitcher — add a new `stitchTypeDetailLabel
  (stitchType, dropCount)` export in `src/grid/gridEngine.js`, alongside the
  existing `stitchTypeLabel`:
  ```js
  export function stitchTypeDetailLabel(stitchType, dropCount) {
    if (stitchType === 'peyote' && dropCount > 1) return `${stitchTypeLabel(stitchType)} (${dropCount}-Drop)`;
    return stitchTypeLabel(stitchType);
  }
  ```
  (1-drop is just "Peyote," matching how nobody calls ordinary peyote
  "1-drop peyote" in practice.) Update every current call site of
  `stitchTypeLabel` that describes a *specific design* (not a bare stitch
  type in the abstract) to use this instead: `printView.js`'s `specLine`,
  and `libraryView.js`'s per-row stitch-type label (wired via a callback —
  audit the exact current name at implementation time, likely something like
  `resolveStitchTypeLabel` passed from `main.js`). `editorView.js`'s
  stitch-type-conversion confirm dialog (`handleStitchTypeChange`) should
  keep using the bare `stitchTypeLabel` — that message is about the *target*
  stitch type in the abstract, not the current design's drop count.

## UI

### New Pattern dialog (replaces instant-create on "+ New")

New `src/ui/newPatternDialog.js`, following the same self-contained,
Promise-based convention as `resizeDialog.js`/`convertBeadTypeDialog.js` (own
`<dialog>` markup, no hooks into `main.js`):

```js
export function promptNewPattern({ beadCatalog, defaults }) {
  // defaults: { name: '', stitchType, beadTypeKey, dropCount, rows, cols }
  // resolves { name, stitchType, beadTypeKey, dropCount, rows, cols } on
  // Create, null on Cancel/Esc.
}
```

New `#new-pattern-dialog` markup in `index.html`:
- Name — `<input type="text">`, seeded blank (matches this codebase's
  existing "no default name" precedent from `handleCreate` — a blank name
  is a supported, intentional state, not an error).
- Pattern Type — `<select>` with the same two options as the Settings
  dialog's `#stitch-type` (Peyote / Square Stitch).
- Bead Type — `<select>`, populated from `beadCatalog` the same way
  `editorView.js`'s `renderBeadTypeSelect()` already populates the settings
  dialog's own bead-type select — reuse that population logic (extract it
  into a small shared helper if it isn't already independent of DOM refs) so
  both selects can never drift.
- Drops — `<input type="number" min="1" max="10">`, shown only when Pattern
  Type is Peyote (toggled via the Pattern Type select's own `change` event
  inside the dialog, before any Create/Cancel decision is made). `max="10"`
  is a soft UI sanity bound, not an architectural limit — worth a quick
  gut-check with the user once this is built, easy to change.
- Rows / Cols — two `<input type="number" min="1">` fields, same convention
  as `#settings-dialog`'s existing `#rows`/`#cols` inputs (including the
  same historical label-vs-internal-axis mapping already established there —
  reuse `#settings-dialog`'s labels verbatim, don't re-derive them). Seeded
  from `defaultRows`/`defaultCols`.
- Create / Cancel buttons, same layout convention as
  `#convert-bead-type-dialog`'s actions row.

Defaults for every field are seeded from preferences
(`defaultStitchType`/`defaultBeadTypeKey`/`defaultDropCount ?? 1`/
`defaultRows`/`defaultCols`) exactly like today's `handleCreate` does. All
six fields (name, type, bead type, drops, rows, cols) are now chosen
up front in this one dialog, rather than rows/cols only being adjustable
after creation via the existing Resize flow — Resize remains available
afterward for changing size on an already-created design, this dialog just
also lets the user pick a starting size instead of always inheriting
whatever the last design used.

`main.js`'s `handleCreate` changes from taking no arguments (reading
everything off `appState.preferences`) to taking the dialog's resolved
fields directly:

```js
async function handleCreate() {
  const prefs = appState.preferences;
  const result = await promptNewPattern({
    beadCatalog: appState.beadCatalog,
    defaults: {
      name: '',
      stitchType: prefs.defaultStitchType,
      beadTypeKey: prefs.defaultBeadTypeKey,
      dropCount: prefs.defaultDropCount ?? 1,
      rows: prefs.defaultRows,
      cols: prefs.defaultCols,
    },
  });
  if (!result) return; // Cancel — nothing created, matching every other cancel-flow in this app

  const design = await createDesign(appState.db, {
    name: result.name,
    beadTypeKey: result.beadTypeKey,
    stitchType: result.stitchType,
    dropCount: result.stitchType === 'peyote' ? result.dropCount : 1,
    rows: result.rows,
    cols: result.cols,
  });
  appState.designs.push(design);
  appState.designs.sort((a, b) => a.order - b.order);
  const updatedPrefs = {
    ...prefs,
    defaultStitchType: result.stitchType,
    defaultBeadTypeKey: result.beadTypeKey,
    defaultDropCount: result.dropCount,
    defaultRows: result.rows,
    defaultCols: result.cols,
  };
  await savePreferences(appState.db, updatedPrefs);
  appState.preferences = updatedPrefs;
  await openDesign(design);
}
```

Rows/Cols chosen here become the new "last-used" defaults too, same
"last-used becomes the new default" treatment `defaultStitchType`/
`defaultBeadTypeKey`/`defaultDropCount` already get — consistent with how
`defaultRows`/`defaultCols` already behave today (currently only ever
updated by a Resize, per `resizeDialog.js`'s existing writeback; this dialog
becomes a second place that can set them).

(Exact preference-writeback mechanics — whether this goes through the
existing generic `hooks.onPreferencesChanged`-style helper or a direct
`savePreferences` call — should match whatever `main.js` already does
elsewhere for "last used becomes new default"; audit at implementation
time rather than assume the sketch above is the final shape.)

Audit the exact current wiring of `#library-new` (likely
`libraryView.js`'s `callbacks.onCreate` → `main.js`'s `handleCreate`) at
implementation time and confirm the click handler still lands on the
(now-async, now dialog-gated) `handleCreate` with no other change needed on
the `libraryView.js` side.

### Settings dialog — "Drops" field (the conversion mechanism for existing designs)

Because drop-count changes are non-destructive and reinterpreted live (per
the confirmed decision), there's no separate "Convert Drop Count" dialog the
way Bead Type/Stitch Type conversions need one — the Settings dialog's Drops
field *is* the conversion UI, and changing it takes effect immediately.

`index.html`'s `#settings-dialog` gains, next to `#stitch-type`:
```html
<label id="settings-drop-count-label">Drops
  <input id="drop-count" type="number" value="1" min="1" max="10">
</label>
```

`editorView.js`:
- `updateDropCountVisibility()` — shows/hides `#settings-drop-count-label`
  based on the *currently selected* stitch-type select value (not
  necessarily the committed `appState.stitchType`, since the select's value
  can change before a non-empty-design conversion is confirmed or reverted —
  call this from `handleStitchTypeChange`'s empty-design branch, its
  confirmed-conversion branch, and its cancel/revert branch, plus once at
  mount).
- New `handleDropCountChange()`, wired to `#drop-count`'s `change` event:
  parses and clamps to a positive integer, no-ops if unchanged, otherwise:
  ```js
  function handleDropCountChange() {
    const value = Math.max(1, Math.round(Number(dropCountInput.value)) || 1);
    dropCountInput.value = String(value);
    if (value === appState.dropCount) return;
    appState.dropCount = value;
    rebuildGridParams();
    updateSelectionButtons(); // Mirror Horizontal's guard depends on dropCount
    scheduleRedraw();
    hooks.onPreferencesChanged({ defaultDropCount: value });
    hooks.onDesignContentChanged();
    hooks.onImmediateSave();
  }
  ```
  No confirm dialog (matches Crop to Design's precedent — nothing is lost),
  no undo-history entry (matches how `stitchType`/`beadTypeKey` changes
  aren't part of the cell-patch undo stack either — this doesn't touch
  `cells`/`rows`/`cols`/`staggerFlipped` at all, only a rendering
  reinterpretation of existing data).
- A short static helper line under the field (e.g. "Changes how existing
  rows restagger for stitching — no beads are added or removed") to set
  expectations for what's otherwise an instant, silent visual change to
  every already-placed bead's apparent row/level.

## Known limitations (flagging honestly rather than silently deciding)

**Resize's column-shift compensation isn't fully general for every
`dropCount`/offset combination.** `resizeGrid.js`'s existing
`compensatedStaggerFlipped(staggerFlipped, colOffset)` toggles
`staggerFlipped` iff `colOffset` is odd — this exists because a resize's
anchor can shift every existing cell's column by a constant `colOffset`,
which (for `dropCount = 1`) flips which parity is "raised" iff the shift is
odd. Generalized: a shift only cleanly preserves every drop group's internal
structure when `colOffset` is itself a multiple of `dropCount` (an
whole-groups-at-a-time shift) — in that case, compensate by toggling iff
`colOffset / dropCount` is odd. When `colOffset` is **not** a multiple of
`dropCount`, no single `staggerFlipped`-style toggle can correctly
compensate every column uniformly (different columns' group membership
shifts by different amounts) — this plan's recommendation is to leave
`staggerFlipped` uncompensated in that case (equivalent to accepting a
possible one-time visual restagger for that specific resize, no worse than
what this app's stagger-flip fix already improved on historically, and
fully undoable via the existing resize/crop undo mechanism). This should be
called out to the user once built, since it's a real (if narrow — most
resizes are small deltas, and `dropCount` is typically 2–3) correctness
compromise rather than a silent implementation detail.

**Soft `max="10"` on the Drops inputs** is an arbitrary sanity bound, not
load-bearing — worth confirming with the user once the feature is in hand,
not worth blocking on now.

## File-by-file summary

| File | Change |
|---|---|
| `src/grid/peyote.js` | `isRaised`, `peyoteCellOriginMm`, `peyoteCellAtPoint`, `peyoteCellAtPointClamped`, `peyoteCellAtPointUnbounded`, `peyoteNeighbors` all gain a trailing `dropCount = 1` param; new internal `dropGroup` helper; `peyoteNeighbors` restructured for same-group adjacency |
| `src/grid/gridEngine.js` | `peyoteEngine`'s wrappers thread `p.dropCount` through; new `stitchTypeDetailLabel` export |
| `src/export/wordChart.js` | `buildWordChart`/`splitByPosition` gain trailing `dropCount` param |
| `src/tools/mirrorTool.js` | New exported pure `canMirrorHorizontally(width, dropCount)`; header comment updated |
| `src/state/resizeGrid.js` | `compensatedStaggerFlipped` generalized for `dropCount` (see Known limitations) |
| `src/state/rotateGrid.js` | No change (dropCount passes through rotation untouched) |
| `src/state/appState.js` | New `dropCount: 1` field |
| `src/storage/migrateDesign.js` | New `migrateDropCount` step |
| `src/storage/designStore.js` | `createDesign`/`createConvertedDesign` gain `dropCount` param |
| `src/storage/preferencesStore.js` | New `defaultDropCount: 1` default |
| `src/storage/db.js` | `DB_VERSION` 8 → 9 |
| `src/ui/editorView.js` | `rebuildGridParams` stashes `dropCount`; `updateSelectionButtons` uses `canMirrorHorizontally`; new Drops field wiring (`updateDropCountVisibility`/`handleDropCountChange`) |
| `src/ui/newPatternDialog.js` | New file — the New Pattern dialog |
| `src/ui/printView.js` | `buildWordChart` call site passes `dropCount`; header uses `stitchTypeDetailLabel` |
| `src/ui/libraryView.js` | Per-row stitch-type label uses `stitchTypeDetailLabel` (via whatever callback currently supplies it) |
| `index.html` | New `#new-pattern-dialog` markup; `#settings-dialog` gains the Drops field |
| `main.js` | `handleCreate` rewritten around the new dialog; `handleBeadTypeConvertConfirmed`/`handleStitchTypeConvertConfirmed` pass `dropCount` through `createConvertedDesign` |

## Build order

1. `src/grid/peyote.js` — the geometric core, no dependents yet to break.
   Write its `node:test` coverage (including the neighbor-symmetry property
   sweep) before moving on, since every later step trusts this being right.
2. `src/grid/gridEngine.js` — thread `dropCount` through the peyote engine
   wrapper; add `stitchTypeDetailLabel`.
3. `src/export/wordChart.js` — thread `dropCount` through; extend tests.
4. `src/tools/mirrorTool.js` — extract `canMirrorHorizontally`; test it
   directly (pure, fast to verify against the derivation above).
5. `src/state/resizeGrid.js` — generalize `compensatedStaggerFlipped`; test
   both the clean-multiple and non-multiple cases explicitly (the latter
   should assert "no crash, no data loss, staggerFlipped unchanged" rather
   than a specific "corrected" value, since none exists).
6. `src/storage/migrateDesign.js`, `designStore.js`, `preferencesStore.js`,
   `db.js` — data-layer plumbing, all mechanical given steps 1–5.
7. `src/state/appState.js` — add the field.
8. `src/ui/editorView.js` — `rebuildGridParams`, `updateSelectionButtons`,
   the Drops field. This is where the feature becomes actually usable for
   existing designs.
9. `src/ui/newPatternDialog.js` + `index.html` + `main.js`'s `handleCreate`
   rewrite — the New Pattern dialog. Deliberately last among the
   editor-facing work, since it depends on `dropCount` already existing
   end-to-end (steps 1–8) to have anything meaningful to offer.
10. `src/ui/printView.js`, `src/ui/libraryView.js` — the two
    `stitchTypeDetailLabel` call sites, cosmetic/output-only, safe to do
    last.

## Verification

- `node --test 'src/test/**/*.js'` after every step, plus new cases:
  - `peyote.test.js`: `isRaised`/`peyoteCellOriginMm`/`peyoteCellAtPoint*`
    with `dropCount` 2 and 3, including negative-column and group-boundary
    cases; a dedicated **`peyoteNeighbors` symmetry sweep** across a real
    grid for several `(dropCount, flipped)` combinations, asserting "B is a
    neighbor of A iff A is a neighbor of B" and "two cells in the same drop
    group are always mutual same-row neighbors" — this is the highest-risk
    piece of math in the whole feature and needs to be proven, not
    eyeballed.
  - `gridEngine.test.js`: `dropCount` threading, `stitchTypeDetailLabel`'s
    1-drop-is-unlabeled / N-drop-appends-suffix / square-stitch-ignores-it
    cases.
  - `wordChart.test.js`: a `dropCount = 2` fixture confirming a run can span
    a drop-group boundary when colors match, and confirming two
    differently-colored beads *within* one group still produce two separate
    1-length runs (proves color independence within a group actually
    works end to end through the chart builder).
  - `mirrorTool.test.js`: `canMirrorHorizontally` against the derivation's
    table of `(width, dropCount)` cases, including the `dropCount = 1`
    regression cases already covered today.
  - `resizeGrid.test.js`: `compensatedStaggerFlipped` with a `dropCount`-
    multiple offset (compensates) and a non-multiple offset (does not
    crash, leaves `staggerFlipped` as documented).
  - `migrateDesign.test.js`: `migrateDropCount`'s absent/present/idempotent
    cases.
- Playwright pass (headless Chromium, local `python3 -m http.server`, per
  this project's established convention):
  - New Pattern dialog: Cancel creates nothing; Create with each stitch
    type/bead type/drop-count/rows/cols combination produces a design with
    exactly those fields; Drops field hides when Pattern Type is Square
    Stitch; a second "+ New" reopens the dialog pre-seeded with the
    previous creation's values (confirming the writeback to
    `defaultRows`/`defaultCols`/etc. round-trips correctly).
  - Draw a small asymmetric multi-color pattern at `dropCount = 1`,
    screenshot it, then set `dropCount = 2` via the Settings dialog and
    confirm (a) every originally-placed bead's color is still present at its
    original `(row, col)` — no data loss — and (b) the on-screen stagger
    genuinely regroups into 2-wide same-level clusters (pixel-sample two
    adjacent same-group cells and confirm they render at the same Y, unlike
    the pre-change screenshot). Then set it back to `dropCount = 1` and
    confirm the canvas is pixel-identical to the original screenshot
    (round-trip, no data lost or shifted).
  - Flood fill (color-replace or the fill tool) at `dropCount = 2` reaching
    across a same-group same-row pair that a `dropCount = 1` fill would
    have needed to go around diagonally — confirms the neighbor
    restructuring is live, not just unit-tested in isolation.
  - Mirror Horizontal: confirm it's enabled/disabled correctly for a
    selection whose width is a multiple of `dropCount` with an odd quotient,
    versus one that isn't, at `dropCount = 2`.
  - Print/export: a `dropCount = 2` design's header line reads "... (2-Drop)"
    and the printed run text is unchanged in shape from the `dropCount = 1`
    case (still plain run-length text, no new punctuation).
  - Library row label reflects the drop count for a peyote design and is
    silent about it for a square-stitch design.

## Open items to confirm once the plan is otherwise agreed

- Exact current wiring of `#library-new` (function/callback names) — audit
  directly at implementation time rather than guess further here.
- Whether the `max="10"` soft bound on Drops feels right in practice.
