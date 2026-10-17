import { describe, it, expect, beforeEach } from 'vitest';
import { loadWLC, loadFixture, AGE_VARIANTS_HTML } from './helpers.mjs';

const WLC = loadWLC();
const YEAR = 365.25;
const MONTH = YEAR / 12;

describe('parseAge text variants', () => {
  const cases = [
    ['3 years ago', 3 * YEAR],
    ['1 year ago', YEAR],
    ['a year ago', YEAR],
    ['an hour ago', 1 / 24],
    ['one month ago', MONTH],
    ['Streamed 2 years ago', 2 * YEAR],
    ['Premiered 8 months ago', 8 * MONTH],
    ['Updated 3 days ago', 3],
    ['Streamed 1 week ago', 7],
    ['3y ago', 3 * YEAR],
    ['3 yr ago', 3 * YEAR],
    ['3 yrs ago', 3 * YEAR],
    ['2mo ago', 2 * MONTH],
    ['5 min ago', 5 / 1440],
    ['3\u00a0years\u00a0ago', 3 * YEAR],
    ['3\u2009years\u202fago', 3 * YEAR],
    ['1.2M views • 3 years ago', 3 * YEAR],
    ['yesterday', 1],
    ['vor 3 Jahren', 3 * YEAR],
    ['vor einem Monat', MONTH],
    ['hace 2 años', 2 * YEAR],
    ['il y a 6 mois', 6 * MONTH],
    ['há 1 mês', MONTH],
    ['3 anni fa', 3 * YEAR],
  ];
  it.each(cases)('%j', (text, days) => {
    expect(WLC.parseAgeDays(text)).toBeCloseTo(days, 6);
  });

  it.each(['1.2M views', '12 minutes', 'Learn Rust in 10 minutes', 'Data ago', '', null])('no age in %j', (t) => {
    expect(WLC.parseAge(t)).toBeNull();
  });

  it('12 months equals 1 year exactly', () => {
    expect(12 * WLC.DAYS_PER.month).toBeCloseTo(WLC.DAYS_PER.year, 9);
  });
});

describe('findAge across DOM variants (age-variants fixture)', () => {
  let byCase;
  beforeEach(() => {
    loadFixture({ html: AGE_VARIANTS_HTML });
    byCase = Object.fromEntries(WLC.getItems(document).map((el) => [el.dataset.case, WLC.parseItem(el)]));
  });

  it('classic #video-info spans with "•" separator', () => {
    expect(byCase['classic-bullet']).toMatchObject({ ageText: '1 year ago', ageSource: '#video-info', channel: 'Chan A' });
    expect(byCase['classic-bullet'].ageDays).toBeCloseTo(YEAR);
  });

  it('empty #video-info falls through to #metadata-line', () => {
    expect(byCase['metadata-line']).toMatchObject({ ageText: 'Streamed 2 years ago' });
    expect(byCase['metadata-line'].ageSource).toMatch(/metadata-line/);
  });

  it('yt-content-metadata-view-model layout', () => {
    expect(byCase['view-model'].ageDays).toBeCloseTo(8 * MONTH);
    expect(byCase['view-model'].ageSource).toBe('yt-content-metadata-view-model');
    expect(byCase['view-model'].channel).toBe('Chan C');
  });

  it('aria-label fallback ignores ages inside the title', () => {
    expect(byCase['aria-label'].ageDays).toBeCloseTo(4 * YEAR);
    expect(byCase['aria-label'].ageText).toBe('4 years ago');
    expect(byCase['aria-label'].ageSource).toMatch(/^aria-label/);
  });

  it('NBSP / thin spaces, abbreviations, "a year", "Updated"', () => {
    expect(byCase.nbsp.ageDays).toBeCloseTo(3 * YEAR);
    expect(byCase.nbsp.ageText).toBe('3 years ago');
    expect(byCase.abbrev.ageDays).toBeCloseTo(3 * YEAR);
    expect(byCase['a-year'].ageDays).toBeCloseTo(YEAR);
    expect(byCase.updated.ageDays).toBe(3);
  });

  it('unknown age stays null', () => {
    expect(byCase.unknown).toMatchObject({ ageText: '', ageDays: null, ageSource: null });
  });
});

