/*
 * Simulation of YouTube's Watch Later item "⋮" menu and list behaviour, for tests only.
 * Configure with window.__wlcFake = {
 *   mode: 'en' | 'de' | 'icon' | 'position'   menu language / icon variant (or legacy window.__wlcFakeMenuMode)
 *   menuDelay: ms before the popup opens (default 30)
 *   removeDelay: ms between clicking "Remove" and the row disappearing (default 60)
 *   recycle: true → like Polymer dom-repeat, rows are re-used: after a removal every following row node
 *            takes the next video's content and the LAST node is removed (the clicked node stays connected)
 *   toast: true → show a "Removed from Watch later" toast on each removal
 *   rowLagMs: if set, the toast appears immediately but the row only disappears after this many ms
 *   flaky: { videoId: n } → the menu fails to open for the first n clicks on that video
 *   throttle: { after: N, fail: K } → after N removals, the next K menu clicks do nothing
 *   noRemove: true → clicking "Remove" closes the menu but does nothing
 * }
 * Rows with a data-lazy attribute have no ⋮ button until scrollIntoView() is called on them.
 */
(function (win) {
  'use strict';
  const doc = win.document;
  const cfg = () => Object.assign({ mode: win.__wlcFakeMenuMode || 'en', menuDelay: 30, removeDelay: 60 }, win.__wlcFake || {});
  const TRASH = 'M11 17H9V8h2v9zm4-9h-2v9h2V8zm4-4v1h-1v16H6V5H5V4h4V3h6v1h4zm-2 1H7v15h10V5z';
  const LABELS = {
    en: ['Add to queue', 'Save to playlist', 'Remove from Watch later', 'Download', 'Share', 'Move to top', 'Move to bottom'],
    de: ['Zur Wiedergabeliste hinzufügen', 'In Playlist speichern', 'Aus „Später ansehen“ entfernen', 'Herunterladen', 'Teilen', 'Nach oben', 'Nach unten'],
    xx: ['Zzq alpha', 'Zzq beta', 'Zzq gamma', 'Zzq delta', 'Zzq epsilon', 'Zzq zeta', 'Zzq eta'],
  };
  const MENU_HTML =
    '<ytd-menu-renderer><yt-icon-button id="button"><button id="button" aria-label="Action menu"></button></yt-icon-button></ytd-menu-renderer>';
  const container = doc.querySelector('ytd-popup-container') || doc.body.appendChild(doc.createElement('ytd-popup-container'));
  const dropdown = doc.createElement('tp-yt-iron-dropdown');
  dropdown.style.display = 'none';
  dropdown.setAttribute('aria-hidden', 'true');
  container.appendChild(dropdown);
  const toast = doc.createElement('tp-yt-paper-toast');
  toast.style.display = 'none';
  doc.body.appendChild(toast);

  let target = null;
  let removals = 0;
  let throttled = 0;
  const clicks = {};
  win.__wlcFakeMenuLog = [];
  win.__wlcFakeRemoved = [];

  const videoIdOf = (row) => {
    const a = row && row.querySelector('a[href*="v="]');
    const m = a && a.getAttribute('href').match(/[?&]v=([\w-]+)/);
    return m ? m[1] : null;
  };

  function hide() {
    dropdown.style.display = 'none';
    dropdown.setAttribute('aria-hidden', 'true');
  }

  function showToast() {
    toast.innerHTML = '<span id="text">Removed from Watch later</span>';
    toast.style.display = '';
  }

  function removeRow(row) {
    if (!row.isConnected) return;
    win.__wlcFakeRemoved.push(videoIdOf(row));
    if (!cfg().recycle) {
      row.remove();
      return;
    }
    const rows = Array.from(doc.querySelectorAll('ytd-playlist-video-renderer'));
    const i = rows.indexOf(row);
    for (let j = i; j < rows.length - 1; j++) {
      rows[j].innerHTML = rows[j + 1].innerHTML;
      if (rows[j + 1].hasAttribute('data-lazy')) rows[j].setAttribute('data-lazy', '');
      else rows[j].removeAttribute('data-lazy');
    }
    rows[rows.length - 1].remove();
  }

  function open(row) {
    const c = cfg();
    const id = videoIdOf(row);
    clicks[id] = (clicks[id] || 0) + 1;
    if (c.flaky && clicks[id] <= (c.flaky[id] || 0)) return; // menu silently fails to open
    if (c.throttle && removals >= c.throttle.after && throttled < c.throttle.fail) {
      throttled++;
      return;
    }
    target = row;
    const labels = LABELS[c.mode === 'en' || c.mode === 'de' ? c.mode : 'xx'];
    dropdown.innerHTML = '<ytd-menu-popup-renderer><tp-yt-paper-listbox id="items"></tp-yt-paper-listbox></ytd-menu-popup-renderer>';
    const list = dropdown.querySelector('#items');
    labels.forEach((label, i) => {
      const it = doc.createElement('ytd-menu-service-item-renderer');
      const icon = c.mode === 'position' ? '' : `<yt-icon><svg viewBox="0 0 24 24"><path d="${i === 2 ? TRASH : 'M0 0h24v24H0z'}"></path></svg></yt-icon>`;
      it.innerHTML = `<tp-yt-paper-item role="menuitem">${icon}<yt-formatted-string>${label}</yt-formatted-string></tp-yt-paper-item>`;
      it.addEventListener('click', () => {
        win.__wlcFakeMenuLog.push(label);
        hide();
        if (i !== 2 || !target || cfg().noRemove) return;
        const t = target;
        const cc = cfg();
        removals++;
        if (cc.rowLagMs) {
          if (cc.toast) showToast();
          setTimeout(() => removeRow(t), cc.rowLagMs);
        } else {
          setTimeout(() => {
            removeRow(t);
            if (cc.toast) showToast();
          }, cc.removeDelay);
        }
      });
      list.appendChild(it);
    });
    setTimeout(() => {
      dropdown.style.display = '';
      dropdown.removeAttribute('aria-hidden');
    }, c.menuDelay);
  }

  // Lazy rows get their ⋮ button only once scrolled into view.
  const origScroll = win.Element.prototype.scrollIntoView;
  win.Element.prototype.scrollIntoView = function (...args) {
    if (this.matches && this.matches('ytd-playlist-video-renderer[data-lazy]')) {
      this.removeAttribute('data-lazy');
      if (!this.querySelector('#menu')) {
        const menu = doc.createElement('div');
        menu.id = 'menu';
        menu.innerHTML = MENU_HTML;
        this.appendChild(menu);
      }
    }
    if (origScroll) return origScroll.apply(this, args);
  };

  doc.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('ytd-playlist-video-renderer #menu button');
    if (btn) open(btn.closest('ytd-playlist-video-renderer'));
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
})(typeof window !== 'undefined' ? window : globalThis);
