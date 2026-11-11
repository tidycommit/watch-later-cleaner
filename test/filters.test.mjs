import { describe, it, expect, beforeAll } from 'vitest';
import { loadWLC, loadFixture } from './helpers.mjs';

const WLC = loadWLC();
const S = (o) => WLC.normalizeSettings(Object.assign({ watched: false, unavailable: false }, o));
let videos;
const titles = (settings) => WLC.selectVideos(videos, settings).map((m) => m.video.title);

beforeAll(() => {
  loadFixture();
  videos = WLC.parseAll(document);
});

describe('settings', () => {
  it('fills defaults and clamps values', () => {
    const s = WLC.normalizeSettings({ watchedThreshold: 500, delayMs: 'x', olderThanUnit: 'eons' });
    expect(s.watchedThreshold).toBe(100);
    expect(s.delayMs).toBe(400);
    expect(s.olderThanUnit).toBe('years');
    expect(WLC.normalizeSettings(null)).toMatchObject({ watched: true, watchedThreshold: 90, unavailable: true, delayMs: 400 });
  });

  it('parseKeywords', () => {
    expect(WLC.parseKeywords(' Foo, bar ,,BAZ ')).toEqual(['foo', 'bar', 'baz']);
    expect(WLC.parseKeywords('')).toEqual([]);
  });
});

describe('selectVideos on fixture', () => {
  it('default settings: watched >= 90% + unavailable', () => {
    expect(titles(WLC.normalizeSettings(null))).toEqual([
      'Learn Rust in 10 minutes',
      'Lo-fi beats to study to',
      '[Deleted video]',
      '[Private video]',
    ]);
  });

  it('respects watched threshold', () => {
    expect(titles(S({ watched: true, watchedThreshold: 89 }))).toHaveLength(3);
    expect(titles(S({ watched: true, watchedThreshold: 100 }))).toEqual(['Learn Rust in 10 minutes']);
  });

  it('published at least N ago (inclusive: "1 year ago" matches 1 year)', () => {
    expect(titles(S({ olderThan: true, olderThanValue: 1, olderThanUnit: 'years' }))).toEqual([
      'Learn Rust in 10 minutes',
      'Cooking pasta like a pro',
      'Full Course: JavaScript for beginners', // "1 year ago" — was wrongly excluded before (strict >)
      'Live concert highlights',
    ]);
    expect(titles(S({ olderThan: true, olderThanValue: 12, olderThanUnit: 'months' }))).toHaveLength(4);
    expect(titles(S({ olderThan: true, olderThanValue: 2, olderThanUnit: 'years' }))).toEqual([
      'Learn Rust in 10 minutes',
      'Cooking pasta like a pro',
      'Live concert highlights',
    ]);
    expect(titles(S({ olderThan: true, olderThanValue: 10, olderThanUnit: 'days' }))).toHaveLength(6);
  });

  it('channel and title keyword filters', () => {
    expect(titles(S({ channelFilter: true, channelKeywords: 'tech channel' }))).toEqual([
      'Learn Rust in 10 minutes',
      'Full Course: JavaScript for beginners',
    ]);
    expect(titles(S({ titleFilter: true, titleKeywords: 'podcast, UNBOX' }))).toEqual([
      'Unboxing the new phone',
      'Podcast episode #42 – productivity',
    ]);
    // enabled filter with no keywords matches nothing
    expect(titles(S({ titleFilter: true, titleKeywords: ' , ' }))).toEqual([]);
  });

  it('remove all overrides other criteria', () => {
    const r = WLC.selectVideos(videos, S({ removeAll: true }));
    expect(r).toHaveLength(9);
    expect(r[0].reasons).toEqual(['all']);
  });

  it('no criteria selected matches nothing', () => {
    expect(titles(S({}))).toEqual([]);
    expect(WLC.hasCriteria(S({}))).toBe(false);
  });

  it('reports all matching reasons', () => {
    const r = WLC.selectVideos(videos, S({ watched: true, olderThan: true, olderThanValue: 1, channelFilter: true, channelKeywords: 'tech' }));
    expect(r[0].reasons).toEqual(['watched 100%', 'published "2 years ago" → ~731 days ≥ 1 year (~365 days)', 'channel "tech"']);
  });
});

