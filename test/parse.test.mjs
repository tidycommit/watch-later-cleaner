import { describe, it, expect, beforeEach } from 'vitest';
import { loadWLC, loadFixture } from './helpers.mjs';

const WLC = loadWLC();

describe('helpers', () => {
  it('parsePercent', () => {
    expect(WLC.parsePercent('63%')).toBe(63);
    expect(WLC.parsePercent('width: 12.5%;')).toBe(12.5);
    expect(WLC.parsePercent('150%')).toBe(100);
    expect(WLC.parsePercent('')).toBeNull();
    expect(WLC.parsePercent('20px')).toBeNull();
  });

  it('parseAgeDays', () => {
    expect(WLC.parseAgeDays('3 days ago')).toBe(3);
    expect(WLC.parseAgeDays('1 week ago')).toBe(7);
    expect(WLC.parseAgeDays('2 years ago')).toBeCloseTo(730.5);
    expect(WLC.parseAgeDays('Streamed 6 years ago')).toBeCloseTo(6 * 365.25);
    expect(WLC.parseAgeDays('5 hours ago')).toBeCloseTo(5 / 24);
    expect(WLC.parseAgeDays('1.2M views')).toBeNull();
    expect(WLC.parseAgeDays('3 Monate')).toBeNull();
  });

  it('getVideoId', () => {
    expect(WLC.getVideoId('/watch?v=abcDEF12345&list=WL&index=3')).toBe('abcDEF12345');
    expect(WLC.getVideoId('/shorts/abcDEF12345')).toBe('abcDEF12345');
    expect(WLC.getVideoId(null)).toBeNull();
  });

  it('isUnavailable', () => {
    expect(WLC.isUnavailable('[Deleted video]', '')).toBe(true);
    expect(WLC.isUnavailable('[Private video]', '')).toBe(true);
    expect(WLC.isUnavailable('[Vidéo supprimée]', '')).toBe(true);
    expect(WLC.isUnavailable('[Live] Concert', 'Some Channel')).toBe(false);
    expect(WLC.isUnavailable('Normal title', '')).toBe(false);
  });

  it('isWatchLaterUrl', () => {
    expect(WLC.isWatchLaterUrl('https://www.youtube.com/playlist?list=WL')).toBe(true);
    expect(WLC.isWatchLaterUrl('https://www.youtube.com/playlist?list=PL123')).toBe(false);
    expect(WLC.isWatchLaterUrl('https://www.youtube.com/watch?v=x&list=WL')).toBe(false);
    expect(WLC.isWatchLaterUrl('https://evil.example/playlist?list=WL')).toBe(false);
  });
});

describe('parsing the Watch Later fixture', () => {
  let videos;
  beforeEach(() => {
    loadFixture();
    videos = WLC.parseAll(document);
  });

  it('finds all playlist items', () => {
    expect(videos).toHaveLength(9);
    expect(videos.map((v) => v.position)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('extracts title, channel, id, progress and age', () => {
    expect(videos[0]).toMatchObject({
      videoId: 'aaaaaaaaaa1',
      title: 'Learn Rust in 10 minutes',
      channel: 'Tech Channel',
      progress: 100,
      ageText: '2 years ago',
      unavailable: false,
    });
    expect(videos[2]).toMatchObject({ channel: 'Kitchen Lab', progress: 40, ageText: '5 years ago' });
    expect(videos[5]).toMatchObject({ progress: 0, ageText: '2 weeks ago' });
    expect(videos[7].ageText).toBe('Streamed 6 years ago');
  });

  it('flags deleted and private videos as unavailable', () => {
    expect(videos.filter((v) => v.unavailable).map((v) => v.title)).toEqual(['[Deleted video]', '[Private video]']);
    expect(videos[3]).toMatchObject({ channel: '', ageDays: null, progress: 0 });
  });

  it('finds the ⋮ menu button of every item', () => {
    for (const v of videos) expect(WLC.findMenuButton(v.el)?.getAttribute('aria-label')).toBe('Action menu');
  });
});
