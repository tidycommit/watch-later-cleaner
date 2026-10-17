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

  it('older than N (published)', () => {
    expect(titles(S({ olderThan: true, olderThanValue: 1, olderThanUnit: 'years' }))).toEqual([
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
    expect(r[0].reasons).toEqual(['watched 100%', 'older (2 years ago)', 'channel "tech"']);
  });
});