describe('duration, Shorts, duplicates, allowlist', () => {
  const vid = (over) => Object.assign({ title: 't', channel: 'c', progress: 0, unavailable: false, ageDays: 10, ageText: '10 days ago', durationSec: 120, videoId: 'v' }, over);

  it('normalizes the new settings and leaves them off by default', () => {
    expect(WLC.normalizeSettings(null)).toMatchObject({
      shorts: false,
      durationFilter: false,
      duplicates: false,
      durationCmp: 'shorter',
      durationUnit: 'minutes',
      durationValue: 10,
      keepChannels: '',
      keepTitles: '',
    });
    const s = WLC.normalizeSettings({ durationCmp: 'nope', durationUnit: 'hours', durationValue: 0, shorts: 1, keepChannels: 12 });
    expect(s.durationCmp).toBe('shorter');
    expect(s.durationUnit).toBe('minutes');
    expect(s.durationValue).toBe(1);
    expect(s.shorts).toBe(true);
    expect(s.keepChannels).toBe('12');
  });

  it('Shorts matches 59s and 60s and not 61s or a null duration', () => {
    const s = S({ shorts: true });
    expect(WLC.matchReasons(vid({ durationSec: 59 }), s)).toEqual(['duration 0:59 ≤ 1:00 (Shorts)']);
    expect(WLC.matchReasons(vid({ durationSec: 60 }), s)).toEqual(['duration 1:00 ≤ 1:00 (Shorts)']);
    expect(WLC.matchReasons(vid({ durationSec: 61 }), s)).toEqual([]);
    expect(WLC.matchReasons(vid({ durationSec: null }), s)).toEqual([]);
    expect(WLC.keepReason(vid({ durationSec: null }), s)).toBe('kept: duration unknown (never matched by the duration filter)');
    expect(WLC.reasonKey('duration 0:45 ≤ 1:00 (Shorts)')).toBe('Shorts');
  });

  it('shorter and longer are inclusive and skip a null duration', () => {
    const shorter = S({ durationFilter: true, durationCmp: 'shorter', durationValue: 1, durationUnit: 'minutes' });
    expect(WLC.matchReasons(vid({ durationSec: 60 }), shorter)).toEqual(['duration 1:00 ≤ 1:00']);
    expect(WLC.matchReasons(vid({ durationSec: 61 }), shorter)).toEqual([]);
    const longer = S({ durationFilter: true, durationCmp: 'longer', durationValue: 90, durationUnit: 'seconds' });
    expect(WLC.matchReasons(vid({ durationSec: 90 }), longer)).toEqual(['duration 1:30 ≥ 1:30']);
    expect(WLC.matchReasons(vid({ durationSec: 89 }), longer)).toEqual([]);
    expect(WLC.matchReasons(vid({ durationSec: null }), longer)).toEqual([]);
    expect(WLC.selectVideos([vid({ durationSec: null }), vid({ durationSec: 30 })], shorter).map((m) => m.video.durationSec)).toEqual([30]);
  });

  it('composes with match any and match all', () => {
    const any = S({ shorts: true, watched: true, watchedThreshold: 90, matchMode: 'any' });
    expect(WLC.matchReasons(vid({ durationSec: 30, progress: 0 }), any)).toEqual(['duration 0:30 ≤ 1:00 (Shorts)']);
    expect(WLC.matchReasons(vid({ durationSec: 120, progress: 95 }), any)).toEqual(['watched 95%']);
    const all = S({ shorts: true, watched: true, watchedThreshold: 90, matchMode: 'all' });
    expect(WLC.matchReasons(vid({ durationSec: 30, progress: 95 }), all)).toEqual(['watched 95%', 'duration 0:30 ≤ 1:00 (Shorts)']);
    expect(WLC.matchReasons(vid({ durationSec: 30, progress: 10 }), all)).toEqual([]);
    expect(WLC.matchReasons(vid({ durationSec: null, progress: 100 }), all)).toEqual([]);
  });

  it('duplicates keep the first videoId and name the earlier position', () => {
    const videos = ['A', 'B', 'A', 'C', 'A'].map((id, i) => vid({ videoId: id, title: `${id}${i}`, durationSec: 10 }));
    const picked = WLC.selectVideos(videos, S({ duplicates: true }));
    expect(picked.map((m) => m.video.title)).toEqual(['A2', 'A4']);
    expect(picked.map((m) => m.reasons)).toEqual([['duplicate of earlier #1'], ['duplicate of earlier #1']]);
    expect(WLC.reasonKey(picked[0].reasons[0])).toBe('Duplicates');
  });

  it('duplicates work in match-all together with watched, in list order', () => {
    const videos = [
      vid({ videoId: 'A', progress: 100, title: 'first' }),
      vid({ videoId: 'A', progress: 100, title: 'second watched' }),
      vid({ videoId: 'A', progress: 0, title: 'third unwatched' }),
    ];
    const picked = WLC.selectVideos(videos, S({ duplicates: true, watched: true, watchedThreshold: 90, matchMode: 'all' }));
    expect(picked.map((m) => m.video.title)).toEqual(['second watched']);
    expect(picked[0].reasons).toEqual(['watched 100%', 'duplicate of earlier #1']);
  });

  it('allowlist drops matches; an empty allowlist does not', () => {
    const rows = [
      vid({ videoId: '1', title: 'Learn Rust', channel: 'Tech Channel', progress: 100 }),
      vid({ videoId: '2', title: 'Other', channel: 'Someone', progress: 100 }),
    ];
    const watched = S({ watched: true, watchedThreshold: 90 });
    expect(WLC.selectVideos(rows, watched)).toHaveLength(2);
    expect(WLC.selectVideos(rows, watched).excludedByAllowlist || 0).toBe(0);
    const kept = S({ watched: true, watchedThreshold: 90, keepChannels: 'tech channel' });
    const picked = WLC.selectVideos(rows, kept);
    expect(picked.map((m) => m.video.title)).toEqual(['Other']);
    expect(picked.excludedByAllowlist).toBe(1);
    expect(WLC.keepReason(rows[0], kept)).toBe('kept: allowlisted channel "tech channel"');
    const titled = S({ watched: true, watchedThreshold: 90, keepTitles: 'Rust' });
    expect(WLC.selectVideos(rows, titled).map((m) => m.video.title)).toEqual(['Other']);
    expect(WLC.keepReason(rows[0], titled)).toBe('kept: allowlisted title "rust"');
    expect(WLC.hasCriteria(S({ keepChannels: 'tech' }))).toBe(false);
  });

  it('panel round-trips the new fields and keeps an allowlisted channel out of the plan', async () => {
    loadFixture();
    document.getElementById(WLC.PANEL_HOST_ID)?.remove();
    const panel = WLC.createPanel(document);
    const $ = (sel) => panel.shadow.querySelector(sel);
    await panel.reloadSettings();
    const set = (k, val) => {
      const el = $(`[data-k="${k}"]`);
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('shorts', true);
    set('duplicates', true);
    set('durationFilter', true);
    set('durationCmp', 'shorter');
    set('durationValue', '1');
    set('durationUnit', 'minutes');
    set('keepChannels', 'Tech Channel');
    set('loadAllFirst', false);
    set('showKept', true);
    expect(panel.state.settings).toMatchObject({ shorts: true, duplicates: true, durationFilter: true, durationValue: 1, keepChannels: 'Tech Channel' });
    const plan = await panel.preview();
    expect(plan.map((m) => m.video.title)).toEqual(['Lo-fi beats to study to', '[Deleted video]', '[Private video]']);
    expect(plan.excludedByAllowlist).toBe(1);
    expect($('.status').textContent).toMatch(/1 matched but kept by the allowlist/);
    expect($('.allow-note').textContent).toBe('Excluded by allowlist: 1');
    const rust = [...panel.shadow.querySelectorAll('.list .item.kept')].find((r) => r.textContent.includes('Learn Rust'));
    expect(rust.textContent).toContain('kept: allowlisted channel "tech channel"');
    panel.destroy();
  });
});
