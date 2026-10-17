/* Watch Later Cleaner — settings (defaults, normalization, storage). */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});

  const STORAGE_KEY = 'wlcSettings';

  const DEFAULTS = Object.freeze({
    watched: true,
    watchedThreshold: 90, // percent
    olderThan: false,
    olderThanValue: 1,
    olderThanUnit: 'years', // days | weeks | months | years
    unavailable: true,
    channelFilter: false,
    channelKeywords: '',
    titleFilter: false,
    titleKeywords: '',
    removeAll: false,
    addedOrder: false, // "Added order" criterion (needs the playlist sorted by Date added)
    addedMode: 'oldestN', // oldestN | below | range
    addedN: 100,
    addedFrom: 1,
    addedTo: 0, // 0 = to the end
    addedSortOverride: 'auto', // auto | newest | oldest (manual fallback if the sort label can't be read)
    matchMode: 'any', // any | all — how ticked criteria combine
    delayMs: 400,
    loadAllFirst: true,
    showKept: false, // also list non-matching videos (with their parsed age) in the preview
    menuFallbackPosition: 3, // 1-based menu position used when text/icon match fails; 0 = disabled
  });

  const UNITS = ['days', 'weeks', 'months', 'years'];

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /** Coerce arbitrary (possibly stale/partial) stored settings into a valid settings object. */
  function normalizeSettings(raw) {
    const s = Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    const bool = (k) => (s[k] = Boolean(s[k]));
    ['watched', 'olderThan', 'unavailable', 'channelFilter', 'titleFilter', 'removeAll', 'loadAllFirst', 'showKept', 'addedOrder'].forEach(bool);
    s.watchedThreshold = clampNumber(s.watchedThreshold, 1, 100, DEFAULTS.watchedThreshold);
    s.olderThanValue = clampNumber(s.olderThanValue, 1, 100000, DEFAULTS.olderThanValue);
    s.olderThanUnit = String(s.olderThanUnit || '').trim().toLowerCase();
    if (!s.olderThanUnit.endsWith('s')) s.olderThanUnit += 's'; // accept "year" as well as "years"
    if (!UNITS.includes(s.olderThanUnit)) s.olderThanUnit = DEFAULTS.olderThanUnit;
    s.delayMs = Math.round(clampNumber(s.delayMs, 100, 10000, DEFAULTS.delayMs));
    s.menuFallbackPosition = Math.round(clampNumber(s.menuFallbackPosition, 0, 20, DEFAULTS.menuFallbackPosition));
    if (!['oldestN', 'below', 'range'].includes(s.addedMode)) s.addedMode = DEFAULTS.addedMode;
    if (!['auto', 'newest', 'oldest'].includes(s.addedSortOverride)) s.addedSortOverride = 'auto';
    if (s.matchMode !== 'all') s.matchMode = 'any';
    s.addedN = Math.round(clampNumber(s.addedN, 1, 100000, DEFAULTS.addedN));
    s.addedFrom = Math.round(clampNumber(s.addedFrom, 1, 100000, DEFAULTS.addedFrom));
    s.addedTo = Math.round(clampNumber(s.addedTo, 0, 100000, 0));
    s.channelKeywords = String(s.channelKeywords || '');
    s.titleKeywords = String(s.titleKeywords || '');
    return s;
  }

  function storageArea() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) return chrome.storage.sync;
    } catch (_) {
      /* not in an extension context */
    }
    return null;
  }

  async function loadSettings() {
    const area = storageArea();
    if (!area) return normalizeSettings(null);
    try {
      const data = await area.get(STORAGE_KEY);
      return normalizeSettings(data && data[STORAGE_KEY]);
    } catch (_) {
      return normalizeSettings(null);
    }
  }

  async function saveSettings(settings) {
    const s = normalizeSettings(settings);
    const area = storageArea();
    if (area) {
      try {
        await area.set({ [STORAGE_KEY]: s });
      } catch (_) {
        /* ignore quota / context errors */
      }
    }
    return s;
  }

  Object.assign(WLC, { DEFAULTS, UNITS, STORAGE_KEY, normalizeSettings, loadSettings, saveSettings });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
