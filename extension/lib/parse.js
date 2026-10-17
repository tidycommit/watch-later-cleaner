/* Watch Later Cleaner — DOM selectors and playlist item parsing. */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});

  const SELECTORS = Object.freeze({
    item: 'ytd-playlist-video-renderer',
    list: 'ytd-playlist-video-list-renderer #contents, ytd-section-list-renderer #contents',
    continuation: 'ytd-continuation-item-renderer',
    title: '#video-title, a#video-title, h3 a',
    channel: [
      'ytd-channel-name #text a',
      'ytd-channel-name a',
      '#channel-name a',
      '#byline a',
      'yt-content-metadata-view-model a[href^="/@"]',
      'yt-content-metadata-view-model a[href^="/channel/"]',
      'ytd-channel-name #text',
      '#channel-name',
    ].join(', '),
    progress: [
      'ytd-thumbnail-overlay-resume-playback-renderer #progress',
      'ytd-thumbnail-overlay-resume-playback-renderer [id="progress"]',
      '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
      '#overlays #progress',
    ].join(', '),
    // Containers that may hold "1.2M views • 3 years ago", in order of preference. Covers the classic
    // ytd-video-meta-block (#video-info / #metadata-line) and the newer view-model layouts.
    ageSources: [
      '#video-info',
      'ytd-video-meta-block #metadata-line',
      '#metadata-line',
      'yt-content-metadata-view-model',
      '.yt-content-metadata-view-model-wiz',
      'yt-lockup-metadata-view-model',
      'ytd-video-meta-block',
      '#metadata',
      '#meta',
    ],
    // Duration badge on the thumbnail ("12:34", "1:02:03"); classic overlay and newer badge-shape variants.
    duration: [
      'ytd-thumbnail-overlay-time-status-renderer #text',
      'ytd-thumbnail-overlay-time-status-renderer .badge-shape-wiz__text',
      'ytd-thumbnail-overlay-time-status-renderer .yt-badge-shape__text',
      'ytd-thumbnail-overlay-time-status-renderer badge-shape',
      'yt-thumbnail-overlay-badge-view-model .badge-shape-wiz__text',
      'yt-thumbnail-overlay-badge-view-model .yt-badge-shape__text',
      'ytd-thumbnail-overlay-time-status-renderer',
    ].join(', '),
    // Elements whose aria-label usually reads "<title> by <channel> 1,234 views 3 years ago 12 minutes".
    ariaSources: ['#video-title[aria-label]', 'a#thumbnail[aria-label]', 'h3[aria-label]', '[aria-label]'],
    menuButton: [
      'ytd-menu-renderer yt-icon-button#button button',
      'ytd-menu-renderer #button button',
      'ytd-menu-renderer button',
      '#menu button',
      'button[aria-label]',
    ].join(', '),
  });

  // A month is defined as exactly 1/12 year so that "12 months" and "1 year" compare equal.
  const DAYS_PER_YEAR = 365.25;
  const DAYS_PER = {
    second: 1 / 86400,
    minute: 1 / 1440,
    hour: 1 / 24,
    day: 1,
    week: 7,
    month: DAYS_PER_YEAR / 12, // ≈ 30.44
    year: DAYS_PER_YEAR,
  };

  // Unit spellings → canonical unit. Longest alternatives first so "mo" wins over "m", "min" over "m", etc.
  const EN_UNITS = [
    ['years', 'year'], ['year', 'year'], ['yrs', 'year'], ['yr', 'year'], ['y', 'year'],
    ['months', 'month'], ['month', 'month'], ['mos', 'month'], ['mo', 'month'],
    ['weeks', 'week'], ['week', 'week'], ['wks', 'week'], ['wk', 'week'], ['w', 'week'],
    ['days', 'day'], ['day', 'day'], ['d', 'day'],
    ['hours', 'hour'], ['hour', 'hour'], ['hrs', 'hour'], ['hr', 'hour'], ['h', 'hour'],
    ['minutes', 'minute'], ['minute', 'minute'], ['mins', 'minute'], ['min', 'minute'], ['m', 'minute'],
    ['seconds', 'second'], ['second', 'second'], ['secs', 'second'], ['sec', 'second'], ['s', 'second'],
  ];
  const EN_UNIT_MAP = new Map(EN_UNITS);
  const EN_RE = new RegExp(
    '(?<![a-z])(\\d+(?:[.,]\\d+)?|an?|one)\\s*(' + EN_UNITS.map((u) => u[0]).join('|') + ')\\.?\\s*ago\\b'
  );

  // A few common UI languages (relative publish dates as YouTube renders them).
  const LOCALE_RULES = [
    // German: "vor 3 Jahren", "vor einem Monat"
    { re: /vor\s+(\d+|einem|einer)\s+(jahr|jahren|monat|monaten|woche|wochen|tag|tagen|stunde|stunden|minute|minuten)(?![a-zà-ÿ])/, units: { jahr: 'year', jahren: 'year', monat: 'month', monaten: 'month', woche: 'week', wochen: 'week', tag: 'day', tagen: 'day', stunde: 'hour', stunden: 'hour', minute: 'minute', minuten: 'minute' } },
    // Spanish: "hace 3 años"
    { re: /hace\s+(\d+|un|una)\s+(años?|mes(?:es)?|semanas?|días?|horas?|minutos?)(?![a-zà-ÿ])/, units: { año: 'year', años: 'year', mes: 'month', meses: 'month', semana: 'week', semanas: 'week', día: 'day', días: 'day', hora: 'hour', horas: 'hour', minuto: 'minute', minutos: 'minute' } },
    // French: "il y a 3 ans"
    { re: /il y a\s+(\d+|un|une)\s+(ans?|années?|mois|semaines?|jours?|heures?|minutes?)(?![a-zà-ÿ])/, units: { an: 'year', ans: 'year', année: 'year', années: 'year', mois: 'month', semaine: 'week', semaines: 'week', jour: 'day', jours: 'day', heure: 'hour', heures: 'hour', minute: 'minute', minutes: 'minute' } },
    // Portuguese: "há 3 anos"
    { re: /há\s+(\d+|um|uma)\s+(anos?|mês|meses|semanas?|dias?|horas?|minutos?)(?![a-zà-ÿ])/, units: { ano: 'year', anos: 'year', mês: 'month', meses: 'month', semana: 'week', semanas: 'week', dia: 'day', dias: 'day', hora: 'hour', horas: 'hour', minuto: 'minute', minutos: 'minute' } },
    // Italian: "3 anni fa"
    { re: /(\d+|un|una)\s+(anni|anno|mesi|mese|settimane|settimana|giorni|giorno|ore|ora|minuti|minuto)\s+fa(?![a-zà-ÿ])/, units: { anno: 'year', anni: 'year', mese: 'month', mesi: 'month', settimana: 'week', settimane: 'week', giorno: 'day', giorni: 'day', ora: 'hour', ore: 'hour', minuto: 'minute', minuti: 'minute' } },
  ];

  /** Normalize whitespace incl. NBSP (\u00a0), thin/narrow spaces (\u2009, \u202f) and zero-width chars. */
  function normalizeSpaces(s) {
    return String(s || '')
      .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
      .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function countValue(token) {
    const n = parseFloat(String(token).replace(',', '.'));
    return Number.isFinite(n) ? n : 1; // "a", "an", "one", "einem", "un", ...
  }

  /**
   * Parse a relative age such as "3 years ago", "Streamed 2 years ago", "Premiered 1 month ago",
   * "Updated 5 days ago", "a year ago", "3y ago", "3 yr ago", "yesterday", plus a few other languages.
   * Returns { count, unit, days, match } or null. The value YouTube shows is rounded DOWN
   * ("1 year ago" = 12–23 months), so `days` is a lower bound of the real age.
   */
  function parseAge(text) {
    const t = normalizeSpaces(text).toLowerCase();
    if (!t) return null;
    let m = t.match(EN_RE);
    if (m) {
      const unit = EN_UNIT_MAP.get(m[2]);
      const count = countValue(m[1]);
      return { count, unit, days: count * DAYS_PER[unit], match: m[0] };
    }
    if (/\byesterday\b/.test(t)) return { count: 1, unit: 'day', days: 1, match: 'yesterday' };
    if (/\b(today|just now)\b/.test(t)) return { count: 0, unit: 'day', days: 0, match: 'today' };
    for (const rule of LOCALE_RULES) {
      m = t.match(rule.re);
      if (m && rule.units[m[2]]) {
        const unit = rule.units[m[2]];
        const count = countValue(m[1]);
        return { count, unit, days: count * DAYS_PER[unit], match: m[0] };
      }
    }
    return null;
  }

  /** Approximate age in days, or null if it cannot be detected. */
  function parseAgeDays(text) {
    const a = parseAge(text);
    return a ? a.days : null;
  }

  function cleanText(s) {
    return normalizeSpaces(s);
  }

  /** Parse a CSS percentage width ("63%" / "width: 63%;") into a number 0..100, or null. */
  function parsePercent(styleValue) {
    if (!styleValue) return null;
    const m = String(styleValue).match(/(-?\d+(?:\.\d+)?)\s*%/);
    if (!m) return null;
    return Math.min(100, Math.max(0, parseFloat(m[1])));
  }

  /** Return watch progress (0..100) for a playlist item, 0 if no progress bar is present. */
  function getProgress(el) {
    const bar = el.querySelector(SELECTORS.progress);
    if (!bar) return 0;
    const fromStyle = parsePercent(bar.style && bar.style.width) ?? parsePercent(bar.getAttribute('style'));
    return fromStyle == null ? 0 : fromStyle;
  }

  function getVideoId(href) {
    if (!href) return null;
    const m = String(href).match(/[?&]v=([\w-]{6,})/) || String(href).match(/\/shorts\/([\w-]{6,})/);
    return m ? m[1] : null;
  }

  /** Detect deleted/private/unavailable entries: bracketed titles like "[Deleted video]" and no channel. */
  function isUnavailable(title, channel, el) {
    if (el && (el.hasAttribute('is-unavailable') || el.hasAttribute('unavailable'))) return true;
    const t = cleanText(title);
    if (/^\[(deleted|private|unavailable)( video)?\]$/i.test(t)) return true;
    if (/^\[.+\]$/.test(t) && !channel) return true; // localized "[Vidéo supprimée]", "[Privates Video]" …
    return false;
  }

  /**
   * Find the relative publish age of a playlist item. Tries, in order:
   *  1. each <span> of the metadata containers (e.g. #video-info: "1.2M views" "•" "3 years ago"),
   *  2. the container text split on "•" / "·" (layouts without spans),
   *  3. aria-labels (title link / thumbnail), with the title stripped so a title like
   *     "What changed 2 years ago" can't be mistaken for the age.
   * Returns { text, days, unit, count, source } or null when no age can be detected.
   */
  function findAge(el, title) {
    for (const sel of SELECTORS.ageSources) {
      for (const container of el.querySelectorAll(sel)) {
        const split = (t) => cleanText(t).split(/\s*[•·|]\s*/);
        const texts = Array.from(container.querySelectorAll('span')).flatMap((n) => split(n.textContent));
        texts.push(...split(container.textContent));
        for (const text of texts) {
          if (!text || (title && text.includes(title))) continue;
          const a = parseAge(text);
          if (a) return Object.assign({ text, source: sel }, a);
        }
      }
    }
    for (const sel of SELECTORS.ariaSources) {
      for (const node of el.querySelectorAll(sel)) {
        let label = cleanText(node.getAttribute('aria-label'));
        if (!label) continue;
        if (title && label.toLowerCase().startsWith(title.toLowerCase())) label = label.slice(title.length);
        const a = parseAge(label);
        if (a) return Object.assign({ text: a.match, source: `aria-label(${sel})` }, a);
      }
    }
    return null;
  }

  /** "12:34" → 754, "1:02:03" → 3723; null for "LIVE", "SHORTS", "" … */
  function parseDuration(text) {
    const m = cleanText(text).match(/(?:^|\s)(\d{1,3}(?::[0-5]\d){1,2})(?:\s|$)/);
    if (!m) return null;
    return m[1].split(':').reduce((acc, part) => acc * 60 + parseInt(part, 10), 0);
  }

  /** "1 hour, 2 minutes, 3 seconds" (aria-label of the badge) → 3723 */
  function parseSpokenDuration(text) {
    const t = cleanText(text).toLowerCase();
    let total = 0;
    let found = false;
    const re = /(\d+)\s*(hours?|minutes?|seconds?)/g;
    let m;
    while ((m = re.exec(t))) {
      found = true;
      total += parseInt(m[1], 10) * (m[2][0] === 'h' ? 3600 : m[2][0] === 'm' ? 60 : 1);
    }
    return found ? total : null;
  }

  function findDuration(el) {
    for (const node of el.querySelectorAll(SELECTORS.duration)) {
      const text = cleanText(node.textContent);
      const sec = parseDuration(text);
      if (sec != null) return { text: text.match(/\d{1,3}(?::[0-5]\d){1,2}/)[0], seconds: sec };
      const spoken = parseSpokenDuration(node.getAttribute('aria-label'));
      if (spoken != null) return { text, seconds: spoken };
    }
    return null;
  }

  /** Parse one ytd-playlist-video-renderer element into a plain object. */
  function parseItem(el, index) {
    const titleEl = el.querySelector(SELECTORS.title);
    const title = cleanText(titleEl && (titleEl.getAttribute('title') || titleEl.textContent));
    const href = titleEl && titleEl.getAttribute('href');
    const channelEl = el.querySelector(SELECTORS.channel);
    const channel = cleanText(channelEl && channelEl.textContent);
    const age = findAge(el, title);
    const duration = findDuration(el);
    const indexEl = el.querySelector('#index');
    return {
      index: typeof index === 'number' ? index : null,
      position: indexEl ? cleanText(indexEl.textContent) : '',
      videoId: getVideoId(href),
      title,
      channel,
      progress: getProgress(el),
      durationSec: duration ? duration.seconds : null,
      durationText: duration ? duration.text : '',
      ageText: age ? age.text : '',
      ageDays: age ? age.days : null,
      ageSource: age ? age.source : null, // which DOM variant the age was read from (debugging)
      unavailable: isUnavailable(title, channel, el),
    };
  }

  function getItems(doc) {
    return Array.from((doc || document).querySelectorAll(SELECTORS.item));
  }

  /** Parse all currently loaded playlist items. Each result keeps a reference to its element. */
  function parseAll(doc) {
    return getItems(doc).map((el, i) => Object.assign(parseItem(el, i), { el }));
  }

  function isWatchLaterUrl(url) {
    try {
      const u = new URL(url);
      return /(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === '/playlist' && u.searchParams.get('list') === 'WL';
    } catch (_) {
      return false;
    }
  }

  Object.assign(WLC, {
    SELECTORS,
    cleanText,
    parsePercent,
    getProgress,
    parseAge,
    findAge,
    parseDuration,
    parseSpokenDuration,
    findDuration,
    parseAgeDays,
    normalizeSpaces,
    DAYS_PER,
    getVideoId,
    isUnavailable,
    parseItem,
    getItems,
    parseAll,
    isWatchLaterUrl,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
