# Feature Plan — Cloud Backup & Cross-Device Sync (Google Drive)

## Context

Raised directly by the user, prompted by a specific worry: a future app update (an IndexedDB migration in particular — this project has bumped `DB_VERSION` five times already) could have a bug that wipes or corrupts local data, and right now there is no copy of anything outside the one browser's IndexedDB on the one device. CLAUDE.md's Decision #5 already anticipated needing this ("real sync layered on later once the data model is stable") but left it fully unscoped. The data model has been stable since Phase 6 (colorways/shared-shape), so this plan is that follow-through.

A second, related want came up in the same conversation: syncing the same library across the user's iPad (primary daily-use device) and Mac (development/testing device), not just guarding against data loss on one device.

**This is a planning document only. No code has been written. Explicitly not scheduled against any session yet** — the user asked to have this scoped now so it's ready to pick up later, not to build it today.

## Why Google Drive, and why no backend

Confirmed with the user in conversation: sign in with their own Google account, write to their own Drive. This is achievable with **no server of ours at all** — Google Identity Services (GIS), a client-side auth library, can get an OAuth access token directly in the browser, which is then used to call the Drive REST API directly via `fetch()`. That fits this project's existing "no framework, no bundler, ship fast" posture (Decisions #1/#2) better than standing up any backend of our own would. The one real departure: GIS is loaded as an external `<script>` from Google's CDN — the project's first true third-party runtime dependency since the (since-removed) PDF.js import feature. Worth having eyes-open about that trade before starting.

## Scope — what actually syncs

Everything currently in IndexedDB except photo trace images (see below), read via the existing store modules (`designStore.js`, `preferencesStore.js`, `customColorStore.js`, `beadCatalogStore.js`) — no parallel storage layer, this plan only adds a way to push/pull what those already read and write:

- **Designs** — `shapeEntries`, `colorways`, `activeColorwayId`, `beadTypeKey`, `rows`/`cols`, `name`, `order`, `thumbnailDataUrl` (already a small PNG data-URL string, trivially JSON-embeddable).
- **Preferences** — the single global `preferences` row.
- **Custom colors** — the full `customColors` list, all bead types together (small).
- **Bead catalog** — the full `beadCatalog` list (small).

**Excluded from v1: photo trace images** (`photoTraces` store — a Blob per design, potentially several MB). Reasoning: it's the one piece of stored data the user didn't actually *create* in this app — it's a reference photo loaded from their own camera roll, which they still have. Backing it up buys comparatively little for real storage/upload cost on every design close. Flagged as a decision below, easy to revisit.

Explicitly **not** synced: anything in `appState` that's session-only and never persisted today either — `selection`, `clipboard`, `tool`, `viewport`, `pasteMode`, `pastePreview`, etc.

## Data shape on the Drive side

**One JSON file per design**, not one giant combined blob — plus a handful of small support files:

```
designs/{designId}.json     — one design's full record (as in the designs store)
library.json                — { designs: [{id, order}, ...], deletedDesigns: [{id, deletedAt}, ...] }
preferences.json
customColors.json
beadCatalog.json
```

Per-design files are the load-bearing choice: they're what Phase B's per-design conflict detection needs (see below), and they mean a bad upload/corruption can't take out the whole library in one file. `library.json`'s `deletedDesigns` list is a tombstone set — without it, deleting a design on one device wouldn't propagate; a second device would just re-upload or keep its own still-present copy of the "deleted" file on its next sync.

**Folder location — recommended: a visible "Bead Pattern Designer Backups" folder in My Drive**, not Drive's hidden `appDataFolder`. Given the whole point is the user's own peace of mind about not losing data, being able to literally open drive.google.com and see the files sitting there seems worth more than the slightly higher tamper-resistance a hidden app-data folder would give. Flagged as a decision below — cheap to flip either direction later, it's a config choice, not a data-model one.

## Auth

