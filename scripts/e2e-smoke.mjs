// Headless smoke test: load the unpacked extension in Chrome, serve the local fixture at the real
// Watch Later URL (via request interception — nothing reaches YouTube), and check the panel + dry run.
// Removal is exercised only against the fake fixture menu. Usage:
//   CHROME_PATH=/usr/bin/google-chrome node scripts/e2e-smoke.mjs [screenshot.png]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { generateWatchLaterHtml } from '../test/fixtures/generate.mjs';

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

const EXPECTED = ['Learn Rust in 10 minutes', 'Lo-fi beats to study to', '[Deleted video]', '[Private video]'];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  pipe: true,
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
    if (req.url() === WL_URL) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: served });
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
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
