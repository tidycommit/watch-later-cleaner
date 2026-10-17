/* Watch Later Cleaner — playlist sort detection and "added order" ranks.
 * YouTube doesn't show when a video was added to Watch Later, but the list can be sorted by
 * "Date added (newest|oldest)". When it is, the displayed position gives each video's added rank. */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});

  // Where the active sort can be read: the selected entry of the sort dropdown, selected chips,
  // or a dropdown trigger that shows the current value.
  const SORT_SELECTED_SELECTORS = [
    'yt-sort-filter-sub-menu-renderer [aria-selected="true"]',
    'yt-sort-filter-sub-menu-renderer .iron-selected',
    'yt-sort-filter-sub-menu-renderer [selected]',
    'yt-dropdown-menu [aria-selected="true"]',
    'yt-dropdown-menu .iron-selected',
    'yt-chip-cloud-chip-renderer[selected]',
    'yt-chip-cloud-chip-renderer[aria-selected="true"]',
    'chip-shape button[aria-selected="true"]',
    'button[role="tab"][aria-selected="true"]',
    '[role="menuitemradio"][aria-checked="true"]',
    '[role="option"][aria-selected="true"]',
    'yt-sort-filter-sub-menu-renderer #label-text',
    'yt-dropdown-menu #label-text',
  ];

  // Localized words. Order matters: "added" vs "published", then the direction.
  const ADDED = /date added|added|hinzugefügt|añadido|agregad|ajouté|ajout|aggiunt|adicionad|toegevoegd|dodan|добавлен|추가|追加|添加|新增|eklenme|ditambahkan|thêm/i;
  const PUBLISHED = /published|publish|upload|veröffentlich|hochgeladen|publicaci|publicad|publié|publicat|pubblicaz|gepubliceerd|опубликов|게시|업로드|公開|投稿|发布|上傳|發布|yayın/i;
  const POPULAR = /popular|beliebt|populares|populaire|popolari|populair|популяр|인기|人気|热门|熱門/i;
  const NEWEST = /newest|latest|recent|neueste|neuste|más reciente|recientes|plus récent|récents|più recenti|mais recente|nieuwste|najnowsze|нов|최신|新しい|最新|en yeni|terbaru|mới nhất/i;
  const OLDEST = /oldest|earliest|älteste|más antigu|antiguos|plus ancien|anciens|meno recenti|più vecchi|mais antig|oudste|najstarsze|стар|오래된|古い|最旧|最早|最舊|en eski|terlama|cũ nhất/i;

  /** Classify a sort label like "Date added (newest)". */
  function classifySort(text) {
    const t = WLC.cleanText(text);
    if (!t) return null;
    const dir = NEWEST.test(t) ? 'newest' : OLDEST.test(t) ? 'oldest' : null;
    if (ADDED.test(t) && !PUBLISHED.test(t)) return { kind: 'added', direction: dir, text: t };
    if (PUBLISHED.test(t)) return { kind: 'published', direction: dir, text: t };
    if (POPULAR.test(t)) return { kind: 'popular', direction: null, text: t };
    return null;
  }

  /**
   * Detect the playlist's active sort from the page.
   * Returns { kind: 'added'|'published'|'popular'|'unknown', direction: 'newest'|'oldest'|null, text, source }.
   */
  function detectSort(doc) {
    const d = doc || document;
    for (const sel of SORT_SELECTED_SELECTORS) {
      for (const el of d.querySelectorAll(sel)) {
        if (el.closest && el.closest(WLC.SELECTORS.item)) continue;
        const c = classifySort(el.textContent);
        if (c && (c.kind !== 'added' || c.direction)) return Object.assign(c, { source: sel });
      }
    }
    return { kind: 'unknown', direction: null, text: '', source: null };
  }

  /**
   * Combine detection with the user's manual override ('auto' | 'newest' | 'oldest').
   * Returns { available, direction, label, reason }.
   */
  function resolveAddedSort(detected, override) {
    if (override === 'newest' || override === 'oldest') {
      return { available: true, direction: override, label: `Date added (${override}) — set manually`, reason: '' };
    }
    if (detected.kind === 'added' && detected.direction) {
      return { available: true, direction: detected.direction, label: detected.text, reason: '' };
    }
    const shown = detected.text ? `“${detected.text}”` : 'not detected';
    return {
      available: false,
      direction: null,
      label: shown,
      reason: `Switch the playlist sort to Date added to use this (current sort: ${shown}).`,
    };
  }

  /** "2,691 videos" in the playlist header → 2691 (null if not found). */
  function getPlaylistCount(doc) {
    const d = doc || document;
    const sels = [
      'ytd-playlist-byline-renderer',
      'ytd-playlist-header-renderer .metadata-stats',
      'yt-page-header-view-model yt-content-metadata-view-model',
      'yt-content-metadata-view-model',
      '#stats',
    ];
    for (const sel of sels) {
      for (const el of d.querySelectorAll(sel)) {
        if (el.closest(WLC.SELECTORS.item)) continue;
        const m = WLC.cleanText(el.textContent).match(/([\d][\d,.\s]*)\s*(videos?|동영상|Videos|vidéos|vídeos|video)/i);
        if (m) return parseInt(m[1].replace(/[^\d]/g, ''), 10);
      }
    }
    return null;
  }

  /**
   * Annotate videos with displayPos (the "#836" number YouTube shows, else DOM order) and addedRank
   * (1 = oldest added). direction: 'newest' (newest added first) | 'oldest' | null (ranks left null).
   * Returns { total, usedIndexNumbers }.
   */
  function annotateAddedOrder(videos, direction) {
    const nums = videos.map((v) => parseInt(String(v.position || '').replace(/[^\d]/g, ''), 10));
    const usedIndexNumbers = videos.length > 0 && nums.every((n) => Number.isFinite(n) && n > 0) && new Set(nums).size === nums.length;
    let maxPos = 0;
    videos.forEach((v, i) => {
      v.displayPos = usedIndexNumbers ? nums[i] : i + 1;
      if (v.displayPos > maxPos) maxPos = v.displayPos;
    });
    const total = maxPos;
    for (const v of videos) {
      v.addedRank = direction === 'newest' ? total - v.displayPos + 1 : direction === 'oldest' ? v.displayPos : null;
      v.addedTotal = direction ? total : null;
    }
    return { total, usedIndexNumbers };
  }

  function describeAdded(v) {
    if (v.addedRank == null) return '';
    return `added #${v.addedRank.toLocaleString('en-US')} of ${Number(v.addedTotal).toLocaleString('en-US')} (oldest = 1)`;
  }

  Object.assign(WLC, { classifySort, detectSort, resolveAddedSort, getPlaylistCount, annotateAddedOrder, describeAdded });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
