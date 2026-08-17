// "Backup & Sync" dialog (Phase A of .work/feature-cloud-sync-plan.md) —
// Google Drive connect/status/back-up-now/restore, plus the required Google-
// free local JSON export/import fallback (Decision #5). Self-contained like
// the project's other dialogs (resizeDialog.js, copyColorDialog.js): reads/
// writes only its own #backup-dialog markup. Reachable from the library
// header, independent of any open design, since restore is meant to work on
// a fresh install with nothing open yet.

import { pushBackupToDriveTracked, restoreFromDeviceBackup, listDeviceBackups } from '../sync/backupSync.js';
import { buildSnapshotFromDb, readAllStoreData, applyRestorePlan } from '../sync/dbSnapshot.js';
import { planRestore } from '../sync/snapshot.js';
import { downloadSnapshotFile, readSnapshotFile } from '../sync/localBackupFile.js';
import { getDriveSyncMeta } from '../storage/driveSyncStore.js';
import { getStoredDeviceName, setStoredDeviceName, ensureDeviceName } from '../sync/deviceName.js';
import { promptDeviceBackupPicker } from './deviceBackupPickerDialog.js';
import { hideReconnectBanner } from './driveReconnectBanner.js';

export const DRIVE_CONNECTED_BEFORE_KEY = 'bpd-drive-connected-before';

