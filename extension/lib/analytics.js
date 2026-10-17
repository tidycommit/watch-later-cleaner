/* Watch Later Cleaner — local-only analytics over parsed playlist items (single pass, no network). */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});

  const MONTH = 365.25 / 12;
  const YEAR = 365.25;

  const AGE_BUCKETS = [
    { key: 'lt1m', label: '< 1 month', max: MONTH },
    { key: '1to6m', label: '1–6 months', max: 6 * MONTH },
    { key: '6to12m', label: '6–12 months', max: YEAR },
    { key: '1to2y', label: '1–2 years', max: 2 * YEAR },
    { key: '2to3y', label: '2–3 years', max: 3 * YEAR },
    { key: '3yplus', label: '3+ years', max: Infinity },
  ];
  const DURATION_BUCKETS = [
    { key: 'lt5m', label: '< 5 min', max: 5 * 60 },
    { key: '5to20m', label: '5–20 min', max: 20 * 60 },
    { key: '20to60m', label: '20–60 min', max: 60 * 60 },
    { key: '1to2h', label: '1–2 h', max: 2 * 3600 },
    { key: '2hplus', label: '2 h+', max: Infinity },
  ];

  const RE_HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
  const RE_KANA = /[\u3040-\u30ff]/;
  const RE_HAN = /[\u4e00-\u9fff]/;
  const RE_LATIN = /[A-Za-z\u00c0-\u024f]/;
  const RE_CYRILLIC = /[\u0400-\u04ff]/;
  const RE_ARABIC = /[\u0600-\u06ff]/;

  /** Rough writing-script category of a title. Ages buckets are lower-bound based, like the age filter. */
  function titleScript(title) {
    const t = String(title || '');
    const hangul = RE_HANGUL.test(t);
    const latin = RE_LATIN.test(t);
    if (hangul && latin) return 'Hangul + Latin';
    if (hangul) return 'Hangul';
    if (RE_KANA.test(t)) return 'Japanese';
    if (RE_HAN.test(t)) return 'Chinese (Han)';
    if (RE_CYRILLIC.test(t)) return 'Cyrillic';
    if (RE_ARABIC.test(t)) return 'Arabic';
    if (latin) return 'Latin';
    return 'Other';
  }

  function bucketOf(buckets, value) {
    for (const b of buckets) if (value < b.max) return b.key;
    return buckets[buckets.length - 1].key;
  }

  function ageBucket(ageDays) {
    if (ageDays == null || !Number.isFinite(ageDays)) return 'unknown';
    return bucketOf(AGE_BUCKETS, ageDays + 1e-6); // "1 year ago" (exactly 365.25 d) → 1–2 years
  }

  function durationBucket(sec) {
    return sec == null ? 'unknown' : bucketOf(DURATION_BUCKETS, sec);
  }

  function pickSummary(v) {
    return { videoId: v.videoId, title: v.title, channel: v.channel, durationSec: v.durationSec, ageText: v.ageText, ageDays: v.ageDays, position: v.position };
  }

  /** Keep the top `n` items by `score` without sorting the whole list (n is small). */
  function topN(list, n, score) {
    const out = [];
    for (const item of list) {
      const s = score(item);
      if (s == null) continue;
      if (out.length < n) {
        out.push({ item, s });
        out.sort((a, b) => b.s - a.s);
      } else if (s > out[n - 1].s) {
        out[n - 1] = { item, s };
        out.sort((a, b) => b.s - a.s);
      }
    }
    return out.map((o) => o.item);
  }

  /** Average publish age of the oldest 10% vs newest 10% added (needs addedRank from annotateAddedOrder). */
  function addedOrderStats(avail) {
    const ranked = avail.filter((v) => v.addedRank != null);
    if (ranked.length < 2) return null;
    ranked.sort((a, b) => a.addedRank - b.addedRank);
    const k = Math.max(1, Math.round(ranked.length * 0.1));
    const avg = (list) => {
      const known = list.filter((v) => v.ageDays != null);
      return known.length ? known.reduce((sum, v) => sum + v.ageDays, 0) / known.length : null;
    };
    return { sampleSize: k, oldestAvgAgeDays: avg(ranked.slice(0, k)), newestAvgAgeDays: avg(ranked.slice(-k)) };
  }

  /**
   * Compute statistics for a list of parsed videos.
   * opts: { watchedThreshold = 90, topChannels = 15, topItems = 5 }
   */
  function computeStats(videos, opts = {}) {
    const threshold = opts.watchedThreshold == null ? 90 : opts.watchedThreshold;
    const nTop = opts.topChannels || 15;
    const nItems = opts.topItems || 5;
    const stats = {
      total: videos.length,
      available: 0,
      unavailable: 0,
      totalDurationSec: 0,
      withDuration: 0,
      avgDurationSec: 0,
      watch: { watched: 0, partial: 0, unwatched: 0 },
      watchedDurationSec: 0,
      remainingDurationSec: 0,
      age: Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, 0]).concat([['unknown', 0]])),
      duration: Object.fromEntries(DURATION_BUCKETS.map((b) => [b.key, 0]).concat([['unknown', 0]])),
      scripts: {},
      channelsCount: 0,
      topChannelsByCount: [],
      topChannelsByDuration: [],
      oldest: [],
      longest: [],
      addedOrder: null,
    };
    const channels = new Map();
    for (const v of videos) {
      if (v.unavailable) {
        stats.unavailable++;
        continue;
      }
      stats.available++;
      const d = v.durationSec;
      if (d != null) {
        stats.totalDurationSec += d;
        stats.withDuration++;
        stats.remainingDurationSec += d * (1 - Math.min(100, v.progress || 0) / 100);
        stats.watchedDurationSec += d * (Math.min(100, v.progress || 0) / 100);
      }
      if (v.progress >= threshold) stats.watch.watched++;
      else if (v.progress > 0) stats.watch.partial++;
      else stats.watch.unwatched++;
      stats.age[ageBucket(v.ageDays)]++;
      stats.duration[durationBucket(d)]++;
      const script = titleScript(v.title);
      stats.scripts[script] = (stats.scripts[script] || 0) + 1;
      const name = v.channel || '(unknown channel)';
      let c = channels.get(name);
      if (!c) channels.set(name, (c = { channel: name, count: 0, durationSec: 0 }));
      c.count++;
      if (d != null) c.durationSec += d;
    }
    stats.avgDurationSec = stats.withDuration ? stats.totalDurationSec / stats.withDuration : 0;
    stats.channelsCount = channels.size;
    const chList = Array.from(channels.values());
    const byName = (a, b) => a.channel.localeCompare(b.channel);
    stats.topChannelsByCount = chList.slice().sort((a, b) => b.count - a.count || byName(a, b)).slice(0, nTop);
    stats.topChannelsByDuration = chList.slice().sort((a, b) => b.durationSec - a.durationSec || byName(a, b)).slice(0, nTop);
    const avail = videos.filter((v) => !v.unavailable);
    stats.oldest = topN(avail, nItems, (v) => v.ageDays).map(pickSummary);
    stats.addedOrder = addedOrderStats(avail);
    stats.longest = topN(avail, nItems, (v) => v.durationSec).map(pickSummary);
    return stats;
  }

  function formatDuration(sec) {
    if (sec == null) return '';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  }

  function formatHours(sec) {
    const h = sec / 3600;
    return h >= 10 ? `${Math.round(h).toLocaleString('en-US')} h` : `${h.toFixed(1)} h`;
  }

  const CSV_COLUMNS = ['position', 'title', 'channel', 'videoId', 'url', 'duration', 'durationSeconds', 'progressPercent', 'publishedText', 'ageDays', 'unavailable'];

  /** Escape one CSV cell (RFC 4180) and neutralize spreadsheet formula injection (=, +, -, @ at start). */
  function csvCell(value) {
    let s = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportRow(v) {
    return {
      position: v.position || (v.index != null ? v.index + 1 : ''),
      title: v.title,
      channel: v.channel,
      videoId: v.videoId || '',
      url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : '',
      duration: v.durationText || formatDuration(v.durationSec),
      durationSeconds: v.durationSec == null ? '' : v.durationSec,
      progressPercent: Math.round(v.progress || 0),
      publishedText: v.ageText || '',
      ageDays: v.ageDays == null ? '' : Math.round(v.ageDays),
      unavailable: Boolean(v.unavailable),
    };
  }

  function toCSV(videos) {
    const lines = [CSV_COLUMNS.join(',')];
    for (const v of videos) {
      const row = exportRow(v);
      lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
    }
    return '\ufeff' + lines.join('\r\n') + '\r\n'; // BOM so Excel opens UTF-8 (Korean titles) correctly
  }

  function toJSON(videos, stats) {
    return JSON.stringify({ exportedAt: new Date().toISOString(), stats: stats || computeStats(videos), videos: videos.map(exportRow) }, null, 2);
  }

  Object.assign(WLC, {
    AGE_BUCKETS,
    DURATION_BUCKETS,
    CSV_COLUMNS,
    titleScript,
    ageBucket,
    durationBucket,
    computeStats,
    addedOrderStats,
    formatDuration,
    formatHours,
    csvCell,
    exportRow,
    toCSV,
    toJSON,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
