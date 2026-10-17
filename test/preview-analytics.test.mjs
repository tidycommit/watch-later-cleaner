import { describe, it, expect } from 'vitest';
import { loadWLC, loadFixture } from './helpers.mjs';

const WLC = loadWLC();
const S = (o) => WLC.normalizeSettings(Object.assign({ watched: false, unavailable: false }, o));
const DUR = { a1: 602, a2: 3723, a3: 1125, a6: 299, a7: 9070, a8: 2700, a9: 4530 };
const TOTAL = Object.values(DUR).reduce((x, y) => x + y, 0);

describe('computePreviewStats', () => {
  it('matched vs total, freed hours, after-removal totals, per-criterion counts', () => {
    loadFixture();
    const all = WLC.parseAll(document);
    const sel = WLC.selectVideos(all, WLC.normalizeSettings(null));
    const ps = WLC.computePreviewStats(all, sel);
    expect(ps).toMatchObject({ total: 9, count: 4, freedSec: DUR.a1 + DUR.a2 });
    expect(ps.pct).toBeCloseTo(4 / 9);
    expect(ps.before).toEqual({ videos: 9, durationSec: TOTAL });
    expect(ps.after).toEqual({ videos: 5, durationSec: TOTAL - DUR.a1 - DUR.a2 });
    expect(ps.criteria).toEqual({ Watched: 2, Unavailable: 2 });
    expect(ps.overlap).toEqual({ single: 4, multi: 0, combos: [] });
    expect(ps.matched.watch).toEqual({ watched: 2, partial: 0, unwatched: 0 });
    expect(ps.matched.unavailable).toBe(2);
    expect(ps.matched.topChannelsByCount.map((c) => c.channel)).toEqual(['Chill Music', 'Tech Channel']);
    expect(ps.addedRange).toBeNull();
  });

  it('overlap when Match = any, and added-rank range', () => {
    loadFixture();
    const all = WLC.parseAll(document);
    WLC.annotateAddedOrder(all, 'newest');
    const s = S({ watched: true, olderThan: true, olderThanValue: 1, olderThanUnit: 'years', addedOrder: true, addedN: 3 });
    const sel = WLC.selectVideos(all, s, { addedOrder: { available: true, direction: 'newest', incomplete: false } });
    const ps = WLC.computePreviewStats(all, sel);
    expect(ps.criteria).toEqual({ Watched: 2, 'Published age': 4, 'Added order': 3 });
    expect(ps.overlap.multi).toBe(3); // Learn Rust (watched+age), Full Course & Live concert (age+added)
    expect(ps.overlap.combos).toEqual([
      { combo: 'Published age + Added order', count: 2 },
      { combo: 'Watched + Published age', count: 1 },
    ]);
    expect(ps.addedRange).toEqual({ min: 1, max: 9, total: 9 });
  });

  it('reasonKey maps every reason type', () => {
    expect(['all', 'unavailable', 'watched 95%', 'published "x" → ~1 day ≥ 1 day', 'channel "a"', 'title "b"', 'oldest 5 added (added #1)', 'below position #3 (#4)', 'positions #1–end (#2)'].map(WLC.reasonKey)).toEqual([
      'Remove all', 'Unavailable', 'Watched', 'Published age', 'Channel', 'Title', 'Added order', 'Added order', 'Added order',
    ]);
  });

  it('is fast for 2,700+ entries', () => {
    const all = Array.from({ length: 2800 }, (_, i) => ({ videoId: `v${i}`, title: `t${i}`, channel: `ch${i % 40}`, progress: i % 100, unavailable: false, ageDays: i, durationSec: 60 + i, addedRank: 2800 - i, addedTotal: 2800 }));
    const sel = all.filter((_, i) => i % 2).map((video) => ({ video, reasons: ['watched 99%', 'published x'] }));
    const t0 = performance.now();
    const base = WLC.computeStats(all);
    for (let k = 0; k < 10; k++) WLC.computePreviewStats(all, sel, { base });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('panel preview analytics', () => {
  async function setup() {
    loadFixture();
    const panel = WLC.createPanel(document);
    const $ = (s) => panel.shadow.querySelector(s);
    await panel.reloadSettings();
    $('[data-k="loadAllFirst"]').checked = false;
    panel.show();
    await panel.preview();
    return { panel, $ };
  }
  const card0 = ($) => $('.pv .card .v').textContent;

  it('renders after Preview and updates live on untick', async () => {
    const { panel, $ } = await setup();
    expect($('details.pv').hidden).toBe(false);
    expect(card0($)).toBe('4 / 9');
    const secs = [...panel.shadow.querySelectorAll('.pv .sec h4')].map((h) => h.textContent);
    expect(secs).toEqual(['Matched by criterion', 'Watch progress', 'Published (age)', 'Duration', 'Top channels (click to keep)']);
    expect($('.pv .ba').textContent).toContain('Videos after');
    const box = $('.list input[data-i="0"]');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    expect(card0($)).toBe('3 / 9');
    expect(panel.state.previewStats.after.videos).toBe(6);
    expect(panel.state.previewStats.freedSec).toBe(DUR.a2);
    panel.destroy();
  });

  it('channel click keeps (unticks) all of that channel; Tick all restores; export uses the selection', async () => {
    const { panel, $ } = await setup();
    $('.pv [data-exclude-channel="Chill Music"]').click();
    expect($('.list input[data-i="1"]').checked).toBe(false);
    expect(card0($)).toBe('3 / 9');
    expect($('.btn-remove').textContent).toBe('Remove 3…');
    expect($('.status').textContent).toContain('Keeping 1 video(s) from “Chill Music”');
    globalThis.URL.createObjectURL = () => 'blob:x';
    globalThis.URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    expect(panel.exportPreview('csv').trim().split('\r\n')).toHaveLength(4);
    expect(JSON.parse(panel.exportPreview('json')).videos.map((v) => v.videoId)).toEqual(['aaaaaaaaaa1', 'aaaaaaaaaa4', 'aaaaaaaaaa5']);
    panel.tickAll();
    expect(card0($)).toBe('4 / 9');
    // a settings change invalidates the preview and hides its analytics
    const w = $('[data-k="watched"]');
    w.checked = false;
    w.dispatchEvent(new Event('change', { bubbles: true }));
    expect($('details.pv').hidden).toBe(true);
    panel.destroy();
  });
});
