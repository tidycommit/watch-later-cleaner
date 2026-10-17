// Headless smoke test: load the unpacked extension in Chrome, serve the local fixture at the real
// Watch Later URL (via request interception — nothing reaches YouTube), and check the panel + dry run.
// Removal is exercised only against the fake fixture menu and a mocked /youtubei/v1 endpoint (Fast mode). Usage:
//   CHROME_PATH=/usr/bin/google-chrome node scripts/e2e-smoke.mjs [screenshot.png]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { generateWatchLaterHtml } from '../test/fixtures/generate.mjs';
import { createFakeInnertube, buildInitialData, FAKE_YTCFG, generateVideos } from '../test/fixtures/innertube.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extPath = path.join(root, 'dist', 'extension');
if (!fs.existsSync(extPath)) throw new Error('Run `npm run build` first');
const shot = path.resolve(process.argv[2] || path.join(root, 'dist', 'wl_cleaner_panel.png'));
const WL_URL = 'https://www.youtube.com/playlist?list=WL';
const fixture = fs
  .readFileSync(path.join(root, 'test/fixtures/watch-later.html'), 'utf8')
  .replace('</body>', `<script>window.__wlcFake = { recycle: true, toast: true };</script><script>${fs.readFileSync(path.join(root, 'test/fixtures/fake-yt-menu.js'), 'utf8')}</script></body>`);

const ageFixture = fs.readFileSync(path.join(root, 'test/fixtures/age-variants.html'), 'utf8');
let served = fixture;
let fakeApi = null; // in-memory fake of /youtubei/v1/browse + /browse/edit_playlist (Fast mode section)

