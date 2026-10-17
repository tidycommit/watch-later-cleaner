/* Watch Later Cleaner — pure filtering logic. */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});

  const UNIT_DAYS = { days: 1, weeks: 7, months: 30.44, years: 365.25 };

  /** "foo, Bar ,,baz" -> ["foo","bar","baz"] */
  function parseKeywords(str) {
    return String(str || '')
      .split(/[,\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function olderThanDays(settings) {
    return Number(settings.olderThanValue) * (UNIT_DAYS[settings.olderThanUnit] || 1);
  }

  /** Has at least one removal criterion been selected? */
  function hasCriteria(s) {
    return Boolean(
      s.removeAll ||
        s.watched ||
        s.olderThan ||
        s.unavailable ||
        (s.channelFilter && parseKeywords(s.channelKeywords).length) ||
        (s.titleFilter && parseKeywords(s.titleKeywords).length)
    );
  }

  /**
   * Return the list of reasons why a video matches the settings (empty array = keep).
   * Criteria are OR-ed: a video is removed if it matches any enabled criterion.
   */
  function matchReasons(video, settings) {
    const s = settings;
    if (s.removeAll) return ['all'];
    const reasons = [];
    if (s.unavailable && video.unavailable) reasons.push('unavailable');
    if (s.watched && !video.unavailable && video.progress >= Number(s.watchedThreshold)) {
      reasons.push(`watched ${Math.round(video.progress)}%`);
    }
    if (s.olderThan && video.ageDays != null && video.ageDays > olderThanDays(s)) {
      reasons.push(`older (${video.ageText})`);
    }
    if (s.channelFilter) {
      const ch = String(video.channel || '').toLowerCase();
      const kw = parseKeywords(s.channelKeywords).find((k) => ch && ch.includes(k));
      if (kw) reasons.push(`channel "${kw}"`);
    }
    if (s.titleFilter) {
      const t = String(video.title || '').toLowerCase();
      const kw = parseKeywords(s.titleKeywords).find((k) => t.includes(k));
      if (kw) reasons.push(`title "${kw}"`);
    }
    return reasons;
  }

  /** Select videos to remove. Returns [{ video, reasons }] in playlist order. */
  function selectVideos(videos, settings) {
    if (!hasCriteria(settings)) return [];
    const out = [];
    for (const video of videos) {
      const reasons = matchReasons(video, settings);
      if (reasons.length) out.push({ video, reasons });
    }
    return out;
  }

  Object.assign(WLC, { UNIT_DAYS, parseKeywords, olderThanDays, hasCriteria, matchReasons, selectVideos });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
