import { describe, it, expect, beforeEach } from 'vitest';
import { loadWLC, loadFixture } from './helpers.mjs';

const WLC = loadWLC();
const S = (o) => WLC.normalizeSettings(Object.assign({ watched: false, unavailable: false }, o));

function selectSort(label) {
  for (const item of document.querySelectorAll('yt-sort-filter-sub-menu-renderer tp-yt-paper-item')) {
    const on = item.textContent.trim() === label;
    item.setAttribute('aria-selected', String(on));
    item.classList.toggle('iron-selected', on);
  }
}

function prepared(direction) {
  const videos = WLC.parseAll(document);
  const info = WLC.annotateAddedOrder(videos, direction);
  return { videos, info };
}
const titles = (sel) => sel.map((m) => m.video.title);
const ctx = (direction, extra = {}) => ({ addedOrder: Object.assign({ available: true, direction, incomplete: false }, extra) });

describe('sort detection', () => {
  it.each([
    ['Date added (newest)', 'added', 'newest'],
    ['Date added (oldest)', 'added', 'oldest'],
    ['Most popular', 'popular', null],
    ['Date published (newest)', 'published', 'newest'],
    ['Date published (oldest)', 'published', 'oldest'],
    ['추가된 날짜(최신순)', 'added', 'newest'],
    ['추가된 날짜(오래된순)', 'added', 'oldest'],
    ['Hinzugefügt (älteste)', 'added', 'oldest'],
    ['Fecha de publicación (más reciente)', 'published', 'newest'],
  ])('%j → %s %s', (text, kind, direction) => {
    expect(WLC.classifySort(text)).toMatchObject({ kind, direction });
  });

  it('ignores labels that are not a sort', () => {
    expect(WLC.classifySort('Sort')).toBeNull();
    expect(WLC.classifySort('')).toBeNull();
  });

  describe('on the fixture page', () => {
    beforeEach(() => loadFixture());
    it('reads the selected dropdown entry', () => {
      expect(WLC.detectSort(document)).toMatchObject({ kind: 'added', direction: 'newest', text: 'Date added (newest)' });
      selectSort('Date added (oldest)');
      expect(WLC.detectSort(document)).toMatchObject({ kind: 'added', direction: 'oldest' });
      selectSort('Most popular');
      expect(WLC.detectSort(document)).toMatchObject({ kind: 'popular' });
      selectSort('Date published (newest)');
      expect(WLC.detectSort(document)).toMatchObject({ kind: 'published', direction: 'newest' });
    });
    it('falls back to chips', () => {
      document.querySelector('yt-sort-filter-sub-menu-renderer').remove();
      expect(WLC.detectSort(document).kind).toBe('unknown');
      document.body.insertAdjacentHTML('afterbegin', '<yt-chip-cloud-chip-renderer selected>Date added (oldest)</yt-chip-cloud-chip-renderer>');
      expect(WLC.detectSort(document)).toMatchObject({ kind: 'added', direction: 'oldest' });
    });
    it('reads the header video count', () => {
      expect(WLC.getPlaylistCount(document)).toBe(9);
    });
  });

  it('resolveAddedSort: disabled unless sorted by Date added; manual override', () => {
    expect(WLC.resolveAddedSort({ kind: 'added', direction: 'newest', text: 'Date added (newest)' }, 'auto')).toMatchObject({ available: true, direction: 'newest' });
    const pop = WLC.resolveAddedSort({ kind: 'popular', direction: null, text: 'Most popular' }, 'auto');
    expect(pop.available).toBe(false);
    expect(pop.reason).toBe('Switch the playlist sort to Date added to use this (current sort: “Most popular”).');
    expect(WLC.resolveAddedSort({ kind: 'unknown', direction: null, text: '' }, 'auto').reason).toContain('not detected');
    expect(WLC.resolveAddedSort({ kind: 'unknown', direction: null, text: '' }, 'oldest')).toMatchObject({ available: true, direction: 'oldest' });
  });
});

