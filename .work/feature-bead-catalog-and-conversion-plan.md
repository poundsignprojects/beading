# Feature Plan — Bead Catalog, Cross-Palette Color Copy, Convert Bead Type

## Context

This session started as a small ask ("make bead width/height adjustable") and grew, across several rounds of discussion, into a bigger reshaping of how bead types work:

1. **Bead catalog.** Instead of adjusting one field on a fixed Delica/Rocaille pair (the "Bead Size" dialog + `beadSpecOverrides` store built earlier this session — see CLAUDE.md's Phase Status), the user wants to define *any number* of custom bead types: name, width, height, and optionally corner-roundness/hole size/diameter. **This fully replaces the Bead Size dialog work — confirmed with the user, not layered on top.**
2. **Switching a design's bead type without losing the pattern.** Today, changing bead type on a design with beads placed clears everything (`regenerateGrid()`). The user wants to change bead type on an *existing* pattern and keep it.
3. Getting there required deciding what happens to colors, since (Phase 8) `customColors` are scoped per bead type — a Delica pattern's colors don't exist in Rocaille's palette. After discussion, the user chose to **keep palettes independent** (not merge into one global list) and instead:
   - add a way to **copy a color from one bead type's palette to another's**, and
   - make bead-type switching go through a **color-mapping step**, so each color actually in use gets assigned to (or copied into) a color in the target palette.
4. Doing the mapping *in place* would need to clear undo history (same as any other geometry-affecting action) with no way back if the user doesn't like the result. The user's own suggestion, which this plan adopts: **make it produce a new, separate design instead** — same pattern, new bead type, colors resolved per the mapping — leaving the original completely untouched. No undo-history question at all, since it's a brand-new design with its own fresh history.
5. Trigger point (user's choice): the existing bead-type `<select>` in the editor's top bar. Auto-naming (user's choice): like Duplicate, no prompt — `"{original name} ({target bead type name})"`.

## Part A — Bead catalog (replaces `beadSpecOverrides`)

### Data model

New `beadCatalog` IndexedDB store (keyPath `id`), one row per bead type:

```js
{
  id,                     // 'delica11'/'rocaille11' for the two seeded defaults
                           // (fixed, so existing designs' beadTypeKey still resolves);
                           // generateId() for anything the user creates
  name,
  widthMm, heightMm,       // drive grid geometry — same role as today's BEAD_TYPES
  cornerRadiusFraction,    // number or null — see "Dropping `shape`" below
  holeMm,                  // number or null — display/reference only, nothing reads it
  diameterMm,              // number or null — display/reference only, nothing reads it
  order, createdAt, updatedAt,
}
```

`src/palette/beadSpecs.js` is repurposed (kept as the same filename — fewer import churns — but its content changes completely): drops `BEAD_TYPES`/`DELICA_11_0`/`ROCAILLE_11_0`/`resolveBeadSpec`/`OVERRIDABLE_SPEC_FIELDS` (all from this session's now-superseded work), replaced with:

```js
export const DEFAULT_BEAD_CATALOG = [
  { id: 'delica11', name: 'Delica 11/0', widthMm: 1.6, heightMm: 1.3, cornerRadiusFraction: null, holeMm: 0.8, diameterMm: 1.6 },
  { id: 'rocaille11', name: 'Round Rocaille 11/0', widthMm: 2.0, heightMm: 1.4, cornerRadiusFraction: 0.25, holeMm: 0.8, diameterMm: 2.0 },
];

export function findBeadType(catalog, beadTypeKey) {
  return catalog.find((b) => b.id === beadTypeKey) ?? null;
}
```

These are the exact values the current hardcoded `BEAD_TYPES` already has — seeding with them means nothing visually changes for the existing design(s) on upgrade.

### Dropping `shape` (`'cylinder'` | `'round'`)

`cornerRadiusFraction: null` (Delica) vs. a number (Rocaille's `0.25`) already fully encodes what `shape` used to. `ctx.roundRect(x, y, w, h, 0)` draws identically to `ctx.rect(x, y, w, h)` — so `drawPeyoteGrid`/`renderThumbnailDataUrl` can **always** call `roundRect` with `radius = (cornerRadiusFraction ?? 0) * min(beadWidthPx, beadHeightPx)`, dropping the `if (beadShape === 'round') {...} else {...}` branch entirely. `beadShape` disappears as a parameter from both functions. (Worth double-checking no other renderer — `selectionOverlay.js`, `pastePreviewOverlay.js` — branches on it; a quick grep before starting confirms scope.)

### Storage — `src/storage/beadCatalogStore.js` (new, replaces `beadSpecStore.js`)

Mirrors `customColorStore.js`'s shape: `listBeadCatalogSorted`, `createBeadType`, `saveBeadType`, `deleteBeadType`, plus `seedDefaultBeadCatalog(db)` (no-ops if the store already has rows — called once from `boot()`, same idea as `migrateDesign` seeding a default colorway).

`db.js`: bump `DB_VERSION` to 5. Remove the `beadSpecOverrides` store (added this session, effectively unreleased — safe to drop outright rather than migrate). Add `beadCatalog`.

`appState.js`: replace `beadSpecOverrides: {}` with `beadCatalog: []` (full in-memory list, loaded once at boot after seeding, mutated in place — same role as `appState.designs`/`appState.customColors`).

### Deletion guard

New `src/palette/beadTypeUsage.js`: `findPatternsUsingBeadType(designs, beadTypeKey)` → design names referencing it. Simpler than `colorUsage.js`'s guard — `beadTypeKey` is a top-level design field that (per this plan) only ever changes via the new clone-based conversion flow, never live-edited in place, so no `liveState` substitution is needed. Wired into the catalog manager's delete action the same way `handleColorDelete` already blocks with `window.alert` + pattern names.

### UI — replaces the "Bead Size" button

Top bar: the `<select id="bead-type">` now populates its `<option>`s from `appState.beadCatalog` instead of two hardcoded ones. A new `#bead-catalog-manage-button` ("Manage Bead Types…") opens a `<dialog>` CRUD list — structurally like Manage Colors' rows (drag-reorder via pointer-capture-on-container, per-row inline number inputs for width/height/corner/hole/diameter, rename via the same prompt-based convention colors use, delete guarded by usage), plus an "+ Add Bead Type" row. `beadSizeDialog.js` is deleted.

## Part B — Copy a color to another bead type's palette

Each Manage Colors row gets a "Copy to…" action. With an arbitrary-length catalog (not just two), this needs a lightweight target picker rather than a single implicit "the other one." Simplest option consistent with this app's existing dialog conventions: a small `<dialog>` listing every *other* bead type as a button; clicking one calls `createCustomColor(db, { beadTypeKey: target, name, hex })` (same call the "copy over" choice in Part C's mapping dialog also uses) and closes. No changes to the source color or its palette.

## Part C — Convert Bead Type (clone-based)

### Trigger

The existing top-bar `<select id="bead-type">`, per the user's choice:

- **`appState.cells.size === 0`** (nothing drawn yet): switches directly, exactly like today's cheap path — no dialog, no clone, just `appState.beadTypeKey = ...; rebuildGridParams(); fitViewportToGrid(); redraw; save.`
- **Design has beads placed**: opens the conversion flow below instead of mutating the open design. If the user cancels at any point, the `<select>`'s displayed value reverts to the design's actual current bead type (nothing about the open design changes).

### Flow

1. `editorView.js` asks main.js (a new read-only hook, `onRequestBeadTypeConversionData(targetBeadTypeKey)`) for what it needs to build the dialog: the distinct colors *actually used* across every one of this design's colorways (decomposing the active colorway from live `appState.cells`, reusing the rest from `appState.colorways` — the same substitution `persistCurrentDesign()` already does), each resolved to `{id, name, hex}` via the source `appState.customColors`; and the target bead type's own color list (`listCustomColorsSorted(db, targetBeadTypeKey)`, a fresh read since it's not the currently-loaded palette).
2. If there are zero used colors, skip straight to step 4 with an empty mapping.
3. Otherwise, `src/ui/convertBeadTypeDialog.js` (new, same self-contained `Promise`-returning pattern as `resizeDialog.js`/`beadSizeDialog.js`) shows one row per used color: swatch + name, and a `<select>` of "an existing color in the target palette" + "Copy this color over (create new)", defaulted per color:
   - target palette has an exact hex match → default to mapping onto it,
   - otherwise → default to "Copy over."
   Resolves `{ mappings: [{sourceColorId, action: 'map', targetColorId} | {sourceColorId, action: 'copy'}] }` on confirm, `null` on cancel.
4. On confirm, a new hook `onBeadTypeConvertConfirmed(targetBeadTypeKey, mappings)` does the actual work in main.js:
   - For each `action: 'copy'` mapping, `createCustomColor(db, { beadTypeKey: target, name, hex })`, and record the resulting id.
   - Build the new design's `colorways`: same decomposition as step 1, with every `colorEntries` colorId run through the resolved mapping table (`null`/unassigned entries pass through unchanged — nothing to map).
   - `shapeEntries`/`rows`/`cols` copy over unchanged — the occupied-cell layout doesn't change, only bead type (rendering proportions) and per-cell colors.
   - New `designStore.js` export `createConvertedDesign(db, { name, beadTypeKey, rows, cols, shapeEntries, colorways, activeColorwayId })` — same shape as `createDesign`/`duplicateDesign` (fresh id, `order = maxOrder + 1`, `thumbnailDataUrl: null`), named `` `${originalName} (${targetBeadType.name})` `` per the user's confirmed auto-naming choice.
   - Flush/save the still-open original design first (so its IndexedDB record matches what's on screen before we leave it — same as `backToLibrary()` already does), push the new design into `appState.designs`, unmount the current editor, and open the new design for editing (reusing `openDesign()`) — leaving the original untouched in the library the whole time.
5. No history-clearing question anywhere in this flow — the new design starts with `createHistory()` fresh, same as any newly opened design.

### What this retires

CLAUDE.md's "Later / optional" backlog already has an open, unscheduled "Bead-type conversion" note flagging color remapping as an unresolved design question. This plan **is** that feature, fully specified — the note gets removed/marked done once this ships.

## Test coverage

- `src/test/palette/beadSpecs.test.js`: replace the now-superseded `resolveBeadSpec` tests with `findBeadType` cases (found/not-found).
- New `src/test/palette/beadTypeUsage.test.js`: mirrors `colorUsage.test.js`'s style — used/unused/multiple-designs cases.
- New `src/test/storage/...` — skipped for `beadCatalogStore.js`/`designStore.js`'s new export, same precedent as every other IndexedDB-touching store (no `node:test` coverage, verified in headless Chromium instead).
- Any pure color-mapping-table-building logic (step 4's remap) gets pulled into a small pure helper (e.g. `remapColorwayColorIds(colorways, mappingTable)`) specifically so it *can* get `node:test` coverage independent of the dialog/storage plumbing around it.

## Verification (headless Chromium, same approach as every prior phase)

1. Bead catalog: add a custom bead type, confirm it appears in the `<select>` and can be selected for a new/empty design; edit an existing entry's width/height and confirm a design using it re-renders at the new proportions; attempt to delete a bead type in use → blocked with pattern names, matching the color-deletion-guard precedent; delete one not in use → succeeds; drag-reorder persists.
2. Copy color to another palette: copy a color from Delica to Rocaille, confirm it appears as a new independent entry (new id) in Rocaille's Manage Colors list, and editing/deleting it doesn't affect the original Delica color.
3. Convert Bead Type: draw a small pattern with 2+ colors across 2 colorways on a Delica design; switch the bead-type `<select>` to Rocaille → mapping dialog appears listing the used colors with sensible defaults (exact-hex match vs. copy-over); confirm → a new design appears in the library named `"{name} (Round Rocaille 11/0)"`, editor switches into it, original Delica design is byte-for-byte untouched (re-open it separately to confirm); the new design's pattern silhouette matches exactly, colors resolved per the chosen mapping, both colorways' colors correctly remapped (not just the one that was active at conversion time); Undo is disabled (fresh history) in the new design. Cancelling the mapping dialog leaves the original design open and unchanged, `<select>` reverts to showing its real bead type. Converting a design with zero beads switches instantly with no dialog.
4. Full `node:test` suite, no regressions.

## Open, low-stakes implementation calls (flagging, not blocking)

- **"Copy to…" picker UI** — a small dialog listing every other bead type as a button (this plan's default) vs. a `<select>` inline in the Manage Colors row. Cheap to change later, doesn't touch data model.
- **Bead catalog manager row layout** — inline-editable number inputs (this plan's default, matches how Rows/Cols already work) vs. a separate "edit" sub-dialog per bead type. Also cheap to change later.
