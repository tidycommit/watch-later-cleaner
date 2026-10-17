import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWLC, loadFixture } from './helpers.mjs';
import { SAMPLE_VIDEOS, FAKE_YTCFG, buildInitialData, createFakeInnertube, generateVideos } from './fixtures/innertube.mjs';

const WLC = loadWLC();
const here = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SRC = fs.readFileSync(path.join(here, '../extension/content/page-bridge.js'), 'utf8');
const SAPISID = 'TestSapisid-NotReal_0123/abc';
const ORIGIN = window.location.origin;
const CLASSIC = { menuTimeout: 400, removeTimeout: 600, scrollSettleMs: 0, notFoundWaitMs: 20, maxDelayMs: 40 };
const DEFAULT_EXPECTED = ['Learn Rust in 10 minutes', 'Lo-fi beats to study to', '[Deleted video]', '[Private video]'];

let server = null;
const fetchLog = [];

/** Start the real main-world bridge (page-bridge.js) in jsdom with a fake fetch backed by `server`. */
beforeAll(() => {
  const fakeRoot = { WLC: Object.assign({}, WLC), document, location: { hostname: 'localhost' } };
  new Function('globalThis', BRIDGE_SRC)(fakeRoot);
  expect(fakeRoot.WLC).toBeUndefined(); // the bridge removes the helper namespace from the page window
  fakeRoot.__wlcInstallBridge({
    win: window,
    doc: document,
    origin: ORIGIN,
    fetch: async (url, init) => {
      fetchLog.push({ url, headers: init.headers, body: init.body });
      await Promise.resolve();
      const r = server.handle({ url, headers: init.headers, body: init.body });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
    },
  });
});

function setupPage({ videos = SAMPLE_VIDEOS, pageSize = 4, initial = true, ytcfg = true, cookie = true, dom = true, fakeMenu = false, server: sOpts = {} } = {}) {
  if (dom) loadFixture({ fakeMenu });
  server = createFakeInnertube(videos, Object.assign({ pageSize, sapisid: SAPISID, origin: ORIGIN }, sOpts));
  fetchLog.length = 0;
  window.ytInitialData = initial ? buildInitialData(videos, { pageSize }) : undefined;
  if (ytcfg) window.ytcfg = { data_: Object.assign({}, FAKE_YTCFG), get(k) { return this.data_[k]; } };
  else delete window.ytcfg;
  document.cookie = cookie ? `SAPISID=${SAPISID}` : 'SAPISID=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  return WLC.createFastApi({ win: window, doc: document, sleep: async () => {} });
}

const fastOpts = (extra) => Object.assign({ mode: 'fast', doc: document, delayMs: 1, jitterMs: 0, sleep: async () => {} }, CLASSIC, extra || {});

