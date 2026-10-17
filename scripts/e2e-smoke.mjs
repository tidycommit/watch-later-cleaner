// Headless smoke test: load the unpacked extension in Chrome, serve the local fixture at the real
// Watch Later URL (via request interception — nothing reaches YouTube), and check the panel + dry run.
// Removal is exercised only against the fake fixture menu. Usage:
//   CHROME_PATH=/usr/bin/google-chrome node scripts/e2e-smoke.mjs [screenshot.png]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extPath = path.join(root, 'dist', 'extension');
if (!fs.existsSync(extPath)) throw new Error('Run `npm run build` first');
const shot = path.resolve(process.argv[2] || path.join(root, 'dist', 'wl_cleaner_panel.png'));
const WL_URL = 'https://www.youtube.com/playlist?list=WL';
const fixture = fs
  .readFileSync(path.join(root, 'test/fixtures/watch-later.html'), 'utf8')
  .replace('</body>', `<script>${fs.readFileSync(path.join(root, 'test/fixtures/fake-yt-menu.js'), 'utf8')}</script></body>`);

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
  check(after.length === 5 && !after.some((t) => EXPECTED.includes(t)), `confirmed removal on fake fixture leaves 5 items`);
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
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
