// App shell (Phase 4): opens the DB, loads preferences + the design list on boot,
// owns the single appState instance, switches between the library and editor
// views, and wires autosave. Grid/tool/canvas logic lives in src/ui/editorView.js;
// the design list lives in src/ui/libraryView.js — this file only coordinates them.

import { openDatabase, openExistingDatabase, CURRENT_DB_VERSION } from './src/storage/db.js';
import { listDesignsSorted, listDesignsSortedWithMigrationInfo, createDesign, saveDesign, deleteDesign, duplicateDesign, createConvertedDesign } from './src/storage/designStore.js';
import { getPreferences, savePreferences } from './src/storage/preferencesStore.js';
import { getPhotoTrace, savePhotoTrace, deletePhotoTrace } from './src/storage/photoTraceStore.js';
import { listCustomColorsSorted, createCustomColor, saveCustomColor, deleteCustomColor } from './src/storage/customColorStore.js';
import { listBeadCatalogSorted, createBeadType, saveBeadType, deleteBeadType, seedDefaultBeadCatalog } from './src/storage/beadCatalogStore.js';
import { generateId } from './src/storage/id.js';
import { debounce } from './src/storage/debounce.js';
import { createAppState } from './src/state/appState.js';
import { materializeColorwayCells, decomposeCellsForSave, pruneColorwaysToShape } from './src/state/colorwaySync.js';
import { remapColorwayColorIds } from './src/state/beadTypeConversion.js';
import { createHistory } from './src/state/historyStore.js';
import { mountEditorView } from './src/ui/editorView.js';
import { mountLibraryView } from './src/ui/libraryView.js';
import { mountBackupDialog, DRIVE_CONNECTED_BEFORE_KEY } from './src/ui/backupDialog.js';
import { showReconnectBanner, showAxisMigrationReviewBanner, hideReconnectBanner } from './src/ui/driveReconnectBanner.js';
import { getStoredDeviceName } from './src/sync/deviceName.js';
import { preloadIcons, mountIcons } from './src/ui/icons.js';
import { initLongPressTooltips } from './src/ui/longPressTooltip.js';
import { renderThumbnailDataUrl } from './src/render/thumbnailRenderer.js';
import { resolveSwatchHex } from './src/palette/colorLibrary.js';
import { findBeadType } from './src/palette/beadSpecs.js';
import { generatePeyoteGrid } from './src/grid/peyote.js';
import { createGoogleDriveClient } from './src/sync/googleDriveClient.js';
import { pushBackupToDriveTracked, recordDesignDeletedLocally, recordCustomColorDeletedLocally, recordBeadTypeDeletedLocally, runPreMigrationBackup } from './src/sync/backupSync.js';
import { getDriveSyncMeta, saveDriveSyncMeta } from './src/storage/driveSyncStore.js';

const AUTOSAVE_DEBOUNCE_MS = 800;
// Rendered once at a size that stays crisp scaled down into either the small list
// thumbnail box or the larger gallery tile via CSS, rather than re-rendering two sizes.
const THUMBNAIL_MAX_SIZE_PX = 200;
// Smaller than the library's own thumbnail — these render inside a compact picker
// row (see colorwayPickerDialog.js), not a full library tile.
const COLORWAY_PREVIEW_MAX_SIZE_PX = 96;

const appState = createAppState();

const libraryViewEl = document.getElementById('library-view');
const editorViewEl = document.getElementById('editor-view');

let libraryController = null;
let editorController = null;
let backupController = null;
const driveClient = createGoogleDriveClient();
let debouncedSave = null; // created per open design, discarded on unmount
// Separate from debouncedSave: targets photoTraceStore, not designStore, and
// changes (move/scale/opacity) happen far less often than cell edits — see
// db.js's comment on the photoTraces store for why it isn't embedded in a design.
let debouncedPhotoSave = null;

function showLibraryView() {
  appState.view = 'library';
  libraryViewEl.hidden = false;
  editorViewEl.hidden = true;
}

