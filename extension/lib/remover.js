/* Watch Later Cleaner — UI automation: auto-scroll and "⋮ → Remove from Watch later". */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});

  const MENU_ITEM_SELECTOR = [
    'ytd-menu-service-item-renderer',
    'ytd-menu-navigation-item-renderer',
    'yt-list-item-view-model',
    'tp-yt-paper-item',
  ].join(', ');

  const MENU_CONTAINER_SELECTOR = [
    'tp-yt-iron-dropdown',
    'ytd-menu-popup-renderer',
    'yt-sheet-view-model',
    'yt-contextual-sheet-layout',
    'tp-yt-paper-dialog',
  ].join(', ');

  // Exact English label first, then localized labels/verbs for "Remove from Watch later".
  const REMOVE_EXACT = [/remove from watch later/i, /remove from playlist/i];
  const REMOVE_WORDS = [
    /\bremove\b/i, // en
    /entfernen/i, // de
    /supprimer|retirer/i, // fr
    /quitar|eliminar/i, // es
    /rimuovi/i, // it
    /remover/i, // pt
    /verwijder/i, // nl
    /usuń/i, // pl
    /удалить|убрать/i, // ru
    /видалити/i, // uk
    /kaldır/i, // tr
    /hapus/i, // id
    /xóa/i, // vi
    /ta bort/i, // sv
    /fjern/i, // da/no
    /poista/i, // fi
    /odebrat|odstranit/i, // cs
    /eltávolítás/i, // hu
    /αφαίρεση|κατάργηση/i, // el
    /הסר/, // he
    /إزالة|حذف/, // ar
    /हटाएं|हटाएँ/, // hi
    /ลบ/, // th
    /削除/, // ja
    /삭제|제거/, // ko
    /移除|删除|刪除/, // zh
  ];
  // Path prefixes of trash-can icons YouTube has used for this menu entry.
  const TRASH_ICON_PATHS = ['M11 17H9V8h2v9zm4-9h-2v9h2V8z', 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4', 'M19 3h-4V2a1 1 0 00-1-1h-4'];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, { timeout = 3000, interval = 50 } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() >= end) return null;
      await sleep(interval);
    }
  }

  function isHidden(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden || n.getAttribute('aria-hidden') === 'true') return true;
      const st = n.style;
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return true;
    }
    return false;
  }

  /** Return the menu items of the currently open (visible) popup menu, or []. */
  function getOpenMenuItems(doc) {
    const d = doc || document;
    const containers = Array.from(d.querySelectorAll(MENU_CONTAINER_SELECTOR)).filter(
      (c) => !isHidden(c) && !c.closest(WLC.SELECTORS.item)
    );
    // The most recently opened popup is the last visible one in document order.
    for (let i = containers.length - 1; i >= 0; i--) {
      const items = Array.from(containers[i].querySelectorAll(MENU_ITEM_SELECTOR)).filter(
        (it) => !isHidden(it) && !(it.matches('tp-yt-paper-item') && it.parentElement && it.parentElement.closest(MENU_ITEM_SELECTOR))
      );
      if (items.length) return items;
    }
    return [];
  }

  function hasTrashIcon(item) {
    const icon = item.querySelector('yt-icon[icon], [icon]');
    if (icon && /delete|trash|remove/i.test(icon.getAttribute('icon') || '')) return true;
    return Array.from(item.querySelectorAll('path')).some((p) => {
      const d = (p.getAttribute('d') || '').replace(/\s+/g, ' ');
      return TRASH_ICON_PATHS.some((prefix) => d.startsWith(prefix));
    });
  }

  /**
   * Find the "Remove from Watch later" entry in a list of menu items.
   * Strategy: exact English text → localized remove verb → trash icon → configured position.
   * Returns { item, method } or null.
   */
  function findRemoveMenuItem(items, { fallbackPosition = 3 } = {}) {
    const text = (it) => WLC.cleanText(it.textContent);
    for (const re of REMOVE_EXACT) {
      const hit = items.find((it) => re.test(text(it)));
      if (hit) return { item: hit, method: 'text' };
    }
    for (const re of REMOVE_WORDS) {
      const hit = items.find((it) => re.test(text(it)));
      if (hit) return { item: hit, method: 'localized-text' };
    }
    const iconHit = items.find(hasTrashIcon);
    if (iconHit) return { item: iconHit, method: 'icon' };
    // Watch Later item menus have ~5-8 entries; only trust the positional fallback on a menu of that shape.
    if (fallbackPosition > 0 && items.length >= 4 && items.length <= 12 && items[fallbackPosition - 1]) {
      return { item: items[fallbackPosition - 1], method: 'position' };
    }
    return null;
  }

  function findMenuButton(itemEl) {
    return itemEl.querySelector(WLC.SELECTORS.menuButton);
  }

  function clickEl(el) {
    const target = el.querySelector('tp-yt-paper-item, button, a') || el;
    target.click();
  }

  function closeMenus(doc) {
    const d = doc || document;
    const ev = { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true };
    (d.activeElement || d.body).dispatchEvent(new (d.defaultView || root).KeyboardEvent('keydown', ev));
  }

  function isGone(el) {
    return !el.isConnected || el.hasAttribute('hidden') || (el.style && el.style.display === 'none');
  }

  /** Remove one playlist item via its menu. Resolves { ok, method?, error? }. */
  async function removeItem(itemEl, opts = {}) {
    const doc = opts.doc || itemEl.ownerDocument;
    const btn = findMenuButton(itemEl);
    if (!btn) return { ok: false, error: 'menu button not found' };
    if (itemEl.scrollIntoView) itemEl.scrollIntoView({ block: 'center' });
    btn.click();
    let found = null;
    await waitFor(
      () => {
        const items = getOpenMenuItems(doc);
        found = items.length ? findRemoveMenuItem(items, opts) : null;
        return found;
      },
      { timeout: opts.menuTimeout || 2500 }
    );
    if (!found) {
      closeMenus(doc);
      return { ok: false, error: 'remove menu item not found' };
    }
    clickEl(found.item);
    const gone = await waitFor(() => isGone(itemEl), { timeout: opts.removeTimeout || 4000 });
    if (!gone) {
      closeMenus(doc);
      return { ok: false, method: found.method, error: 'item still present after clicking remove' };
    }
    return { ok: true, method: found.method };
  }

  /** Scroll to the bottom repeatedly until no more items load. Calls onProgress(count). */
  async function loadAll(opts = {}) {
    const doc = opts.doc || document;
    const win = doc.defaultView || root;
    const shouldStop = opts.shouldStop || (() => false);
    const settleMs = opts.settleMs == null ? 1200 : opts.settleMs;
    const maxRounds = opts.maxRounds || 1000;
    let last = -1;
    let stable = 0;
    for (let round = 0; round < maxRounds && !shouldStop(); round++) {
      const items = WLC.getItems(doc);
      if (opts.onProgress) opts.onProgress(items.length);
      const cont = doc.querySelector(WLC.SELECTORS.continuation);
      if (items.length === last && !cont) {
        if (++stable >= 2) break;
      } else if (items.length === last) {
        if (++stable >= 6) break; // spinner stuck
      } else {
        stable = 0;
      }
      last = items.length;
      const tail = cont || items[items.length - 1];
      if (tail && tail.scrollIntoView) tail.scrollIntoView({ block: 'end' });
      if (win.scrollTo) win.scrollTo(0, doc.documentElement.scrollHeight);
      await sleep(settleMs);
    }
    return WLC.getItems(doc).length;
  }

  /** Locate the current element for a planned video (DOM may re-render while removing). */
  function resolveElement(video, doc) {
    if (video.el && video.el.isConnected) {
      const now = WLC.parseItem(video.el);
      if (!video.videoId || now.videoId === video.videoId) return video.el;
    }
    if (!video.videoId) return null;
    return WLC.getItems(doc).find((el) => WLC.parseItem(el).videoId === video.videoId) || null;
  }

  /**
   * Remove a planned list of videos one by one.
   * opts: { delayMs, shouldStop, onProgress({done,total,failed,current,result}), doc, fallbackPosition }
   */
  async function removeVideos(videos, opts = {}) {
    const doc = opts.doc || document;
    const shouldStop = opts.shouldStop || (() => false);
    const delayMs = opts.delayMs == null ? 400 : opts.delayMs;
    const stats = { done: 0, failed: 0, skipped: 0, total: videos.length, stopped: false, errors: [] };
    let consecutiveFailures = 0;
    for (const video of videos) {
      if (shouldStop()) {
        stats.stopped = true;
        break;
      }
      const el = resolveElement(video, doc);
      let result;
      if (!el) {
        stats.skipped++;
        result = { ok: false, error: 'item no longer on page' };
      } else {
        result = await removeItem(el, Object.assign({}, opts, { doc }));
        if (result.ok) {
          stats.done++;
          consecutiveFailures = 0;
        } else {
          stats.failed++;
          consecutiveFailures++;
          stats.errors.push(`${video.title || video.videoId}: ${result.error}`);
        }
      }
      if (opts.onProgress) opts.onProgress(Object.assign({ current: video, result }, stats));
      if (consecutiveFailures >= 3) {
        stats.aborted = true;
        stats.errors.push('Stopped after 3 consecutive failures (YouTube layout may have changed).');
        break;
      }
      await sleep(delayMs);
    }
    return stats;
  }

  Object.assign(WLC, {
    MENU_ITEM_SELECTOR,
    MENU_CONTAINER_SELECTOR,
    sleep,
    waitFor,
    isHidden,
    getOpenMenuItems,
    hasTrashIcon,
    findRemoveMenuItem,
    findMenuButton,
    removeItem,
    loadAll,
    resolveElement,
    removeVideos,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
