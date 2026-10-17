/*
 * Minimal simulation of YouTube's playlist item "⋮" menu, for tests only.
 * window.__wlcFakeMenuMode: 'en' (default) | 'de' | 'icon' (unknown language, trash icon) | 'position' (unknown language, no icon)
 */
(function (win) {
  'use strict';
  const doc = win.document;
  const TRASH = 'M11 17H9V8h2v9zm4-9h-2v9h2V8zm4-4v1h-1v16H6V5H5V4h4V3h6v1h4zm-2 1H7v15h10V5z';
  const LABELS = {
    en: ['Add to queue', 'Save to playlist', 'Remove from Watch later', 'Download', 'Share', 'Move to top', 'Move to bottom'],
    de: ['Zur Wiedergabeliste hinzufügen', 'In Playlist speichern', 'Aus „Später ansehen“ entfernen', 'Herunterladen', 'Teilen', 'Nach oben', 'Nach unten'],
    xx: ['Zzq alpha', 'Zzq beta', 'Zzq gamma', 'Zzq delta', 'Zzq epsilon', 'Zzq zeta', 'Zzq eta'],
  };
  const container = doc.querySelector('ytd-popup-container') || doc.body.appendChild(doc.createElement('ytd-popup-container'));
  const dropdown = doc.createElement('tp-yt-iron-dropdown');
  dropdown.style.display = 'none';
  dropdown.setAttribute('aria-hidden', 'true');
  container.appendChild(dropdown);
  let target = null;
  win.__wlcFakeMenuLog = [];

  function hide() {
    dropdown.style.display = 'none';
    dropdown.setAttribute('aria-hidden', 'true');
  }

  function open(item) {
    target = item;
    const mode = win.__wlcFakeMenuMode || 'en';
    const labels = LABELS[mode === 'en' || mode === 'de' ? mode : 'xx'];
    dropdown.innerHTML = '<ytd-menu-popup-renderer><tp-yt-paper-listbox id="items"></tp-yt-paper-listbox></ytd-menu-popup-renderer>';
    const list = dropdown.querySelector('#items');
    labels.forEach((label, i) => {
      const it = doc.createElement('ytd-menu-service-item-renderer');
      const icon = mode === 'position' ? '' : `<yt-icon><svg viewBox="0 0 24 24"><path d="${i === 2 ? TRASH : 'M0 0h24v24H0z'}"></path></svg></yt-icon>`;
      it.innerHTML = `<tp-yt-paper-item role="menuitem">${icon}<yt-formatted-string>${label}</yt-formatted-string></tp-yt-paper-item>`;
      it.addEventListener('click', () => {
        win.__wlcFakeMenuLog.push(label);
        hide();
        if (i === 2 && target) {
          const t = target;
          setTimeout(() => t.remove(), 60);
        }
      });
      list.appendChild(it);
    });
    // YouTube opens the popup asynchronously.
    setTimeout(() => {
      dropdown.style.display = '';
      dropdown.removeAttribute('aria-hidden');
    }, 30);
  }

  doc.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('ytd-playlist-video-renderer #menu button');
    if (btn) open(btn.closest('ytd-playlist-video-renderer'));
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
})(typeof window !== 'undefined' ? window : globalThis);