function showEditorView() {
  appState.view = 'editor';
  libraryViewEl.hidden = true;
  editorViewEl.hidden = false;
}

// Reads whatever's live in appState right now and writes it to the currently open
// design's record. Safe to call more than once for the same state (e.g. once
// directly, once from a debounce timer that was already pending) — always reflects
// current appState, so a redundant call just re-writes the same values. Folds the
// active colorway's on-screen cells back into appState.colorways before saving
// (same reconciliation switchColorway does when leaving a colorway) so shapeEntries/
// colorways persisted here always agree with what's actually drawn.
async function persistCurrentDesign() {
  if (!appState.currentDesignId) return;
  const existing = appState.designs.find((d) => d.id === appState.currentDesignId);
  if (!existing) return;

  const { shapeEntries, colorEntries } = decomposeCellsForSave(appState.cells);
  appState.colorways = pruneColorwaysToShape(appState.colorways, shapeEntries).map((cw) =>
    cw.id === appState.activeColorwayId ? { ...cw, colorEntries, updatedAt: Date.now() } : cw
  );

  // Regenerated from live state on every save (no separate dirty-tracking), so it's
  // always in sync with what's actually drawn. Falls back to whatever was already
  // stored if the editor hasn't derived gridParams yet (shouldn't happen while a
  // design is open, but keeps this function total rather than throwing).
  const thumbnailDataUrl = appState.gridParams
    ? renderThumbnailDataUrl(
        appState.gridParams,
        appState.cells,
        (colorId) => resolveSwatchHex(appState.customColors, colorId),
        THUMBNAIL_MAX_SIZE_PX,
        findBeadType(appState.beadCatalog, appState.beadTypeKey)?.cornerRadiusFraction ?? 0,
      )
    : existing.thumbnailDataUrl;

  const saved = await saveDesign(appState.db, {
    ...existing,
    beadTypeKey: appState.beadTypeKey,
    rows: appState.rows,
    cols: appState.cols,
    staggerFlipped: appState.staggerFlipped,
    shapeEntries,
    colorways: appState.colorways,
    activeColorwayId: appState.activeColorwayId,
    thumbnailDataUrl,
  });
  const idx = appState.designs.findIndex((d) => d.id === saved.id);
  if (idx !== -1) appState.designs[idx] = saved;
}

async function handlePreferencesChanged(patch) {
  appState.preferences = { ...appState.preferences, ...patch };
  await savePreferences(appState.db, appState.preferences);
}

async function handleViewModeChanged(mode) {
  appState.preferences = { ...appState.preferences, libraryViewMode: mode };
  await savePreferences(appState.db, appState.preferences);
}

// Custom colors (Phase 8) are scoped per bead type — each of these mutates
// appState.customColors in place (same pattern handlePreferencesChanged already
// uses for appState.preferences), and editorView.js re-renders after the
// returned promise resolves.
async function handleBeadTypeChanged(beadTypeKey) {
  appState.customColors = await listCustomColorsSorted(appState.db, beadTypeKey);
}

// Bead catalog CRUD (Part A of .work/feature-bead-catalog-and-conversion-plan.md)
// — each mutates appState.beadCatalog in place, same convention
// handlePreferencesChanged already uses for appState.preferences.
async function handleBeadTypeCreated(fields) {
  const created = await createBeadType(appState.db, fields);
  appState.beadCatalog.push(created);
  return created;
}

async function handleBeadTypeSaved(beadType) {
  const saved = await saveBeadType(appState.db, beadType);
  const idx = appState.beadCatalog.findIndex((b) => b.id === beadType.id);
  if (idx !== -1) appState.beadCatalog[idx] = saved;
  return saved;
}

async function handleBeadTypeDeleted(id) {
  await deleteBeadType(appState.db, id);
  await recordBeadTypeDeletedLocally(appState.db, id); // so a later Drive push removes it there too
  appState.beadCatalog = appState.beadCatalog.filter((b) => b.id !== id);
}

