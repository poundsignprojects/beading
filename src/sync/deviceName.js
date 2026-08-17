// Each device backing up to Drive gets its own name/folder (see backupSync.js
// — "devices/{deviceName}/..."), so backups from different devices never mix
// and Restore can show a per-device picker instead of pulling one shared
// pool. The name itself is plain localStorage, not IndexedDB/driveSyncStore —
// it's inherently local-only ("what is *this* device called"), never synced,
// and needs to be readable before any IndexedDB access at all (the pre-
// migration backup path runs before openDatabase()).

const DEVICE_NAME_KEY = 'bpd-drive-device-name';

export function getStoredDeviceName() {
  return localStorage.getItem(DEVICE_NAME_KEY);
}

export function setStoredDeviceName(name) {
  localStorage.setItem(DEVICE_NAME_KEY, name);
}

// Best-effort starting suggestion only — the user can type anything.
function suggestDefaultDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'This device';
}

// Returns the stored name, or prompts for one (once) if none is set yet.
// Returns null if the user cancels the prompt — callers should treat that as
// "can't back up right now" rather than falling back to a made-up name.
export function ensureDeviceName() {
  const existing = getStoredDeviceName();
  if (existing) return existing;
  const name = window.prompt(
    'Name this device for Google Drive backups (e.g. "Mac" or "iPad").\n\nEach device gets its own backup folder, so you can pick exactly which one to restore from later — backups from different devices are never mixed together.',
    suggestDefaultDeviceName()
  );
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  setStoredDeviceName(trimmed);
  return trimmed;
}
