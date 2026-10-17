import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const FIXTURE_HTML = fs.readFileSync(path.join(here, 'fixtures/watch-later.html'), 'utf8');
const FAKE_MENU_SRC = fs.readFileSync(path.join(here, 'fixtures/fake-yt-menu.js'), 'utf8');

/** Load the extension libraries (they attach to globalThis.WLC, like in the content script). */
window.scrollTo = () => {}; // not implemented in jsdom

export function loadWLC() {
  for (const f of ['settings', 'parse', 'filters', 'remover']) require(`../extension/lib/${f}.js`);
  require('../extension/content/panel.js');
  return globalThis.WLC;
}

/** Replace the jsdom document with the Watch Later fixture (optionally with the fake ⋮ menu). */
export function loadFixture({ fakeMenu = false, mode = 'en' } = {}) {
  const doc = new DOMParser().parseFromString(FIXTURE_HTML, 'text/html');
  document.documentElement.replaceWith(document.importNode(doc.documentElement, true));
  if (fakeMenu) {
    window.__wlcFakeMenuMode = mode;
    new Function('window', FAKE_MENU_SRC)(window);
  }
  return document;
}