async function handleBeadTypeReordered(id, newOrder) {
  const beadType = appState.beadCatalog.find((b) => b.id === id);
  if (!beadType) return;
  const saved = await saveBeadType(appState.db, { ...beadType, order: newOrder });
  const idx = appState.beadCatalog.findIndex((b) => b.id === id);
  appState.beadCatalog[idx] = saved;
  appState.beadCatalog.sort((a, b) => a.order - b.order);
}

// Copies a color into another bead type's own independent palette (Part B) — a
// real create in the target's customColors list, never touching the source.
async function handleCustomColorCopiedToBeadType(id, targetBeadTypeKey) {
  const color = appState.customColors.find((c) => c.id === id);
  if (!color) return;
  await createCustomColor(appState.db, { beadTypeKey: targetBeadTypeKey, name: color.name, hex: color.hex });
}

// Builds what the Convert Bead Type mapping dialog needs (Part C): every color
// actually used across every one of this design's colorways (decomposing the
// active colorway from live appState.cells so an edit not yet through the
// autosave debounce still counts, same substitution colorUsage.js's
// findPatternsUsingColor already makes for the same reason), resolved to
// {id, name, hex}; and the target bead type's own existing palette, freshly read
// since it isn't the currently loaded one.
async function handleRequestBeadTypeConversionData(targetBeadTypeKey) {
  const { colorEntries } = decomposeCellsForSave(appState.cells);
  const usedColorIds = new Set();
  for (const cw of appState.colorways) {
    const entries = cw.id === appState.activeColorwayId ? colorEntries : cw.colorEntries;
    for (const [, colorId] of entries) usedColorIds.add(colorId);
  }
  const usedColors = [...usedColorIds]
    .map((id) => appState.customColors.find((c) => c.id === id))
    .filter(Boolean)
    .map(({ id, name, hex }) => ({ id, name, hex }));

  const targetColors = (await listCustomColorsSorted(appState.db, targetBeadTypeKey))
    .map(({ id, name, hex }) => ({ id, name, hex }));

  return { usedColors, targetColors };
}

// The actual conversion (Part C): resolves every mapping into a source-colorId ->
// target-colorId table (creating a new color for each 'copy' action first),
// clones the open design's current shape/colorways with colors remapped through
// that table into a brand-new design under the target bead type, and switches
// the editor into it — leaving the source design's own record untouched.
async function handleBeadTypeConvertConfirmed(targetBeadTypeKey, mappings) {
  const mappingTable = new Map();
  for (const mapping of mappings) {
    if (mapping.action === 'copy') {
      const created = await createCustomColor(appState.db, { beadTypeKey: targetBeadTypeKey, name: mapping.name, hex: mapping.hex });
      mappingTable.set(mapping.sourceColorId, created.id);
    } else {
      mappingTable.set(mapping.sourceColorId, mapping.targetColorId);
    }
  }

  const { shapeEntries, colorEntries } = decomposeCellsForSave(appState.cells);
  const sourceColorways = pruneColorwaysToShape(appState.colorways, shapeEntries).map((cw) =>
    cw.id === appState.activeColorwayId ? { ...cw, colorEntries, updatedAt: Date.now() } : cw
  );
  const idMap = new Map(sourceColorways.map((cw) => [cw.id, generateId()]));
  const newColorways = remapColorwayColorIds(sourceColorways, mappingTable).map((cw) => ({ ...cw, id: idMap.get(cw.id) }));
  const newActiveColorwayId = idMap.get(appState.activeColorwayId);

  const originalDesign = appState.designs.find((d) => d.id === appState.currentDesignId);

  // Flush the still-open original design's own record first, so it's exactly
  // what's on screen right now before we leave it — same as backToLibrary().
  await persistCurrentDesign();
  await persistPhotoTrace();
  debouncedSave?.flush();
  debouncedPhotoSave?.flush();

  const newDesign = await createConvertedDesign(appState.db, {
    name: originalDesign.name,
    beadTypeKey: targetBeadTypeKey,
    rows: appState.rows,
    cols: appState.cols,
    // Same shape as the source (only bead type/colors changed) — keep the
    // same stagger convention so the converted copy renders identically to
    // the design it came from, not the default for a "brand new" design.
    staggerFlipped: appState.staggerFlipped,
    shapeEntries,
    colorways: newColorways,
    activeColorwayId: newActiveColorwayId,
  });
  appState.designs.push(newDesign);
  appState.designs.sort((a, b) => a.order - b.order);

  editorController.unmount();
  editorController = null;
  debouncedSave = null;
  debouncedPhotoSave = null;
  appState.currentDesignId = null;

  await openDesign(newDesign);
}

