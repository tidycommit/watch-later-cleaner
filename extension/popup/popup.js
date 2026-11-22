/* Watch Later Cleaner — popup: settings + shortcuts to the on-page panel. */
(function () {
  'use strict';
  const WL_URL = 'https://www.youtube.com/playlist?list=WL';
  const form = document.getElementById('settings');
  const statusEl = document.getElementById('page-status');
  const btnShow = document.getElementById('show-panel');
  const btnPreview = document.getElementById('preview');
  const btnAnalytics = document.getElementById('analytics');
  let activeTab = null;

  /** Same host rule as WLC.isWatchLaterUrl: any youtube.com host, not only www. */
  function isYouTubeHost(url) {
    try {
      return /(^|\.)youtube\.com$/.test(new URL(url).hostname);
    } catch (_) {
      return false;
    }
  }

  function isWatchLater(url) {
    return WLC.isWatchLaterUrl(url);
  }

  // Last full settings object. readForm overlays the popup fields on this so keys the popup
  // does not render (or that were removed from the DOM) are not reset to defaults.
  let loaded = WLC.normalizeSettings(null);
  let ready = false;

  function writeForm(s) {
    loaded = WLC.normalizeSettings(s);
    for (const el of form.elements) {
      if (!el.name || !(el.name in loaded)) continue;
      if (el.type === 'checkbox') el.checked = Boolean(loaded[el.name]);
      else el.value = loaded[el.name];
    }
  }
  function readForm() {
    const patch = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      patch[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    loaded = WLC.applyFormPatch(loaded, patch);
    return loaded;
  }

  async function send(type) {
    if (!activeTab) return null;
    try {
      return await chrome.tabs.sendMessage(activeTab.id, { type });
    } catch (_) {
      return null;
    }
  }

  async function init() {
    writeForm(await WLC.loadSettings());
    ready = true;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    if (activeTab && isWatchLater(activeTab.url)) {
      statusEl.textContent = 'Watch Later page detected.';
      btnShow.disabled = false;
      btnPreview.disabled = false;
      btnAnalytics.disabled = false;
    } else {
      statusEl.textContent = 'Open your Watch Later playlist to clean it up.';
    }
  }

  const savedEl = document.getElementById('saved');
  function showSaved(note) {
    savedEl.textContent = note || 'Settings are saved automatically.';
  }

  form.addEventListener('change', async () => {
    if (!ready) return;
    const saved = await WLC.saveSettings(readForm());
    showSaved(saved && saved.storageNote);
    send('wlc:reload-settings');
  });
  document.getElementById('open-wl').addEventListener('click', () => {
    if (activeTab && isYouTubeHost(activeTab.url || '')) chrome.tabs.update(activeTab.id, { url: WL_URL });
    else chrome.tabs.create({ url: WL_URL });
    window.close();
  });
  btnShow.addEventListener('click', async () => {
    const r = await send('wlc:show-panel');
    if (!r) statusEl.textContent = 'Could not reach the page — reload the tab and try again.';
    else window.close();
  });
  btnPreview.addEventListener('click', async () => {
    const saved = await WLC.saveSettings(readForm());
    showSaved(saved && saved.storageNote);
    await send('wlc:reload-settings');
    const r = await send('wlc:preview');
    if (!r) statusEl.textContent = 'Could not reach the page — reload the tab and try again.';
    else window.close();
  });

  btnAnalytics.addEventListener('click', async () => {
    const r = await send('wlc:show-analytics');
    if (!r) statusEl.textContent = 'Could not reach the page — reload the tab and try again.';
    else window.close();
  });

  init();
})();
