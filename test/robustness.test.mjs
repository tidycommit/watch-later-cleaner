import { describe, it, expect } from 'vitest';
import { loadWLC, loadFixture } from './helpers.mjs';

const WLC = loadWLC();
const opts = { delayMs: 5, maxDelayMs: 40, menuTimeout: 400, removeTimeout: 600, scrollSettleMs: 0, notFoundWaitMs: 20 };
const ids = () => WLC.parseAll(document).map((v) => v.videoId);
const ALL = ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3', 'aaaaaaaaaa4', 'aaaaaaaaaa5', 'aaaaaaaaaa6', 'aaaaaaaaaa7', 'aaaaaaaaaa8', 'aaaaaaaaaa9'];
const plan = (wanted) => WLC.parseAll(document).filter((v) => wanted.includes(v.videoId));
const run = (videos, extra = {}) => WLC.removeVideos(videos, Object.assign({ doc: document }, opts, extra));

describe('YouTube re-uses row nodes after removals (DOM recycling)', () => {
  it('removes exactly the planned videos, verified by videoId — not by node presence', async () => {
    loadFixture({ fakeMenu: true, fake: { recycle: true } });
    const target = ['aaaaaaaaaa2', 'aaaaaaaaaa3', 'aaaaaaaaaa5', 'aaaaaaaaaa9'];
    const videos = plan(target);
    const firstNode = videos[0].el;
    const stats = await run(videos);
    expect(stats).toMatchObject({ done: 4, failed: 0, skipped: 0 });
    expect(window.__wlcFakeRemoved).toEqual(target); // never clicked the wrong row
    expect(ids()).toEqual(ALL.filter((id) => !target.includes(id)));
    expect(firstNode.isConnected).toBe(true); // the node survived, now showing a different video
  });

  it('old behaviour check: the stale node from preview now shows another video', async () => {
    loadFixture({ fakeMenu: true, fake: { recycle: true } });
    const videos = plan(['aaaaaaaaaa1', 'aaaaaaaaaa2']);
    await run(videos.slice(0, 1));
    expect(WLC.parseItem(videos[0].el).videoId).toBe('aaaaaaaaaa2'); // stale reference ≠ planned video
    const stats = await run(videos.slice(1));
    expect(stats.done).toBe(1);
    expect(window.__wlcFakeRemoved).toEqual(['aaaaaaaaaa1', 'aaaaaaaaaa2']);
  });

  it('plans hold ids only (no DOM positions)', () => {
    loadFixture();
    const entry = WLC.toPlanEntry(WLC.parseAll(document)[0]);
    expect(entry).toEqual({ videoId: 'aaaaaaaaaa1', title: 'Learn Rust in 10 minutes', channel: 'Tech Channel', ageText: '2 years ago' });
  });
});

describe('lazy rows, slow menus, slow rows, toasts', () => {
  it('scrolls a lazily-rendered row into view before using its ⋮ button', async () => {
    loadFixture({ fakeMenu: true });
    const rows = WLC.getItems(document);
    for (const r of rows.slice(5)) {
      r.querySelector('#menu').remove();
      r.setAttribute('data-lazy', '');
    }
    const stats = await run(plan(['aaaaaaaaaa7', 'aaaaaaaaaa9']));
    expect(stats.done).toBe(2);
    expect(window.__wlcFakeRemoved).toEqual(['aaaaaaaaaa7', 'aaaaaaaaaa9']);
  });

  it('waits for a slow-opening menu', async () => {
    loadFixture({ fakeMenu: true, fake: { menuDelay: 250 } });
    const stats = await run(plan(['aaaaaaaaaa1', 'aaaaaaaaaa2']));
    expect(stats).toMatchObject({ done: 2, failed: 0 });
  });

  it('counts a removal confirmed by the YouTube toast even if the row lags behind', async () => {
    loadFixture({ fakeMenu: true, fake: { toast: true, rowLagMs: 1500 } });
    const stats = await run(plan(['aaaaaaaaaa1']), { removeTimeout: 300 });
    expect(stats).toMatchObject({ done: 1, failed: 0 });
    expect(stats.log[0].step).toMatch(/^removed/);
  });

  it('a toast left over from the previous removal is NOT taken as success', async () => {
    loadFixture({ fakeMenu: true, fake: { toast: true } });
    expect((await run(plan(['aaaaaaaaaa1']))).done).toBe(1); // toast now visible
    window.__wlcFake.noRemove = true;
    const stats = await run(plan(['aaaaaaaaaa2']), { maxAttempts: 1, removeTimeout: 200 });
    expect(stats).toMatchObject({ done: 0, failed: 1 });
    expect(stats.steps).toEqual({ 'still-present-after-click': 1 });
  });

  it('treats a video that is no longer on the page as already gone (not a failure)', async () => {
    loadFixture({ fakeMenu: true });
    const videos = plan(['aaaaaaaaaa1', 'aaaaaaaaaa2']);
    videos[0].el.remove(); // e.g. removed in another tab
    const stats = await run(videos);
    expect(stats).toMatchObject({ done: 1, skipped: 1, failed: 0 });
    expect(stats.log[0].step).toBe('not-found');
  });
});