async function handleCustomColorAdded({ name, hex }) {
  const created = await createCustomColor(appState.db, { beadTypeKey: appState.beadTypeKey, name, hex });
  appState.customColors.push(created);
}

async function handleCustomColorRenamed(id, name) {
  const color = appState.customColors.find((c) => c.id === id);
  if (!color) return;
  const saved = await saveCustomColor(appState.db, { ...color, name });
  const idx = appState.customColors.findIndex((c) => c.id === id);
  appState.customColors[idx] = saved;
}

async function handleCustomColorHexChanged(id, hex) {
  const color = appState.customColors.find((c) => c.id === id);
  if (!color) return;
  const saved = await saveCustomColor(appState.db, { ...color, hex });
  const idx = appState.customColors.findIndex((c) => c.id === id);
  appState.customColors[idx] = saved;
}

async function handleCustomColorDeleted(id) {
  await deleteCustomColor(appState.db, id);
  await recordCustomColorDeletedLocally(appState.db, id); // so a later Drive push removes it there too
  appState.customColors = appState.customColors.filter((c) => c.id !== id);
}

async function handleCustomColorReordered(id, newOrder) {
  const color = appState.customColors.find((c) => c.id === id);
  if (!color) return;
  const saved = await saveCustomColor(appState.db, { ...color, order: newOrder });
  const idx = appState.customColors.findIndex((c) => c.id === id);
  appState.customColors[idx] = saved;
  appState.customColors.sort((a, b) => a.order - b.order);
}

// Reads whatever's live in appState.photoTrace right now and writes it to
// photoTraceStore, keyed by the open design. No-ops if the design has no photo —
// Remove Photo goes through handlePhotoTraceRemoved (an immediate delete) instead
// of leaving a stale record here for this to silently skip.
async function persistPhotoTrace() {
  if (!appState.currentDesignId || !appState.photoTrace) return;
  const { blob, opacityPercent, xMm, yMm, widthMm, heightMm } = appState.photoTrace;
  await savePhotoTrace(appState.db, appState.currentDesignId, { blob, opacityPercent, xMm, yMm, widthMm, heightMm });
}

async function handlePhotoTraceRemoved() {
  if (!appState.currentDesignId) return;
  debouncedPhotoSave?.flush(); // drop any pending save racing with this delete
  await deletePhotoTrace(appState.db, appState.currentDesignId);
}

// Kicked off (not awaited) from openDesign so a multi-MB reference photo's decode
// never blocks the editor's first paint. Guards against the user having already
// left this design (or the app) by the time a slow decode resolves.
async function loadPhotoTraceForDesign(designId) {
  const record = await getPhotoTrace(appState.db, designId);
  if (!record) return;
  const image = await createImageBitmap(record.blob);
  if (!editorController || appState.currentDesignId !== designId) return;
  editorController.setPhotoTrace({
    image,
    blob: record.blob,
    opacityPercent: record.opacityPercent,
    xMm: record.xMm,
    yMm: record.yMm,
    widthMm: record.widthMm,
    heightMm: record.heightMm,
  });
}

