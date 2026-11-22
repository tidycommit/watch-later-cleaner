/* Watch Later Cleaner — settings (defaults, normalization, storage). */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});

  const STORAGE_KEY = 'wlcSettings';
  // Sibling of STORAGE_KEY. { savedAt: number } only — never the settings payload.
  const META_KEY = 'wlcSettingsMeta';
  const SYNC_QUOTA_NOTE = 'Settings saved on this device only: Chrome Sync quota exceeded';
  const SYNC_UNAVAILABLE_NOTE = 'Settings saved on this device only: Chrome Sync is unavailable';
  const SAVE_FAILED_NOTE = 'Settings could not be saved.';

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
    shorts: false, // duration ≤ 60s; null duration never matches
    durationFilter: false,
    durationCmp: 'shorter', // shorter | longer (both inclusive)
    durationValue: 10,
    durationUnit: 'minutes', // minutes | seconds
    duplicates: false, // keep the first occurrence of each videoId
    keepChannels: '', // always-keep allowlist; empty = no effect
    keepTitles: '',
    removeAll: false,
    addedOrder: false, // "Added order" criterion (needs the playlist sorted by Date added)
    addedMode: 'oldestN', // oldestN | below | range
    addedN: 100,
    addedFrom: 1,
    addedTo: 0, // 0 = to the end
    addedSortOverride: 'auto', // auto | newest | oldest (manual fallback if the sort label can't be read)
    matchMode: 'any', // any | all — how ticked criteria combine
    delayMs: 400,
    coolDownEvery: 0, // pause after every N successful removals; 0 = off
    coolDownMs: 0, // pause length. Also used after HTTP 429 when > 0. 0 = off
    loadAllFirst: true,
    showKept: false, // also list non-matching videos (with their parsed age) in the preview
    menuFallbackPosition: 3, // 1-based menu position used when text/icon match fails; 0 = disabled
    removalMode: 'fast', // fast = YouTube's own web requests (works in background tabs) | classic = page clicks
  });

  const REMOVAL_MODES = ['fast', 'classic'];

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
    ['watched', 'olderThan', 'unavailable', 'channelFilter', 'titleFilter', 'shorts', 'durationFilter', 'duplicates', 'removeAll', 'loadAllFirst', 'showKept', 'addedOrder'].forEach(bool);
    s.watchedThreshold = clampNumber(s.watchedThreshold, 1, 100, DEFAULTS.watchedThreshold);
    s.olderThanValue = clampNumber(s.olderThanValue, 1, 100000, DEFAULTS.olderThanValue);
    s.olderThanUnit = String(s.olderThanUnit || '').trim().toLowerCase();
    if (!s.olderThanUnit.endsWith('s')) s.olderThanUnit += 's'; // accept "year" as well as "years"
    if (!UNITS.includes(s.olderThanUnit)) s.olderThanUnit = DEFAULTS.olderThanUnit;
    s.delayMs = Math.round(clampNumber(s.delayMs, 100, 10000, DEFAULTS.delayMs));
    s.coolDownEvery = Math.round(clampNumber(s.coolDownEvery, 0, 100000, 0));
    s.coolDownMs = Math.round(clampNumber(s.coolDownMs, 0, 30 * 60 * 1000, 0));
    s.menuFallbackPosition = Math.round(clampNumber(s.menuFallbackPosition, 0, 20, DEFAULTS.menuFallbackPosition));
    if (!['oldestN', 'below', 'range'].includes(s.addedMode)) s.addedMode = DEFAULTS.addedMode;
    if (!['auto', 'newest', 'oldest'].includes(s.addedSortOverride)) s.addedSortOverride = 'auto';
    if (s.matchMode !== 'all') s.matchMode = 'any';
    if (!REMOVAL_MODES.includes(s.removalMode)) s.removalMode = DEFAULTS.removalMode;
    s.addedN = Math.round(clampNumber(s.addedN, 1, 100000, DEFAULTS.addedN));
    s.addedFrom = Math.round(clampNumber(s.addedFrom, 1, 100000, DEFAULTS.addedFrom));
    s.addedTo = Math.round(clampNumber(s.addedTo, 0, 100000, 0));
    s.channelKeywords = String(s.channelKeywords || '');
    s.titleKeywords = String(s.titleKeywords || '');
    s.keepChannels = String(s.keepChannels || '');
    s.keepTitles = String(s.keepTitles || '');
    s.durationValue = Math.round(clampNumber(s.durationValue, 1, 100000, DEFAULTS.durationValue));
    if (s.durationCmp !== 'longer') s.durationCmp = 'shorter';
    if (s.durationUnit !== 'seconds') s.durationUnit = 'minutes';
    delete s.storageNote;
    return s;
  }

  function storageAreas() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        return { sync: chrome.storage.sync || null, local: chrome.storage.local || null };
      }
    } catch (_) {
      /* not in an extension context */
    }
    return { sync: null, local: null };
  }

  /**
   * Merge winner, deterministic:
   * - a missing copy loses to a present one
   * - if both are present, the greater meta.savedAt wins
   * - equal timestamps (including both missing, treated as 0) keep Sync
   * Sync stays the default for writes that fit. A local copy is newer only after Sync has rejected a write.
   */
  function chooseStoredSettings(syncRec, localRec) {
    const syncOk = Boolean(syncRec && syncRec.settings && typeof syncRec.settings === 'object');
    const localOk = Boolean(localRec && localRec.settings && typeof localRec.settings === 'object');
    const syncAt = syncOk && Number.isFinite(Number(syncRec.savedAt)) ? Number(syncRec.savedAt) : 0;
    const localAt = localOk && Number.isFinite(Number(localRec.savedAt)) ? Number(localRec.savedAt) : 0;
    if (syncOk && localOk) {
      if (localAt > syncAt) return { settings: localRec.settings, area: 'local' };
      return { settings: syncRec.settings, area: 'sync' };
    }
    if (syncOk) return { settings: syncRec.settings, area: 'sync' };
    if (localOk) return { settings: localRec.settings, area: 'local' };
    return { settings: null, area: null };
  }

  function syncFailureNote(err) {
    const message = String((err && err.message) || '');
    if (/quota|QUOTA_|MAX_WRITE_OPERATIONS|MAX_ITEMS|MAX_SUSTAINED_WRITE/i.test(message)) return SYNC_QUOTA_NOTE;
    return SYNC_UNAVAILABLE_NOTE;
  }

  async function readRecord(area) {
    if (!area || typeof area.get !== 'function') return { settings: null, savedAt: 0 };
    try {
      const data = await area.get([STORAGE_KEY, META_KEY]);
      const settings = data && data[STORAGE_KEY];
      const meta = data && data[META_KEY];
      const savedAt = meta && typeof meta === 'object' ? Number(meta.savedAt) : 0;
      return {
        settings: settings && typeof settings === 'object' ? settings : null,
        savedAt: Number.isFinite(savedAt) ? savedAt : 0,
      };
    } catch (_) {
      return { settings: null, savedAt: 0 };
    }
  }

  async function writeRecord(area, settings, savedAt) {
    await area.set({ [STORAGE_KEY]: settings, [META_KEY]: { savedAt } });
  }

  async function loadSettings() {
    const areas = storageAreas();
    if (!areas.sync && !areas.local) return normalizeSettings(null);
    const chosen = chooseStoredSettings(await readRecord(areas.sync), await readRecord(areas.local));
    return normalizeSettings(chosen.settings);
  }

  async function saveSettings(settings) {
    const s = normalizeSettings(settings);
    const areas = storageAreas();
    let note = '';
    if (areas.sync || areas.local) {
      const savedAt = Date.now();
      if (areas.sync) {
        try {
          await writeRecord(areas.sync, s, savedAt);
          if (areas.local) {
            try {
              await writeRecord(areas.local, s, savedAt);
            } catch (_) {
              /* the Sync copy is the one that will win a tie */
            }
          }
        } catch (err) {
          note = syncFailureNote(err);
          if (areas.local) {
            try {
              await writeRecord(areas.local, s, Date.now());
            } catch (_) {
              note = SAVE_FAILED_NOTE;
            }
          } else note = SAVE_FAILED_NOTE;
        }
      } else {
        try {
          await writeRecord(areas.local, s, savedAt);
        } catch (_) {
          note = SAVE_FAILED_NOTE;
        }
      }
    }
    return Object.assign({}, s, { storageNote: note });
  }

  Object.assign(WLC, {
    DEFAULTS,
    UNITS,
    REMOVAL_MODES,
    STORAGE_KEY,
    META_KEY,
    SYNC_QUOTA_NOTE,
    SYNC_UNAVAILABLE_NOTE,
    SAVE_FAILED_NOTE,
    normalizeSettings,
    chooseStoredSettings,
    loadSettings,
    saveSettings,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
