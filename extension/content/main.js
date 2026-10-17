/* Watch Later Cleaner — content-script entry: mount the panel on the Watch Later page (YouTube is a SPA). */
(function (root) {
  'use strict';
  const WLC = root.WLC;
  if (!WLC || WLC.__mainLoaded) return;
  WLC.__mainLoaded = true;

  let panel = null;

  function sync() {
    if (WLC.isWatchLaterUrl(location.href)) {
      if (!panel) panel = WLC.createPanel(document);
    } else if (panel) {
      panel.destroy();
      panel = null;
    }
  }

  sync();
  document.addEventListener('yt-navigate-finish', sync);
  window.addEventListener('popstate', sync);

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('wlc:')) return false;
      sync();
      if (!panel) {
        sendResponse({ ok: false, onWatchLater: false });
        return false;
      }
      if (msg.type === 'wlc:show-panel') panel.show();
      if (msg.type === 'wlc:toggle-panel') panel.toggle();
      if (msg.type === 'wlc:reload-settings') panel.reloadSettings();
      if (msg.type === 'wlc:preview') {
        panel.show();
        panel.reloadSettings().then(() => panel.preview());
      }
      if (msg.type === 'wlc:stop') panel.stop();
      sendResponse({ ok: true, onWatchLater: true, open: panel.isOpen(), busy: panel.state.busy });
      return false;
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
