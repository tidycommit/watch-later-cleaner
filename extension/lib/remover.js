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

  function pressEscape(doc) {
    const d = doc || document;
    const ev = { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true };
    (d.activeElement || d.body).dispatchEvent(new (d.defaultView || root).KeyboardEvent('keydown', ev));
  }

  /** Make sure no ⋮ popup is open (a closing/stale popup would otherwise be clicked for the next video). */
  async function ensureMenuClosed(doc, timeout = 1500) {
    if (!getOpenMenuItems(doc).length) return true;
    pressEscape(doc);
    return Boolean(await waitFor(() => getOpenMenuItems(doc).length === 0, { timeout }));
  }

  function isGone(el) {
    return !el.isConnected || el.hasAttribute('hidden') || (el.style && el.style.display === 'none');
  }

  /**
   * Find the playlist renderer that CURRENTLY shows a given videoId. YouTube re-uses
   * ytd-playlist-video-renderer nodes after removals (a node can switch to showing the next video),
   * so element references are never trusted — videos are always located by id right before acting.
   */
  function findItemByVideoId(doc, videoId) {
    if (!videoId) return null;
    const links = (doc || document).querySelectorAll(`${WLC.SELECTORS.item} a[href*="v=${videoId}"]`);
    for (const a of links) {
      if (WLC.getVideoId(a.getAttribute('href')) === videoId) {
        const item = a.closest(WLC.SELECTORS.item);
        if (item && !isGone(item)) return item;
      }
    }
    return null;
  }

  function locate(video, doc) {
    if (video.videoId) return findItemByVideoId(doc, video.videoId);
    return video.el && !isGone(video.el) ? video.el : null; // no id (rare): fall back to the node from preview
  }

  function isPresent(video, el, doc) {
    return video.videoId ? Boolean(findItemByVideoId(doc, video.videoId)) : !isGone(el);
  }

  const TOAST_SELECTOR = 'tp-yt-paper-toast, yt-notification-action-renderer, ytd-notification-action-renderer';
  const TOAST_ERROR = /went wrong|error|try again|failed|couldn.t|unable|could not/i;

  /**
   * Watch YouTube's toast ("Removed from Watch later") as a second success signal.
   * Only a toast that NEWLY appears (hidden → visible) or whose text changes / gets new nodes after this
   * call counts — a toast still showing from the previous removal is ignored.
   */
  function watchToasts(doc) {
    const d = doc || document;
    const seen = { success: false, error: false, text: '' };
    const before = new Map();
    d.querySelectorAll(TOAST_SELECTOR).forEach((t) => before.set(t, { visible: !WLC.isHidden(t), text: WLC.cleanText(t.textContent) }));
    const check = (m) => {
      const node = m.target;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      const toast = el && el.closest && el.closest(TOAST_SELECTOR);
      if (!toast || WLC.isHidden(toast)) return;
      const text = WLC.cleanText(toast.textContent);
      if (!text) return;
      const prev = before.get(toast);
      const isNew = !prev || !prev.visible || prev.text !== text || (m.type === 'childList' && m.addedNodes.length > 0);
      if (!isNew) return;
      seen.text = text;
      if (TOAST_ERROR.test(text)) seen.error = true;
      else seen.success = true;
    };
    const Obs = (d.defaultView || root).MutationObserver;
    const obs = Obs ? new Obs((muts) => muts.forEach(check)) : null;
    if (obs) obs.observe(d.body || d.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    return { seen, stop: () => obs && obs.disconnect() };
  }

  /**
   * One attempt at removing one video. Returns { ok, status, step, detail }:
   *  status 'removed' | 'gone' (not on the page any more — treated as already removed) | 'failed'
   *  step   which stage the attempt ended in (for the debug log).
   */
  async function attemptRemove(video, opts = {}) {
    const doc = opts.doc || document;
    if (!(await ensureMenuClosed(doc))) return { ok: false, status: 'failed', step: 'previous-menu-stuck-open' };

    let el = locate(video, doc);
    if (!el) {
      await sleep(opts.notFoundWaitMs == null ? 300 : opts.notFoundWaitMs);
      el = locate(video, doc);
      if (!el) return { ok: false, status: 'gone', step: 'not-found' };
    }
    if (el.scrollIntoView) {
      el.scrollIntoView({ block: 'center' });
      await sleep(opts.scrollSettleMs == null ? 150 : opts.scrollSettleMs);
      el = locate(video, doc) || el; // re-resolve: scrolling may hydrate/recycle nodes
    }
    const btn = findMenuButton(el);
    if (!btn) return { ok: false, status: 'failed', step: 'menu-button-not-found' };
    btn.click();

    let items = [];
    await waitFor(() => (items = getOpenMenuItems(doc)).length > 0, { timeout: opts.menuTimeout || 3000 });
    if (!items.length) {
      pressEscape(doc);
      return { ok: false, status: 'failed', step: 'menu-did-not-open' };
    }
    if (video.videoId && locate(video, doc) !== el) {
      pressEscape(doc);
      return { ok: false, status: 'failed', step: 'item-changed-while-menu-open' };
    }
    const found = findRemoveMenuItem(items, opts);
    if (!found) {
      const labels = items.map((it) => WLC.cleanText(it.textContent)).join(' | ');
      pressEscape(doc);
      return { ok: false, status: 'failed', step: 'remove-item-not-found', detail: `menu: ${labels.slice(0, 200)}` };
    }

    const toasts = watchToasts(doc);
    clickEl(found.item);
    try {
      const done = await waitFor(() => !isPresent(video, el, doc) || toasts.seen.success || toasts.seen.error, {
        timeout: opts.removeTimeout || 6000,
      });
      if (toasts.seen.error && isPresent(video, el, doc)) {
        return { ok: false, status: 'failed', step: 'youtube-error-toast', detail: toasts.seen.text, method: found.method };
      }
      if (done && !isPresent(video, el, doc)) return { ok: true, status: 'removed', step: 'removed', method: found.method };
      if (toasts.seen.success) {
        // YouTube confirmed; the row can lag behind the toast. Give it a moment, but count it either way.
        await waitFor(() => !isPresent(video, el, doc), { timeout: 3000 });
        return { ok: true, status: 'removed', step: 'removed-toast', method: found.method, detail: toasts.seen.text };
      }
      return { ok: false, status: 'failed', step: 'still-present-after-click', method: found.method };
    } finally {
      toasts.stop();
    }
  }

  /** Legacy single-element helper (kept for callers/tests): remove the video shown by `itemEl`. */
  async function removeItem(itemEl, opts = {}) {
    const video = Object.assign(WLC.parseItem(itemEl), { el: itemEl });
    const r = await attemptRemove(video, Object.assign({ doc: itemEl.ownerDocument }, opts));
    return { ok: r.ok, method: r.method, error: r.ok ? undefined : r.step };
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

  /** True if an item looks like it hasn't been hydrated yet (no title, or neither channel nor age). */
  function isIncomplete(v) {
    return !v.unavailable && (!v.title || (!v.channel && v.ageDays == null));
  }

  /**
   * Parse all items, re-reading items whose metadata hasn't been rendered yet (lazy hydration)
   * a few times before giving up. Always call after loadAll() has finished.
   */
  async function parseAllSettled(opts = {}) {
    const doc = opts.doc || document;
    const retries = opts.retries == null ? 4 : opts.retries;
    const waitMs = opts.waitMs == null ? 400 : opts.waitMs;
    let videos = WLC.parseAll(doc);
    for (let i = 0; i < retries && videos.some(isIncomplete); i++) {
      await sleep(waitMs);
      videos = WLC.parseAll(doc);
    }
    return videos;
  }

  /** Strip DOM references: a removal plan is a list of ids (+ display info), never element positions. */
  function toPlanEntry(v) {
    const entry = { videoId: v.videoId, title: v.title, channel: v.channel, ageText: v.ageText };
    if (v.setVideoId) entry.setVideoId = v.setVideoId; // playlist-entry id (Fast mode)
    if (!v.videoId) entry.el = v.el; // only for items without an id (rare)
    return entry;
  }

  /** Classic-path cleanup between attempts: close any ⋮ popup that is still open. */
  async function classicCleanup(doc) {
    pressEscape(doc);
    await ensureMenuClosed(doc);
  }

  /**
   * Remove planned videos one by one (sequentially).
   * - each video gets up to `maxAttempts` attempts with backoff between them
   * - adaptive pacing: the delay doubles after a failed video (up to maxDelayMs) and decays back after successes
   * - pauses (aborted=true) only after `maxConsecutiveFailures` failed videos in a row
   * - returns `remaining` (failed + not attempted) so the caller can Resume without re-previewing
   * The per-video step is pluggable: Classic (default) locates the row by videoId and clicks ⋮ → Remove;
   * Fast mode passes `attempt` (an edit_playlist request) and `sleep` (a pacing sleep that works in hidden tabs).
   * opts: { doc, delayMs, maxDelayMs, jitterMs, maxAttempts, maxConsecutiveFailures, fallbackAfter, mode,
   *         attempt, sleep, onRemoved, shouldStop, onProgress, onLog, ... }
   */
  async function removeVideos(videos, opts = {}) {
    const doc = opts.doc || document;
    const shouldStop = opts.shouldStop || (() => false);
    const mode = opts.mode || 'classic';
    const attemptFn = opts.attempt || ((video) => attemptRemove(video, Object.assign({}, opts, { doc })));
    const wait = opts.sleep || sleep;
    const cleanup = opts.attempt ? null : classicCleanup;
    const baseDelay = opts.delayMs == null ? 400 : opts.delayMs;
    const maxDelay = Math.max(baseDelay, opts.maxDelayMs == null ? 5000 : opts.maxDelayMs);
    const jitter = Math.max(0, opts.jitterMs || 0);
    const random = opts.random || Math.random;
    const maxAttempts = opts.maxAttempts || 3;
    const maxConsecutive = opts.maxConsecutiveFailures || 8;
    const fallbackAfter = opts.fallbackAfter || 0;
    const queue = videos.map(toPlanEntry);
    const stats = {
      done: 0, failed: 0, skipped: 0, total: queue.length, stopped: false, aborted: false, fallback: false,
      remaining: [], failures: [], steps: {}, log: [], errors: [],
    };
    const failedVideos = [];
    let delay = baseDelay;
    let consecutive = 0;
    let i = 0;
    const log = (entry) => {
      const e = Object.assign({ t: new Date().toISOString(), mode, delayMs: delay }, entry);
      if (stats.log.length < 5000) stats.log.push(e);
      if (opts.onLog) opts.onLog(e);
    };

    for (; i < queue.length; i++) {
      if (shouldStop()) {
        stats.stopped = true;
        break;
      }
      const video = queue[i];
      let r = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        r = await attemptFn(video);
        log({ videoId: video.videoId, title: video.title, attempt, step: r.step, ok: r.ok, detail: r.detail || r.method || '' });
        if (r.ok || r.status === 'gone' || r.retryable === false || shouldStop()) break;
        if (cleanup) await cleanup(doc);
        await wait(Math.min(maxDelay, delay * 2 ** attempt)); // backoff before retrying the same video
      }
      if (r.ok) {
        stats.done++;
        consecutive = 0;
        delay = Math.max(baseDelay, Math.round(delay * 0.8));
        if (opts.onRemoved) opts.onRemoved(video, r);
      } else if (r.status === 'gone') {
        stats.skipped++;
      } else {
        stats.failed++;
        consecutive++;
        failedVideos.push(video);
        stats.steps[r.step] = (stats.steps[r.step] || 0) + 1;
        stats.failures.push({ videoId: video.videoId, title: video.title, step: r.step, detail: r.detail || '' });
        stats.errors.push(`${video.title || video.videoId}: ${r.step}`);
        delay = Math.min(maxDelay, delay * 2); // YouTube may be throttling — slow down instead of giving up
      }
      if (opts.onProgress) opts.onProgress(Object.assign({ current: video, result: r, delayMs: delay, index: i, mode }, stats));
      if (fallbackAfter && stats.done === 0 && consecutive >= fallbackAfter) {
        stats.fallback = true; // nothing worked in this mode — let the caller switch modes
        i++;
        break;
      }
      if (consecutive >= maxConsecutive) {
        stats.aborted = true;
        i++;
        break;
      }
      if (i < queue.length - 1) await wait(delay + (jitter ? Math.round(random() * jitter) : 0));
    }
    stats.remaining = failedVideos.concat(queue.slice(i));
    return stats;
  }

  /** Remove anything that could look like a credential (defense in depth for the copyable debug log). */
  function redactSecrets(text) {
    return String(text == null ? '' : text)
      .replace(/SAPISID\w*HASH\s+\S+/gi, '[redacted]')
      .replace(/\b(Authorization|Cookie)\s*[:=]\s*[^\n]*/gi, '$1: [redacted]')
      .replace(/\b((?:__Secure-[\w-]+)|SAPISID|APISID|HSID|SSID|SID|LOGIN_INFO)=[^;\s]+/g, '$1=[redacted]');
  }

  /** Plain-text debug report for the "Copy debug log" button (no data leaves the browser unless the user pastes it). */
  function formatDebugLog(info = {}) {
    const s = info.stats || {};
    const lines = [
      'Watch Later Cleaner debug log',
      `version: ${info.version || '?'}  time: ${new Date().toISOString()}`,
      `userAgent: ${info.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '?')}`,
      `items on page: ${info.itemCount == null ? '?' : info.itemCount}`,
      `settings: ${JSON.stringify(info.settings || {})}`,
      `mode: ${s.modeUsed || (info.settings && info.settings.removalMode) || '?'}${s.fallbackReason ? `  fallback: ${s.fallbackReason}` : ''}`,
      `result: removed ${s.done || 0}/${s.total || 0}, failed ${s.failed || 0}, already gone ${s.skipped || 0}, ` +
        `stopped ${Boolean(s.stopped)}, paused ${Boolean(s.aborted)}, remaining ${(s.remaining || []).length}`,
      `failure steps: ${JSON.stringify(s.steps || {})}`,
      '',
      'failures:',
      ...(s.failures || []).map((f) => `  ${f.videoId || '-'}  ${f.step}  ${f.detail || ''}  "${String(f.title || '').slice(0, 60)}"`),
      '',
      'attempts (last 300):',
      ...(info.log || s.log || [])
        .slice(-300)
        .map((e) =>
          e.event
            ? `  ${e.t} ${String(e.event).toUpperCase()} [${e.mode || '-'}] ${e.detail || ''}`
            : `  ${e.t} ${e.ok ? 'OK  ' : 'FAIL'} #${e.attempt} ${e.videoId || '-'} ${e.step} delay=${e.delayMs} mode=${e.mode || 'classic'} ${e.detail || ''}`
        ),
    ];
    return redactSecrets(lines.join('\n'));
  }

  Object.assign(WLC, {
    MENU_ITEM_SELECTOR,
    MENU_CONTAINER_SELECTOR,
    TOAST_SELECTOR,
    sleep,
    waitFor,
    isHidden,
    getOpenMenuItems,
    hasTrashIcon,
    findRemoveMenuItem,
    findMenuButton,
    pressEscape,
    ensureMenuClosed,
    findItemByVideoId,
    watchToasts,
    attemptRemove,
    removeItem,
    loadAll,
    isIncomplete,
    parseAllSettled,
    toPlanEntry,
    removeVideos,
    redactSecrets,
    formatDebugLog,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
