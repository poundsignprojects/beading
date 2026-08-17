// Auth (Google Identity Services) + raw Drive REST v3 file CRUD. No knowledge
// of this app's data shapes — backupSync.js is the shape-aware layer on top.
// Loaded as a real browser dependency (GIS's own <script>, from Google's CDN)
// since there's no server here to hold a refresh token — see
// .work/feature-cloud-sync-plan.md's "Why Google Drive, and why no backend".

import { GOOGLE_CLIENT_ID, GOOGLE_DRIVE_SCOPE } from './googleAuthConfig.js';

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Thrown when a Drive call fails because the access token is missing/expired
// — the UI should show a "Reconnect Google Drive" state for this
// specifically, not a generic error.
export class DriveAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

let gisScriptPromise = null;
function loadGisScript() {
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services script.')));
      if (window.google?.accounts?.oauth2) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script.'));
    document.head.appendChild(script);
  });
  return gisScriptPromise;
}

// One instance is enough for this app (single global connect/disconnect
// state, matching there being exactly one settings surface for it).
export function createGoogleDriveClient() {
  let accessToken = null; // held in memory only for this session, never persisted
  let tokenExpiresAt = 0;

  // A fresh client per call, deliberately not cached/reused — confirmed
  // directly that reusing one client instance across calls can wedge it: a
  // silent (prompt: '') request that never truly completes (the same COOP-
  // blocked `popup.closed` issue trySilentConnect's timeout works around)
  // leaves the client "busy" from Google's own library's perspective, and a
  // later interactive request on that same client instance silently did
  // nothing at all — no popup, no callback, no error. initTokenClient() only
  // registers local config (no network call), so creating a new one per
  // request is cheap and sidesteps this entirely.
  async function createFreshTokenClient() {
    await loadGisScript();
    if (GOOGLE_CLIENT_ID.startsWith('REPLACE_WITH_')) {
      throw new Error('Google Drive isn’t configured yet — GOOGLE_CLIENT_ID in src/sync/googleAuthConfig.js still needs a real OAuth Client ID.');
    }
    return window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: () => {}, // overridden per-call below via a fresh Promise
    });
  }

  function requestToken({ interactive }) {
    return new Promise((resolve, reject) => {
      createFreshTokenClient().then((client) => {
        client.callback = (response) => {
          if (response.error) {
            reject(new DriveAuthError(response.error_description || response.error));
            return;
          }
          accessToken = response.access_token;
          // expires_in is seconds; back off by 60s so a call doesn't start an
          // upload just as the token expires mid-request.
          tokenExpiresAt = Date.now() + (response.expires_in - 60) * 1000;
          resolve(accessToken);
        };
        client.error_callback = (err) => reject(new DriveAuthError(err?.message || 'Google sign-in was cancelled or failed.'));
        client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      }, reject);
    });
  }

  // Called directly from a user click (Connect button) so the consent popup
  // isn't blocked by the browser's popup blocker.
  async function connect() {
    return requestToken({ interactive: true });
  }

  function disconnect() {
    if (accessToken && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    tokenExpiresAt = 0;
  }

  function isConnected() {
    return Boolean(accessToken) && Date.now() < tokenExpiresAt;
  }

  // No silent-refresh fallback here (see the comment above requestToken's
  // former trySilentConnect sibling, now removed entirely): confirmed
  // directly that a silent (prompt: '') request which fails can leave
  // Google's own client library unable to open an interactive popup for the
  // rest of the page's life. So every reconnect this app ever makes, at any
  // layer, is a direct response to a real user click — never automatic.
  async function getValidToken() {
    if (isConnected()) return accessToken;
    throw new DriveAuthError('Not connected to Google Drive — reconnect to continue.');
  }

  async function driveFetch(path, { method = 'GET', headers = {}, body, isUpload = false } = {}) {
    const token = await getValidToken();
    const base = isUpload ? DRIVE_UPLOAD_API : DRIVE_API;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body,
    });
    if (res.status === 401) {
      // The token looked valid locally (isConnected() was true) but Google
      // rejected it server-side anyway — consent revoked, the testing-mode
      // expiry, etc. Clear it and surface a clear reconnect error rather than
      // attempting a silent refresh (see getValidToken's comment above).
      accessToken = null;
      throw new DriveAuthError('Google Drive rejected the request — reconnect to continue, then try again.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Drive request failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    return res;
  }

  // Finds a folder by name under `parentId` (null = root of what this app can
  // see, i.e. My Drive under drive.file scope), creating it if absent.
  async function ensureFolder(name, parentId = null) {
    const existing = await findByName(name, parentId, FOLDER_MIME);
    if (existing) return existing.id;
    const metadata = { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) };
    const res = await driveFetch('/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
    const created = await res.json();
    return created.id;
  }

  // mimeType null matches any (used for finding a JSON file by name).
  async function findByName(name, parentId, mimeType = null) {
    const clauses = [`name='${escapeQueryValue(name)}'`, 'trashed=false'];
    if (parentId) clauses.push(`'${parentId}' in parents`);
    if (mimeType) clauses.push(`mimeType='${mimeType}'`);
    const q = encodeURIComponent(clauses.join(' and '));
    const res = await driveFetch(`/files?q=${q}&fields=files(id,name,modifiedTime)&spaces=drive`);
    const { files } = await res.json();
    return files?.[0] ?? null;
  }

  async function listFiles(parentId) {
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`);
    const res = await driveFetch(`/files?q=${q}&fields=files(id,name,modifiedTime)&spaces=drive&pageSize=1000`);
    const { files } = await res.json();
    return files ?? [];
  }

  // Just the subfolders directly under parentId — used for backupSync.js's
  // per-device "devices/" folder listing (one subfolder per device that's
  // ever backed up here), so Restore can offer a picker instead of guessing.
  async function listFolders(parentId) {
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false and mimeType='${FOLDER_MIME}'`);
    const res = await driveFetch(`/files?q=${q}&fields=files(id,name,modifiedTime)&spaces=drive&pageSize=1000`);
    const { files } = await res.json();
    return files ?? [];
  }

  // Creates or updates (if a file with this name already exists in the
  // folder) a JSON file. Returns {id, modifiedTime}.
  async function uploadJson(name, parentId, data) {
    const existing = await findByName(name, parentId);
    const metadata = existing ? { name } : { name, parents: [parentId] };
    const boundary = `bpd-${Math.random().toString(36).slice(2)}`;
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n` +
      `--${boundary}--`;

    const path = existing
      ? `/files/${existing.id}?uploadType=multipart&fields=id,modifiedTime`
      : '/files?uploadType=multipart&fields=id,modifiedTime';
    const res = await driveFetch(path, {
      method: existing ? 'PATCH' : 'POST',
      isUpload: true,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return res.json();
  }

  async function downloadJson(fileId) {
    const res = await driveFetch(`/files/${fileId}?alt=media`);
    return res.json();
  }

  async function deleteFile(fileId) {
    await driveFetch(`/files/${fileId}`, { method: 'DELETE' });
  }

  return {
    connect,
    disconnect,
    isConnected,
    ensureFolder,
    findByName,
    listFiles,
    listFolders,
    uploadJson,
    downloadJson,
    deleteFile,
  };
}

function escapeQueryValue(value) {
  return value.replace(/'/g, "\\'");
}