describe('retries, throttling and adaptive pacing', () => {
  it('retries the same video when the menu intermittently fails to open', async () => {
    loadFixture({ fakeMenu: true, fake: { flaky: { aaaaaaaaaa2: 2 } } });
    const stats = await run(plan(['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3']), { menuTimeout: 100 });
    expect(stats).toMatchObject({ done: 3, failed: 0 });
    const attempts = stats.log.filter((e) => e.videoId === 'aaaaaaaaaa2');
    expect(attempts.map((e) => e.step)).toEqual(['menu-did-not-open', 'menu-did-not-open', 'removed']);
  });

  it('survives a burst of throttling: slows down instead of aborting, then finishes', async () => {
    loadFixture({ fakeMenu: true, fake: { throttle: { after: 2, fail: 7 } } });
    const delays = [];
    const stats = await run(plan(ALL), { menuTimeout: 60, onProgress: (p) => delays.push(p.delayMs) });
    expect(stats).toMatchObject({ aborted: false });
    expect(stats.done + stats.failed).toBe(9);
    expect(stats.done).toBeGreaterThanOrEqual(7);
    expect(Math.max(...delays)).toBeGreaterThan(opts.delayMs); // backed off
    expect(delays[delays.length - 1]).toBeLessThan(Math.max(...delays)); // and recovered
  });

  it('Resume continues with failed + unattempted videos without a new preview', async () => {
    loadFixture({ fakeMenu: true, fake: { throttle: { after: 1, fail: 1000 } } });
    const first = await run(plan(ALL), { menuTimeout: 30, maxAttempts: 1, maxConsecutiveFailures: 3 });
    expect(first).toMatchObject({ done: 1, failed: 3, aborted: true });
    expect(first.remaining).toHaveLength(8);
    window.__wlcFake.throttle = null; // throttling over
    const second = await run(first.remaining);
    expect(second).toMatchObject({ done: 8, failed: 0, remaining: [] });
    expect(WLC.getItems(document)).toHaveLength(0);
  });

  it('Stop returns the not-yet-processed videos for Resume', async () => {
    loadFixture({ fakeMenu: true });
    let stop = false;
    const stats = await run(plan(ALL), { shouldStop: () => stop, onProgress: (p) => (stop = p.done >= 3) });
    expect(stats).toMatchObject({ done: 3, stopped: true });
    expect(stats.remaining.map((v) => v.videoId)).toEqual(ALL.slice(3));
  });
});

describe('debug log', () => {
  it('records each attempt with the failing step and formats a report', async () => {
    loadFixture({ fakeMenu: true, fake: { flaky: { aaaaaaaaaa1: 99 } } });
    const stats = await run(plan(['aaaaaaaaaa1', 'aaaaaaaaaa2']), { menuTimeout: 30 });
    expect(stats.failures).toEqual([{ videoId: 'aaaaaaaaaa1', title: 'Learn Rust in 10 minutes', step: 'menu-did-not-open', detail: '' }]);
    const text = WLC.formatDebugLog({ version: '1.0.0', settings: { delayMs: 400 }, stats, itemCount: 8 });
    expect(text).toContain('failure steps: {"menu-did-not-open":1}');
    expect(text).toContain('aaaaaaaaaa1  menu-did-not-open');
    expect(text).toMatch(/OK {3}#1 aaaaaaaaaa2 removed/);
  });

  it('records the menu labels when the remove entry cannot be identified', async () => {
    loadFixture({ fakeMenu: true, mode: 'position' });
    const stats = await run(plan(['aaaaaaaaaa1']), { fallbackPosition: 0, maxAttempts: 1 });
    expect(stats.failures[0]).toMatchObject({ step: 'remove-item-not-found' });
    expect(stats.failures[0].detail).toContain('Zzq alpha | Zzq beta');
  });
});

describe('panel: Resume and Copy debug log', () => {
  it('offers Resume after a pause and copies a debug log', async () => {
    loadFixture({ fakeMenu: true, fake: { throttle: { after: 1, fail: 1000 } } });
    const panel = WLC.createPanel(document);
    const $ = (s) => panel.shadow.querySelector(s);
    $('[data-k="loadAllFirst"]').checked = false;
    $('[data-k="removeAll"]').checked = true;
    await panel.preview();
    panel.state.settings.delayMs = 5;
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => (copied = t) }, configurable: true });
    // speed: shorten waits through the shared defaults
    const orig = WLC.removeVideos;
    WLC.removeVideos = (v, o) => orig(v, Object.assign({}, o, { menuTimeout: 30, maxAttempts: 1, maxDelayMs: 20, scrollSettleMs: 0 }));
    try {
      await panel.remove(); // arm
      const stats = await panel.remove(); // confirm
      expect(stats).toMatchObject({ done: 1, aborted: true });
      expect($('.status').textContent).toContain('Paused');
      expect($('.status').textContent).toContain('menu-did-not-open ×8');
      expect($('.btn-resume').hidden).toBe(false);
      expect($('.btn-resume').textContent).toBe('Resume (8 left)');
      await panel.copyDebugLog();
      expect(copied).toContain('Watch Later Cleaner debug log');
      expect(copied).toContain('menu-did-not-open');
      window.__wlcFake.throttle = null;
      const resumed = await panel.resume();
      expect(resumed).toMatchObject({ done: 8, failed: 0 });
      expect($('.btn-resume').hidden).toBe(true);
      expect(WLC.getItems(document)).toHaveLength(0);
    } finally {
      WLC.removeVideos = orig;
      panel.destroy();
    }
  });
});
