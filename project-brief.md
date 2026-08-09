# Project Brief: Bead Pattern Designer

## What this is

I want a custom web app for designing seed bead patterns — specifically for peyote stitch, brick stitch, square stitch, and bead looming. This replaces a commercial iPad app called the prior app that I currently use but find frustrating in specific ways. This is not a clone or reverse-engineering of the prior app — it's a new tool built around my actual workflow, for my own personal, non-commercial use.

I'll primarily use this on an iPad with an Apple Pencil, in Safari (installed to the home screen so it opens full-screen like an app). Development happens on my Mac.

## Why I'm building this (the problems with my current tool)

1. **Preferences don't persist.** If I set my grid/tool preferences on one design, then open a different design, I have to set them all again. I want app-level preferences that apply globally, not per-file.
2. **No control over design ordering.** My saved designs display in whatever order the app decides. I want to manually reorder them myself.
3. **Colorways require full duplicates.** If I want the same pattern in different color combinations, I currently have to save entirely separate files for each. I want colorways (same grid, different color-to-cell mapping) to be lightweight variants of one pattern, not full copies.
4. **Easy to lose my place.** If I'm experimenting with a design and want to preserve where I was, I have to remember to manually duplicate the file first. I want autosave and no risk of losing state.
5. **Too many steps to close a design.** Simple things like closing what I'm working on take more taps than they should.

## What the app needs to do

### Grids & stitch types
- Peyote stitch grid (offset rows) — **build this first**
- Brick stitch grid (offset rows) — later
- Square stitch grid (true grid) — later
- Bead loom grid (true grid) — later
- The grid's cell proportions should be driven by the actual physical dimensions of the bead type/size selected — not just square cells — so the pattern's proportions are accurate.
- A finished-size readout (physical dimensions of the completed piece) based on bead count and bead size, with a toggle between millimeters and inches. Bead specs come from the manufacturer in mm; I'll want to think about the final piece size in inches. This conversion should be easy and reliable — not an afterthought.

### Bead types
I only need **Miyuki Delica** and **Miyuki Rocaille**, size 11/0 to start. (Not Toho, not Preciosa — no need to build those in yet.)

Bead specs I've sourced from Miyuki's own site:

| Type | Size | Diameter (mm) | Hole (mm) |
|---|---|---|---|
| Round Rocaille | 11/0 | 2.0 | 0.8 |
| Delica (DB) | 11/0 | 1.6 | 0.8 |

One gap: I don't yet have a verified separate height dimension for each bead (Miyuki's chart only lists one "diameter" figure), which matters for getting the offset-row grid proportions right. Some unverified secondary sources suggest Delica 11/0 is about 1.6mm × 1.3mm and Rocaille 11/0 is about 2.0mm × 1.3-1.5mm, but treat those as provisional — I may want to verify this myself (e.g., measuring actual beads) before we lock in the grid math. Please store these as easily-adjustable values, not hardcoded into the grid logic, since they may need correcting.

### Drawing tools (in priority order — build draw and erase first, the rest can come later)
- **Draw** — needs two modes: tapping to place a single bead, AND dragging (with finger or Apple Pencil) to draw a continuous line of beads. Both matter, not just one.
- **Erase**
- **Print/export instructions** — generate a printable pattern (PDF) and a row-by-row word chart, so I can print at home and follow it while beading.
- *(Lower priority, can come after the above work well:)* Fill (bucket fill of a contiguous region), color replace (swap one color for another across the whole design), cut, copy/paste, mirror (horizontal/vertical).
- **Photo trace overlay**: I want to be able to show a reference photo behind the grid, with adjustable transparency, so I can trace over it manually. I do **not** need automatic photo-to-pattern conversion (i.e. a wizard that generates a pattern from a photo) — that's out of scope, it's a much bigger feature than I need.

### Interaction
- Pinch-to-zoom (touch and/or Apple Pencil)
- Panning around a large pattern

### Preferences & settings
- App-level default preferences (grid type, zoom level, tool defaults, etc.) that apply across all designs, not reset per file.

### Project organization
- A library/gallery view of all my saved designs
- Manual drag-to-reorder — I choose the display order
- Colorways as lightweight variants of a single pattern (same grid, different palette applied) — not full duplicate files
- Autosave — no explicit "save" step required, and no need to remember to duplicate before experimenting
- Closing or switching between designs should take as few taps as possible
- A "duplicate as new design" option should still exist for true forks (as opposed to colorways)

### Storage
- Local storage on the iPad to start
- I'd like a real backup and/or cloud storage option — this matters to me, local-only storage tied to one browser instance isn't an acceptable end state. It doesn't need to be solved on day one, but the data model should be built with this in mind so it's not a painful retrofit.
- Cross-device sync (iPad + Mac) would be nice but is not required to start.

## What I'm explicitly NOT asking for right now
- Not a the prior app clone or reverse-engineered app — this is being built from scratch based on the requirements above.
- Not a native iOS app (yet) — starting as a web app. I may revisit native later using Xcode with Cursor/Cline, but that's a separate future decision, not part of this build.
- Not automatic photo-to-pattern conversion.
- Not Toho/Preciosa bead support (yet).
- Not brick/square/loom grids yet — peyote first.

## How I'd like to work together on this

- Please give me your honest, best-practice recommendation first, even if it's more work than the easy path. I'd rather hear the correct approach and then discuss tradeoffs, than get the path of least resistance by default.
- Explain your intent before producing large code changes, especially early on, so I can weigh in before you build.
- I use zsh for shell commands.
- No unnecessary compliments or hedging — I'd rather have direct, substantive answers.
- See CLAUDE.md in this repo for the full technical architecture, phased build plan, and decisions already made — that file should be treated as the persistent source of truth across our sessions, and updated as we go.