// colorwayId defaults to the design's own stored default, but a caller can pass
// a specific one (the library's colorway badge/picker — see handleOpenColorway)
// to land directly on that colorway instead. Whichever one is opened becomes the
// active colorway going forward, same as switching colorways from inside the
// editor already does.
async function openDesign(design, colorwayId = design.activeColorwayId) {
  appState.currentDesignId = design.id;
  appState.beadTypeKey = design.beadTypeKey;
  appState.rows = design.rows;
  appState.cols = design.cols;
  appState.staggerFlipped = design.staggerFlipped ?? false;
  appState.colorways = design.colorways;
  appState.activeColorwayId = colorwayId;
  const activeColorway = design.colorways.find((cw) => cw.id === colorwayId);
  appState.cells = materializeColorwayCells(design.shapeEntries, activeColorway.colorEntries);
  appState.units = appState.preferences.units;
  // !== false rather than a straight read: an existing stored preferences row from
  // before this field existed has it as undefined, which should mean "on" (the
  // default), not "off".
  appState.showBeadOutlines = appState.preferences.showBeadOutlines !== false;
  appState.tool = 'draw';
  appState.gridParams = null;
  appState.history = createHistory();
  appState.selection = null; // coordinates from a previous design's grid don't apply here
  appState.pastePreview = null; // a previous design's preview coordinates don't apply here
  appState.photoTrace = null; // loaded async below, once the editor is already mounted
  // Small/fast rows, unlike a multi-MB photo blob — awaited before mount rather
  // than loaded async afterward like the photo trace below.
  appState.customColors = await listCustomColorsSorted(appState.db, design.beadTypeKey);

  showEditorView();

  debouncedSave = debounce(() => { persistCurrentDesign(); }, AUTOSAVE_DEBOUNCE_MS);
  debouncedPhotoSave = debounce(() => { persistPhotoTrace(); }, AUTOSAVE_DEBOUNCE_MS);

  editorController = mountEditorView(appState, {
    onCellsChanged: () => debouncedSave(),
    onImmediateSave: () => { persistCurrentDesign(); },
    onPreferencesChanged: handlePreferencesChanged,
    onPhotoTraceChanged: () => debouncedPhotoSave(),
    onPhotoTraceRemoved: () => { handlePhotoTraceRemoved(); },
    onBeadTypeChanged: handleBeadTypeChanged,
    onBeadTypeCreated: handleBeadTypeCreated,
    onBeadTypeSaved: handleBeadTypeSaved,
    onBeadTypeDeleted: handleBeadTypeDeleted,
    onBeadTypeReordered: handleBeadTypeReordered,
    onRequestBeadTypeConversionData: handleRequestBeadTypeConversionData,
    onBeadTypeConvertConfirmed: handleBeadTypeConvertConfirmed,
    onCustomColorAdded: handleCustomColorAdded,
    onCustomColorRenamed: handleCustomColorRenamed,
    onCustomColorHexChanged: handleCustomColorHexChanged,
    onCustomColorDeleted: handleCustomColorDeleted,
    onCustomColorReordered: handleCustomColorReordered,
    onCustomColorCopiedToBeadType: handleCustomColorCopiedToBeadType,
    onBack: backToLibrary,
  });

  loadPhotoTraceForDesign(design.id);
}

async function backToLibrary() {
  await persistCurrentDesign();
  await persistPhotoTrace();
  debouncedSave?.flush(); // cancel/settle any still-pending debounce before unmounting
  debouncedPhotoSave?.flush();
  editorController.unmount();
  editorController = null;
  debouncedSave = null;
  debouncedPhotoSave = null;
  appState.currentDesignId = null;

  showLibraryView();
  libraryController.renderList(appState.designs);
  pushBackupIfConnected();
}

// Shared by every place that wants to offer "reconnect with one tap" — the
// boot-time silent-reconnect failure and a skipped design-close backup both
// funnel here. A real Google sign-in popup can only open from a genuine user
// click (see driveReconnectBanner.js), so this is what that click runs.
async function reconnectDrive() {
  try {
    await driveClient.connect();
  } catch (err) {
    console.warn('Drive reconnect failed:', err);
  }
}

