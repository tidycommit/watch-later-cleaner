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

  function isWatchLater(url) {
    try {
      const u = new URL(url);
      return u.hostname === 'www.youtube.com' && u.pathname === '/playlist' && u.searchParams.get('list') === 'WL';
    } catch (_) {
      return false;
    }
  }

  function writeForm(s) {
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') el.checked = Boolean(s[el.name]);
      else el.value = s[el.name];
    }
  }
  function readForm() {
    const raw = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      raw[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return WLC.normalizeSettings(raw);
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

  form.addEventListener('change', async () => {
    await WLC.saveSettings(readForm());
    send('wlc:reload-settings');
  });
  document.getElementById('open-wl').addEventListener('click', () => {
    if (activeTab && /^https:\/\/www\.youtube\.com\//.test(activeTab.url || '')) chrome.tabs.update(activeTab.id, { url: WL_URL });
    else chrome.tabs.create({ url: WL_URL });
    window.close();
  });
  btnShow.addEventListener('click', async () => {
    const r = await send('wlc:show-panel');
    if (!r) statusEl.textContent = 'Could not reach the page — reload the tab and try again.';
    else window.close();
  });
  btnPreview.addEventListener('click', async () => {
    await WLC.saveSettings(readForm());
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