describe('added rank', () => {
  beforeEach(() => loadFixture());

  it('newest-first: rank 1 = last item', () => {
    const { videos, info } = prepared('newest');
    expect(info).toEqual({ total: 9, usedIndexNumbers: true });
    expect(videos.map((v) => v.addedRank)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(WLC.describeAdded(videos[8])).toBe('added #1 of 9 (oldest = 1)');
  });

  it('oldest-first: rank = position', () => {
    const { videos } = prepared('oldest');
    expect(videos.map((v) => v.addedRank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('uses the index numbers YouTube shows (e.g. #836), else DOM order', () => {
    const vs = [836, 837, 838].map((n) => ({ position: String(n) }));
    expect(WLC.annotateAddedOrder(vs, 'newest')).toEqual({ total: 838, usedIndexNumbers: true });
    expect(vs.map((v) => [v.displayPos, v.addedRank])).toEqual([[836, 3], [837, 2], [838, 1]]);
    const noIdx = [{ position: '' }, { position: '' }, { position: '' }];
    expect(WLC.annotateAddedOrder(noIdx, 'newest')).toEqual({ total: 3, usedIndexNumbers: false });
    expect(noIdx.map((v) => v.addedRank)).toEqual([3, 2, 1]);
    const dup = [{ position: '1' }, { position: '1' }];
    expect(WLC.annotateAddedOrder(dup, 'oldest').usedIndexNumbers).toBe(false);
    expect(WLC.annotateAddedOrder([{ position: '5' }], null)).toEqual({ total: 5, usedIndexNumbers: true });
  });
});

describe('added-order criterion', () => {
  beforeEach(() => loadFixture());

  it('oldest N added — newest-first list: the last N', () => {
    const { videos } = prepared('newest');
    const sel = WLC.selectVideos(videos, S({ addedOrder: true, addedMode: 'oldestN', addedN: 3 }), ctx('newest'));
    expect(titles(sel)).toEqual(['Full Course: JavaScript for beginners', 'Live concert highlights', 'Podcast episode #42 – productivity']);
    expect(sel[2].reasons).toEqual(['oldest 3 added (added #1)']);
  });

  it('oldest N added — oldest-first list: the first N', () => {
    const { videos } = prepared('oldest');
    const sel = WLC.selectVideos(videos, S({ addedOrder: true, addedN: 2 }), ctx('oldest'));
    expect(titles(sel)).toEqual(['Learn Rust in 10 minutes', 'Lo-fi beats to study to']);
  });

  it('below position #X and positions X–Y use displayed positions', () => {
    const { videos } = prepared('newest');
    expect(titles(WLC.selectVideos(videos, S({ addedOrder: true, addedMode: 'below', addedFrom: 7 }), ctx('newest')))).toEqual([
      'Live concert highlights',
      'Podcast episode #42 – productivity',
    ]);
    expect(titles(WLC.selectVideos(videos, S({ addedOrder: true, addedMode: 'range', addedFrom: 2, addedTo: 4 }), ctx('newest')))).toEqual([
      'Lo-fi beats to study to',
      'Cooking pasta like a pro',
      '[Deleted video]',
    ]);
    expect(titles(WLC.selectVideos(videos, S({ addedOrder: true, addedMode: 'range', addedFrom: 8, addedTo: 0 }), ctx('newest')))).toHaveLength(2);
  });

  it('disabled when the sort is not Date added, and when the list is incomplete (oldest N, newest-first)', () => {
    const { videos } = prepared(null);
    const s = S({ addedOrder: true, addedN: 3 });
    expect(WLC.selectVideos(videos, s, { addedOrder: { available: false } })).toEqual([]);
    expect(WLC.selectVideos(videos, s, undefined)).toEqual([]);
    const ranked = prepared('newest').videos;
    expect(WLC.selectVideos(ranked, s, ctx('newest', { incomplete: true }))).toEqual([]);
    // position ranges don't depend on the total, so they still work on a partial list
    expect(WLC.selectVideos(ranked, S({ addedOrder: true, addedMode: 'below', addedFrom: 8 }), ctx('newest', { incomplete: true }))).toHaveLength(1);
  });

  it('match any vs all', () => {
    const { videos } = prepared('newest');
    const base = { addedOrder: true, addedN: 5, olderThan: true, olderThanValue: 3, olderThanUnit: 'years' };
    const any = WLC.selectVideos(videos, S(base), ctx('newest'));
    expect(titles(any)).toEqual([
      'Cooking pasta like a pro', // published 5 years ago
      '[Private video]', // oldest 5 added
      'Unboxing the new phone',
      'Full Course: JavaScript for beginners',
      'Live concert highlights', // both
      'Podcast episode #42 – productivity',
    ]);
    const all = WLC.selectVideos(videos, S(Object.assign({ matchMode: 'all' }, base)), ctx('newest'));
    expect(titles(all)).toEqual(['Live concert highlights']);
    expect(all[0].reasons).toEqual(['published "Streamed 6 years ago" → ~2192 days ≥ 3 years (~1096 days)', 'oldest 5 added (added #2)']);
    // all + an unusable added-order criterion → nothing (never silently drops a required condition)
    expect(WLC.selectVideos(videos, S(Object.assign({ matchMode: 'all' }, base)), { addedOrder: { available: false } })).toEqual([]);
    // default stays "any"
    expect(WLC.normalizeSettings(null).matchMode).toBe('any');
  });
});

describe('panel', () => {
  it('shows the detected sort, disables the criterion for other sorts, and shows added rank in preview rows', async () => {
    loadFixture();
    const panel = WLC.createPanel(document);
    const $ = (s) => panel.shadow.querySelector(s);
    await panel.reloadSettings();
    panel.show();
    expect($('.sort-note').textContent).toBe('Sort: Date added (newest) — added #1 = oldest. Loads the full list first.');
    expect($('[data-k="addedOrder"]').disabled).toBe(false);

    selectSort('Most popular');
    panel.refreshSort();
    expect($('[data-k="addedOrder"]').disabled).toBe(true);
    expect($('.sort-note').textContent).toContain('Switch the playlist sort to Date added to use this');
    selectSort('Date added (newest)');
    panel.refreshSort();

    const set = (k, v) => {
      const el = $(`[data-k="${k}"]`);
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('watched', false);
    set('unavailable', false);
    set('loadAllFirst', false);
    set('addedOrder', true);
    set('addedMode', 'oldestN');
    expect($('.am-n').hidden).toBe(false);
    expect($('.am-to').hidden).toBe(true);
    set('addedN', '2');
    // loadAll is forced on for this criterion; make it fast in tests
    const orig = WLC.loadAll;
    WLC.loadAll = (o) => orig(Object.assign({}, o, { settleMs: 1 }));
    try {
      const plan = await panel.preview();
      expect(plan.map((m) => m.video.title)).toEqual(['Live concert highlights', 'Podcast episode #42 – productivity']);
      const rows = [...panel.shadow.querySelectorAll('.list .item .c')].map((c) => c.textContent);
      expect(rows[0]).toContain('added #2 of 9 (oldest = 1)');
      expect(rows[1]).toContain('added #1 of 9 (oldest = 1)');

      set('addedMode', 'range');
      expect($('.am-from').hidden).toBe(false);
      expect($('.am-to').hidden).toBe(false);
      selectSort('Date published (oldest)');
      set('addedSortOverride', 'auto');
      const none = await panel.preview();
      expect(none).toEqual([]);
      expect($('.status').textContent).toContain('Added order ignored: Switch the playlist sort to Date added');
    } finally {
      WLC.loadAll = orig;
      panel.destroy();
    }
  });
});

describe('analytics added-order note', () => {
  it('average publish age of oldest vs newest 10% added', () => {
    loadFixture();
    const { videos } = prepared('newest');
    const st = WLC.computeStats(videos);
    expect(st.addedOrder.sampleSize).toBe(1);
    expect(st.addedOrder.oldestAvgAgeDays).toBe(8); // Podcast, "8 days ago", is added #1
    expect(st.addedOrder.newestAvgAgeDays).toBeCloseTo(2 * 365.25);
    expect(WLC.computeStats(WLC.parseAll(document)).addedOrder).toBeNull(); // no ranks without a date-added sort
  });
});
