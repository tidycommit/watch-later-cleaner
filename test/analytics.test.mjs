import { describe, it, expect } from 'vitest';
import { loadWLC, loadFixture } from './helpers.mjs';
import { JSDOM } from 'jsdom';
import { generateWatchLaterHtml } from './fixtures/generate.mjs';

const WLC = loadWLC();

const V = (o) => Object.assign({ title: 't', channel: 'c', videoId: 'x', progress: 0, unavailable: false, ageDays: null, ageText: '', durationSec: null, durationText: '' }, o);

describe('duration parsing', () => {
  it('parses badge text and spoken aria-labels', () => {
    expect(WLC.parseDuration('12:34')).toBe(754);
    expect(WLC.parseDuration(' 1:02:03 ')).toBe(3723);
    expect(WLC.parseDuration('0:59')).toBe(59);
    expect(WLC.parseDuration('LIVE')).toBeNull();
    expect(WLC.parseDuration('SHORTS')).toBeNull();
    expect(WLC.parseSpokenDuration('1 hour, 2 minutes, 3 seconds')).toBe(3723);
    expect(WLC.parseSpokenDuration('5 minutes')).toBe(300);
  });

  it('reads durations from the fixture', () => {
    loadFixture();
    const v = WLC.parseAll(document);
    expect(v.map((x) => x.durationSec)).toEqual([602, 3723, 1125, null, null, 299, 9070, 2700, 4530]);
    expect(v[1].durationText).toBe('1:02:03');
  });
});

describe('computeStats', () => {
  it('fixture totals, watch state, buckets, channels, oldest/longest', () => {
    loadFixture();
    const st = WLC.computeStats(WLC.parseAll(document), { watchedThreshold: 90 });
    expect(st).toMatchObject({ total: 9, available: 7, unavailable: 2, withDuration: 7, channelsCount: 5 });
    expect(st.totalDurationSec).toBe(602 + 3723 + 1125 + 299 + 9070 + 2700 + 4530);
    expect(st.avgDurationSec).toBeCloseTo(st.totalDurationSec / 7);
    expect(st.watch).toEqual({ watched: 2, partial: 3, unwatched: 2 });
    expect(st.age).toEqual({ lt1m: 2, '1to6m': 1, '6to12m': 0, '1to2y': 1, '2to3y': 1, '3yplus': 2, unknown: 0 });
    expect(st.duration).toEqual({ lt5m: 1, '5to20m': 2, '20to60m': 1, '1to2h': 2, '2hplus': 1, unknown: 0 });
    expect(st.topChannelsByCount[0]).toEqual({ channel: 'Chill Music', count: 2, durationSec: 3723 + 2700 });
    expect(st.topChannelsByCount[1]).toEqual({ channel: 'Tech Channel', count: 2, durationSec: 602 + 9070 });
    expect(st.topChannelsByDuration[0].channel).toBe('Tech Channel');
    expect(st.oldest.map((v) => v.title)).toEqual([
      'Live concert highlights',
      'Cooking pasta like a pro',
      'Learn Rust in 10 minutes',
      'Full Course: JavaScript for beginners',
      'Lo-fi beats to study to',
    ]);
    expect(st.longest[0]).toMatchObject({ title: 'Full Course: JavaScript for beginners', durationSec: 9070 });
    // remaining = duration × (1 − progress)
    const expectedRemaining = 602 * 0 + 3723 * 0.05 + 1125 * 0.6 + 299 + 9070 * 0.11 + 2700 * 0.9 + 4530;
    expect(st.remainingDurationSec).toBeCloseTo(expectedRemaining, 3);
  });

  it('bucket boundaries (lower-bound ages, like the age filter)', () => {
    const d = (t) => WLC.ageBucket(WLC.parseAgeDays(t));
    expect(d('4 weeks ago')).toBe('lt1m');
    expect(d('1 month ago')).toBe('1to6m');
    expect(d('6 months ago')).toBe('6to12m');
    expect(d('11 months ago')).toBe('6to12m');
    expect(d('1 year ago')).toBe('1to2y');
    expect(d('2 years ago')).toBe('2to3y');
    expect(d('3 years ago')).toBe('3yplus');
    expect(WLC.ageBucket(null)).toBe('unknown');
    expect(WLC.durationBucket(299)).toBe('lt5m');
    expect(WLC.durationBucket(300)).toBe('5to20m');
    expect(WLC.durationBucket(3600)).toBe('1to2h');
    expect(WLC.durationBucket(7200)).toBe('2hplus');
    expect(WLC.durationBucket(null)).toBe('unknown');
  });

  it('title script mix (Hangul vs Latin)', () => {
    expect(WLC.titleScript('침착맨 라이브')).toBe('Hangul');
    expect(WLC.titleScript('침착맨 live 리뷰')).toBe('Hangul + Latin');
    expect(WLC.titleScript('Learn Rust')).toBe('Latin');
    expect(WLC.titleScript('ゲーム実況')).toBe('Japanese');
    expect(WLC.titleScript('中文标题')).toBe('Chinese (Han)');
    expect(WLC.titleScript('Привет')).toBe('Cyrillic');
    expect(WLC.titleScript('12345 !!')).toBe('Other');
    const st = WLC.computeStats([V({ title: '침착맨' }), V({ title: 'abc' }), V({ title: '먹방 vlog' }), V({ title: 'x', unavailable: true })]);
    expect(st.scripts).toEqual({ Hangul: 1, Latin: 1, 'Hangul + Latin': 1 });
  });

  it('limits top channels and handles empty input', () => {
    const many = Array.from({ length: 40 }, (_, i) => V({ channel: `ch${i}`, durationSec: i * 10 }));
    const st = WLC.computeStats(many, { topChannels: 15 });
    expect(st.topChannelsByCount).toHaveLength(15);
    expect(st.topChannelsByDuration[0]).toMatchObject({ channel: 'ch39', durationSec: 390 });
    const empty = WLC.computeStats([]);
    expect(empty).toMatchObject({ total: 0, avgDurationSec: 0, oldest: [], longest: [] });
  });

  it('handles 2,700+ items quickly (parse + stats)', () => {
    // separate JSDOM instance: inserting 2,750 rows into vitest's shared document is pathologically slow
    const big = new JSDOM(generateWatchLaterHtml(2750)).window.document;
    const t0 = performance.now();
    const videos = WLC.parseAll(big);
    const st = WLC.computeStats(videos);
    const ms = performance.now() - t0;
    expect(videos).toHaveLength(2750);
    expect(st.available + st.unavailable).toBe(2750);
    expect(st.withDuration).toBe(st.available);
    expect(st.scripts.Hangul).toBeGreaterThan(500);
    expect(st.scripts.Latin).toBeGreaterThan(500);
    expect(ms).toBeLessThan(15000); // jsdom is much slower than Chrome; real pages take well under a second
  });
});