const EXPECTED = ['Learn Rust in 10 minutes', 'Lo-fi beats to study to', '[Deleted video]', '[Private video]'];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  pipe: true,
  // Keep Chrome's normal background-tab timer throttling (puppeteer disables it by default) so the
  // Fast-mode background test sees what a real hidden tab sees.
  ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  enableExtensions: [extPath],
  args: ['--no-sandbox', '--window-size=1280,900'],
  defaultViewport: { width: 1280, height: 900 },
});
let failed = false;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failed = true;
};
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (fakeApi && req.url().startsWith('https://www.youtube.com/youtubei/v1/') && req.method() === 'POST') {
      const r = fakeApi.handle({ url: req.url(), headers: req.headers(), body: req.postData() });
      req.respond({ status: r.status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(r.json) });
    } else if (req.url() === WL_URL) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: served });
    else if (/^https?:/.test(req.url())) req.abort(); // keep the test fully offline
    else req.continue();
  });
  await page.goto(WL_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('wlc-panel-host')?.shadowRoot?.querySelector('.fab'), { timeout: 15000 });
  check(true, 'content script injected the panel on the Watch Later page');

  const sr = (fn, ...args) => page.evaluate(fn, ...args);
  await sr(() => document.getElementById('wlc-panel-host').shadowRoot.querySelector('.fab').click());
  check(await sr(() => !document.getElementById('wlc-panel-host').shadowRoot.querySelector('.panel').hidden), 'panel opens from the floating button');

  await sr(() => document.getElementById('wlc-panel-host').shadowRoot.querySelector('.btn-preview').click());
  await page.waitForFunction(() => /Dry run/.test(document.getElementById('wlc-panel-host').shadowRoot.querySelector('.status').textContent), {
    timeout: 20000,
  });
  const preview = await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    return { status: s.querySelector('.status').textContent, titles: [...s.querySelectorAll('.list .item .t')].map((e) => e.textContent) };
  });
  console.log('  status:', preview.status);
  check(JSON.stringify(preview.titles) === JSON.stringify(EXPECTED), `dry run matches expected items: ${preview.titles.join(' | ')}`);
  check((await page.$$eval('ytd-playlist-video-renderer', (els) => els.length)) === 9, 'dry run removed nothing (9 items still present)');
  await page.screenshot({ path: shot });
  console.log(`  screenshot: ${shot}`);

  // Removal against the FAKE fixture menu only (two clicks: arm + confirm).
  await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    s.querySelector('[data-k="delayMs"]').value = '150';
    s.querySelector('.btn-remove').click();
  });
  check((await page.$$eval('ytd-playlist-video-renderer', (els) => els.length)) === 9, 'first Remove click only arms (nothing removed yet)');
  await sr(() => document.getElementById('wlc-panel-host').shadowRoot.querySelector('.btn-remove').click());
  await page.waitForFunction(() => /^(Done|Stopped)/.test(document.getElementById('wlc-panel-host').shadowRoot.querySelector('.status').textContent), {
    timeout: 30000,
  });
  const after = await page.$$eval('ytd-playlist-video-renderer #video-title', (els) => els.map((e) => e.textContent.trim()));
  console.log('  status:', await sr(() => document.getElementById('wlc-panel-host').shadowRoot.querySelector('.status').textContent));
  check(after.length === 5 && !after.some((t) => EXPECTED.includes(t)), `confirmed removal on fake fixture (rows recycled like Polymer, toast shown) leaves the 5 right items`);
  await page.screenshot({ path: shot.replace(/\.png$/, '_after_removal.png') });

  // Age filter against the markup-variants fixture: "Published at least 12 months ago", list kept videos too.
  served = ageFixture;
  await page.goto(WL_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('wlc-panel-host')?.shadowRoot?.querySelector('.fab'), { timeout: 15000 });
  await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    s.querySelector('.fab').click();
    const set = (k, v) => {
      const el = s.querySelector(`[data-k="${k}"]`);
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('watched', false);
    set('unavailable', false);
    set('loadAllFirst', false);
    set('olderThan', true);
    set('olderThanValue', '12');
    set('olderThanUnit', 'months');
    set('showKept', true);
    s.querySelector('.btn-preview').click();
  });
  await page.waitForFunction(() => /Dry run/.test(document.getElementById('wlc-panel-host').shadowRoot.querySelector('.status').textContent), {
    timeout: 20000,
  });
  const ageRows = await sr(() =>
    [...document.getElementById('wlc-panel-host').shadowRoot.querySelectorAll('.list .item')].map((r) => ({
      kept: r.classList.contains('kept'),
      title: r.querySelector('.t').textContent,
      meta: r.querySelector('.c').textContent,
    }))
  );
  for (const r of ageRows) console.log(`  ${r.kept ? 'keep  ' : 'remove'} ${r.title} — ${r.meta}`);
  const matchedTitles = ageRows.filter((r) => !r.kept).map((r) => r.title);
  check(
    JSON.stringify(matchedTitles) ===
      JSON.stringify(['Classic one year', 'Metadata line stream', 'What changed 2 years ago', 'Nbsp spaces', 'Abbreviated', 'A year']),
    'age filter (>= 12 months) matches all markup variants incl. "1 year ago"'
  );
  check(ageRows.some((r) => r.kept && r.title === 'No age shown' && /age unknown/.test(r.meta)), 'unknown age is kept and labelled "age unknown"');
  await page.screenshot({ path: shot.replace(/\.png$/, '_age_preview.png') });

  // Analytics tab on a generated 2,750-item Watch Later page (fake data, Korean + English titles).
  served = generateWatchLaterHtml(2750);
  await page.goto(WL_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('wlc-panel-host')?.shadowRoot?.querySelector('.fab'), { timeout: 30000 });
  await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    s.querySelector('.fab').click();
    s.querySelector('[data-tab="analytics"]').click();
  });
  const compactShot = shot.replace(/wl_cleaner_panel(\.png)$/, 'wl_cleaner_analytics_compact$1');
  await sr(() => document.getElementById('wlc-panel-host').shadowRoot.querySelector('.btn-analyze').click());
  await page.waitForFunction(() => /Analyzed/.test(document.getElementById('wlc-panel-host').shadowRoot.querySelector('.a-status').textContent), {
    timeout: 60000,
  });
  const a = await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    return {
      status: s.querySelector('.a-status').textContent,
      cards: [...s.querySelectorAll('.card')].map((c) => `${c.querySelector('.v').textContent} ${c.querySelector('.l').textContent}`),
      sections: s.querySelectorAll('.sec').length,
      channels: s.querySelectorAll('.brow.click').length,
    };
  });
  console.log('  analytics:', a.status, '|', a.cards.join(' | '));
  check(a.cards[0] === '2,750 videos' && a.sections === 9 && a.channels >= 20, 'analytics renders in the panel for 2,750 items (9 sections incl. added order, clickable channels)');
  await page.screenshot({ path: compactShot });
  await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    s.querySelector('.expand').click();
    s.querySelector('.body.view-analytics').scrollTop = 0;
  });
  const analyticsShot = shot.replace(/wl_cleaner_panel(\.png)$/, 'wl_cleaner_analytics$1');
  await page.screenshot({ path: analyticsShot });
  console.log(`  screenshot: ${analyticsShot}`);
  const prefill = await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    const row = s.querySelector('.brow.click');
    const name = row.getAttribute('data-channel');
    row.click();
    return { name, value: s.querySelector('[data-k="channelKeywords"]').value, checked: s.querySelector('[data-k="channelFilter"]').checked, cleanVisible: !s.querySelector('.view-clean').hidden };
  });
  check(prefill.value === prefill.name && prefill.checked && prefill.cleanVisible, `clicking channel "${prefill.name}" prefills the Clean tab's channel filter`);

  // Added-order criterion: "oldest 500 added" AND "published at least 3 years ago" on the 2,750-item page (Date added newest).
  await page.goto(WL_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('wlc-panel-host')?.shadowRoot?.querySelector('.fab'), { timeout: 30000 });
  const sortNote = await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    s.querySelector('.fab').click();
    const set = (k, v) => {
      const el = s.querySelector(`[data-k="${k}"]`);
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('removeAll', false);
    set('channelFilter', false);
    set('watched', false);
    set('unavailable', false);
    set('showKept', false);
    set('olderThan', true);
    set('olderThanValue', '3');
    set('olderThanUnit', 'years');
    set('addedOrder', true);
    set('addedMode', 'oldestN');
    set('addedN', '500');
    set('matchMode', 'all');
    s.querySelector('.btn-preview').click();
    return s.querySelector('.sort-note').textContent;
  });
  console.log('  sort note:', sortNote);
  await page.waitForFunction(() => /Dry run/.test(document.getElementById('wlc-panel-host').shadowRoot.querySelector('.status').textContent), { timeout: 60000 });
  const ao = await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    return { status: s.querySelector('.status').textContent, metas: [...s.querySelectorAll('.list .item .c')].map((c) => c.textContent), reasons: [...s.querySelectorAll('.list .item .r')].map((c) => c.textContent) };
  });
  console.log('  status:', ao.status);
  const ranks = ao.metas.map((m) => Number((m.match(/added #([\d,]+) of/) || [])[1]?.replace(/,/g, '')));
  check(
    /Date added \(newest\)/.test(sortNote) && ao.metas.length > 0 && ranks.every((r) => r >= 1 && r <= 500) && ao.reasons.every((r) => /≥ 3 years/.test(r) && /oldest 500 added/.test(r)),
    `added order: ${ao.metas.length} matches, all within oldest 500 added AND published ≥ 3 years (match: all)`
  );
  await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    s.querySelector('.body.view-clean').scrollTop = 140;
  });
  const addedShot = shot.replace(/wl_cleaner_panel(\.png)$/, 'wl_cleaner_added_order$1');
  await page.screenshot({ path: addedShot });
  console.log(`  screenshot: ${addedShot}`);
  // Preview analytics: Match = any (watched OR published ≥ 3 years OR oldest 500 added), wide panel.
  await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    const set = (k, v) => {
      const el = s.querySelector(`[data-k="${k}"]`);
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('watched', true);
    set('matchMode', 'any');
    if (!s.querySelector('.panel').classList.contains('expanded')) s.querySelector('.expand').click();
    s.querySelector('.btn-preview').click();
  });
  await page.waitForFunction(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    return /Dry run/.test(s.querySelector('.status').textContent) && !s.querySelector('details.pv').hidden && s.querySelector('.pv-out .card');
  }, { timeout: 60000 });
  const pv = await sr(async () => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    const first = () => s.querySelector('.pv-out .card .v').textContent;
    const before = first();
    const secs = [...s.querySelectorAll('.pv-out .sec h4')].map((h) => h.textContent);
    const row = s.querySelector('.pv-out [data-exclude-channel]');
    const name = row.getAttribute('data-exclude-channel');
    row.click();
    await new Promise((r) => setTimeout(r, 150));
    return { before, after: first(), secs, name, overlap: /by 2\+/.test(s.querySelector('.pv-out').textContent), ba: !!s.querySelector('.pv-out .ba') };
  });
  console.log('  preview analytics:', pv.before, '→', pv.after, 'after keeping', pv.name);
  const n = (t) => Number(t.split('/')[0].replace(/[^\d]/g, ''));
  check(
    pv.secs.includes('Matched by criterion') && pv.secs.some((t) => /Top channels/.test(t)) && pv.ba && pv.overlap && n(pv.after) < n(pv.before) && /\/ 2,750/.test(pv.before),
    `preview analytics renders for 2,750 items (${pv.before}); keeping channel "${pv.name}" updates it live (${pv.after})`
  );
  await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    s.querySelector('details.pv').scrollIntoView({ block: 'start' });
  });
  const pvShot = shot.replace(/wl_cleaner_panel(\.png)$/, 'wl_cleaner_preview_analytics$1');
  await page.screenshot({ path: pvShot });
  console.log(`  screenshot: ${pvShot}`);

  // ---------- Fast mode: mocked InnerTube endpoints, removal keeps going with the tab hidden ----------
  const N = 100;
  const FAKE_SAPISID = 'e2eFakeSapisid_NotReal-0123/xyz';
  const fastVideos = generateVideos(N, 11);
  fakeApi = createFakeInnertube(fastVideos, { pageSize: 40, sapisid: FAKE_SAPISID, origin: 'https://www.youtube.com' });
  const ytcfgScript = `<script>window.ytcfg={data_:${JSON.stringify(FAKE_YTCFG)},get:function(k){return this.data_[k];}};window.ytInitialData=${JSON.stringify(buildInitialData(fastVideos, { pageSize: 40 }))};</script>`;
  served = generateWatchLaterHtml(N, 11).replace('</head>', `${ytcfgScript}</head>`);
  await page.setCookie({ name: 'SAPISID', value: FAKE_SAPISID, domain: '.youtube.com', path: '/', secure: true });
  await page.goto(WL_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('wlc-panel-host')?.shadowRoot?.querySelector('.fab'), { timeout: 30000 });
  check(await page.evaluate(() => document.documentElement.getAttribute('data-wlc-bridge') === '1' && typeof window.WLC === 'undefined'), 'main-world bridge installed (and leaves no WLC global on the page)');
  await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    if (s.querySelector('.panel').hidden) s.querySelector('.fab').click();
    if (s.querySelector('.panel').classList.contains('expanded')) s.querySelector('.expand').click();
    const set = (k, v) => {
      const el = s.querySelector(`[data-k="${k}"]`);
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const [k, v] of Object.entries({ removeAll: false, addedOrder: false, olderThan: false, channelFilter: false, titleFilter: false, showKept: false, watched: true, watchedThreshold: '20', unavailable: true, matchMode: 'any', loadAllFirst: true, removalMode: 'fast', delayMs: '150' })) set(k, v);
    s.querySelector('.btn-preview').click();
  });
  await page.waitForFunction(() => /Dry run/.test(document.getElementById('wlc-panel-host').shadowRoot.querySelector('.status').textContent), { timeout: 30000 });
  const expectedFast = fastVideos.filter((v) => !v.channel || (v.progress != null && v.progress >= 20)).length;
  const fp = await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    return { status: s.querySelector('.status').textContent, rows: s.querySelectorAll('.list .item').length, mode: s.querySelector('[data-k="removalMode"]').value, note: s.querySelector('.mode-note').textContent };
  });
  console.log('  status:', fp.status);
  check(fp.mode === 'fast' && /\[Fast\]/.test(fp.status) && fp.rows === expectedFast && fakeApi.state.browseCalls === 2 && fakeApi.state.authErrors === 0,
    `Fast preview listed ${N} videos via ytInitialData + 2 browse continuations (SAPISIDHASH accepted), ${fp.rows} match`);
  await sr(() => {
    const s = document.getElementById('wlc-panel-host').shadowRoot;
    const body = s.querySelector('.body.view-clean');
    const fs = s.querySelector('.mode-row').closest('fieldset');
    body.scrollTop += fs.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
  });
  const fastShot = process.env.FAST_SHOT ? path.resolve(process.env.FAST_SHOT) : shot.replace(/wl_cleaner_panel(\.png)$/, 'wl_cleaner_fast_mode$1');
  await page.screenshot({ path: fastShot });
  console.log(`  screenshot: ${fastShot}`);

  await sr(() => document.getElementById('wlc-panel-host').shadowRoot.querySelector('.btn-remove').click());
  await sr(() => document.getElementById('wlc-panel-host').shadowRoot.querySelector('.btn-remove').click());
  const other = await browser.newPage();
  await other.bringToFront(); // the Watch Later tab is now a background tab
  const hiddenAt = Date.now();
  const visHidden = await page.evaluate(() => document.visibilityState);
  // Prove the page's own timers really are throttled now (Chrome aligns hidden-tab timers to ~1 s).
  const timerGap = await page.evaluate(() => new Promise((r) => { const t0 = performance.now(); setTimeout(() => setTimeout(() => r(Math.round(performance.now() - t0)), 10), 10); }));
  const until = Date.now() + 90000;
  while (Date.now() < until && fakeApi.state.removed.length < expectedFast) await new Promise((r) => setTimeout(r, 200));
  const visAfter = await page.evaluate(() => document.visibilityState);
  let fastStatus = '';
  for (let k = 0; k < 50 && !/^Done/.test(fastStatus); k++) {
    fastStatus = await sr(() => document.getElementById('wlc-panel-host').shadowRoot.querySelector('.status').textContent);
    if (!/^Done/.test(fastStatus)) await new Promise((r) => setTimeout(r, 200));
  }
  const edits = fakeApi.state.requests.filter((q) => /edit_playlist/.test(q.url)).map((q) => q.t);
  const hiddenEdits = edits.filter((t) => t >= hiddenAt);
  const gaps = hiddenEdits.slice(1).map((t, k) => t - hiddenEdits[k]).sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  console.log(`  hidden: ${visHidden}→${visAfter}; page timer 2×10 ms took ${timerGap} ms; ${hiddenEdits.length}/${edits.length} edit requests while hidden, median gap ${median} ms, total ${edits.length ? edits[edits.length - 1] - hiddenAt : '?'} ms`);
  console.log('  status:', fastStatus);
  check(visHidden === 'hidden' && visAfter === 'hidden', 'Watch Later tab stayed hidden (background) during removal');
  check(
    fakeApi.state.removed.length === expectedFast && hiddenEdits.length >= expectedFast - 1 && median != null && median < 900 && new RegExp(`^Done: removed ${expectedFast} of ${expectedFast}\\. \\[Fast\\]`).test(fastStatus),
    `Fast removal finished in a hidden tab: ${fakeApi.state.removed.length}/${expectedFast} via edit_playlist, median ${median} ms between requests (hidden-tab page timers: ${timerGap} ms)`
  );
  const domLeft = await page.$$eval('ytd-playlist-video-renderer', (els) => els.length);
  check(domLeft === N - expectedFast && fakeApi.state.authErrors === 0, `removed rows taken off the page (${domLeft} left), every request carried a valid SAPISIDHASH`);
  await page.bringToFront();
  await other.close();
  const editBody = fakeApi.state.requests.find((q) => /edit_playlist/.test(q.url)).body;
  check(editBody.playlistId === 'WL' && editBody.actions.length === 1 && editBody.actions[0].action === 'ACTION_REMOVE_VIDEO' && /^[0-9A-F]{16}$/.test(editBody.actions[0].setVideoId), 'edit_playlist body: playlistId WL, one ACTION_REMOVE_VIDEO with setVideoId');
  fakeApi = null;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
