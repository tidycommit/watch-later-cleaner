import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(root, 'extension/lib/settings.js'));
require(path.join(root, 'extension/lib/parse.js'));
const WLC = globalThis.WLC;

const popupHtml = fs.readFileSync(path.join(root, 'extension/popup/popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'extension/popup/popup.js'), 'utf8');

function installChrome({ stored, tabUrl }) {
  const store = { wlcSettings: stored };
  const tabs = { updated: null, created: null, messages: [] };
  globalThis.chrome = {
    storage: {
      sync: {
        async get(key) {
          if (typeof key === 'string') return { [key]: store[key] };
          const out = {};
          for (const k of key || []) out[k] = store[k];
          return out;
        },
        async set(obj) {
          Object.assign(store, obj);
        },
      },
    },
    tabs: {
      async query() {
        return tabUrl ? [{ id: 7, url: tabUrl }] : [];
      },
      async update(id, props) {
        tabs.updated = { id, props };
      },
      async create(props) {
        tabs.created = props;
      },
      async sendMessage(id, msg) {
        tabs.messages.push({ id, msg });
        return { ok: true };
      },
    },
  };
  return { store, tabs };
}

async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

async function boot({ stored, tabUrl }) {
  const body = (popupHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || '';
  document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  window.close = () => {};
  const handle = installChrome({ stored, tabUrl });
  new Function(popupJs)();
  await settle();
  return handle;
}

afterEach(() => {
  document.body.innerHTML = '';
  delete globalThis.chrome;
});

describe('applyFormPatch', () => {
  it('overlays named fields and keeps keys the patch does not mention', () => {
    const saved = WLC.normalizeSettings({
      matchMode: 'all',
      addedOrder: true,
      addedMode: 'range',
      addedN: 12,
      addedFrom: 4,
      addedTo: 9,
      addedSortOverride: 'newest',
      delayMs: 400,
    });
    const next = WLC.applyFormPatch(saved, { delayMs: '800' });
    expect(next).toMatchObject({
      delayMs: 800,
      matchMode: 'all',
      addedOrder: true,
      addedMode: 'range',
      addedN: 12,
      addedFrom: 4,
      addedTo: 9,
      addedSortOverride: 'newest',
    });
  });
});

describe('popup settings', () => {
  it('writes matchMode all and addedOrder back unchanged when delayMs changes', async () => {
    const saved = WLC.normalizeSettings({
      matchMode: 'all',
      addedOrder: true,
      addedMode: 'range',
      addedN: 12,
      addedFrom: 4,
      addedTo: 9,
      addedSortOverride: 'newest',
      delayMs: 400,
      menuFallbackPosition: 5,
    });
    const { store, tabs } = await boot({ stored: saved, tabUrl: 'https://m.youtube.com/playlist?list=WL' });

    expect(document.getElementById('page-status').textContent).toBe('Watch Later page detected.');
    expect(document.getElementById('show-panel').disabled).toBe(false);
    expect(document.getElementById('preview').disabled).toBe(false);

    const heading = document.querySelector('#settings h2');
    const match = heading.querySelector('select[name="matchMode"]');
    expect(match).toBeTruthy();
    expect(match.value).toBe('all');
    expect(heading.textContent.includes('matches')).toBe(true);
    expect(document.querySelector('[name="addedOrder"]').checked).toBe(true);
    expect(document.querySelector('[name="addedMode"]').value).toBe('range');

    // Remove the panel-oriented controls so a form-only save would snap them back to defaults.
    for (const name of ['matchMode', 'addedOrder', 'addedMode', 'addedN', 'addedFrom', 'addedTo', 'addedSortOverride']) {
      document.querySelector(`[name="${name}"]`).remove();
    }

    const delay = document.querySelector('[name="delayMs"]');
    expect(delay.value).toBe('400');
    delay.value = '800';
    delay.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    const written = store.wlcSettings;
    expect(written.delayMs).toBe(800);
    expect(written.matchMode).toBe('all');
    expect(written.addedOrder).toBe(true);
    expect(written.addedMode).toBe('range');
    expect(written.addedN).toBe(12);
    expect(written.addedFrom).toBe(4);
    expect(written.addedTo).toBe(9);
    expect(written.addedSortOverride).toBe('newest');
    expect(written.menuFallbackPosition).toBe(5);
    expect(tabs.messages.some((m) => m.msg.type === 'wlc:reload-settings')).toBe(true);

    document.getElementById('open-wl').click();
    expect(tabs.updated).toEqual({ id: 7, props: { url: 'https://www.youtube.com/playlist?list=WL' } });
  });

  it('keeps www.youtube.com Watch Later and rejects a lookalike host', async () => {
    await boot({ stored: WLC.normalizeSettings(null), tabUrl: 'https://www.youtube.com/playlist?list=WL' });
    expect(document.getElementById('page-status').textContent).toBe('Watch Later page detected.');

    await boot({ stored: WLC.normalizeSettings(null), tabUrl: 'https://youtube.com.evil.example/playlist?list=WL' });
    expect(document.getElementById('page-status').textContent).toBe('Open your Watch Later playlist to clean it up.');
    expect(document.getElementById('show-panel').disabled).toBe(true);

    await boot({ stored: WLC.normalizeSettings(null), tabUrl: 'https://www.youtube.com/playlist?list=PL123' });
    expect(document.getElementById('preview').disabled).toBe(true);
  });
});
