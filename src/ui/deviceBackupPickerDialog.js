// "Restore From…" device picker (Phase A's per-device backup layout — see
// backupSync.js) — structurally identical to copyColorDialog.js's
// promptCopyColorTarget: a small <dialog> listing each option as a button,
// self-contained, no hooks into main.js. Resolves with the chosen device's
// Drive folder id on pick, null on cancel/Esc.
export function promptDeviceBackupPicker({ devices }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('device-backup-picker-dialog');
    const listEl = document.getElementById('device-backup-picker-list');
    const cancelButton = document.getElementById('device-backup-picker-cancel');

    function cleanup() {
      cancelButton.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      listEl.replaceChildren();
    }
    function onCancel(e) {
      e?.preventDefault();
      cleanup();
      dialog.close();
      resolve(null);
    }
    function finish(deviceFolderId) {
      cleanup();
      dialog.close();
      resolve(deviceFolderId);
    }

    listEl.replaceChildren(
      ...devices.map((device) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'device-backup-picker-target';
        button.textContent = device.name;
        button.addEventListener('click', () => finish(device.id));
        return button;
      })
    );

    cancelButton.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);

    dialog.showModal();
  });
}