describe('main-world bridge + Fast API', () => {
  it('probe reports ready only with ytcfg + SAPISID, without leaking values', async () => {
    let api = setupPage();
    const ok = await api.probe();
    expect(ok).toEqual({ ready: true, problems: [], hasInitialData: true });
    api = setupPage({ ytcfg: false });
    expect((await api.probe()).problems).toContain('ytcfg-missing');
    api = setupPage({ cookie: false });
    const p = await api.probe();
    expect(p.ready).toBe(false);
    expect(p.problems).toEqual(['sapisid-cookie-missing']);
    expect(JSON.stringify(p)).not.toContain(SAPISID);
  });

  it('probe fails fast when the bridge is not installed', async () => {
    const api = setupPage();
    document.documentElement.removeAttribute('data-wlc-bridge');
    try {
      expect(await api.probe()).toEqual({ ready: false, problems: ['bridge-not-installed'] });
    } finally {
      document.documentElement.setAttribute('data-wlc-bridge', '1');
    }
  });

  it('lists the whole playlist from ytInitialData + browse continuations', async () => {
    const api = setupPage({ pageSize: 4 });
    const seen = [];
    const r = await api.listAll({ onProgress: (n) => seen.push(n) });
    expect(r.complete).toBe(true);
    expect(r.pages).toBe(3);
    expect(r.source).toBe('page-data');
    expect(seen).toEqual([4, 8, 9]);
    expect(r.videos.map((v) => v.videoId)).toEqual(SAMPLE_VIDEOS.map((v) => v.id));
    expect(server.state.browseCalls).toBe(2);
    const req = fetchLog[0];
    expect(req.url).toBe(`/youtubei/v1/browse?key=${FAKE_YTCFG.INNERTUBE_API_KEY}&prettyPrint=false`);
    expect(JSON.parse(req.body)).toMatchObject({ context: { client: { clientName: 'WEB' } }, continuation: expect.any(String) });
    expect(req.headers.Authorization).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    expect(req.headers['X-Origin']).toBe(ORIGIN);
    expect(server.state.authErrors).toBe(0);
  });

  it('API videos feed the same filters as DOM rows (same matches as the page fixture)', async () => {
    const api = setupPage({ pageSize: 4 });
    const { videos } = await api.listAll();
    const s = WLC.normalizeSettings(null);
    const fromApi = WLC.selectVideos(videos, s).map((m) => m.video.title);
    const fromDom = WLC.selectVideos(WLC.parseAll(document), s).map((m) => m.video.title);
    expect(fromApi).toEqual(DEFAULT_EXPECTED);
    expect(fromApi).toEqual(fromDom);
    const live = videos.find((v) => v.videoId === 'aaaaaaaaaa8');
    expect(live).toMatchObject({ ageText: 'Streamed 4 years ago', durationSec: 1830, progress: 10, channel: 'Chill Music', position: '8', ageSource: 'api:videoInfo' });
    expect(live.ageDays).toBeCloseTo(4 * 365.25);
    const old = WLC.selectVideos(videos, WLC.normalizeSettings({ watched: false, unavailable: false, olderThan: true, olderThanValue: 1, olderThanUnit: 'years' }));
    expect(old.map((m) => m.video.videoId)).toEqual(['aaaaaaaaaa1', 'aaaaaaaaaa3', 'aaaaaaaaaa7', 'aaaaaaaaaa8']);
    const stats = WLC.computeStats(videos, { watchedThreshold: 90 });
    expect(stats.total).toBe(9);
    expect(stats.unavailable).toBe(2);
  });

  it('falls back to browse(VLWL) when the page has no Watch Later initial data (SPA navigation)', async () => {
    const api = setupPage({ initial: false, pageSize: 5 });
    const r = await api.listAll();
    expect(r.source).toBe('browse');
    expect(r.videos).toHaveLength(9);
    expect(JSON.parse(fetchLog[0].body).browseId).toBe('VLWL');
  });

  it('removeOne sends ACTION_REMOVE_VIDEO with setVideoId and checks STATUS_SUCCEEDED', async () => {
    const api = setupPage();
    const { videos } = await api.listAll();
    fetchLog.length = 0;
    const r = await api.removeOne(videos[0]);
    expect(r).toMatchObject({ ok: true, step: 'api-removed', method: 'api:setVideoId' });
    const req = fetchLog[0];
    expect(req.url).toMatch(/^\/youtubei\/v1\/browse\/edit_playlist\?key=/);
    expect(JSON.parse(req.body)).toMatchObject({ playlistId: 'WL', actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: videos[0].setVideoId }] });
    expect(req.headers).toMatchObject({ 'X-Goog-AuthUser': '0', 'X-Origin': ORIGIN, 'X-Youtube-Client-Name': '1' });
    expect(server.state.removed).toEqual(['aaaaaaaaaa1']);
    // Without a setVideoId (e.g. a plan from a Classic preview) it removes by video id.
    const r2 = await api.removeOne({ videoId: 'aaaaaaaaaa2' });
    expect(r2).toMatchObject({ ok: true, method: 'api:videoId' });
    expect(JSON.parse(fetchLog[1].body).actions).toEqual([{ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: 'aaaaaaaaaa2' }]);
  });

  it('a 200 reply without STATUS_SUCCEEDED is a failure', async () => {
    const api = setupPage({ server: { editStatus: 'STATUS_FAILED' } });
    const r = await api.removeOne({ videoId: 'aaaaaaaaaa1', setVideoId: 'X' });
    expect(r.ok).toBe(false);
  });
});

