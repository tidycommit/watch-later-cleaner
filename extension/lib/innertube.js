/* Watch Later Cleaner — YouTube web-client ("InnerTube") helpers for the Fast mode.
 * Pure functions only (no DOM, no network): SHA-1 / SAPISIDHASH, request headers and bodies,
 * and parsing of browse / edit_playlist responses. Loaded in the isolated content-script world
 * (parsing) and in the page's main world (page-bridge.js, which makes the actual same-origin requests). */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});

  const ORIGIN = 'https://www.youtube.com';
  const BROWSE_PATH = '/youtubei/v1/browse';
  const EDIT_PLAYLIST_PATH = '/youtubei/v1/browse/edit_playlist';
  const WL_PLAYLIST_ID = 'WL';
  const WL_BROWSE_ID = 'VLWL';

  // ---------- SHA-1 (small, synchronous, UTF-8) ----------
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(str));
    const s = unescape(encodeURIComponent(String(str)));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /** Hex SHA-1 of a string (UTF-8). */
  function sha1Hex(str) {
    const msg = utf8Bytes(str);
    const ml = msg.length;
    const words = new Uint32Array((((ml + 8) >> 6) + 1) * 16);
    for (let i = 0; i < ml; i++) words[i >> 2] |= msg[i] << (24 - (i % 4) * 8);
    words[ml >> 2] |= 0x80 << (24 - (ml % 4) * 8);
    const bits = ml * 8;
    words[words.length - 1] = bits >>> 0;
    words[words.length - 2] = Math.floor(bits / 0x100000000);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80);
    const rotl = (x, n) => (x << n) | (x >>> (32 - n));
    for (let off = 0; off < words.length; off += 16) {
      for (let t = 0; t < 16; t++) w[t] = words[off + t];
      for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let t = 0; t < 80; t++) {
        let f, k;
        if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const tmp = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
        e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = tmp;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  // ---------- Authorization (what the YouTube web client sends) ----------
  /** "<scheme> <ts>_<sha1(ts + ' ' + cookieValue + ' ' + origin)>" */
  function sapisidHash(cookieValue, origin, timestampSec, scheme = 'SAPISIDHASH') {
    const ts = Math.floor(Number(timestampSec));
    return `${scheme} ${ts}_${sha1Hex(`${ts} ${cookieValue} ${origin}`)}`;
  }

  /** Read one cookie from a document.cookie string. */
  function readCookie(cookieString, name) {
    for (const part of String(cookieString || '').split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return null;
  }

  /**
   * Authorization header value from the page's cookies, as the web client builds it:
   * SAPISIDHASH (+ SAPISID1PHASH / SAPISID3PHASH when the __Secure-1P/3PAPISID cookies are present).
   * Returns null when not signed in (no SAPISID-type cookie).
   */
  function buildAuthorization(cookieString, origin, timestampSec) {
    const sapisid = readCookie(cookieString, 'SAPISID') || readCookie(cookieString, '__Secure-3PAPISID');
    if (!sapisid) return null;
    const parts = [sapisidHash(sapisid, origin, timestampSec, 'SAPISIDHASH')];
    const p1 = readCookie(cookieString, '__Secure-1PAPISID');
    const p3 = readCookie(cookieString, '__Secure-3PAPISID');
    if (p1) parts.push(sapisidHash(p1, origin, timestampSec, 'SAPISID1PHASH'));
    if (p3) parts.push(sapisidHash(p3, origin, timestampSec, 'SAPISID3PHASH'));
    return parts.join(' ');
  }

  /** Read the bits of ytcfg we need. `cfg` is window.ytcfg (with .get) or a plain data_ object. */
  function readYtcfg(cfg) {
    if (!cfg) return null;
    const get = (k) => {
      try {
        if (typeof cfg.get === 'function') {
          const v = cfg.get(k);
          if (v !== undefined) return v;
        }
      } catch (_) {
        /* fall through to data_ */
      }
      const data = cfg.data_ || cfg;
      return data ? data[k] : undefined;
    };
    const context = get('INNERTUBE_CONTEXT');
    const client = (context && context.client) || {};
    return {
      apiKey: get('INNERTUBE_API_KEY') || null,
      context: context || null,
      clientName: get('INNERTUBE_CONTEXT_CLIENT_NAME') || 1,
      clientVersion: get('INNERTUBE_CLIENT_VERSION') || client.clientVersion || null,
      visitorData: get('VISITOR_DATA') || client.visitorData || null,
      sessionIndex: get('SESSION_INDEX') == null ? 0 : get('SESSION_INDEX'),
      delegatedSessionId: get('DELEGATED_SESSION_ID') || null,
      loggedIn: get('LOGGED_IN'),
    };
  }

  /** What's missing for the Fast mode (empty array = ready). Never includes secret values. */
  function fastModeProblems(cfg, hasAuth) {
    const p = [];
    if (!cfg) p.push('ytcfg-missing');
    else {
      if (!cfg.apiKey) p.push('api-key-missing');
      if (!cfg.context || !cfg.context.client) p.push('context-missing');
      if (cfg.loggedIn === false) p.push('not-logged-in');
    }
    if (!hasAuth) p.push('sapisid-cookie-missing');
    return p;
  }

  function endpointUrl(path, cfg) {
    const q = [];
    if (cfg && cfg.apiKey) q.push(`key=${encodeURIComponent(cfg.apiKey)}`);
    q.push('prettyPrint=false');
    return `${path}?${q.join('&')}`;
  }

  /** Request headers mirroring the web client's own InnerTube calls. */
  function buildHeaders({ authorization, origin = ORIGIN, cfg = {} } = {}) {
    const h = { 'Content-Type': 'application/json', 'X-Origin': origin, 'X-Goog-AuthUser': String(cfg.sessionIndex == null ? 0 : cfg.sessionIndex) };
    if (authorization) h.Authorization = authorization;
    if (cfg.clientName != null) h['X-Youtube-Client-Name'] = String(cfg.clientName);
    if (cfg.clientVersion) h['X-Youtube-Client-Version'] = String(cfg.clientVersion);
    if (cfg.visitorData) h['X-Goog-Visitor-Id'] = String(cfg.visitorData);
    if (cfg.delegatedSessionId) h['X-Goog-PageId'] = String(cfg.delegatedSessionId);
    if (authorization) h['X-Youtube-Bootstrap-Logged-In'] = 'true';
    return h;
  }

  function cloneContext(context) {
    return JSON.parse(JSON.stringify(context || {}));
  }

  function buildBrowseBody(context, { continuation, browseId } = {}) {
    const body = { context: cloneContext(context) };
    if (continuation) body.continuation = continuation;
    else body.browseId = browseId || WL_BROWSE_ID;
    return body;
  }

  /** Remove action for one video: by setVideoId (the playlist entry id) when known, else by videoId. */
  function buildRemoveAction(video) {
    if (video && video.setVideoId) return { action: 'ACTION_REMOVE_VIDEO', setVideoId: video.setVideoId };
    if (video && video.videoId) return { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: video.videoId };
    return null;
  }

  function buildEditPlaylistBody(context, videos, playlistId = WL_PLAYLIST_ID) {
    const actions = (Array.isArray(videos) ? videos : [videos]).map(buildRemoveAction).filter(Boolean);
    return { context: cloneContext(context), actions, playlistId };
  }

  // ---------- Response parsing ----------
  function textOf(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if (t.simpleText != null) return String(t.simpleText);
    if (Array.isArray(t.runs)) return t.runs.map((r) => r.text || '').join('');
    if (t.content != null) return String(t.content);
    return '';
  }

  function continuationToken(item) {
    const r = item && item.continuationItemRenderer;
    if (!r) return null;
    const ep = r.continuationEndpoint || (r.button && r.button.buttonRenderer && r.button.buttonRenderer.command) || {};
    if (ep.continuationCommand && ep.continuationCommand.token) return ep.continuationCommand.token;
    const cmds = (ep.commandExecutorCommand && ep.commandExecutorCommand.commands) || [];
    for (const c of cmds) if (c.continuationCommand && c.continuationCommand.token) return c.continuationCommand.token;
    return null;
  }

  function setVideoIdFromMenu(r) {
    const items = (r.menu && r.menu.menuRenderer && r.menu.menuRenderer.items) || [];
    for (const it of items) {
      const ep = it.menuServiceItemRenderer && it.menuServiceItemRenderer.serviceEndpoint;
      const actions = (ep && ep.playlistEditEndpoint && ep.playlistEditEndpoint.actions) || [];
      for (const a of actions) if (a.setVideoId) return a.setVideoId;
    }
    return null;
  }

  function resumePercent(r) {
    for (const o of r.thumbnailOverlays || []) {
      const p = o.thumbnailOverlayResumePlaybackRenderer;
      if (p && p.percentDurationWatched != null) return Math.max(0, Math.min(100, Number(p.percentDurationWatched) || 0));
    }
    return 0;
  }

  function durationTextOf(r) {
    const t = textOf(r.lengthText);
    if (t) return t;
    for (const o of r.thumbnailOverlays || []) {
      const s = o.thumbnailOverlayTimeStatusRenderer;
      if (s && textOf(s.text)) return textOf(s.text);
    }
    return '';
  }

  /** Candidate texts that may hold the relative publish age ("3 years ago"), in order of preference. */
  function ageCandidates(r) {
    const out = [];
    const runs = (r.videoInfo && r.videoInfo.runs) || [];
    for (const run of runs) if (run && run.text) out.push(run.text);
    const info = textOf(r.videoInfo);
    if (info) out.push(...info.split(/\s*[•·|]\s*/));
    if (r.publishedTimeText) out.unshift(textOf(r.publishedTimeText));
    return out.map((s) => String(s).trim()).filter(Boolean);
  }

  /**
   * One playlistVideoRenderer → the raw fields the filters need (same shape as parse.js parseItem,
   * minus ageDays, which the isolated world adds with WLC.parseAge).
   */
  function parsePlaylistVideoRenderer(r, index) {
    const title = textOf(r.title);
    const channel = textOf(r.shortBylineText);
    const lengthSeconds = r.lengthSeconds != null && r.lengthSeconds !== '' ? parseInt(r.lengthSeconds, 10) : null;
    const accessibility = (r.title && r.title.accessibility && r.title.accessibility.accessibilityData && r.title.accessibility.accessibilityData.label) || '';
    const bracketed = /^\[.+\]$/.test(title.trim());
    return {
      index: typeof index === 'number' ? index : null,
      position: textOf(r.index),
      videoId: r.videoId || null,
      setVideoId: r.setVideoId || setVideoIdFromMenu(r),
      title,
      channel,
      progress: resumePercent(r),
      durationSec: Number.isFinite(lengthSeconds) ? lengthSeconds : null,
      durationText: durationTextOf(r),
      ageCandidates: ageCandidates(r),
      accessibilityLabel: accessibility,
      isPlayable: r.isPlayable !== false,
      unavailable: (bracketed && !channel) || (r.isPlayable === false && !channel),
    };
  }

  function playlistContents(node) {
    // ytInitialData / browse(VLWL): tabs → sectionList → itemSection → playlistVideoListRenderer.contents
    const out = { items: null, playlistId: null };
    const visit = (n, depth) => {
      if (!n || typeof n !== 'object' || out.items || depth > 14) return;
      if (n.playlistVideoListRenderer && Array.isArray(n.playlistVideoListRenderer.contents)) {
        out.items = n.playlistVideoListRenderer.contents;
        out.playlistId = n.playlistVideoListRenderer.playlistId || null;
        return;
      }
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (v && typeof v === 'object') visit(v, depth + 1);
        if (out.items) return;
      }
    };
    visit(node && node.contents, 0);
    return out;
  }

  function continuationItems(json) {
    const items = [];
    const acts = [].concat(json.onResponseReceivedActions || [], json.onResponseReceivedEndpoints || [], json.onResponseReceivedCommands || []);
    for (const a of acts) {
      const c = a.appendContinuationItemsAction || a.reloadContinuationItemsCommand;
      if (c && Array.isArray(c.continuationItems)) items.push(...c.continuationItems);
    }
    // Older shape: continuationContents.playlistVideoListContinuation.contents
    const old = json.continuationContents && json.continuationContents.playlistVideoListContinuation;
    if (old && Array.isArray(old.contents)) items.push(...old.contents);
    return items;
  }

  /**
   * Parse ytInitialData (first page) or a browse continuation response.
   * Returns { videos: raw[], continuation: token|null, playlistId, kind: 'initial'|'continuation'|'unknown' }.
   * `startIndex` numbers the videos (0-based) across pages.
   */
  function parseBrowseResponse(json, startIndex = 0) {
    if (!json || typeof json !== 'object') return { videos: [], continuation: null, playlistId: null, kind: 'unknown' };
    let items = null;
    let kind = 'unknown';
    let playlistId = null;
    const cont = continuationItems(json);
    if (cont.length) {
      items = cont;
      kind = 'continuation';
    } else {
      const pc = playlistContents(json);
      if (pc.items) {
        items = pc.items;
        kind = 'initial';
        playlistId = pc.playlistId;
      }
    }
    const videos = [];
    let continuation = null;
    for (const it of items || []) {
      if (it.playlistVideoRenderer) videos.push(parsePlaylistVideoRenderer(it.playlistVideoRenderer, startIndex + videos.length));
      else if (it.continuationItemRenderer) continuation = continuationToken(it) || continuation;
    }
    return { videos, continuation, playlistId, kind };
  }

  /** True if a ytInitialData-like object is the Watch Later playlist page. */
  function isWatchLaterData(json) {
    if (!json || typeof json !== 'object') return false;
    const pc = playlistContents(json);
    if (!pc.items) return false;
    const header = json.header && (json.header.playlistHeaderRenderer || json.header.pageHeaderRenderer);
    return pc.playlistId === WL_PLAYLIST_ID || Boolean(header && header.playlistId === WL_PLAYLIST_ID);
  }

  /**
   * Interpret an edit_playlist response. Success only when the HTTP status is OK AND status is STATUS_SUCCEEDED.
   * Returns { ok, status: 'removed'|'failed', step, detail, retryable }.
   */
  function interpretEditResponse(httpOk, httpStatus, json) {
    const j = json && typeof json === 'object' ? json : {};
    if (httpOk && j.status === 'STATUS_SUCCEEDED') return { ok: true, status: 'removed', step: 'api-removed', detail: 'STATUS_SUCCEEDED' };
    const err = j.error || {};
    const parts = [`HTTP ${httpStatus == null ? '?' : httpStatus}`];
    if (err.status) parts.push(String(err.status));
    if (j.status && j.status !== 'STATUS_SUCCEEDED') parts.push(String(j.status));
    if (err.message) parts.push(String(err.message).slice(0, 120));
    let step = 'api-error';
    if (!httpOk && (httpStatus === 401 || httpStatus === 403)) step = 'api-unauthorized';
    else if (httpStatus === 429) step = 'api-throttled';
    else if (!httpOk && httpStatus >= 500) step = 'api-server-error';
    else if (!httpOk && httpStatus === 0) step = 'api-network-error';
    else if (httpOk) step = 'api-not-succeeded';
    return { ok: false, status: 'failed', step, detail: parts.join(' '), retryable: step !== 'api-unauthorized' };
  }

  Object.assign(WLC, {
    IT: Object.freeze({ ORIGIN, BROWSE_PATH, EDIT_PLAYLIST_PATH, WL_PLAYLIST_ID, WL_BROWSE_ID }),
    sha1Hex,
    sapisidHash,
    readCookie,
    buildAuthorization,
    readYtcfg,
    fastModeProblems,
    endpointUrl,
    buildHeaders,
    buildBrowseBody,
    buildRemoveAction,
    buildEditPlaylistBody,
    textOf,
    continuationToken,
    parsePlaylistVideoRenderer,
    parseBrowseResponse,
    isWatchLaterData,
    interpretEditResponse,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
