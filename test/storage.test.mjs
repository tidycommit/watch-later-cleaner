import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWLC } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WLC = loadWLC();
const popupHtml = fs.readFileSync(path.join(root, 'extension/popup/popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'extension/popup/popup.js'), 'utf8');

const QUOTA = 'QUOTA_BYTES_PER_ITEM quota exceeded';
const RATE = 'This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.';

function createArea({ maxItemBytes = 0, failMessage = '' } = {}) {
  const store = {};
  return {
    store,
    async get(keys) {
      const list = keys == null ? Object.keys(store) : typeof keys === 'string' ? [keys] : keys;
      const out = {};
      for (const k of list) out[k] = store[k];
      return out;
    },
    async set(items) {
      if (failMessage) {
        const err = new Error(failMessage);
        err.storageDump = JSON.parse(JSON.stringify(store));
        throw err;
      }
      const next = Object.assign({}, store);
      for (const [key, value] of Object.entries(items)) {
        const size = JSON.stringify(value).length;
        if (maxItemBytes && size > maxItemBytes) {
          const err = new Error(QUOTA);
          err.payload = value;
          throw err;
        }
        next[key] = JSON.parse(JSON.stringify(value));
      }
      for (const key of Object.keys(store)) delete store[key];
      Object.assign(store, next);
    },
  };
}

function installChrome({ sync, local } = {}) {
  globalThis.chrome = {
    storage: {
      sync: sync || createArea(),
      local: local || createArea(),
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime: { getManifest() { return { version: 'test' }; } },
    tabs: {
      async query() { return []; },
      async sendMessage() { return { ok: true }; },
      async update() {},
      async create() {},
    },
  };
  return globalThis.chrome.storage;
}

async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById(WLC.PANEL_HOST_ID)?.remove();
  delete globalThis.chrome;
});

describe('storage merge', () => {
  it('picks the newer savedAt and lets Sync win a tie', () => {
    const older = { settings: { delayMs: 400, matchMode: 'any' }, savedAt: 5 };
    const newer = { settings: { delayMs: 900, matchMode: 'all', addedOrder: true }, savedAt: 9 };
    expect(WLC.chooseStoredSettings(older, newer)).toMatchObject({ area: 'local', settings: newer.settings });
    expect(WLC.chooseStoredSettings(newer, older)).toMatchObject({ area: 'sync', settings: newer.settings });
    expect(WLC.chooseStoredSettings(older, { settings: newer.settings, savedAt: 5 }).area).toBe('sync');
    expect(WLC.chooseStoredSettings({ settings: null, savedAt: 0 }, newer).area).toBe('local');
    expect(WLC.chooseStoredSettings(older, { settings: null, savedAt: 99 }).area).toBe('sync');
  });

  it('keeps a small save in Sync and mirrors it locally', async () => {
    const sync = createArea({ maxItemBytes: 8192 });
    const local = createArea({ maxItemBytes: 8192 });
    installChrome({ sync, local });
    const saved = await WLC.saveSettings({ delayMs: 450, channelKeywords: 'short' });
    expect(saved.storageNote).toBe('');
    expect(sync.store[WLC.STORAGE_KEY].delayMs).toBe(450);
    expect(sync.store[WLC.STORAGE_KEY].channelKeywords).toBe('short');
    expect(local.store[WLC.STORAGE_KEY].delayMs).toBe(450);
    expect(sync.store[WLC.META_KEY].savedAt).toBe(local.store[WLC.META_KEY].savedAt);
    expect(JSON.stringify(sync.store)).not.toContain('storageNote');
    expect((await WLC.loadSettings()).delayMs).toBe(450);
  });

  it('falls back to local when Sync exceeds the per-item quota and loads that copy', async () => {
    const sync = createArea({ maxItemBytes: 8192 });
    const local = createArea();
    installChrome({ sync, local });
    const keywords = 'k'.repeat(9000);
    const saved = await WLC.saveSettings({ channelKeywords: keywords, matchMode: 'all', addedOrder: true });
    expect(saved.storageNote).toBe(WLC.SYNC_QUOTA_NOTE);
    expect(saved.storageNote).not.toContain(keywords);
    expect(sync.store[WLC.STORAGE_KEY]).toBeUndefined();
    expect(local.store[WLC.STORAGE_KEY].channelKeywords).toBe(keywords);
    expect(local.store[WLC.STORAGE_KEY].matchMode).toBe('all');
    const loaded = await WLC.loadSettings();
    expect(loaded.channelKeywords).toBe(keywords);
    expect(loaded.addedOrder).toBe(true);
    const log = WLC.formatDebugLog({ settings: loaded, stats: {}, log: [] });
    expect(log).toContain(keywords);
    expect(log).not.toContain('storageDump');
    expect(log).not.toContain('"wlcSettingsMeta"');
  });

  it('treats a Sync write-rate error as the same device-only note and does not store the thrown payload', async () => {
    const sync = createArea({ failMessage: RATE });
    const local = createArea();
    installChrome({ sync, local });
    const sentinel = 'RAW_STORAGE_SENTINEL';
    sync.store.leftover = sentinel;
    const saved = await WLC.saveSettings({ delayMs: 700 });
    expect(saved.storageNote).toBe(WLC.SYNC_QUOTA_NOTE);
    expect(saved.storageNote).not.toContain(sentinel);
    expect(local.store[WLC.STORAGE_KEY].delayMs).toBe(700);
    expect(JSON.stringify(local.store)).not.toContain(sentinel);
    expect((await WLC.loadSettings()).delayMs).toBe(700);
  });

  it('reports a visible failure when local cannot store the fallback either', async () => {
    installChrome({ sync: createArea({ failMessage: QUOTA }), local: createArea({ failMessage: QUOTA }) });
    const saved = await WLC.saveSettings({ delayMs: 500 });
    expect(saved.storageNote).toBe(WLC.SAVE_FAILED_NOTE);
    expect(saved.delayMs).toBe(500);
  });

  it('loads the local copy when Sync is empty', async () => {
    const sync = createArea();
    const local = createArea();
    local.store[WLC.STORAGE_KEY] = WLC.normalizeSettings({ delayMs: 800, matchMode: 'all' });
    local.store[WLC.META_KEY] = { savedAt: 50 };
    installChrome({ sync, local });
    expect(await WLC.loadSettings()).toMatchObject({ delayMs: 800, matchMode: 'all' });
  });
});

describe('storage notes in the panel and popup', () => {
  it('shows the quota note on the panel instead of failing silently', async () => {
    installChrome({ sync: createArea({ maxItemBytes: 8192 }), local: createArea() });
    const panel = WLC.createPanel(document);
    await panel.reloadSettings();
    const input = panel.shadow.querySelector('[data-k="channelKeywords"]');
    input.value = 'p'.repeat(9000);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const note = panel.shadow.querySelector('.storage-note');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(WLC.SYNC_QUOTA_NOTE);
    expect(globalThis.chrome.storage.sync.store[WLC.STORAGE_KEY]).toBeUndefined();
    expect(globalThis.chrome.storage.local.store[WLC.STORAGE_KEY].channelKeywords).toHaveLength(9000);
  });

  it('shows the quota note in the popup instead of "saved automatically"', async () => {
    installChrome({ sync: createArea({ maxItemBytes: 8192 }), local: createArea() });
    const body = (popupHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || '';
    document.body.innerHTML = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    window.close = () => {};
    new Function(popupJs)();
    await settle();
    expect(document.getElementById('saved').textContent).toBe('Settings are saved automatically.');
    const input = document.querySelector('[name="channelKeywords"]');
    input.value = 'z'.repeat(9000);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(document.getElementById('saved').textContent).toBe(WLC.SYNC_QUOTA_NOTE);
    expect(globalThis.chrome.storage.local.store[WLC.STORAGE_KEY].channelKeywords).toHaveLength(9000);
    expect(globalThis.chrome.storage.sync.store[WLC.STORAGE_KEY]).toBeUndefined();
  });
});