describe('Fast removal loop', () => {
  it('removes sequentially via edit_playlist and takes the rows off the page', async () => {
    const api = setupPage();
    const { videos } = await api.listAll();
    const plan = WLC.selectVideos(videos, WLC.normalizeSettings(null)).map((m) => m.video);
    const progress = [];
    const stats = await WLC.removeWithFallback(plan, fastOpts({ api, onProgress: (p) => progress.push(p.done) }));
    expect(stats).toMatchObject({ modeUsed: 'fast', done: 4, failed: 0, total: 4, aborted: false, remaining: [] });
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(server.state.removed).toEqual(['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa4', 'aaaaaaaaaa5']);
    expect(WLC.parseAll(document).map((v) => v.title)).not.toContain('Learn Rust in 10 minutes');
    expect(WLC.getItems(document)).toHaveLength(5);
    expect(server.state.editCalls).toBe(4); // one request per video, never in parallel
  });

  it('retries a failed request with backoff', async () => {
    const api = setupPage({ server: { failEdits: 2 } });
    const waits = [];
    const stats = await WLC.removeWithFallback([{ videoId: 'aaaaaaaaaa1', setVideoId: (await api.listAll()).videos[0].setVideoId }], fastOpts({ api, delayMs: 10, maxDelayMs: 1000, sleep: async (ms) => waits.push(ms) }));
    expect(stats).toMatchObject({ modeUsed: 'fast', done: 1, failed: 0 });
    expect(stats.log.map((e) => `${e.ok ? 'OK' : 'FAIL'}#${e.attempt}:${e.step}`)).toEqual(['FAIL#1:api-server-error', 'FAIL#2:api-server-error', 'OK#3:api-removed']);
    expect(waits).toEqual([20, 40]); // delay × 2^attempt
  });

  it('adds jitter to the delay between videos', async () => {
    const api = setupPage();
    const waits = [];
    const plan = (await api.listAll()).videos.slice(0, 3);
    await WLC.removeWithFallback(plan, fastOpts({ api, delayMs: 400, jitterMs: 200, random: () => 0.5, sleep: async (ms) => waits.push(ms) }));
    expect(waits).toEqual([500, 500]); // no wait after the last one
  });

  it('pauses after 8 failed videos in a row once removal had worked, and Resume continues', async () => {
    const api = setupPage({ videos: generateVideos(20, 3), pageSize: 100 });
    const { videos } = await api.listAll();
    const opts = fastOpts({ api, maxAttempts: 1 });
    await api.removeOne(videos[0]);
    // A run that starts OK, then fails 8 in a row → pause (no Classic fallback, since Fast removal worked).
    let n = 0;
    const flaky = Object.assign({}, api, { removeOne: async (v) => (n++ < 2 ? api.removeOne(v) : { ok: false, status: 'failed', step: 'api-server-error', retryable: true }) });
    const paused = await WLC.removeWithFallback(videos.slice(1, 15), Object.assign({}, opts, { api: flaky }));
    expect(paused).toMatchObject({ modeUsed: 'fast', done: 2, failed: 8, aborted: true });
    expect(paused.remaining).toHaveLength(12);
    const resumed = await WLC.removeWithFallback(paused.remaining, opts);
    expect(resumed).toMatchObject({ done: 12, failed: 0, aborted: false, remaining: [] });
    expect(server.state.videos).toHaveLength(20 - 1 - 14);
  });

  it('does not retry unauthorized requests (wrong credentials)', async () => {
    const api = setupPage({ server: { sapisid: 'a-different-cookie' } });
    const stats = await WLC.removeWithFallback([{ videoId: 'aaaaaaaaaa1', setVideoId: 'S1' }], fastOpts({ api, fallbackAfter: 0 }));
    expect(stats.log).toHaveLength(1);
    expect(stats.log[0].step).toBe('api-unauthorized');
  });

  it('keeps running in a hidden tab, pacing through the service worker instead of page timers', async () => {
    const api = setupPage({ videos: generateVideos(12, 5), pageSize: 5 });
    const { videos } = await api.listAll();
    const sleeps = [];
    const runtime = { id: 'ext', sendMessage: async (m) => sleeps.push(m) };
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      const stats = await WLC.removeWithFallback(videos, Object.assign(fastOpts({ api, delayMs: 300, jitterMs: 0 }), { sleep: undefined, runtime }));
      expect(stats).toMatchObject({ modeUsed: 'fast', done: 12, failed: 0 });
      expect(sleeps).toHaveLength(11);
      expect(sleeps.every((m) => m.type === 'wlc:sleep' && m.ms === 300)).toBe(true);
    } finally {
      delete document.visibilityState;
      if (desc) Object.defineProperty(Document.prototype, 'visibilityState', desc);
    }
  });
});

