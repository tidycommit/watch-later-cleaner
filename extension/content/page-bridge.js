/* Watch Later Cleaner — main-world bridge for the Fast mode (runs in the YouTube page's own JS world).
 * It makes the same same-origin InnerTube requests YouTube's web client makes (browse + edit_playlist),
 * using the page's ytcfg and cookies. The isolated content script talks to it with window.postMessage.
 * Only video ids / playlist JSON cross the bridge; cookies and the Authorization header never leave this
 * script and are never logged. Requests go to https://www.youtube.com only. */
(function (root) {
  'use strict';
  const IT = root.WLC; // innertube.js was loaded just before this file in the main world
  try {
    delete root.WLC; // don't leave our helper namespace on the page's window
  } catch (_) {
    root.WLC = undefined;
  }
  if (!IT || !IT.sha1Hex) return;
  const SOURCE = 'wlc-ext';

  function installBridge(opts) {
    const win = opts.win;
    const doc = opts.doc || win.document;
    const doFetch = opts.fetch || ((...a) => win.fetch(...a));
    const now = opts.now || (() => Date.now());
    const origin = opts.origin || (win.location && win.location.origin) || IT.IT.ORIGIN;
    if (win.__wlcBridgeInstalled) return;
    win.__wlcBridgeInstalled = true;
    // Marker the isolated content script can see (shared DOM), so it knows the bridge is there.
    if (doc.documentElement) doc.documentElement.setAttribute('data-wlc-bridge', '1');

    const cfg = () => IT.readYtcfg(win.ytcfg);
    const auth = () => IT.buildAuthorization(doc.cookie, origin, Math.floor(now() / 1000));

    async function post(path, body) {
      const c = cfg();
      const headers = IT.buildHeaders({ authorization: auth(), origin, cfg: c || {} });
      try {
        const res = await doFetch(IT.endpointUrl(path, c), { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body) });
        let json = null;
        try {
          json = await res.json();
        } catch (_) {
          json = null;
        }
        return { httpOk: Boolean(res.ok), httpStatus: res.status, json };
      } catch (e) {
        return { httpOk: false, httpStatus: 0, json: { error: { message: String((e && e.message) || e).slice(0, 120) } } };
      }
    }

    function initialData() {
      const candidates = [];
      try {
        const el = doc.querySelector('ytd-browse[page-subtype="playlist"]');
        if (el && el.data) candidates.push(el.data);
      } catch (_) {
        /* not a Polymer page */
      }
      if (win.ytInitialData) candidates.push(win.ytInitialData);
      return candidates.find((d) => IT.isWatchLaterData(d)) || null;
    }

    const ops = {
      probe() {
        const c = cfg();
        const problems = IT.fastModeProblems(c, Boolean(auth()));
        return { ready: problems.length === 0, problems, hasInitialData: Boolean(initialData()) };
      },
      initial() {
        return initialData();
      },
      async browse(args) {
        const c = cfg();
        if (!c || !c.context) return { httpOk: false, httpStatus: 0, json: { error: { message: 'ytcfg missing' } } };
        return post(IT.IT.BROWSE_PATH, IT.buildBrowseBody(c.context, args || {}));
      },
      async edit(args) {
        const c = cfg();
        if (!c || !c.context) return { httpOk: false, httpStatus: 0, json: { error: { message: 'ytcfg missing' } } };
        const body = IT.buildEditPlaylistBody(c.context, (args && args.videos) || []);
        if (!body.actions.length) return { httpOk: false, httpStatus: 0, json: { error: { message: 'no video id' } } };
        const r = await post(IT.IT.EDIT_PLAYLIST_PATH, body);
        const j = r.json || {};
        // Hand back only what's needed to judge success.
        return { httpOk: r.httpOk, httpStatus: r.httpStatus, json: { status: j.status, error: j.error ? { status: j.error.status, code: j.error.code, message: j.error.message } : undefined } };
      },
    };

    win.addEventListener('message', async (e) => {
      if (e.source !== win && e.source != null) return; // only this window (not frames)
      const m = e.data;
      if (!m || m.source !== SOURCE || m.dir !== 'req' || !ops[m.op]) return;
      let reply;
      try {
        reply = { source: SOURCE, dir: 'res', id: m.id, ok: true, result: await ops[m.op](m.args) };
      } catch (err) {
        reply = { source: SOURCE, dir: 'res', id: m.id, ok: false, error: String((err && err.message) || err).slice(0, 200) };
      }
      win.postMessage(reply, origin === 'null' ? '*' : origin);
    });
  }

  if (root.document && root.location && /(^|\.)youtube\.com$/.test(root.location.hostname)) installBridge({ win: root });
  else root.__wlcInstallBridge = installBridge; // tests only (never defined on youtube.com)
})(typeof globalThis !== 'undefined' ? globalThis : this);