describe('CSV / JSON export', () => {
  it('CSV header, escaping, URL, formula-injection guard, BOM', () => {
    const csv = WLC.toCSV([
      V({ index: 0, position: '1', title: 'Hello, "world"', channel: '침착맨', videoId: 'abcDEF12345', durationSec: 754, durationText: '12:34', progress: 63.4, ageText: '3 years ago', ageDays: 1095.75 }),
      V({ index: 1, position: '2', title: '=HYPERLINK("x")', channel: 'Line\nBreak', videoId: null, unavailable: true }),
    ]);
    expect(csv.startsWith('\ufeff')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('position,title,channel,videoId,url,duration,durationSeconds,progressPercent,publishedText,ageDays,unavailable');
    expect(lines[1]).toBe('1,"Hello, ""world""",침착맨,abcDEF12345,https://www.youtube.com/watch?v=abcDEF12345,12:34,754,63,3 years ago,1096,false');
    expect(lines[2]).toBe(`2,"'=HYPERLINK(""x"")","Line\nBreak",,,,,0,,,true`);
    expect(WLC.csvCell('-5')).toBe('-5');
    expect(WLC.csvCell('+cmd')).toBe("'+cmd");
  });

  it('CSV from the fixture has one row per video', () => {
    loadFixture();
    const csv = WLC.toCSV(WLC.parseAll(document));
    const rows = csv.trim().split('\r\n');
    expect(rows).toHaveLength(10);
    expect(rows[2]).toContain('Lo-fi beats to study to,Chill Music,aaaaaaaaaa2,https://www.youtube.com/watch?v=aaaaaaaaaa2,1:02:03,3723,95,3 months ago,91');
  });

  it('JSON contains stats and rows', () => {
    loadFixture();
    const videos = WLC.parseAll(document);
    const data = JSON.parse(WLC.toJSON(videos));
    expect(data.videos).toHaveLength(9);
    expect(data.stats.total).toBe(9);
    expect(data.videos[0]).toMatchObject({ videoId: 'aaaaaaaaaa1', durationSeconds: 602, progressPercent: 100, publishedText: '2 years ago' });
    expect(data.videos[0].el).toBeUndefined();
  });
});

describe('panel Analytics tab', () => {
  it('renders inside the panel, exports, and channel click prefills the Clean filter', async () => {
    loadFixture();
    const panel = WLC.createPanel(document);
    const $ = (s) => panel.shadow.querySelector(s);
    await panel.reloadSettings();
    $('[data-k="loadAllFirst"]').checked = false;
    panel.show();
    panel.showTab('analytics');
    expect($('.view-analytics').hidden).toBe(false);
    expect($('.view-clean').hidden).toBe(true);
    const st = await panel.analyze();
    expect(st.total).toBe(9);
    const cards = [...panel.shadow.querySelectorAll('.card')].map((c) => `${c.querySelector('.v').textContent} ${c.querySelector('.l').textContent}`);
    expect(cards[0]).toBe('9 videos');
    expect(cards[1]).toBe('6.1 h total duration');
    expect($('.a-status').textContent).toContain('Analyzed 9 videos');
    const secs = [...panel.shadow.querySelectorAll('.sec h4')].map((h) => h.textContent);
    expect(secs).toEqual(['Watch progress', 'Published (age)', 'Duration', 'Title script', 'Top channels by videos', 'Top channels by duration', 'Oldest', 'Longest']);
    expect($('.btn-csv').disabled).toBe(false);
    globalThis.URL.createObjectURL = () => 'blob:x';
    globalThis.URL.revokeObjectURL = () => {};
    expect(panel.exportCsv().split('\r\n')).toHaveLength(11);
    expect(JSON.parse(panel.exportJson()).videos).toHaveLength(9);
    panel.setExpanded(true);
    expect($('.panel').classList.contains('expanded')).toBe(true);
    const row = panel.shadow.querySelector('.brow.click[data-channel="Chill Music"]');
    row.click();
    expect($('.view-clean').hidden).toBe(false);
    expect($('[data-k="channelFilter"]').checked).toBe(true);
    expect($('[data-k="channelKeywords"]').value).toBe('Chill Music');
    expect(panel.state.settings).toMatchObject({ channelFilter: true, channelKeywords: 'Chill Music' });
    panel.destroy();
  });
});
