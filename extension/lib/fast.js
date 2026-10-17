/* Watch Later Cleaner — Fast mode (works in background tabs).
 * Lists Watch Later from the page's initial data + /youtubei/v1/browse continuations and removes with
 * /youtubei/v1/browse/edit_playlist, through the main-world bridge (content/page-bridge.js).
 * Falls back to the Classic page-click path automatically when the Fast path isn't available or fails. */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});
  const SOURCE = 'wlc-ext';

  class FastError extends Error {
    constructor(step, detail) {
      super(detail ? `${step}: ${detail}` : step);
      this.step = step;
    }
  }

  /** Isolated-world side of the postMessage bridge. Returns { call(op, args, timeoutMs) }. */
  function createBridgeClient(opts = {}) {
    const win = opts.win || root;
    const defaultTimeout = opts.timeoutMs || 30000;
    const target = () => (win.location && win.location.origin && win.location.origin !== 'null' ? win.location.origin : '*');
    let seq = 0;
    const pending = new Map();
    win.addEventListener('message', (e) => {
      if (e.source !== win && e.source != null) return;
      const m = e.data;
      if (!m || m.source !== SOURCE || m.dir !== 'res') return;
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(new FastError('bridge-error', m.error));
    });
    function call(op, args, timeoutMs) {
      const id = `${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new FastError('bridge-timeout', op));
        }, timeoutMs || defaultTimeout);
        pending.set(id, { resolve, reject, timer });
        win.postMessage({ source: SOURCE, dir: 'req', id, op, args: args || null }, target());
      });
    }
    return { call };
  }

  /**
   * Sleep that keeps its cadence in a hidden tab: when the page is hidden, the wait is done by the
   * extension's service worker (its timers aren't throttled by page visibility); otherwise setTimeout.
   */
  async function pace(ms, opts = {}) {
    if (!(ms > 0)) return;
    const doc = opts.doc || root.document;
    const rt = opts.runtime !== undefined ? opts.runtime : typeof chrome !== 'undefined' ? chrome.runtime : null;
    if (doc && doc.visibilityState === 'hidden' && rt && rt.id && rt.sendMessage) {
      try {
        await rt.sendMessage({ type: 'wlc:sleep', ms: Math.min(ms, 20000) });
        return;
      } catch (_) {
        /* service worker unreachable: fall back to setTimeout */
      }
    }
    await WLC.sleep(ms);
  }

  /** Raw API item → the same video object parse.js produces for a DOM row. */
  function toVideo(raw) {
    let age = null;
    let ageSource = null;
    for (const text of raw.ageCandidates || []) {
      if (raw.title && text.includes(raw.title)) continue;
      const a = WLC.parseAge(text);
      if (a) {
        age = Object.assign({ text }, a);
        ageSource = 'api:videoInfo';
        break;
      }
    }
    if (!age && raw.accessibilityLabel) {
      let label = WLC.cleanText(raw.accessibilityLabel);
      if (raw.title && label.toLowerCase().startsWith(raw.title.toLowerCase())) label = label.slice(raw.title.length);
      const a = WLC.parseAge(label);
      if (a) {
        age = Object.assign({ text: a.match }, a);
        ageSource = 'api:accessibility';
      }
    }
    const title = WLC.cleanText(raw.title);
    const channel = WLC.cleanText(raw.channel);
    let durationSec = raw.durationSec;
    if (durationSec == null && raw.durationText) durationSec = WLC.parseDuration(raw.durationText);
    return {
      index: raw.index,
      position: WLC.cleanText(raw.position),
      videoId: raw.videoId,
      setVideoId: raw.setVideoId || null,
      title,
      channel,
      progress: raw.progress || 0,
      durationSec: durationSec == null ? null : durationSec,
      durationText: raw.durationText || '',
      ageText: age ? age.text : '',
      ageDays: age ? age.days : null,
      ageSource,
      unavailable: Boolean(raw.unavailable) || WLC.isUnavailable(title, channel),
      el: null,
    };
  }

  /** Fast-mode API over a bridge client ({ call }). */
  function createFastApi(opts = {}) {
    const bridge = opts.bridge || createBridgeClient(opts);
    const sleepFn = opts.sleep || ((ms) => pace(ms, opts));
    const maxPages = opts.maxPages || 2000;

    async function probe() {
      const d = opts.doc || (opts.win && opts.win.document) || root.document;
      if (!opts.bridge && d && d.documentElement && !d.documentElement.hasAttribute('data-wlc-bridge')) {
        return { ready: false, problems: ['bridge-not-installed'] };
      }
      try {
        const r = await bridge.call('probe', null, opts.probeTimeoutMs || 4000);
        return r && typeof r === 'object' ? r : { ready: false, problems: ['bridge-bad-reply'] };
      } catch (e) {
        return { ready: false, problems: [e.step || 'bridge-unavailable'] };
      }
    }

    async function browse(args) {
      let last = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        last = await bridge.call('browse', args);
        if (last && last.httpOk && last.json) return last.json;
        if (last && (last.httpStatus === 401 || last.httpStatus === 403)) break;
        await sleepFn(500 * 2 ** attempt);
      }
      const err = WLC.interpretEditResponse(false, last && last.httpStatus, last && last.json);
      throw new FastError('browse-failed', err.detail);
    }

    /** Fetch the full list. Returns { videos, complete, pages, source }. */
    async function listAll(o = {}) {
      const shouldStop = o.shouldStop || (() => false);
      let data = await bridge.call('initial');
      let source = 'page-data';
      if (!data) {
        data = await browse({ browseId: WLC.IT.WL_BROWSE_ID });
        source = 'browse';
      }
      const first = WLC.parseBrowseResponse(data, 0);
      if (first.kind !== 'initial') throw new FastError('unexpected-browse-shape', 'no playlistVideoListRenderer');
      const raw = first.videos.slice();
      let token = first.continuation;
      let pages = 1;
      const seen = new Set();
      if (o.onProgress) o.onProgress(raw.length);
      while (token && !o.firstPageOnly && !shouldStop() && pages < maxPages) {
        if (seen.has(token)) throw new FastError('continuation-loop');
        seen.add(token);
        const json = await browse({ continuation: token });
        const page = WLC.parseBrowseResponse(json, raw.length);
        if (page.kind === 'unknown') throw new FastError('unexpected-continuation-shape');
        raw.push(...page.videos);
        token = page.continuation;
        pages++;
        if (o.onProgress) o.onProgress(raw.length);
      }
      return { videos: raw.map(toVideo), complete: !token, pages, source };
    }

    /** One edit_playlist request removing one video. Same result shape as remover.js attemptRemove. */
    async function removeOne(video) {
      if (!video || (!video.videoId && !video.setVideoId)) return { ok: false, status: 'failed', step: 'api-no-video-id', retryable: false };
      try {
        const r = await bridge.call('edit', { videos: [{ videoId: video.videoId || null, setVideoId: video.setVideoId || null }] });
        const out = WLC.interpretEditResponse(r && r.httpOk, r && r.httpStatus, r && r.json);
        out.method = video.setVideoId ? 'api:setVideoId' : 'api:videoId';
        return out;
      } catch (e) {
        return { ok: false, status: 'failed', step: e.step || 'bridge-error', detail: String(e.message || e).slice(0, 160), retryable: true };
      }
    }

    return { probe, listAll, removeOne, bridge };
  }

  /** Remove the row of a video the API already removed, so the page matches (YouTube doesn't know yet). */
  function removeRowFromPage(doc, videoId) {
    const el = WLC.findItemByVideoId(doc || root.document, videoId);
    if (el) el.remove();
    return Boolean(el);
  }

  function pageOrderMatches(doc, videos, n = 5) {
    const domIds = WLC.getItems(doc)
      .slice(0, n)
      .map((el) => WLC.parseItem(el).videoId)
      .filter(Boolean);
    return domIds.every((id, i) => videos[i] && videos[i].videoId === id);
  }

  /**
   * List the playlist in the chosen mode, falling back to Classic (scroll + parse) when Fast fails.
   * opts: { mode, api, doc, loadAll, needPageOrder, shouldStop, onProgress, onLog }
   * Returns { videos, incomplete, mode: 'fast'|'classic', fallbackReason }.
   */
  async function listVideos(opts = {}) {
    const doc = opts.doc || root.document;
    const note = (m) => opts.onLog && opts.onLog({ t: new Date().toISOString(), event: 'list', mode: 'fast', detail: m });
    let fallbackReason = null;
    if (opts.mode !== 'classic' && opts.api) {
      const probe = await opts.api.probe();
      if (!probe.ready) fallbackReason = `fast mode unavailable (${(probe.problems || []).join(', ') || 'unknown'})`;
      else {
        try {
          const r = await opts.api.listAll({ firstPageOnly: !opts.loadAll, shouldStop: opts.shouldStop, onProgress: opts.onProgress });
          if (opts.needPageOrder && !pageOrderMatches(doc, r.videos)) {
            fallbackReason = 'list order differs from the page (sort changed?)';
          } else {
            note(`listed ${r.videos.length} via ${r.source}, ${r.pages} page(s)${r.complete ? '' : ', incomplete'}`);
            return { videos: r.videos, incomplete: !r.complete, mode: 'fast', fallbackReason: null };
          }
        } catch (e) {
          fallbackReason = String(e.message || e).slice(0, 160);
        }
      }
      note(`falling back to classic: ${fallbackReason}`);
      if (opts.onFallback) opts.onFallback(fallbackReason);
    }
    if (opts.loadAll) await WLC.loadAll({ doc, shouldStop: opts.shouldStop, onProgress: opts.onProgress, settleMs: opts.settleMs });
    const incomplete = Boolean(doc.querySelector(WLC.SELECTORS.continuation));
    const videos = await WLC.parseAllSettled(Object.assign({ doc }, opts.parseOpts || {}));
    return { videos, incomplete, mode: 'classic', fallbackReason };
  }

  /**
   * Remove planned videos in the chosen mode. Fast: sequential edit_playlist requests paced by awaited
   * fetches + delay/jitter (service-worker sleep when hidden). If Fast isn't available, or its first
   * `fallbackAfter` videos all fail, the remaining videos go through the Classic page-click path.
   * opts: everything removeVideos takes, plus { mode, api, jitterMs, fallbackAfter, onFallback }.
   */
  async function removeWithFallback(entries, opts = {}) {
    const doc = opts.doc || root.document;
    const classicOpts = Object.assign({}, opts, { mode: 'classic', attempt: undefined, sleep: undefined, onRemoved: undefined, jitterMs: 0, fallbackAfter: 0 });
    const runClassic = async (list, offset, reason) => {
      if (reason && opts.onFallback) opts.onFallback(reason);
      if (reason && opts.onLog) opts.onLog({ t: new Date().toISOString(), event: 'fallback', mode: 'classic', detail: reason });
      const base = offset || { done: 0, skipped: 0, total: list.length, log: [] };
      const c = await WLC.removeVideos(
        list,
        Object.assign(classicOpts, {
          onProgress: opts.onProgress && ((p) => opts.onProgress(Object.assign({}, p, { done: p.done + base.done, skipped: p.skipped + base.skipped, total: base.total }))),
        })
      );
      return Object.assign(c, {
        done: c.done + base.done,
        skipped: c.skipped + base.skipped,
        total: base.total,
        log: (base.log || []).concat(c.log),
        modeUsed: offset ? 'fast→classic' : 'classic',
        fallbackReason: reason || null,
      });
    };
    if (opts.mode === 'classic' || !opts.api) return runClassic(entries, null, null);
    const probe = await opts.api.probe();
    if (!probe.ready) return runClassic(entries, null, `fast mode unavailable (${(probe.problems || []).join(', ') || 'unknown'})`);
    const fast = await WLC.removeVideos(
      entries,
      Object.assign({}, opts, {
        doc,
        mode: 'fast',
        attempt: (video) => opts.api.removeOne(video),
        sleep: opts.sleep || ((ms) => pace(ms, { doc, runtime: opts.runtime })),
        jitterMs: opts.jitterMs == null ? 200 : opts.jitterMs,
        fallbackAfter: opts.fallbackAfter == null ? 3 : opts.fallbackAfter,
        onRemoved: (v) => {
          if (opts.removeRows !== false) removeRowFromPage(doc, v.videoId);
          if (opts.onRemoved) opts.onRemoved(v);
        },
      })
    );
    fast.modeUsed = 'fast';
    if (fast.fallback && !fast.stopped) {
      const reason = `edit_playlist failed for the first ${fast.failed} video(s) (${Object.keys(fast.steps).join(', ')})`;
      return runClassic(fast.remaining, fast, reason);
    }
    return fast;
  }

  Object.assign(WLC, { FastError, createBridgeClient, pace, toVideo, createFastApi, removeRowFromPage, pageOrderMatches, listVideos, removeWithFallback });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