describe('age filter boundaries (inclusive, displayed age is a lower bound)', () => {
  const S = (value, unit) => WLC.normalizeSettings({ watched: false, unavailable: false, olderThan: true, olderThanValue: value, olderThanUnit: unit });
  const v = (text) => ({ title: 't', channel: 'c', progress: 0, unavailable: false, ageText: text, ageDays: WLC.parseAgeDays(text) });
  const matches = (text, value, unit) => WLC.matchReasons(v(text), S(value, unit)).length > 0;

  it.each([
    ['1 year ago', 1, 'years', true],
    ['1 year ago', 12, 'months', true],
    ['1 year ago', 13, 'months', false],
    ['11 months ago', 1, 'years', false],
    ['11 months ago', 11, 'months', true],
    ['2 years ago', 2, 'years', true],
    ['2 years ago', 3, 'years', false],
    ['6 months ago', 6, 'months', true],
    ['6 months ago', 26, 'weeks', true],
    ['3 weeks ago', 3, 'weeks', true],
    ['3 weeks ago', 1, 'months', false],
    ['4 weeks ago', 28, 'days', true],
    ['5 days ago', 5, 'days', true],
    ['5 days ago', 6, 'days', false],
    ['10 hours ago', 1, 'days', false],
  ])('%j vs >= %d %s → %s', (text, value, unit, expected) => {
    expect(matches(text, value, unit)).toBe(expected);
  });

  it('string inputs from the form are coerced to numbers', () => {
    const s = WLC.normalizeSettings({ olderThan: true, olderThanValue: '2', olderThanUnit: 'years' });
    expect(s.olderThanValue).toBe(2);
    expect(WLC.olderThanDays(s)).toBeCloseTo(2 * YEAR);
    expect(WLC.normalizeSettings({ olderThanValue: '' }).olderThanValue).toBe(1);
    expect(WLC.normalizeSettings({ olderThanUnit: 'Year' }).olderThanUnit).toBe('years');
  });

  it('unknown age is never matched and is explained', () => {
    const unknown = { title: 't', channel: 'c', progress: 0, unavailable: false, ageText: '', ageDays: null };
    expect(WLC.matchReasons(unknown, S(1, 'days'))).toEqual([]);
    expect(WLC.describeAge(unknown)).toBe('age unknown');
    expect(WLC.keepReason(unknown, S(1, 'days'))).toMatch(/age unknown/);
  });

  it('reason shows the parsed age and the threshold', () => {
    expect(WLC.matchReasons(v('3 years ago'), S(1, 'years'))).toEqual(['published "3 years ago" → ~1096 days ≥ 1 year (~365 days)']);
    expect(WLC.keepReason(v('2 months ago'), S(6, 'months'))).toBe('kept: published "2 months ago" → ~61 days < 6 months (~183 days)');
  });

  it('age filter is OR-ed with other criteria', () => {
    const s = WLC.normalizeSettings({ watched: true, unavailable: false, olderThan: true, olderThanValue: 1, olderThanUnit: 'years' });
    expect(WLC.matchReasons(Object.assign(v('1 day ago'), { progress: 100 }), s)).toEqual(['watched 100%']);
    expect(WLC.matchReasons(v('2 years ago'), s)).toHaveLength(1);
  });

  it('selects the expected items from the variants fixture', () => {
    loadFixture({ html: AGE_VARIANTS_HTML });
    const picked = WLC.selectVideos(WLC.parseAll(document), S(1, 'years')).map((m) => m.video.title);
    expect(picked).toEqual([
      'Classic one year',
      'Metadata line stream',
      'What changed 2 years ago',
      'Nbsp spaces',
      'Abbreviated',
      'A year',
    ]);
  });
});

describe('lazy-loaded items', () => {
  it('parseAllSettled re-reads items whose metadata renders late', async () => {
    loadFixture({ html: AGE_VARIANTS_HTML });
    const lazy = document.querySelector('[data-case="lazy"]');
    expect(WLC.parseItem(lazy)).toMatchObject({ title: '', ageDays: null });
    setTimeout(() => {
      lazy.querySelector('#video-title').textContent = 'Hydrated later';
      lazy.querySelector('#channel-name').innerHTML = '<a href="/@k">Chan K</a>';
      lazy.querySelector('#video-info').innerHTML = '<span>1K views</span><span>•</span><span>5 years ago</span>';
    }, 120);
    const videos = await WLC.parseAllSettled({ doc: document, waitMs: 100, retries: 5 });
    const k = videos.find((x) => x.videoId === 'bbbbbbbbbbK');
    expect(k).toMatchObject({ title: 'Hydrated later', channel: 'Chan K', ageText: '5 years ago' });
  });
});

describe('panel preview shows parsed ages', () => {
  it('applies unit dropdown + number input, lists matched and kept videos with ages', async () => {
    loadFixture({ html: AGE_VARIANTS_HTML });
    const lazy = document.querySelector('[data-case="lazy"]');
    lazy.remove();
    const panel = WLC.createPanel(document);
    const $ = (s) => panel.shadow.querySelector(s);
    await panel.reloadSettings();
    const set = (k, val) => {
      const el = $(`[data-k="${k}"]`);
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('watched', false);
    set('unavailable', false);
    set('loadAllFirst', false);
    set('olderThan', true);
    set('olderThanValue', '12');
    set('olderThanUnit', 'months');
    set('showKept', true);
    expect(panel.state.settings).toMatchObject({ olderThanValue: 12, olderThanUnit: 'months' });
    const plan = await panel.preview();
    expect(plan).toHaveLength(6);
    const rows = [...panel.shadow.querySelectorAll('.list .item')];
    expect(rows).toHaveLength(10);
    expect(rows[0].textContent).toContain('"1 year ago" → ~365 days');
    expect(rows[0].querySelector('.r').textContent).toBe('published "1 year ago" → ~365 days ≥ 12 months (~365 days)');
    const kept = rows.filter((r) => r.classList.contains('kept'));
    expect(kept).toHaveLength(4);
    expect(kept.map((r) => r.querySelector('input'))).toEqual([null, null, null, null]);
    const unknownRow = kept.find((r) => r.textContent.includes('No age shown'));
    expect(unknownRow.textContent).toContain('age unknown');
    expect($('.status').textContent).toContain('1 video(s) have an unknown age');
    expect($('.btn-remove').textContent).toBe('Remove 6…');
    panel.destroy();
  });
});