// Phase A's "on design close" backup trigger. Fire-and-forget on purpose —
// this is a background safety net, not something the user should have to
// wait on every time they leave a design; a failure (or the tab getting
// backgrounded mid-upload) is caught by pushBackupToDriveTracked's
// pendingBackup flag and retried on next boot (see retryPendingBackupIfAny).
// No-ops entirely (no banner, no warning) if this device has never named
// itself yet (see deviceName.js) — naming only happens through an explicit
// Back Up Now click, never silently mid-navigation, so a device that's never
// opted in has nothing to warn about. But if it HAS opted in before and just
// isn't connected right now (token expired mid-session, browser lost the
// Google session, etc.), that's a real missed backup worth surfacing — shows
// the same reconnect banner boot uses, rather than failing invisibly.
async function pushBackupIfConnected() {
  const deviceName = getStoredDeviceName();
  if (!deviceName) return;
  // Checked before the connection state — a pending axis-migration review
  // blocks the silent push regardless of whether Drive is reachable right now,
  // since the whole point is to stop freshly-migrated data from overwriting
  // the live backup before a human has looked (see .work/refactor-row-col-
  // axis-naming-plan.md's Backup Safety section). Resolved only by an
  // explicit manual Back Up Now in backupDialog.js, never automatically here.
  const meta = await getDriveSyncMeta(appState.db);
  if (meta.pendingAxisMigrationReview) {
    showAxisMigrationReviewBanner(async () => backupController.open());
    return;
  }
  if (!driveClient.isConnected()) {
    showReconnectBanner(reconnectDrive);
    return;
  }
  pushBackupToDriveTracked(appState.db, driveClient, deviceName).catch((err) => {
    console.warn('Drive backup failed:', err);
  });
}

async function handleOpen(id) {
  const design = appState.designs.find((d) => d.id === id);
  if (design) await openDesign(design);
}

async function handleOpenColorway(id, colorwayId) {
  const design = appState.designs.find((d) => d.id === id);
  if (design) await openDesign(design, colorwayId);
}

function resolveBeadTypeName(beadTypeKey) {
  return findBeadType(appState.beadCatalog, beadTypeKey)?.name ?? beadTypeKey;
}

// Renders a small preview thumbnail per colorway of a (closed) design, for the
// library's colorway picker (see colorwayPickerDialog.js) — libraryView.js has
// no business reading customColors/beadCatalog itself, so this is the one place
// that resolves the DB read + render on its behalf.
async function handleRequestColorwayPreviews(designId) {
  const design = appState.designs.find((d) => d.id === designId);
  if (!design) return [];
  const bead = findBeadType(appState.beadCatalog, design.beadTypeKey);
  const gridParams = generatePeyoteGrid({
    rows: design.rows,
    cols: design.cols,
    beadWidthMm: bead.widthMm,
    beadHeightMm: bead.heightMm,
  });
  gridParams.staggerFlipped = design.staggerFlipped ?? false;
  const customColors = await listCustomColorsSorted(appState.db, design.beadTypeKey);
  return design.colorways.map((cw) => ({
    id: cw.id,
    name: cw.name,
    thumbnailDataUrl: renderThumbnailDataUrl(
      gridParams,
      materializeColorwayCells(design.shapeEntries, cw.colorEntries),
      (colorId) => resolveSwatchHex(customColors, colorId),
      COLORWAY_PREVIEW_MAX_SIZE_PX,
      bead.cornerRadiusFraction ?? 0,
    ),
  }));
}

async function handleCreate() {
  const prefs = appState.preferences;
  const design = await createDesign(appState.db, {
    name: 'Untitled Pattern',
    beadTypeKey: prefs.defaultBeadTypeKey,
    rows: prefs.defaultRows,
    cols: prefs.defaultCols,
  });
  appState.designs.push(design);
  appState.designs.sort((a, b) => a.order - b.order);
  await openDesign(design);
}

