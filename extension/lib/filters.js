/* Watch Later Cleaner — pure filtering logic. */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});

  // Same day values as the parser (month = year / 12) so "12 months" ≡ "1 year".
  const UNIT_DAYS = { days: 1, weeks: 7, months: 365.25 / 12, years: 365.25 };
  const EPSILON = 1e-6;

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

  /**
   * Age criterion. YouTube rounds relative dates DOWN ("1 year ago" means 12–23 months old), so the
   * displayed age is a lower bound. We match when that lower bound is >= the threshold (inclusive):
   * "Published at least 1 year ago" matches "1 year ago", "12 months" also matches "1 year ago",
   * and every matched video is guaranteed to be at least that old. Unknown age never matches.
   */
  function isOlderThan(video, settings) {
    if (video.ageDays == null || !Number.isFinite(video.ageDays)) return false;
    return video.ageDays + EPSILON >= olderThanDays(settings);
  }

  function formatDays(days) {
    if (days == null) return '';
    if (days < 1) return '<1 day';
    const d = Math.round(days);
    return `~${d} day${d === 1 ? '' : 's'}`;
  }

  /** Human-readable parsed age, e.g. '"3 years ago" → ~1096 days' or 'age unknown'. */
  function describeAge(video) {
    if (video.ageDays == null) return 'age unknown';
    return `"${video.ageText}" → ${formatDays(video.ageDays)}`;
  }

  function describeThreshold(settings) {
    const n = Number(settings.olderThanValue);
    const unit = n === 1 ? String(settings.olderThanUnit).replace(/s$/, '') : settings.olderThanUnit;
    return `${n} ${unit} (${formatDays(olderThanDays(settings))})`;
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
    if (s.olderThan && isOlderThan(video, s)) {
      reasons.push(`published ${describeAge(video)} ≥ ${describeThreshold(s)}`);
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

  /** Why a video was kept (shown in the preview's "show non-matching" list). */
  function keepReason(video, settings) {
    if (settings.olderThan) {
      return video.ageDays == null
        ? 'kept: age unknown (never matched by the age filter)'
        : `kept: published ${describeAge(video)} < ${describeThreshold(settings)}`;
    }
    return 'kept: no criterion matched';
  }

  Object.assign(WLC, {
    UNIT_DAYS,
    parseKeywords,
    olderThanDays,
    isOlderThan,
    formatDays,
    describeAge,
    describeThreshold,
    hasCriteria,
    matchReasons,
    keepReason,
    selectVideos,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
