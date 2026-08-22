// Small dismissible banner, two variants sharing one implementation:
//   - Reconnect banner: shown when this browser has connected to Google Drive
//     before but isn't connected right now (token expired, browser cleared
//     cookies, Safari ITP blocking silent session reuse, etc. — see main.js's
//     attemptPreMigrationDriveBackup). A real Google sign-in popup can only
//     ever be opened by a genuine user click — browsers block auto-triggered
//     popups — so this is the closest thing to "pop up a login screen
//     automatically": an automatic, visible *prompt* to click, not the OAuth
//     flow itself, which still needs that one tap.
//   - Axis-migration-review banner: shown when a design close would otherwise
//     silently push freshly row/col-axis-migrated data over the live Drive
//     backup before anyone's looked (see .work/refactor-row-col-axis-naming-
//     plan.md's Backup Safety section) — holds until an explicit manual Back
//     Up Now, which is what actually resolves it (backupDialog.js clears the
//     underlying flag there), not clicking this banner's own action button.
//
// Only one banner shows at a time (a second call while one is already
// showing is a no-op) — the two variants are never expected to be relevant
// simultaneously in practice, and stacking dismissible banners is its own UX
// problem not worth solving here.

let bannerEl = null;

function showBanner({ message, actionLabel, onActionClick, hideOnAction }) {
  if (bannerEl) return;
  bannerEl = document.createElement('div');
  bannerEl.id = 'drive-reconnect-banner';
  bannerEl.innerHTML = `
    <span>${message}</span>
    <button type="button" id="drive-reconnect-banner-connect">${actionLabel}</button>
    <button type="button" id="drive-reconnect-banner-dismiss" aria-label="Dismiss">&times;</button>
  `;
  document.body.append(bannerEl);
  bannerEl.querySelector('#drive-reconnect-banner-connect').addEventListener('click', async () => {
    await onActionClick();
    if (hideOnAction) hideReconnectBanner();
  });
  bannerEl.querySelector('#drive-reconnect-banner-dismiss').addEventListener('click', () => hideReconnectBanner());
}

export function showReconnectBanner(onConnectClick) {
  showBanner({
    message: 'Google Drive backup isn’t connected.',
    actionLabel: 'Reconnect',
    onActionClick: onConnectClick,
    hideOnAction: true, // a successful connect actually resolves this banner's reason for existing
  });
}

// onOpenBackupDialog just opens the Backup & Sync dialog — it doesn't itself
// back anything up, so the banner deliberately does NOT hide on this click;
// only a real Back Up Now (inside that dialog) resolves the underlying flag,
// and backupDialog.js hides this banner explicitly once that happens.
export function showAxisMigrationReviewBanner(onOpenBackupDialog) {
  showBanner({
    message: 'This update changed how patterns are stored — check that your patterns still look right, then back up manually when ready.',
    actionLabel: 'Open Backup & Sync',
    onActionClick: onOpenBackupDialog,
    hideOnAction: false,
  });
}

export function hideReconnectBanner() {
  bannerEl?.remove();
  bannerEl = null;
}