async function handleRename(id) {
  const design = appState.designs.find((d) => d.id === id);
  if (!design) return;
  const newName = window.prompt('Rename pattern', design.name);
  if (!newName || !newName.trim()) return;
  const saved = await saveDesign(appState.db, { ...design, name: newName.trim() });
  const idx = appState.designs.findIndex((d) => d.id === id);
  appState.designs[idx] = saved;
  libraryController.renderList(appState.designs);
}

async function handleDuplicate(id) {
  const copy = await duplicateDesign(appState.db, id);
  appState.designs.push(copy);
  appState.designs.sort((a, b) => a.order - b.order);
  libraryController.renderList(appState.designs);
}

async function handleDelete(id) {
  await deleteDesign(appState.db, id);
  // Queued for Drive too (see backupSync.js) so a design deleted locally
  // doesn't get resurrected by a later restore — actual Drive file removal
  // happens on the next push, not here, to avoid a network call per delete.
  await recordDesignDeletedLocally(appState.db, id);
  appState.designs = appState.designs.filter((d) => d.id !== id);
  libraryController.renderList(appState.designs);
}

async function handleReorder(id, newOrder) {
  const design = appState.designs.find((d) => d.id === id);
  if (!design) return;
  const saved = await saveDesign(appState.db, { ...design, order: newOrder });
  const idx = appState.designs.findIndex((d) => d.id === id);
  appState.designs[idx] = saved;
  appState.designs.sort((a, b) => a.order - b.order);
  libraryController.renderList(appState.designs);
}

// iPad Safari can suspend or discard a backgrounded tab; relying purely on the
// debounce timer risks losing the last few edits if the user switches apps right
// after drawing.
function flushAutosave() {
  debouncedSave?.flush();
  debouncedPhotoSave?.flush();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushAutosave();
});
window.addEventListener('pagehide', flushAutosave);

// Best-effort retained Drive backup checkpoint right before a real schema
// migration runs (plan's Phase A risks — "the pre-migration backup must
// block the migration, not fire-and-forget"). Not a hard block: this app has
// no backend/refresh-token, and — confirmed directly, see
// googleDriveClient.js's SILENT_CONNECT_TIMEOUT_MS comment — a *silent*
// reconnect attempt that fails can leave Google's own client library unable
// to open an interactive popup for the rest of that page's life, which would
// be a far worse outcome than just warning here. So this never attempts to
// reconnect on its own at all (silently or otherwise — no UI is mounted yet
// to receive a user click this early in boot() anyway); it only warns, and
// only if this browser has connected to Drive before (a plain localStorage
// flag, checked before any IndexedDB access at all — set the moment a
// connect() succeeds, in backupDialog.js — so this works even before the DB
// can be opened at its current stored version to find out whether a
// migration is even pending).
async function attemptPreMigrationDriveBackup() {
  if (localStorage.getItem(DRIVE_CONNECTED_BEFORE_KEY) !== '1') return;
  const deviceName = getStoredDeviceName();
  if (!deviceName) return; // never explicitly backed up before — nothing to protect via Drive yet

  const { db: existingDb, wasBrandNew } = await openExistingDatabase();
  const migrationPending = !wasBrandNew && existingDb.version < CURRENT_DB_VERSION;
  existingDb.close();
  if (!migrationPending) return;

  window.alert(
    'A data update is about to run. This app can’t reach Google Drive to back up automatically at this point in loading — ' +
    'once the app has loaded, consider using Backup & Sync\'s "Export Backup File" as an extra local copy before continuing to use it.'
  );
}

// Shows the axis-migration-review banner immediately at boot if it's still
// pending — independent of Drive connection state or whether this device has
// ever backed up at all. The underlying concern ("go check your patterns
// still look right") applies to every user whose data just got migrated, not
// just ones with a Drive backup to protect — a device with no Drive
// relationship has nothing pushBackupIfConnected() would ever protect, so
// without this it would never see the notice at all. Drive-specific
// protection (holding the automatic design-close push) still lives in
// pushBackupIfConnected() and stays gated on deviceName there, since that
// part genuinely has nothing to do until a Drive push would otherwise happen.
async function showAxisMigrationReviewBannerIfNeeded() {
  const meta = await getDriveSyncMeta(appState.db);
  if (meta.pendingAxisMigrationReview) {
    showAxisMigrationReviewBanner(async () => backupController.open());
  }
}

