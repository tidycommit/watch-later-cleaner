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
      'ytd-channel-name #text',
      '#channel-name',
    ].join(', '),
    progress: [
      'ytd-thumbnail-overlay-resume-playback-renderer #progress',
      'ytd-thumbnail-overlay-resume-playback-renderer [id="progress"]',
      '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment',
      '#overlays #progress',
    ].join(', '),
    videoInfo: '#video-info, #metadata-line',
    menuButton: [
      'ytd-menu-renderer yt-icon-button#button button',
      'ytd-menu-renderer #button button',
      'ytd-menu-renderer button',
      '#menu button',
      'button[aria-label]',
    ].join(', '),
  });

  const DAYS_PER = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30.44, year: 365.25 };

  function cleanText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
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

  /**
   * Parse relative age text like "3 years ago", "Streamed 2 weeks ago", "1 month ago" (English).
   * Returns approximate age in days, or null if it cannot be detected.
   */
  function parseAgeDays(text) {
    const t = cleanText(text).toLowerCase();
    const m = t.match(/(\d+(?:[.,]\d+)?)\s*(second|minute|hour|day|week|month|year)s?\s+ago/);
    if (!m) return null;
    return parseFloat(m[1].replace(',', '.')) * DAYS_PER[m[2]];
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

  /** Parse one ytd-playlist-video-renderer element into a plain object. */
  function parseItem(el, index) {
    const titleEl = el.querySelector(SELECTORS.title);
    const title = cleanText(titleEl && (titleEl.getAttribute('title') || titleEl.textContent));
    const href = titleEl && titleEl.getAttribute('href');
    const channelEl = el.querySelector(SELECTORS.channel);
    const channel = cleanText(channelEl && channelEl.textContent);
    const infoEl = el.querySelector(SELECTORS.videoInfo);
    let ageText = '';
    if (infoEl) {
      const parts = Array.from(infoEl.querySelectorAll('span')).map((s) => cleanText(s.textContent));
      const candidates = parts.length ? parts : [cleanText(infoEl.textContent)];
      ageText = candidates.find((p) => parseAgeDays(p) != null) || '';
    }
    const indexEl = el.querySelector('#index');
    return {
      index: typeof index === 'number' ? index : null,
      position: indexEl ? cleanText(indexEl.textContent) : '',
      videoId: getVideoId(href),
      title,
      channel,
      progress: getProgress(el),
      ageText,
      ageDays: parseAgeDays(ageText),
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
    parseAgeDays,
    getVideoId,
    isUnavailable,
    parseItem,
    getItems,
    parseAll,
    isWatchLaterUrl,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