describe('fallback to Classic (page clicks)', () => {
  it('uses Classic when Fast is unavailable (no ytcfg)', async () => {
    const api = setupPage({ ytcfg: false, fakeMenu: true });
    const plan = WLC.selectVideos(WLC.parseAll(document), WLC.normalizeSettings(null)).map((m) => m.video);
    const reasons = [];
    const stats = await WLC.removeWithFallback(plan, fastOpts({ api, onFallback: (r) => reasons.push(r) }));
    expect(stats).toMatchObject({ modeUsed: 'classic', done: 4, failed: 0 });
    expect(stats.fallbackReason).toMatch(/ytcfg-missing/);
    expect(reasons).toHaveLength(1);
    expect(server.state.editCalls).toBe(0);
    expect(WLC.parseAll(document).map((v) => v.title)).toHaveLength(5);
  });

  it('switches to Classic when edit_playlist keeps failing from the start', async () => {
    const api = setupPage({ fakeMenu: true, server: { failEdits: 1000 } });
    const plan = WLC.selectVideos((await api.listAll()).videos, WLC.normalizeSettings(null)).map((m) => m.video);
    const stats = await WLC.removeWithFallback(plan, fastOpts({ api, maxAttempts: 2 }));
    expect(stats.modeUsed).toBe('fast→classic');
    expect(stats).toMatchObject({ done: 4, failed: 0, total: 4, remaining: [] });
    expect(server.state.editCalls).toBe(6); // 3 videos × 2 attempts, then fallback
    expect(stats.log.some((e) => e.mode === 'classic' && e.ok)).toBe(true);
    expect(WLC.parseAll(document).map((v) => v.title).sort()).toEqual(
      ['Cooking pasta like a pro', 'Full Course: JavaScript for beginners', 'Live concert highlights', 'Podcast episode #42 – productivity', 'Unboxing the new phone'].sort()
    );
  });

  it('Classic setting never touches the API', async () => {
    const api = setupPage({ fakeMenu: true });
    const plan = WLC.selectVideos(WLC.parseAll(document), WLC.normalizeSettings(null)).map((m) => m.video);
    const stats = await WLC.removeWithFallback(plan, fastOpts({ api, mode: 'classic' }));
    expect(stats).toMatchObject({ modeUsed: 'classic', done: 4, fallbackReason: null });
    expect(fetchLog).toHaveLength(0);
  });

  it('listVideos falls back to page parsing when Fast fails or the order differs from the page', async () => {
    let api = setupPage({ ytcfg: false });
    let r = await WLC.listVideos({ mode: 'fast', api, doc: document, loadAll: false });
    expect(r.mode).toBe('classic');
    expect(r.fallbackReason).toMatch(/ytcfg-missing/);
    expect(r.videos).toHaveLength(9);
    api = setupPage({ videos: SAMPLE_VIDEOS.slice().reverse() });
    r = await WLC.listVideos({ mode: 'fast', api, doc: document, loadAll: true, needPageOrder: true });
    expect(r.mode).toBe('classic');
    expect(r.fallbackReason).toMatch(/order differs/);
    r = await WLC.listVideos({ mode: 'fast', api, doc: document, loadAll: true, needPageOrder: false });
    expect(r.mode).toBe('fast');
    api = setupPage({ server: { failEdits: 0 }, initial: false, pageSize: 4 });
    server.handle = () => ({ status: 503, json: { error: { code: 503, status: 'UNAVAILABLE' } } });
    r = await WLC.listVideos({ mode: 'fast', api, doc: document, loadAll: true });
    expect(r.mode).toBe('classic');
    expect(r.fallbackReason).toMatch(/browse-failed: HTTP 503 UNAVAILABLE/);
  });
});