// Shows the reconnect banner immediately if this device has backed up before
// but isn't connected right now — no silent reconnect attempt first (see
// attemptPreMigrationDriveBackup's comment on why: a failed silent attempt
// can break the interactive popup for the rest of the page's life, so the
// only Google call this app ever makes automatically is none at all — every
// connect is a direct response to a real click, starting with the banner's
// own "Reconnect" button).
function showReconnectBannerIfNeeded() {
  if (driveClient.isConnected()) return;
  if (localStorage.getItem(DRIVE_CONNECTED_BEFORE_KEY) !== '1') return;
  if (!getStoredDeviceName()) return;
  showReconnectBanner(reconnectDrive);
}

// If a previous design-close backup started but never confirmed complete
// (e.g. the tab was backgrounded mid-upload — see pushBackupToDriveTracked),
// retry it now. Only if already connected this session (see
// showReconnectBannerIfNeeded's comment — no silent reconnect attempt here
// either); otherwise the reconnect banner covers surfacing this instead.
async function retryPendingBackupIfAny() {
  const meta = await getDriveSyncMeta(appState.db);
  if (!meta.pendingBackup) return;
  const deviceName = getStoredDeviceName();
  if (!deviceName || !driveClient.isConnected()) return;
  pushBackupToDriveTracked(appState.db, driveClient, deviceName).catch((err) => {
    console.warn('Retry of pending Drive backup failed:', err);
  });
}

// Reloads the lists a Drive restore or local-file import can add to, and
// re-renders the library — passed as onDataRestored to backupDialog.js.
async function handleDataRestored() {
  appState.designs = await listDesignsSorted(appState.db);
  appState.beadCatalog = await listBeadCatalogSorted(appState.db);
  libraryController.renderList(appState.designs);
}

async function boot() {
  await preloadIcons();
  mountIcons(); // static [data-icon] markup (top bar, tool rail, dialogs) — JS-built rows call createIcon() directly
  initLongPressTooltips();

  await attemptPreMigrationDriveBackup();

  appState.db = await openDatabase();
  appState.preferences = await getPreferences(appState.db);
  const { designs, ranAxisMigration } = await listDesignsSortedWithMigrationInfo(appState.db);
  appState.designs = designs;
  if (ranAxisMigration) {
    const meta = await getDriveSyncMeta(appState.db);
    await saveDriveSyncMeta(appState.db, { ...meta, pendingAxisMigrationReview: true });
  }
  await seedDefaultBeadCatalog(appState.db);
  appState.beadCatalog = await listBeadCatalogSorted(appState.db);

  libraryController = mountLibraryView({
    onOpen: handleOpen,
    onCreate: handleCreate,
    onRename: handleRename,
    onDuplicate: handleDuplicate,
    onDelete: handleDelete,
    onReorder: handleReorder,
    onViewModeChanged: handleViewModeChanged,
    onOpenColorway: handleOpenColorway,
    onRequestColorwayPreviews: handleRequestColorwayPreviews,
    resolveBeadTypeName,
  });

  backupController = mountBackupDialog(appState, { driveClient, onDataRestored: handleDataRestored });
  document.getElementById('library-backup-open').addEventListener('click', () => backupController.open());

  libraryController.setViewMode(appState.preferences.libraryViewMode === 'gallery' ? 'gallery' : 'list');
  showLibraryView();
  libraryController.renderList(appState.designs);

  // Axis-migration review takes priority — driveReconnectBanner.js only ever
  // shows one banner at a time, so if this one shows, the reconnect banner
  // below correctly no-ops instead of replacing it.
  await showAxisMigrationReviewBannerIfNeeded();
  showReconnectBannerIfNeeded();
  retryPendingBackupIfAny();
}

boot();
