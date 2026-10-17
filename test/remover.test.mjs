import { describe, it, expect } from 'vitest';
import { loadWLC, loadFixture } from './helpers.mjs';

const WLC = loadWLC();
const opts = { delayMs: 5, maxDelayMs: 40, menuTimeout: 400, removeTimeout: 600, scrollSettleMs: 0, notFoundWaitMs: 20 };

async function removeDefaultMatches(mode) {
  loadFixture({ fakeMenu: true, mode });
  const plan = WLC.selectVideos(WLC.parseAll(document), WLC.normalizeSettings(null)).map((m) => m.video);
  const stats = await WLC.removeVideos(plan, Object.assign({ doc: document }, opts));
  return { stats, left: WLC.parseAll(document).map((v) => v.title) };
}

const KEPT = [
  'Cooking pasta like a pro',
  'Unboxing the new phone',
  'Full Course: JavaScript for beginners',
  'Live concert highlights',
  'Podcast episode #42 – productivity',
];

describe('findRemoveMenuItem', () => {
  const mk = (labels) =>
    labels.map((l) => {
      const el = document.createElement('ytd-menu-service-item-renderer');
      el.textContent = l;
      return el;
    });

  it('matches English text', () => {
    const r = WLC.findRemoveMenuItem(mk(['Add to queue', 'Save to playlist', 'Remove from Watch later', 'Share']));
    expect(r.method).toBe('text');
    expect(r.item.textContent).toBe('Remove from Watch later');
  });

  it('matches localized text', () => {
    expect(WLC.findRemoveMenuItem(mk(['Ajouter', 'Enregistrer', 'Retirer de À regarder plus tard', 'Partager'])).method).toBe('localized-text');
    expect(WLC.findRemoveMenuItem(mk(['キューに追加', '再生リストに保存', '[後で見る]から削除', '共有'])).item.textContent).toContain('削除');
  });

  it('uses positional fallback only on a menu of the expected shape, and can be disabled', () => {
    const items = mk(['a1', 'b2', 'c3', 'd4', 'e5']);
    expect(WLC.findRemoveMenuItem(items).item.textContent).toBe('c3');
    expect(WLC.findRemoveMenuItem(items, { fallbackPosition: 0 })).toBeNull();
    expect(WLC.findRemoveMenuItem(mk(['a1', 'b2']))).toBeNull();
  });
});

describe('removeVideos via simulated ⋮ menu', () => {
  it('English menu (text match)', async () => {
    const { stats, left } = await removeDefaultMatches('en');
    expect(stats).toMatchObject({ done: 4, failed: 0, total: 4 });
    expect(left).toEqual(KEPT);
    expect(window.__wlcFakeMenuLog.every((l) => l === 'Remove from Watch later')).toBe(true);
  });

  it('German menu (localized text)', async () => {
    const { stats, left } = await removeDefaultMatches('de');
    expect(stats.done).toBe(4);
    expect(left).toEqual(KEPT);
  });

  it('unknown language with trash icon (icon fallback)', async () => {
    const { stats, left } = await removeDefaultMatches('icon');
    expect(stats.done).toBe(4);
    expect(left).toEqual(KEPT);
  });

  it('unknown language without icons (position fallback)', async () => {
    const { stats, left } = await removeDefaultMatches('position');
    expect(stats.done).toBe(4);
    expect(left).toEqual(KEPT);
  });

  it('Stop halts before the next item', async () => {
    loadFixture({ fakeMenu: true });
    const plan = WLC.parseAll(document);
    let stop = false;
    const stats = await WLC.removeVideos(plan, Object.assign({ doc: document, shouldStop: () => stop, onProgress: (p) => (stop = p.done >= 2) }, opts));
    expect(stats).toMatchObject({ done: 2, stopped: true });
    expect(WLC.getItems(document)).toHaveLength(7);
  });

  it('pauses only after 8 consecutive failed videos (with retries) and returns the remaining list', async () => {
    loadFixture(); // no fake menu installed → clicking ⋮ never opens anything
    const plan = WLC.parseAll(document);
    const stats = await WLC.removeVideos(plan, Object.assign({ doc: document }, opts, { menuTimeout: 30, maxAttempts: 2 }));
    expect(stats).toMatchObject({ done: 0, failed: 8, aborted: true });
    expect(stats.steps).toEqual({ 'menu-did-not-open': 8 });
    expect(stats.log).toHaveLength(16); // 2 attempts per video
    expect(stats.remaining.map((v) => v.videoId)).toEqual(plan.map((v) => v.videoId)); // 8 failed + 1 not attempted
    expect(WLC.getItems(document)).toHaveLength(9);
  });

  it('loadAll stops when the item count is stable', async () => {
    loadFixture();
    const n = await WLC.loadAll({ doc: document, settleMs: 5 });
    expect(n).toBe(9);
  });
});

describe('panel', () => {
  it('renders, previews (dry run) and removes only after confirm', async () => {
    loadFixture({ fakeMenu: true });
    const panel = WLC.createPanel(document);
    const $ = (s) => panel.shadow.querySelector(s);
    panel.show();
    $('[data-k="loadAllFirst"]').checked = false;
    const plan = await panel.preview();
    expect(plan.map((m) => m.video.videoId)).toEqual(['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa4', 'aaaaaaaaaa5']);
    expect(panel.shadow.querySelectorAll('.list .item')).toHaveLength(4);
    expect($('.status').textContent).toContain('4 of 9');
    // keep the first match
    const first = $('.list input[data-i="0"]');
    first.checked = false;
    first.dispatchEvent(new Event('change', { bubbles: true }));
    expect($('.btn-remove').textContent).toBe('Remove 3…');
    panel.state.settings.delayMs = 5;
    await panel.remove(); // first click only arms
    expect(WLC.getItems(document)).toHaveLength(9);
    expect($('.btn-remove').textContent).toBe('Confirm: remove 3');
    const stats = await panel.remove();
    expect(stats.done).toBe(3);
    expect(WLC.getItems(document)).toHaveLength(6);
    expect(WLC.parseAll(document)[0].title).toBe('Learn Rust in 10 minutes');
    panel.destroy();
  });
});
