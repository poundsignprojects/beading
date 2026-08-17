// The Google-free "export everything to a JSON file on this computer" escape
// hatch (Decision #5's original idea) — required for Phase A, not optional
// (see .work/feature-cloud-sync-plan.md's Risks section: Google Drive itself
// is a single point of failure tied to one Google account). DOM-dependent
// (Blob/File/URL/<a download>), so — same precedent as the rest of this
// project's storage-layer modules — no node:test coverage; verified in
// headless Chromium instead.

export function downloadSnapshotFile(snapshot, filename = defaultFilename()) {
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function defaultFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `bead-pattern-designer-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

// Rejects with a message safe to show the user directly (not a raw parse
// error) if the file isn't JSON or doesn't look like a snapshot this app made.
export function readSnapshotFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      let snapshot;
      try {
        snapshot = JSON.parse(reader.result);
      } catch {
        reject(new Error('That file is not valid JSON.'));
        return;
      }
      if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.designs)) {
        reject(new Error('That file does not look like a Bead Pattern Designer backup.'));
        return;
      }
      resolve(snapshot);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}
