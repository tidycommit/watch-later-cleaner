/* Watch Later Cleaner — injected toolbar panel (Shadow DOM, no remote code). */
(function (root) {
  'use strict';
  const WLC = (root.WLC = root.WLC || {});

  const HOST_ID = 'wlc-panel-host';

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: Roboto, Arial, sans-serif; }
    .fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; background: #cc1f1f; color: #fff;
      border: 0; border-radius: 22px; padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,.35); }
    .panel { position: fixed; right: 20px; bottom: 72px; z-index: 2147483647; width: 380px; max-height: 80vh;
      display: flex; flex-direction: column; background: #fff; color: #0f0f0f; border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,.35); font-size: 13px; overflow: hidden; }
    .panel[hidden] { display: none; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
      background: #cc1f1f; color: #fff; font-weight: 700; font-size: 14px; }
    header button { background: transparent; color: #fff; border: 0; font-size: 18px; cursor: pointer; line-height: 1; }
    .body { padding: 10px 14px; overflow-y: auto; }
    fieldset { border: 1px solid #e5e5e5; border-radius: 8px; margin: 0 0 8px; padding: 6px 10px; }
    legend { font-weight: 600; padding: 0 4px; color: #606060; font-size: 12px; }
    .row { display: flex; align-items: center; gap: 6px; margin: 5px 0; flex-wrap: wrap; }
    .row label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    input[type=number] { width: 64px; padding: 3px 4px; border: 1px solid #ccc; border-radius: 4px; }
    input[type=text] { flex: 1; min-width: 120px; padding: 4px 6px; border: 1px solid #ccc; border-radius: 4px; }
    select { padding: 3px; border: 1px solid #ccc; border-radius: 4px; }
    .danger { color: #b00020; font-weight: 600; }
    .actions { display: flex; gap: 6px; margin: 8px 0 4px; }
    .actions button { flex: 1; padding: 8px 6px; border-radius: 18px; border: 0; font-weight: 600; cursor: pointer; font-size: 12px; }
    .btn-preview { background: #0f0f0f; color: #fff; }
    .btn-remove { background: #cc1f1f; color: #fff; }
    .btn-stop { background: #e5e5e5; color: #0f0f0f; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .status { margin: 6px 0; color: #303030; min-height: 18px; }
    .bar { height: 6px; background: #eee; border-radius: 3px; overflow: hidden; }
    .bar > div { height: 100%; width: 0; background: #cc1f1f; transition: width .2s; }
    .list { margin-top: 8px; border-top: 1px solid #eee; max-height: 260px; overflow-y: auto; }
    .item { display: flex; gap: 6px; padding: 5px 0; border-bottom: 1px solid #f2f2f2; align-items: flex-start; }
    .item .meta { flex: 1; min-width: 0; }
    .item .t { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .item .c { color: #606060; font-size: 11px; }
    .item .r { color: #cc1f1f; font-size: 11px; }
    .item.kept { opacity: .6; padding-left: 20px; }
    .item.kept .r { color: #606060; }
    .age-unknown { color: #b26a00; }
    .hint { color: #606060; font-size: 11px; }
  `;

  const HTML = `
    <button class="fab" part="fab" title="Watch Later Cleaner">🧹 WL Cleaner</button>
    <div class="panel" hidden role="dialog" aria-label="Watch Later Cleaner">
      <header><span>🧹 Watch Later Cleaner</span><button class="close" title="Close">×</button></header>
      <div class="body">
        <fieldset><legend>Remove videos that match any of</legend>
          <div class="row"><label><input type="checkbox" data-k="watched"> Watched ≥</label>
            <input type="number" min="1" max="100" data-k="watchedThreshold"> %</div>
          <div class="row"><label title="Uses the publish date YouTube shows (e.g. &quot;1 year ago&quot;). Inclusive: 1 year matches &quot;1 year ago&quot;. Videos whose age can't be read are never matched."><input type="checkbox" data-k="olderThan"> Published at least</label>
            <input type="number" min="1" step="1" data-k="olderThanValue">
            <select data-k="olderThanUnit"><option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option><option value="years">years</option></select> ago</div>
          <div class="row"><label><input type="checkbox" data-k="unavailable"> Unavailable / deleted / private</label></div>
          <div class="row"><label><input type="checkbox" data-k="channelFilter"> Channel contains</label>
            <input type="text" data-k="channelKeywords" placeholder="comma-separated"></div>
          <div class="row"><label><input type="checkbox" data-k="titleFilter"> Title contains</label>
            <input type="text" data-k="titleKeywords" placeholder="comma-separated"></div>
          <div class="row danger"><label><input type="checkbox" data-k="removeAll"> Remove ALL videos</label></div>
        </fieldset>
        <fieldset><legend>Options</legend>
          <div class="row"><label><input type="checkbox" data-k="loadAllFirst"> Auto-scroll to load all videos first</label></div>
          <div class="row"><label><input type="checkbox" data-k="showKept"> Preview: also list kept videos (with parsed age)</label></div>
          <div class="row">Delay between removals <input type="number" min="100" step="50" data-k="delayMs"> ms</div>
        </fieldset>
        <div class="actions">
          <button class="btn-preview">Preview (dry run)</button>
          <button class="btn-remove" disabled>Remove…</button>
          <button class="btn-stop" disabled>Stop</button>
        </div>
        <div class="status" aria-live="polite">Choose criteria, then click Preview.</div>
        <div class="bar"><div></div></div>
        <div class="list"></div>
        <div class="hint">Nothing is removed until you click Preview and then confirm. Runs locally; no data leaves your browser.</div>
      </div>
    </div>`;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function createPanel(doc) {
    doc = doc || document;
    const existing = doc.getElementById(HOST_ID);
    if (existing && existing.__wlc) return existing.__wlc;

    const host = doc.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>${HTML}`;
    doc.documentElement.appendChild(host);

    const $ = (sel) => shadow.querySelector(sel);
    const panelEl = $('.panel');
    const statusEl = $('.status');
    const barEl = $('.bar > div');
    const listEl = $('.list');
    const btnPreview = $('.btn-preview');
    const btnRemove = $('.btn-remove');
    const btnStop = $('.btn-stop');

    const state = { settings: WLC.normalizeSettings(null), plan: null, busy: false, stop: false, armed: false };

    function readForm() {
      const raw = {};
      shadow.querySelectorAll('[data-k]').forEach((inp) => {
        raw[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value;
      });
      return WLC.normalizeSettings(raw);
    }
    function writeForm(s) {
      shadow.querySelectorAll('[data-k]').forEach((inp) => {
        if (inp.type === 'checkbox') inp.checked = Boolean(s[inp.dataset.k]);
        else inp.value = s[inp.dataset.k];
      });
    }
    function setStatus(text) {
      statusEl.textContent = text;
    }
    function setBar(frac) {
      barEl.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    }
    function invalidatePlan() {
      state.plan = null;
      state.armed = false;
      btnRemove.disabled = true;
      btnRemove.textContent = 'Remove…';
    }
    function setBusy(b) {
      state.busy = b;
      btnPreview.disabled = b;
      btnStop.disabled = !b;
      shadow.querySelectorAll('[data-k]').forEach((i) => (i.disabled = b));
      if (b) btnRemove.disabled = true;
    }

    function metaLine(v) {
      const age = v.ageDays == null ? '<span class="age-unknown">age unknown</span>' : escapeHtml(WLC.describeAge(v));
      const progress = v.progress ? ` · ${Math.round(v.progress)}% watched` : '';
      return `${escapeHtml(v.channel || '—')} · ${age}${progress}`;
    }

    function renderList(plan, kept) {
      const row = (v, reason, extra, cls) => `<label class="item${cls}">${extra}
            <span class="meta"><div class="t" title="${escapeHtml(v.title)}">${escapeHtml(v.title || '(untitled)')}</div>
            <div class="c">${metaLine(v)}</div>
            <div class="r">${escapeHtml(reason)}</div></span></label>`;
      listEl.innerHTML =
        plan.map((m, i) => row(m.video, m.reasons.join(', '), `<input type="checkbox" checked data-i="${i}">`, '')).join('') +
        (kept || []).map((v) => row(v, WLC.keepReason(v, state.settings), '', ' kept')).join('');
    }
    function selectedPlan() {
      if (!state.plan) return [];
      const boxes = Array.from(listEl.querySelectorAll('input[data-i]'));
      return state.plan.filter((_, i) => !boxes[i] || boxes[i].checked);
    }
    function updateRemoveButton() {
      const n = selectedPlan().length;
      btnRemove.disabled = state.busy || n === 0;
      btnRemove.textContent = state.armed ? `Confirm: remove ${n}` : `Remove ${n}…`;
    }

    async function preview() {
      if (state.busy) return;
      const s = (state.settings = readForm());
      WLC.saveSettings(s);
      invalidatePlan();
      if (!WLC.hasCriteria(s)) {
        setStatus('Select at least one criterion first.');
        listEl.innerHTML = '';
        return null;
      }
      state.stop = false;
      setBusy(true);
      try {
        if (s.loadAllFirst) {
          setStatus('Loading all videos (auto-scrolling)…');
          await WLC.loadAll({ doc, shouldStop: () => state.stop, onProgress: (n) => setStatus(`Loading all videos… ${n} loaded`) });
        }
        setStatus('Reading video details…');
        const videos = await WLC.parseAllSettled({ doc });
        const plan = WLC.selectVideos(videos, s);
        const matched = new Set(plan.map((m) => m.video));
        const kept = s.showKept ? videos.filter((v) => !matched.has(v)) : [];
        state.plan = plan;
        state.videos = videos;
        renderList(plan, kept);
        setBar(0);
        const unknown = videos.filter((v) => !v.unavailable && v.ageDays == null).length;
        const ageNote = s.olderThan && unknown ? ` ${unknown} video(s) have an unknown age and are never matched by the age filter.` : '';
        setStatus(
          (plan.length
            ? `Dry run: ${plan.length} of ${videos.length} videos match. Untick any to keep, then click Remove and confirm.`
            : `Dry run: no matches among ${videos.length} videos.`) + ageNote
        );
        return plan;
      } finally {
        setBusy(false);
        if (state.plan) updateRemoveButton();
      }
    }

    async function remove() {
      if (state.busy || !state.plan) return;
      if (!state.armed) {
        state.armed = true; // require a second, explicit confirm click
        updateRemoveButton();
        setStatus(`Click "Confirm: remove ${selectedPlan().length}" to start. This cannot be undone from here.`);
        return;
      }
      const plan = selectedPlan().map((m) => m.video);
      state.stop = false;
      setBusy(true);
      const s = state.settings;
      const stats = await WLC.removeVideos(plan, {
        doc,
        delayMs: s.delayMs,
        fallbackPosition: s.menuFallbackPosition,
        shouldStop: () => state.stop,
        onProgress: (p) => {
          setBar((p.done + p.failed + p.skipped) / p.total);
          setStatus(`Removing… ${p.done}/${p.total} removed${p.failed ? `, ${p.failed} failed` : ''}`);
        },
      });
      setBusy(false);
      invalidatePlan();
      listEl.innerHTML = '';
      let msg = `${stats.stopped ? 'Stopped' : 'Done'}: removed ${stats.done} of ${stats.total}.`;
      if (stats.failed) msg += ` ${stats.failed} failed.`;
      if (stats.skipped) msg += ` ${stats.skipped} skipped (no longer on page).`;
      if (stats.aborted) msg += ' Aborted after repeated failures — YouTube layout may have changed.';
      setStatus(msg);
      return stats;
    }

    btnPreview.addEventListener('click', () => preview());
    btnRemove.addEventListener('click', () => remove());
    btnStop.addEventListener('click', () => {
      state.stop = true;
      setStatus('Stopping after the current item…');
    });
    $('.fab').addEventListener('click', () => api.toggle());
    $('.close').addEventListener('click', () => api.hide());
    shadow.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-k]')) {
        if (t.dataset.k === 'removeAll' && t.checked) setStatus('⚠ "Remove ALL" ignores the other filters.');
        state.settings = readForm();
        WLC.saveSettings(state.settings);
        invalidatePlan();
      } else if (t.matches('input[data-i]')) {
        state.armed = false;
        updateRemoveButton();
      }
    });
    // Keep YouTube keyboard shortcuts from firing while typing in the panel.
    ['keydown', 'keyup', 'keypress'].forEach((ev) => shadow.addEventListener(ev, (e) => e.stopPropagation()));

    const api = {
      host,
      shadow,
      state,
      show() {
        panelEl.hidden = false;
      },
      hide() {
        panelEl.hidden = true;
      },
      toggle() {
        panelEl.hidden = !panelEl.hidden;
      },
      isOpen: () => !panelEl.hidden,
      preview,
      remove,
      stop() {
        state.stop = true;
      },
      destroy() {
        state.stop = true;
        host.remove();
      },
      async reloadSettings() {
        state.settings = await WLC.loadSettings();
        writeForm(state.settings);
      },
    };
    // Pick up changes made in the popup (or another tab) while the panel is idle.
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'sync' || !changes[WLC.STORAGE_KEY] || state.busy) return;
          const next = WLC.normalizeSettings(changes[WLC.STORAGE_KEY].newValue);
          if (JSON.stringify(next) !== JSON.stringify(state.settings)) {
            state.settings = next;
            writeForm(state.settings);
            invalidatePlan();
          }
        });
      }
    } catch (_) {
      /* not in an extension context */
    }
    host.__wlc = api;
    writeForm(state.settings);
    api.reloadSettings();
    return api;
  }

  Object.assign(WLC, { createPanel, PANEL_HOST_ID: HOST_ID });
  if (typeof module !== 'undefined' && module.exports) module.exports = WLC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