describe('privacy', () => {
  it('the debug log never contains cookies or the Authorization header', async () => {
    const api = setupPage({ server: { failEdits: 1 } });
    const { videos } = await api.listAll();
    const stats = await WLC.removeWithFallback(videos.slice(0, 2), fastOpts({ api }));
    const text = WLC.formatDebugLog({ version: 't', stats, log: stats.log, settings: WLC.normalizeSettings(null) });
    expect(text).toContain('mode=fast');
    expect(text).toContain('api-server-error');
    expect(text).not.toContain(SAPISID);
    expect(text).not.toMatch(/SAPISIDHASH|Authorization/);
    expect(fetchLog.some((r) => r.headers.Authorization)).toBe(true); // it was sent to youtube.com, just never logged
  });

  it('redactSecrets scrubs anything credential-like', () => {
    const s = WLC.redactSecrets('x Authorization: SAPISIDHASH 1_abc y\nSAPISID=secret; __Secure-3PAPISID=s3; SAPISIDHASH 123_def');
    expect(s).not.toMatch(/secret|s3|abc|def/);
  });
});

describe('settings + panel', () => {
  it('removalMode defaults to fast and normalizes', () => {
    expect(WLC.normalizeSettings(null).removalMode).toBe('fast');
    expect(WLC.normalizeSettings({ removalMode: 'classic' }).removalMode).toBe('classic');
    expect(WLC.normalizeSettings({ removalMode: 'turbo' }).removalMode).toBe('fast');
  });

  beforeEach(() => {
    document.getElementById(WLC.PANEL_HOST_ID)?.remove();
  });

  it('panel offers the mode setting, previews and removes via Fast, and Classic on request', async () => {
    const api = setupPage({ pageSize: 4, fakeMenu: true });
    expect(api).toBeTruthy();
    const panel = WLC.createPanel(document);
    const $ = (s) => panel.shadow.querySelector(s);
    await panel.reloadSettings();
    const sel = $('[data-k="removalMode"]');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Fast (works in background)', 'Classic (page clicks)']);
    expect(sel.value).toBe('fast');
    expect($('.mode-note').textContent).toMatch(/background/);
    panel.show();
    await panel.preview();
    expect($('.status').textContent).toMatch(/Dry run: 4 of 9 videos match.*\[Fast\]/);
    expect(server.state.browseCalls).toBe(2);
    expect([...panel.shadow.querySelectorAll('.list .item .t')].map((e) => e.textContent)).toEqual(DEFAULT_EXPECTED);
    panel.state.settings.delayMs = 100;
    await panel.remove(); // arm
    await panel.remove(); // confirm
    expect($('.status').textContent).toMatch(/^Done: removed 4 of 4\. \[Fast\]/);
    expect(server.state.removed).toHaveLength(4);
    expect(WLC.getItems(document)).toHaveLength(5);

    sel.value = 'classic';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect($('.mode-note').textContent).toMatch(/Keep this tab visible/);
    const calls = server.state.browseCalls;
    await panel.preview();
    expect($('.status').textContent).toMatch(/\[Classic\]/);
    expect(server.state.browseCalls).toBe(calls);
  });

  it('panel status says when it fell back to Classic', async () => {
    setupPage({ ytcfg: false });
    const panel = WLC.createPanel(document);
    await panel.reloadSettings();
    panel.shadow.querySelector('[data-k="loadAllFirst"]').checked = false;
    await panel.preview();
    expect(panel.shadow.querySelector('.status').textContent).toMatch(/\[Classic: Fast mode unavailable — fast mode unavailable \(ytcfg-missing\)\]/);
  });
});
