// Small dismissible banner shown when this browser has connected to Google
// Drive before but a silent reconnect attempt on boot didn't succeed (token
// expired, browser cleared cookies, Safari ITP blocking silent session reuse,
// etc. — see main.js's attemptSilentReconnectOnBoot). A real Google sign-in
// popup can only ever be opened by a genuine user click — browsers block
// auto-triggered popups — so this is the closest thing to "pop up a login
// screen automatically": an automatic, visible *prompt* to click, not the
// OAuth flow itself, which still needs that one tap.

let bannerEl = null;

export function showReconnectBanner(onConnectClick) {
  if (bannerEl) return; // already showing, don't stack a second one
  bannerEl = document.createElement('div');
  bannerEl.id = 'drive-reconnect-banner';
  bannerEl.innerHTML = `
    <span>Google Drive backup isn’t connected.</span>
    <button type="button" id="drive-reconnect-banner-connect">Reconnect</button>
    <button type="button" id="drive-reconnect-banner-dismiss" aria-label="Dismiss">&times;</button>
  `;
  document.body.append(bannerEl);
  bannerEl.querySelector('#drive-reconnect-banner-connect').addEventListener('click', async () => {
    await onConnectClick();
    hideReconnectBanner();
  });
  bannerEl.querySelector('#drive-reconnect-banner-dismiss').addEventListener('click', () => hideReconnectBanner());
}

export function hideReconnectBanner() {
  bannerEl?.remove();
  bannerEl = null;
}
