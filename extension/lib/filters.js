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

  const SHORTS_MAX_SEC = 60;

  function hasDuration(video) {
    return video.durationSec != null && Number.isFinite(Number(video.durationSec));
  }

  /** Clock text for a reason, e.g. 45 → "0:45", 3723 → "1:02:03". */
  function formatClock(sec) {
    const s = Math.max(0, Math.round(Number(sec)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  }

  function durationLimitSec(settings) {
    const n = Number(settings.durationValue);
    if (!Number.isFinite(n)) return null;
    return settings.durationUnit === 'seconds' ? n : n * 60;
  }

  /** Shorts (≤ 60s). Null / non-finite duration never matches. */
  function shortsReason(video) {
    if (!hasDuration(video) || Number(video.durationSec) > SHORTS_MAX_SEC) return null;
    return `duration ${formatClock(video.durationSec)} ≤ 1:00 (Shorts)`;
  }

  /** Inclusive shorter (≤) or longer (≥) than the configured limit. Null duration never matches. */
  function durationReason(video, settings) {
    if (!hasDuration(video)) return null;
    const limit = durationLimitSec(settings);
    if (limit == null) return null;
    const sec = Number(video.durationSec);
    if (settings.durationCmp === 'longer') {
      if (sec < limit) return null;
      return `duration ${formatClock(sec)} ≥ ${formatClock(limit)}`;
    }
    if (sec > limit) return null;
    return `duration ${formatClock(sec)} ≤ ${formatClock(limit)}`;
  }

  /** First index and count of each videoId in list order. Ids that appear once are not duplicates. */
  function duplicateContext(videos) {
    const first = new Map();
    const count = new Map();
    (videos || []).forEach((v, i) => {
      const id = v && v.videoId;
      if (!id) return;
      count.set(id, (count.get(id) || 0) + 1);
      if (!first.has(id)) first.set(id, i);
    });
    return { first, count };
  }

  function duplicateReason(video, index, videos, dup) {
    if (!video || !video.videoId || !dup) return null;
    if ((dup.count.get(video.videoId) || 0) < 2) return null;
    const firstIdx = dup.first.get(video.videoId);
    if (firstIdx == null || firstIdx === index) return null;
    const firstVideo = videos && videos[firstIdx];
    const pos = parseInt(String((firstVideo && firstVideo.position) || ''), 10);
    const n = Number.isFinite(pos) && pos > 0 ? pos : firstIdx + 1;
    return `duplicate of earlier #${n}`;
  }

  /**
   * Always-keep rule. Returns { kind: 'channel'|'title', kw } or null.
   * Empty allowlists match nothing. Matching is the same case-insensitive "contains" as the remove filters.
   */
  function allowlistMatch(video, settings) {
    const s = settings || {};
    const chKw = parseKeywords(s.keepChannels);
    const tKw = parseKeywords(s.keepTitles);
    if (!chKw.length && !tKw.length) return null;
    const ch = String((video && video.channel) || '').toLowerCase();
    const title = String((video && video.title) || '').toLowerCase();
    const ck = chKw.find((k) => ch && ch.includes(k));
    if (ck) return { kind: 'channel', kw: ck };
    const tk = tKw.find((k) => title && title.includes(k));
    if (tk) return { kind: 'title', kw: tk };
    return null;
  }

  /** Has at least one removal criterion been selected? The allowlist alone is not a criterion. */
  function hasCriteria(s) {
    return Boolean(
      s.removeAll ||
        s.watched ||
        s.olderThan ||
        s.unavailable ||
        (s.channelFilter && parseKeywords(s.channelKeywords).length) ||
        (s.titleFilter && parseKeywords(s.titleKeywords).length) ||
        s.shorts ||
        s.durationFilter ||
        s.duplicates ||
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
    if (s.shorts) checks.push(shortsReason(video));
    if (s.durationFilter) checks.push(durationReason(video, s));
    if (s.duplicates) checks.push(duplicateReason(video, ctx && ctx.index, ctx && ctx.videos, ctx && ctx.duplicates));
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
    if (r.includes('(Shorts)')) return 'Shorts';
    if (r.startsWith('duration')) return 'Duration';
    if (r.startsWith('duplicate')) return 'Duplicates';
    if (/^(oldest \d+ added|below position|positions #)/.test(r)) return 'Added order';
    return 'Other';
  }

  /**
   * Select videos to remove. Returns [{ video, reasons }] in playlist order.
   * Allowlisted videos are left out even when they match; `excludedByAllowlist` counts those.
   * Duplicate detection uses this list's order (Fast and Classic both pass the loaded list).
   */
  function selectVideos(videos, settings, ctx) {
    if (!hasCriteria(settings)) return [];
    const list = videos || [];
    const dup = duplicateContext(list);
    const out = [];
    let excludedByAllowlist = 0;
    for (let i = 0; i < list.length; i++) {
      const video = list[i];
      const reasons = matchReasons(video, settings, Object.assign({}, ctx, { index: i, videos: list, duplicates: dup }));
      if (!reasons.length) continue;
      if (allowlistMatch(video, settings)) {
        excludedByAllowlist++;
        continue;
      }
      out.push({ video, reasons });
    }
    // Only set when non-zero. An own property on an empty array fails deep-equality with [].
    if (excludedByAllowlist) out.excludedByAllowlist = excludedByAllowlist;
    return out;
  }

  /** Why a video was kept (shown in the preview's "show non-matching" list). */
  function keepReason(video, settings) {
    const allow = allowlistMatch(video, settings);
    if (allow) return `kept: allowlisted ${allow.kind} "${allow.kw}"`;
    if ((settings.shorts || settings.durationFilter) && !hasDuration(video)) {
      return 'kept: duration unknown (never matched by the duration filter)';
    }
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
    SHORTS_MAX_SEC,
    formatClock,
    durationLimitSec,
    shortsReason,
    durationReason,
    duplicateContext,
    duplicateReason,
    allowlistMatch,
    addedModeLabel,
    addedReason,
    matchReasons,
    reasonKey,
    keepReason,
    selectVideos,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
