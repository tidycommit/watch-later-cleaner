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
        (s.titleFilter && parseKeywords(s.titleKeywords).length) ||
        s.addedOrder
    );
  }

  function addedModeLabel(s) {
    if (s.addedMode === 'oldestN') return `oldest ${s.addedN} added`;
    if (s.addedMode === 'below') return `below position #${s.addedFrom}`;
    return `positions #${s.addedFrom}–${s.addedTo ? '#' + s.addedTo : 'end'}`;
  }

  /**
   * "Added order" criterion. ctx.addedOrder = { available, direction, incomplete } from the page's sort.
   * Positions are the numbers shown in the (date-added sorted) list; rank 1 = oldest added.
   * Returns a reason string or null.
   */
  function addedReason(video, s, ctx) {
    const ao = ctx && ctx.addedOrder;
    if (!ao || !ao.available) return null;
    if (s.addedMode === 'oldestN') {
      if (ao.incomplete && ao.direction === 'newest') return null; // can't know the oldest without the full list
      if (video.addedRank != null && video.addedRank <= s.addedN) return `${addedModeLabel(s)} (added #${video.addedRank})`;
      return null;
    }
    const pos = video.displayPos;
    if (pos == null) return null;
    if (s.addedMode === 'below' && pos > s.addedFrom) return `${addedModeLabel(s)} (#${pos})`;
    if (s.addedMode === 'range' && pos >= s.addedFrom && (!s.addedTo || pos <= s.addedTo)) return `${addedModeLabel(s)} (#${pos})`;
    return null;
  }

  /**
   * Return the list of reasons why a video matches the settings (empty array = keep).
   * Criteria are OR-ed: a video is removed if it matches any enabled criterion.
   */
  function matchReasons(video, settings, ctx) {
    const s = settings;
    if (s.removeAll) return ['all'];
    // One entry per ticked (and usable) criterion: a reason string if it matched, else null.
    const checks = [];
    if (s.unavailable) checks.push(video.unavailable ? 'unavailable' : null);
    if (s.watched) {
      checks.push(!video.unavailable && video.progress >= Number(s.watchedThreshold) ? `watched ${Math.round(video.progress)}%` : null);
    }
    if (s.olderThan) checks.push(isOlderThan(video, s) ? `published ${describeAge(video)} ≥ ${describeThreshold(s)}` : null);
    const chKw = s.channelFilter ? parseKeywords(s.channelKeywords) : [];
    if (chKw.length) {
      const ch = String(video.channel || '').toLowerCase();
      const kw = chKw.find((k) => ch && ch.includes(k));
      checks.push(kw ? `channel "${kw}"` : null);
    }
    const tKw = s.titleFilter ? parseKeywords(s.titleKeywords) : [];
    if (tKw.length) {
      const t = String(video.title || '').toLowerCase();
      const kw = tKw.find((k) => t.includes(k));
      checks.push(kw ? `title "${kw}"` : null);
    }
    if (s.addedOrder) checks.push(addedReason(video, s, ctx));
    if (s.matchMode === 'all') return checks.length && checks.every(Boolean) ? checks : [];
    return checks.filter(Boolean);
  }

  /** Map a match reason string to its criterion name (for per-criterion counts). */
  function reasonKey(r) {
    if (r === 'all') return 'Remove all';
    if (r === 'unavailable') return 'Unavailable';
    if (r.startsWith('watched')) return 'Watched';
    if (r.startsWith('published')) return 'Published age';
    if (r.startsWith('channel')) return 'Channel';
    if (r.startsWith('title')) return 'Title';
    if (/^(oldest \d+ added|below position|positions #)/.test(r)) return 'Added order';
    return 'Other';
  }

  /** Select videos to remove. Returns [{ video, reasons }] in playlist order. */
  function selectVideos(videos, settings, ctx) {
    if (!hasCriteria(settings)) return [];
    const out = [];
    for (const video of videos) {
      const reasons = matchReasons(video, settings, ctx);
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
    addedModeLabel,
    addedReason,
    matchReasons,
    reasonKey,
    keepReason,
    selectVideos,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