- Google Identity Services token client (`google.accounts.oauth2.initTokenClient`), requesting the **`drive.file`** scope — not the broader `drive` scope. `drive.file` only ever sees files this app itself created, so it structurally cannot read or touch anything else already in the user's Drive. Least-privilege, and sufficient for everything this plan needs.
- No refresh-token/backend plumbing — a short-lived access token is requested client-side, held in memory for the session, and re-requested (silently, when possible) as needed.
- **Caveat to plan around**: with the OAuth consent screen left in "Testing" mode (the right choice for a single personal user — never needs Google's app-review process), Google currently expires a test user's granted access after about 7 days, requiring a fresh sign-in. Acceptable for personal use, but the UI needs a clear "Reconnect Google Drive" state for when a call fails with a 401, rather than failing silently.
- Google's exact API/policy details (scope classifications, testing-mode token lifetimes) are worth re-verifying at implementation time rather than trusting this document — those are the kind of specifics that shift.

## Phase A — One-way backup (the buildable next increment)

The part that directly answers the user's original worry: a second, independent copy that a bad local migration can't touch.

- **Triggers**: on design close (the user's own stated preference — "every time a design is closed"), and — the one this plan adds on top, because it's the actual failure mode being guarded against — immediately before running any IndexedDB migration (i.e. whenever `db.js`'s `DB_VERSION` is about to change). Plus a manual "Back Up Now" button, for on-demand peace of mind.
- **Upload behavior**: simple overwrite, no diffing — these are small JSON payloads, so there's no real cost to just rewriting a design's file on every close rather than computing a delta.
- New `src/sync/googleDriveClient.js` — auth + raw Drive file read/write/list, no knowledge of this app's data shapes.
- New `src/sync/backupSync.js` — the shape-aware layer on top, assembling/disassembling the Drive file set from what the existing store modules already read/write.
- UI: a small status block in `#settings-dialog` (already exists, from the iPad UX pass) — Connect Google Drive / "Last backed up: …" / Back Up Now / Disconnect.
- **Phase A also includes restore**, not just backup — a "Restore from Google Drive" action (for a fresh install, a second device, or genuine data-loss recovery) that pulls every file down and writes it into IndexedDB via the same store modules' existing create functions. A backup nobody can pull back down isn't actually a safety net, so this isn't optional/deferred — it ships with Phase A.

## Phase A — risks and pre-implementation decisions

Reviewed specifically for "where could this lose data" before any code gets written. These change what Phase A needs to build, not just how it's discussed — folded in here so they're not lost to conversation.

### The core risk: an unconditional overwrite is not the same thing as a backup

Phase A as first scoped (push-on-close, always overwrite, no versioning) protects against *device loss* but not against a bad local migration corrupting data *before* anyone notices — the very next design-close backup would dutifully push the corrupted state to Drive too, overwriting the last good copy. That defeats the actual reason this plan exists. Fix: **the pre-migration backup must write a separate, retained checkpoint** (e.g. `pre-migration-backups/{timestamp}/...`), not just overwrite the live mirror — that one snapshot, taken at the one moment this app actually controls, is what makes the migration-safety guarantee real. Routine design-close backups can stay a simple live overwrite; only the pre-migration one needs retention.

### Must-resolve before building

- **The pre-migration backup must block the migration, not fire-and-forget.** If the upload is slow or fails and the migration proceeds anyway, the one trigger that matters most gives false confidence. The migration should wait for a confirmed-successful upload — or explicitly warn and let the user choose whether to proceed anyway — rather than assume success.
- **Restore is merge-by-id, never wipe-and-replace.** Restoring on a device that already has local designs must add what's missing, never silently delete or overwrite a local design the user didn't ask to touch. Show what will change before writing anything.
- **Phase A is single-device-safe, not multi-device-safe.** With no pull or conflict-check, backing up from a second device can silently overwrite a first device's newer Drive copy with older data. Until Phase B exists, treat Phase A as "one device's safety net, plus a one-time move to a new device" — not ongoing two-device use. A cheap guard is included anyway: before overwriting a design's Drive file, compare its remote `updatedAt` against what this device last wrote; a mismatch means something else touched it since, so warn instead of silently clobbering.
- **Restore must run every incoming record through `migrateDesign()`**, the same shape-migration path local records already get on load — this app's design shape has changed five times already (colorways, bead catalog, etc.), and an old Drive backup needs to survive that the same way an old local record does, or the backup won't actually load when it's needed.

### Secondary risks, still worth building around

- **iPad Safari backgrounding an in-flight upload.** The design-close trigger fires at exactly the moment someone might background the app. A network request is much less likely to survive that than the local IndexedDB writes the existing autosave debounce already handles via `visibilitychange`/`pagehide` flushing — a network call in flight can just get killed. Needs its own handling: track a "backup not yet confirmed" flag locally and retry on next app open, rather than assuming the close-trigger always completes.
- **Silent auth failures.** A token expiring (~7 days in testing mode) and a background backup failing quietly would leave the user believing they're protected when they're not. Needs a visible "last backup: X ago" indicator and a surfaced failure state, not a swallowed error.
- **Deletes need to propagate to Drive.** If deleting a design locally doesn't also remove/tombstone its Drive file, a later restore resurrects designs that were deleted on purpose.

### What Phase A still doesn't solve

Google Drive is a single point of failure tied to one Google account — lost or compromised account access takes the backup with it. This is why the fully independent, Google-free "export everything to a local JSON file" escape hatch (Decision #5's original idea — see "What this does not solve" below) is treated as **required for Phase A, not optional.** It's the same snapshot-assembly code either way, just written to a downloaded file instead of Drive.

## Phase B — real two-way sync (separate, larger, not required for the safety-net goal)

This is what actually answers "can I use it from both devices" rather than just "am I protected from data loss."

- **Pull-on-boot**: after connecting, also fetch `library.json` + changed design files on app start and reconcile against local.
- **Conflict detection, per design**: compare the design's own `updatedAt` (not Drive's file-modified-time — the app's own timestamp is the more precise signal) against a small locally-stored `lastSyncedUpdatedAt` marker.
  - Only local changed since last sync → push.
  - Only Drive changed → pull.
  - **Both changed → real conflict.** Recommended default: don't silently pick a winner — show a small dialog ("This design changed on another device too — keep this version / keep the other version / keep both") using the same native-`<dialog>`, `Promise`-returning-module convention already used throughout this codebase (`resizeDialog.js`, `convertBeadTypeDialog.js`, etc.). Last-write-wins is simpler to build but risks silently discarding real work — given the user's stated priority is not losing anything, this plan does not recommend it as the default.
- **Deletion propagation** via `library.json`'s tombstone list, from the data shape above.
- **Explicitly out of scope**: live/real-time sync while the app is open on two devices simultaneously. There's no server here to push a change to an already-open second device — sync is pull-on-boot and pull-on-demand only, symmetric with push-on-close.

## What this does not solve

- Doesn't protect against a bug in the sync code itself corrupting both copies identically — mitigated only by keeping the Drive-side format plain, boring JSON (human-readable/recoverable by hand), not a proprietary binary blob.
- Doesn't back up photo trace images (see Scope) unless revisited later.
- Isn't a replacement for also having a fully independent, Google-free "export everything to one JSON file on this computer" escape hatch (Decision #5's original plan) for the true doomsday case — losing access to the Google account entirely. **Required for Phase A, not optional** (see the Risks section above) — it's the exact same "assemble one JSON snapshot from every store" logic already needed for the Drive upload, just written to a downloaded file instead of Drive.

## Decisions this plan makes — flagging for pushback, not treating as final

1. **Visible Drive folder, not hidden `appDataFolder`.** Matches the backup-reassurance motivation directly — you can go look. Trade-off: also means it's something you (or anything with Drive access) could manually delete; a hidden appData store would be slightly more tamper-resistant but unverifiable at a glance.
2. **`drive.file` scope, not full `drive` scope.** Least privilege — this app structurally cannot see anything else in your Drive.
3. **One JSON file per design**, not one combined blob. Needed for Phase B's per-design conflict detection either way, so building it that way from Phase A's very first upload avoids a reshape later.
4. **Photo trace images excluded from sync for now.** Multi-MB, regeneratable from your own photo library, not app-authored data.
5. **Phase A ships restore, not backup alone.**
6. **The pre-migration backup is a distinct, retained checkpoint, not another overwrite of the live mirror.** Otherwise it can't actually guarantee recovery from a migration bug — see the Risks section.
7. **Restore is merge-by-id, never a silent wipe-and-replace.**
8. **Phase A is scoped as single-device-safe only** (backup/restore), with a lightweight remote-`updatedAt` check before overwrite as a guard rail, not a promise of real multi-device safety — that's Phase B's job.
9. **Restore runs incoming records through `migrateDesign()`**, same as any local record load.

## Suggested build order, when this gets picked up

1. Google Cloud project + OAuth client setup (one-time, manual, outside the codebase — worth doing together the first time given the consent-screen/scopes decisions above).
2. `googleDriveClient.js` — bare auth + file CRUD, sanity-checked against a scratch file before anything else depends on it.
3. `backupSync.js` — assemble/disassemble against the existing store modules.
4. Settings-dialog UI (connect/status/Back Up Now, a visible "last backup: X ago" + failure state) + the standalone local-JSON-export fallback (required, see Risks section).
5. Wire the two triggers: design-close (live-overwrite, with the remote-`updatedAt` guard, and its own "not yet confirmed, retry on next boot" tracking for the iPad-backgrounding case) and pre-migration (blocking, confirmed-success-required, writes a separate retained checkpoint rather than overwriting the live mirror).
6. Restore flow — merge-by-id, preview before writing, every incoming record run through `migrateDesign()`.
7. Only if still wanted after living with Phase A for a while: Phase B (pull-on-boot, conflict detection, tombstones, conflict dialog).

Nothing in Phase A touches existing app code paths beyond adding two trigger call-sites — it's new surface area alongside the current app, so there's no regression risk to the existing `node:test` suite until those two wiring points land.

## Open questions to resolve at implementation time, not now

- Whether Phase B is worth building at all versus living indefinitely with Phase A's restore-on-demand — this hinges on how often the user actually *edits* designs from the Mac versus just occasionally opening the app there. Worth revisiting once Phase A has been in real use for a while, since that usage pattern will be obvious by then rather than guessed at now.
- The Phase B conflict-dialog's exact wording/flow — sketched above, worth a real look once it's actually being built.