// appState only for its live `db` handle; hooks.onDataRestored is called
// after a successful Drive restore or local-file import so main.js can
// reload appState.designs/beadCatalog and re-render the library list.
export function mountBackupDialog(appState, { driveClient, onDataRestored }) {
  const dialog = document.getElementById('backup-dialog');
  const closeButton = document.getElementById('backup-close');
  const statusEl = document.getElementById('backup-drive-status');
  const deviceRowEl = document.getElementById('backup-device-row');
  const deviceNameEl = document.getElementById('backup-device-name');
  const deviceRenameButton = document.getElementById('backup-device-rename');
  const connectButton = document.getElementById('backup-drive-connect');
  const disconnectButton = document.getElementById('backup-drive-disconnect');
  const backupNowButton = document.getElementById('backup-drive-now');
  const restoreButton = document.getElementById('backup-drive-restore');
  const exportButton = document.getElementById('backup-local-export');
  const importInput = document.getElementById('backup-local-import-file');
  const importButton = document.getElementById('backup-local-import');
  const messageEl = document.getElementById('backup-message');

  function setMessage(text, isError = false) {
    messageEl.textContent = text;
    messageEl.classList.toggle('backup-message-error', isError);
    messageEl.hidden = !text;
  }

  function summarizePlan(plan) {
    const parts = [
      `${plan.designsToCreate.length} pattern(s)`,
      `${plan.customColorsToCreate.length} color(s)`,
      `${plan.beadCatalogToCreate.length} bead type(s)`,
    ];
    const skippedTotal = plan.designsSkipped.length + plan.customColorsSkipped.length + plan.beadCatalogSkipped.length;
    const skippedNote = skippedTotal > 0 ? ` ${skippedTotal} item(s) already existed on this device and were left untouched.` : '';
    return `Added ${parts.join(', ')}.${skippedNote}`;
  }

  function refreshDeviceRow() {
    const name = getStoredDeviceName();
    deviceRowEl.hidden = !name;
    deviceNameEl.textContent = name ?? '';
  }

  async function refreshStatus() {
    const meta = await getDriveSyncMeta(appState.db);
    const connected = driveClient.isConnected();
    connectButton.hidden = connected;
    disconnectButton.hidden = !connected;
    backupNowButton.disabled = !connected;
    restoreButton.disabled = !connected;
    if (connected) {
      const last = meta.lastBackupAt ? new Date(meta.lastBackupAt).toLocaleString() : 'never';
      const pendingNote = meta.pendingBackup ? ' (last backup did not confirm — will retry)' : '';
      statusEl.textContent = `Connected to Google Drive. Last backed up: ${last}.${pendingNote}`;
    } else {
      statusEl.textContent = 'Not connected to Google Drive.';
    }
    refreshDeviceRow();
  }

  async function open() {
    setMessage('');
    await refreshStatus();
    dialog.showModal();
  }

  closeButton.addEventListener('click', () => dialog.close());

  connectButton.addEventListener('click', async () => {
    setMessage('Connecting to Google Drive…');
    try {
      await driveClient.connect();
      localStorage.setItem(DRIVE_CONNECTED_BEFORE_KEY, '1');
      hideReconnectBanner(); // in case it was showing from a failed silent-reconnect attempt
      setMessage('Connected.');
    } catch (err) {
      setMessage(err.message, true);
    }
    await refreshStatus();
  });

  disconnectButton.addEventListener('click', async () => {
    driveClient.disconnect();
    setMessage('Disconnected from Google Drive.');
    await refreshStatus();
  });

  deviceRenameButton.addEventListener('click', () => {
    const current = getStoredDeviceName() ?? '';
    const name = window.prompt('Rename this device (used as its Drive backup folder name):', current);
    if (!name || !name.trim()) return;
    setStoredDeviceName(name.trim());
    refreshDeviceRow();
    setMessage(`This device now backs up as "${name.trim()}". Past backups under the old name are untouched — they’ll still show up as a separate entry in Restore From…`);
  });

  backupNowButton.addEventListener('click', async () => {
    const deviceName = ensureDeviceName();
    if (!deviceName) return; // user cancelled the name prompt
    refreshDeviceRow();
    setMessage('Backing up…');
    backupNowButton.disabled = true;
    try {
      const { designCount } = await pushBackupToDriveTracked(appState.db, driveClient, deviceName);
      setMessage(`Backed up ${designCount} pattern(s) as "${deviceName}".`);
    } catch (err) {
      setMessage(err.message, true);
    }
    await refreshStatus();
  });

  restoreButton.addEventListener('click', async () => {
    setMessage('Looking for backups on Google Drive…');
    restoreButton.disabled = true;
    let devices;
    try {
      devices = await listDeviceBackups(driveClient);
    } catch (err) {
      setMessage(err.message, true);
      await refreshStatus();
      return;
    }
    await refreshStatus();

    // Don't offer this device's own backup as a restore target — restoring
    // from yourself is a no-op at best, confusing at worst.
    const thisDeviceName = getStoredDeviceName();
    const otherDevices = devices.filter((d) => d.name !== thisDeviceName);

    if (otherDevices.length === 0) {
      setMessage(devices.length > 0
        ? 'No other devices have backed up to this Google Drive account yet — only this one.'
        : 'No backups found on Google Drive yet.');
      return;
    }

    const deviceFolderId = await promptDeviceBackupPicker({ devices: otherDevices });
    if (!deviceFolderId) {
      setMessage('');
      return;
    }

    if (!window.confirm('Restore from this device’s backup?\n\nThis only adds patterns, colors, and bead types that aren’t already on this device — nothing already here will be changed or removed.')) {
      setMessage('');
      return;
    }
    setMessage('Restoring…');
    try {
      const plan = await restoreFromDeviceBackup(appState.db, driveClient, deviceFolderId);
      setMessage(summarizePlan(plan));
      await onDataRestored();
    } catch (err) {
      setMessage(err.message, true);
    }
  });

  exportButton.addEventListener('click', async () => {
    setMessage('Preparing backup file…');
    try {
      const snapshot = await buildSnapshotFromDb(appState.db);
      downloadSnapshotFile(snapshot);
      setMessage('Backup file downloaded.');
    } catch (err) {
      setMessage(err.message, true);
    }
  });

  importButton.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = ''; // so re-selecting the same file still fires change
    if (!file) return;
    if (!window.confirm('Import this backup file?\n\nThis only adds patterns, colors, and bead types that aren’t already on this device — nothing already here will be changed or removed.')) return;
    setMessage('Importing…');
    try {
      const snapshot = await readSnapshotFile(file);
      const existing = await readAllStoreData(appState.db);
      const plan = planRestore(snapshot, existing);
      await applyRestorePlan(appState.db, plan);
      setMessage(summarizePlan(plan));
      await onDataRestored();
    } catch (err) {
      setMessage(err.message, true);
    }
  });

  return { open };
}
