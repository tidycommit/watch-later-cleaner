// Deterministic generator for a large, realistic-looking Watch Later page (fake data) — used by the
// analytics performance test and the e2e analytics screenshot. Mirrors the markup of watch-later.html.
const CHANNELS = [
  '침착맨', '피식대학', 'Tech Channel', 'Kitchen Lab', 'Chill Music', '슈카월드', 'Gadget Reviews', 'Talk Show Daily',
  '백종원 PAIK JONG WON', 'Fireship', 'Veritasium', '워크맨-Workman', 'Kurzgesagt', 'MKBHD', '빠니보틀', 'Lex Fridman',
  'Linus Tech Tips', '김사원세끼', 'Tasty', 'NPR Music',
];
const EN_WORDS = ['Learn', 'Rust', 'in', '10', 'minutes', 'review', 'full', 'course', 'live', 'concert', 'podcast', 'recipe', 'guide', 'vlog', 'explained', 'tips'];
const KO_WORDS = ['리뷰', '먹방', '브이로그', '여행', '요리', '라이브', '모음', '꿀팁', '역대급', '반응', '정리', '공부'];
const AGES = ['3 days ago', '2 weeks ago', '1 month ago', '4 months ago', '8 months ago', '11 months ago', '1 year ago', '2 years ago', '3 years ago', '5 years ago', 'Streamed 4 years ago', '7 years ago'];

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmt = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
};

export function generateVideos(n, seed = 7) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = `v${String(i).padStart(10, '0')}`;
    if (r() < 0.02) {
      out.push({ id, title: r() < 0.5 ? '[Deleted video]' : '[Private video]', channel: null });
      continue;
    }
    const style = r();
    const words = (arr, k) => Array.from({ length: k }, () => pick(arr)).join(' ');
    const title = style < 0.4 ? words(KO_WORDS, 3) : style < 0.6 ? `${words(KO_WORDS, 2)} ${words(EN_WORDS, 2)}` : words(EN_WORDS, 4);
    const dr = r();
    const duration = Math.floor(dr < 0.25 ? 30 + r() * 270 : dr < 0.6 ? 300 + r() * 900 : dr < 0.85 ? 1200 + r() * 2400 : dr < 0.95 ? 3600 + r() * 3600 : 7200 + r() * 7200);
    const pr = r();
    const progress = pr < 0.6 ? null : pr < 0.8 ? Math.floor(5 + r() * 80) : 90 + Math.floor(r() * 11);
    out.push({ id, title, channel: CHANNELS[Math.floor(Math.pow(r(), 1.8) * CHANNELS.length)], duration, progress, age: pick(AGES), views: `${Math.floor(r() * 900) + 1}K views` });
  }
  return out;
}

function itemHtml(v, i) {
  const href = `/watch?v=${v.id}&amp;list=WL&amp;index=${i + 1}`;
  const overlays = v.channel
    ? `<ytd-thumbnail-overlay-time-status-renderer><div class="thumbnail-overlay-badge-shape"><badge-shape class="badge-shape-wiz"><div class="badge-shape-wiz__text">${fmt(v.duration)}</div></badge-shape></div></ytd-thumbnail-overlay-time-status-renderer>` +
      (v.progress != null ? `<ytd-thumbnail-overlay-resume-playback-renderer><div id="progress" style="width: ${v.progress}%;"></div></ytd-thumbnail-overlay-resume-playback-renderer>` : '')
    : '';
  return `<ytd-playlist-video-renderer><div id="content"><div id="index-container"><yt-formatted-string id="index">${i + 1}</yt-formatted-string></div>
<div id="container"><ytd-thumbnail><a id="thumbnail" href="${href}"><div id="overlays">${overlays}</div></a></ytd-thumbnail>
<div id="meta"><h3><a id="video-title" href="${href}" title="${esc(v.title)}">${esc(v.title)}</a></h3>
<ytd-video-meta-block class="playlist"><div id="metadata"><div id="byline-container">
<ytd-channel-name id="channel-name"><yt-formatted-string id="text">${v.channel ? `<a href="/@c">${esc(v.channel)}</a>` : ''}</yt-formatted-string></ytd-channel-name>
<yt-formatted-string id="video-info">${v.channel ? `<span>${v.views}</span><span>•</span><span>${v.age}</span>` : ''}</yt-formatted-string>
</div></div></ytd-video-meta-block></div></div></div>
<div id="menu"><ytd-menu-renderer><yt-icon-button id="button"><button id="button" aria-label="Action menu"></button></yt-icon-button></ytd-menu-renderer></div>
</ytd-playlist-video-renderer>`;
}

function sortMenuHtml(selected) {
  const opts = ['Date added (newest)', 'Date added (oldest)', 'Most popular', 'Date published (newest)', 'Date published (oldest)'];
  return `<yt-sort-filter-sub-menu-renderer style="display:block;padding:0 24px 8px;color:#606060;font-size:13px"><yt-dropdown-menu><tp-yt-paper-menu-button>
<div id="trigger"><tp-yt-paper-button id="label"><div id="label-text">Sort: ${selected}</div></tp-yt-paper-button></div>
<tp-yt-paper-listbox id="menu" style="display:none">${opts
    .map((o) => `<a><tp-yt-paper-item role="option" aria-selected="${o === selected}"${o === selected ? ' class="iron-selected"' : ''}><div class="item">${o}</div></tp-yt-paper-item></a>`)
    .join('')}</tp-yt-paper-listbox></tp-yt-paper-menu-button></yt-dropdown-menu></yt-sort-filter-sub-menu-renderer>`;
}

export function generateWatchLaterHtml(n, seed = 7, sort = 'Date added (newest)') {
  const rows = generateVideos(n, seed).map(itemHtml).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Watch later - YouTube</title>
<style>body{font-family:Roboto,Arial,sans-serif;margin:0;background:#f9f9f9} ytd-playlist-video-renderer{display:flex;justify-content:space-between;padding:6px 24px;border-bottom:1px solid #e5e5e5;background:#fff} #video-title{color:#0f0f0f;font-weight:500;text-decoration:none} ytd-thumbnail-overlay-resume-playback-renderer{display:block;height:4px;width:120px;background:#ccc} #progress{height:4px;background:red} #video-info,ytd-channel-name a{color:#606060;font-size:12px} h1{padding:16px 24px;margin:0}</style>
</head><body><ytd-app><h1>Watch later</h1><ytd-playlist-byline-renderer style="display:block;padding:0 24px;color:#606060">${n.toLocaleString('en-US')} videos</ytd-playlist-byline-renderer>${sortMenuHtml(sort)}<ytd-browse page-subtype="playlist"><ytd-playlist-video-list-renderer><div id="contents">
${rows}
</div></ytd-playlist-video-list-renderer></ytd-browse></ytd-app><ytd-popup-container></ytd-popup-container></body></html>`;
}
