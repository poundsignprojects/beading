**Status: implemented, 2026-08-12. See CLAUDE.md's Phase Status for the build/verification summary.**

# Fix: word chart doesn't split rows into real thread passes beyond the foundation

**Status: written up only, deferred — not implemented.** Found and diagnosed during the Loomerly import planning/build session (2026-08-11) when the user built matching tiny (4 wide × 10 tall, 2-color) test patterns in both this app and Loomerly and compared the printed word charts directly. Not blocking the Loomerly importer — see "Relationship to the Loomerly importer" below — logged here so it isn't lost, and the importer work resumed after this was written.

## The bug, in one sentence

`wordChart.js` prints physical row 0 combined with physical row 1 (doubling that line to 8 beads for a 4-wide design), and then prints every row after that as a single full-width line — but real single-drop peyote can only fully populate a row via **two** alternating-position thread passes once past the foundation, so every row after row 0 is currently missing a split it should have.

## Ground truth that exposed it

The user drew the same 4×10, 2-color pattern in this app and in Loomerly and compared printed word charts (see `.work/samples/` session transcript for the exact files — a `Pattern.pdf` from Loomerly and this app's own printout for the same design). Loomerly's picture chart labels exactly 10 physical bands (`1, 3, 5, ..., 19` — one label per finished row, matching `Height: 10`), each fully populated across all 4 column positions. That confirms this app's own row model — "one physical row can hold up to `rows` beads, no inherent gaps" (existing architecture note, `peyote.js`) — is correct and does **not** need to change; a physical row here already represents one full finished band, one-to-one with Loomerly's band count. The bug is entirely in how `wordChart.js` turns one already-correct full band into printed stitching instructions.

Loomerly's own word chart represents each band (after the foundation) as two lines:

```
Row 3 (→) (2)A
Row 4 (←) (2)B
```

This app currently produces the equivalent band as one line with all 4 beads:

```
Row N ←: 1A 1B 1A 1B
```

And row 0 (the foundation) currently gets interleaved with row 1 on top of that, producing 8 beads instead of 4 — a second, compounding error on the very first printed line.

## Why this isn't a storage/grid-model problem

First read on this (see conversation) wrongly concluded the whole grid coordinate system needed restructuring to track per-pass bead positions. That's wrong and was walked back once the ground truth was checked band-by-band: a design's `cells` Map, `peyoteCellOriginMm`, `canvasRenderer.js`, resize, colorways, drawing/erase tools — none of it needs to change. The stored/edited representation (one physical row = one full band) is already the right level of abstraction for *drawing*; the gap is purely in the *export* step, which currently doesn't know it needs to un-merge a band into its two constituent alternating passes when generating printable instructions. No design migration is needed for this fix — existing saved `cells` data is already exactly what's needed as input.

## The fix

In `src/export/wordChart.js`:

1. **Physical row 0**: print its own cells as one line (the foundation ladder), unchanged in spirit from today — but stop interleaving it with physical row 1. `interleaveCells(peyoteRowCells(rows, 0), peyoteRowCells(rows, 1))` should not exist; row 0 alone already *is* Loomerly's "Rows 1 & 2, strung together" collapsed onto this app's band model. The `interleaveCells` helper as currently written (interleaving two full-width rows together) has no correct use anywhere in this model and should be removed, not repurposed.
2. **Physical rows 1 through `cols - 1`**: split each row's cell list by position parity — even bead-index positions (0, 2, 4, ...) as one line, odd bead-index positions (1, 3, 5, ...) as the next — and print each as its own instruction. Verified against the ground truth sample: band 1's cells (`A,B,A,B`, positions 0–3) split into even positions `A,A` and odd positions `B,B`, exactly matching Loomerly's `Row 3 (2)A` / `Row 4 (2)B`.
3. Total printed line count becomes `1 + 2 * (cols - 1)` (was `cols - 1`). Confirmed against the ground truth sample: `1 + 2*9 = 19`, matching Loomerly's actual 19 printed lines for the same 10-band piece exactly.
4. Direction alternation (`isRowReversed`, the `printStartDirection` preference) is already keyed off `entryIndex` — the printed line's own sequential position — not a physical row number, so it should keep alternating correctly once the right number of entries are generated in the right order. Needs verification, not redesign.
5. `printView.js`'s row-label formatting (`formatRowLabel`) needs rework — there's no longer a clean 1:1 between "physical row" and "printed line," so labels can no longer be derived from a single `rowNumbers` field the way `combined`/non-combined rows work today. Loomerly's own convention (just sequentially numbering every printed line, `Row 3`, `Row 4`, `Row 5`, ...) is a reasonable model to follow, partly because it would also make cross-referencing against a Loomerly-originated pattern more natural.
6. New `wordChart.test.js` coverage needed for: row-0-alone (no over-interleaving), the even/odd split on an interior row, line-count formula, and a regression fixture built directly from this session's 4×10 ground-truth sample (expected output known exactly, not just structurally).

## Next step

Not scheduled into a session yet. When picked up: implement the fix above, rewrite `wordChart.test.js`'s fixtures (existing tests encode the old, wrong 1-line-per-band assumption), verify in headless Chromium against a freshly-printed real design.

(An earlier version of this doc noted a "mirror-image" relationship to a Loomerly PDF-import feature that combined half-passes the opposite direction — that importer was built, then removed after repeated correctness bugs on real shaped/tapered patterns proved the reverse-engineered format too fragile for what turned out to be a one-time migration need; see CLAUDE.md's Phase Status. No longer relevant to this fix, which stands on its own.)
