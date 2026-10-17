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
    .panel { position: fixed; right: 20px; bottom: 72px; z-index: 2147483647; width: min(380px, calc(100vw - 40px)); max-height: 85vh;
      display: flex; flex-direction: column; background: #fff; color: #0f0f0f; border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,.35); font-size: 13px; overflow: hidden; }
    .panel[hidden] { display: none; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px;
      background: #cc1f1f; color: #fff; font-weight: 700; font-size: 14px; }
    header button { background: transparent; color: #fff; border: 0; font-size: 18px; cursor: pointer; line-height: 1; }
    .panel.expanded { width: min(860px, calc(100vw - 40px)); }
    header .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    header .hbtns { display: flex; gap: 6px; align-items: center; }
    .tabs { display: flex; border-bottom: 1px solid #e5e5e5; background: #fafafa; }
    .tabs button { flex: 1; border: 0; background: transparent; padding: 8px; font-weight: 600; font-size: 12px; cursor: pointer;
      color: #606060; border-bottom: 2px solid transparent; }
    .tabs button[aria-selected=true] { color: #cc1f1f; border-bottom-color: #cc1f1f; }
    .view[hidden] { display: none; }
    .btn-analyze { background: #0f0f0f; color: #fff; }
    .btn-csv, .btn-json { background: #fff; color: #0f0f0f; border: 1px solid #ccc !important; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(105px, 1fr)); gap: 6px; margin: 8px 0; }
    .card { background: #f6f6f6; border-radius: 8px; padding: 6px 8px; }
    .card .v { font-size: 16px; font-weight: 700; }
    .card .l { font-size: 11px; color: #606060; }
    .a-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 4px 16px; }
    .sec h4 { margin: 10px 0 4px; font-size: 12px; color: #303030; text-transform: uppercase; letter-spacing: .03em; }
    .brow { display: grid; grid-template-columns: minmax(70px, 38%) 1fr auto; gap: 6px; align-items: center; font-size: 12px; margin: 2px 0; }
    .brow .bl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .brow .bt { height: 10px; background: #f0f0f0; border-radius: 5px; overflow: hidden; }
    .brow .bt > i { display: block; height: 100%; background: #cc1f1f; border-radius: 5px; }
    .brow .bv { color: #606060; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .brow.click { cursor: pointer; }
    .brow.click:hover .bl { text-decoration: underline; color: #cc1f1f; }
    .mini { font-size: 12px; margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mini a { color: #0f0f0f; text-decoration: none; }
    .mini a:hover { text-decoration: underline; }
    .mini span { color: #606060; }
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
    .btn-resume { background: #1a73e8; color: #fff; }
    .btn-log { background: #fff; color: #0f0f0f; border: 1px solid #ccc !important; }
    .actions.secondary button[hidden] { display: none; }
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
    .am[hidden] { display: none; }
    details.pv { margin-top: 8px; border: 1px solid #eee; border-radius: 8px; padding: 4px 8px; }
    details.pv[hidden] { display: none; }
    details.pv summary { cursor: pointer; font-weight: 600; font-size: 12px; color: #303030; padding: 2px 0; }
    .pv-actions button { background: #fff; color: #0f0f0f; border: 1px solid #ccc !important; padding: 5px 6px; }
    .pv .cards { grid-template-columns: repeat(auto-fit, minmax(95px, 1fr)); }
    .pv .note { font-size: 11px; color: #606060; margin: 2px 0; }
    .ba { display: grid; grid-template-columns: auto 1fr auto; gap: 3px 6px; align-items: center; font-size: 12px; }
    .ba .bt { height: 10px; background: #f0f0f0; border-radius: 5px; overflow: hidden; }
    .ba .bt > i { display: block; height: 100%; border-radius: 5px; background: #909090; }
    .ba .bt > i.after { background: #1a73e8; }
    .sort-row { font-size: 11px; color: #606060; }
    .sort-row.bad .sort-note { color: #b26a00; }
    legend select { font-size: 12px; padding: 0 2px; }
    .added { color: #1a73e8; }
    .hint { color: #606060; font-size: 11px; }
    .mode-row select { flex: 1; }
    .mode-note { margin-top: -2px; }
  `;

  const HTML = `
    <button class="fab" part="fab" title="Watch Later Cleaner">🧹 WL Cleaner</button>
    <div class="panel" hidden role="dialog" aria-label="Watch Later Cleaner">
      <header><span class="title">🧹 Watch Later Cleaner</span>
        <span class="hbtns"><button class="expand" title="Wider panel">⤢</button><button class="close" title="Close">×</button></span></header>
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="clean" aria-selected="true">Clean</button>
        <button role="tab" data-tab="analytics" aria-selected="false">Analytics</button>
      </div>
      <div class="body view view-clean" data-view="clean">
        <fieldset><legend>Remove videos that match <select data-k="matchMode" title="any = a video matching one ticked criterion is removed; all = it must match every ticked criterion"><option value="any">any</option><option value="all">all</option></select> of</legend>
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
          <div class="row added-row"><label title="Uses the playlist's Date added sort (YouTube doesn't show the added date itself)."><input type="checkbox" data-k="addedOrder"> Added order</label>
            <select data-k="addedMode"><option value="oldestN">Oldest N added</option><option value="below">Below position #</option><option value="range">Positions #…#</option></select>
            <span class="am am-n"><input type="number" min="1" step="1" data-k="addedN" title="N"></span>
            <span class="am am-from"><input type="number" min="1" step="1" data-k="addedFrom" title="Position"></span>
            <span class="am am-to">to <input type="number" min="0" step="1" data-k="addedTo" title="Last position (0 = to the end)"></span></div>
          <div class="row sort-row hint"><span class="sort-note"></span>
            <select data-k="addedSortOverride" title="Only if the sort can't be detected (e.g. other UI languages)"><option value="auto">detect sort</option><option value="newest">list is newest-added first</option><option value="oldest">list is oldest-added first</option></select></div>
          <div class="row danger"><label><input type="checkbox" data-k="removeAll"> Remove ALL videos</label></div>
        </fieldset>
        <fieldset><legend>Options</legend>
          <div class="row mode-row"><label for="wlc-mode">Mode</label>
            <select id="wlc-mode" data-k="removalMode" title="Fast uses YouTube's own web requests and keeps working in a background tab; Classic clicks each row's ⋮ menu."><option value="fast">Fast (works in background)</option><option value="classic">Classic (page clicks)</option></select></div>
          <div class="row hint mode-note"></div>
          <div class="row"><label><input type="checkbox" data-k="loadAllFirst"> Load all videos first (Classic: auto-scroll)</label></div>
          <div class="row"><label><input type="checkbox" data-k="showKept"> Preview: also list kept videos (with parsed age)</label></div>
          <div class="row">Delay between removals <input type="number" min="100" step="50" data-k="delayMs"> ms</div>
        </fieldset>
        <div class="actions">
          <button class="btn-preview">Preview (dry run)</button>
          <button class="btn-remove" disabled>Remove…</button>
          <button class="btn-stop" disabled>Stop</button>
        </div>
        <div class="actions secondary">
          <button class="btn-resume" hidden>Resume</button>
          <button class="btn-log" disabled title="Copy a plain-text log of every removal attempt (for troubleshooting)">Copy debug log</button>
        </div>
        <div class="status" aria-live="polite">Choose criteria, then click Preview.</div>
        <div class="bar"><div></div></div>
        <details class="pv" hidden open><summary>Preview analytics</summary><div class="pv-out"></div>
          <div class="actions pv-actions"><button class="btn-pv-tick">Tick all</button><button class="btn-pv-csv">Export CSV</button><button class="btn-pv-json">Export JSON</button></div>
        </details>
        <div class="list"></div>
        <div class="hint">Nothing is removed until you click Preview and then confirm. Runs in your browser and only talks to youtube.com.</div>
      </div>
      <div class="body view view-analytics" data-view="analytics" hidden>
        <div class="actions">
          <button class="btn-analyze">Analyze playlist</button>
          <button class="btn-csv" disabled>Export CSV</button>
          <button class="btn-json" disabled>Export JSON</button>
        </div>
        <div class="a-status status" aria-live="polite">Click "Analyze playlist" — it loads the whole list (if auto-scroll is on) and computes stats locally.</div>
        <div class="a-out"></div>
        <div class="hint">Computed in your browser; nothing is sent anywhere except youtube.com (Fast mode loads the list from YouTube itself). Click a channel to prefill the Clean tab's channel filter.</div>
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
    const btnResume = $('.btn-resume');
    const btnLog = $('.btn-log');

    const state = {
      settings: WLC.normalizeSettings(null),
      plan: null,
      busy: false,
      stop: false,
      armed: false,
      pending: [], // videos (by id) still to remove after Stop / pause — used by Resume
      log: [],
      lastStats: null,
      api: null,
      lastMode: null,
    };

    function fastApi() {
      if (!state.api) state.api = WLC.createFastApi({ win: doc.defaultView || root, doc });
      return state.api;
    }
    function modeLabel(m) {
      return m === 'classic' ? 'Classic' : 'Fast';
    }
    function applyModeNote() {
      const s = readForm();
      $('.mode-note').textContent =
        s.removalMode === 'fast'
          ? "Uses YouTube's own web requests; keeps running when this tab is in the background. Falls back to Classic automatically."
          : "Clicks each row's ⋮ menu. Keep this tab visible — background tabs are throttled.";
    }
    function logEvent(e) {
      if (state.log.length < 20000) state.log.push(e);
    }

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
      if (shadow.querySelector('.mode-note')) applyModeNote();
    }
    function pvElRef() {
      return shadow.querySelector('details.pv');
    }
    function setStatus(text) {
      statusEl.textContent = text;
    }
    function setBar(frac) {
      barEl.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    }
    function invalidatePlan() {
      if (pvElRef()) pvElRef().hidden = true;
      state.plan = null;
      state.armed = false;
      btnRemove.disabled = true;
      btnRemove.textContent = 'Remove…';
    }
    function updateSecondary() {
      btnResume.hidden = state.busy || !state.pending.length;
      btnResume.textContent = `Resume (${state.pending.length} left)`;
      btnLog.disabled = !state.log.length;
    }
    function setBusy(b) {
      state.busy = b;
      btnPreview.disabled = b;
      btnStop.disabled = !b;
      shadow.querySelectorAll('[data-k]').forEach((i) => (i.disabled = b));
      if (b) btnRemove.disabled = true;
      updateSecondary();
      if (state.sort) applyAddedState();
    }

    function applyAddedState() {
      const s = readForm();
      const mode = s.addedMode;
      $('.am-n').hidden = mode !== 'oldestN';
      $('.am-from').hidden = mode === 'oldestN';
      $('.am-to').hidden = mode !== 'range';
      const sort = state.sort || { available: false, reason: '' };
      const lock = state.busy || !sort.available;
      ['addedOrder', 'addedMode', 'addedN', 'addedFrom', 'addedTo'].forEach((k) => ($(`[data-k="${k}"]`).disabled = lock));
      $('.sort-row').classList.toggle('bad', !sort.available);
      $('.sort-note').textContent = sort.available
        ? `Sort: ${sort.label} — added #1 = oldest.${s.addedMode === 'oldestN' && sort.direction === 'newest' ? ' Loads the full list first.' : ''}`
        : sort.reason;
    }

    function refreshSort() {
      const detected = WLC.detectSort(doc);
      state.sort = WLC.resolveAddedSort(detected, readForm().addedSortOverride);
      state.sort.detected = detected;
      applyAddedState();
      return state.sort;
    }

    function metaLine(v) {
      const age = v.ageDays == null ? '<span class="age-unknown">age unknown</span>' : escapeHtml(WLC.describeAge(v));
      const progress = v.progress ? ` · ${Math.round(v.progress)}% watched` : '';
      const added = v.addedRank != null ? ` · <span class="added">${escapeHtml(WLC.describeAdded(v))}</span>` : '';
      return `${escapeHtml(v.channel || '—')} · ${age}${progress}${added}`;
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

    // ---------- Preview analytics (matched set) ----------
    const pvEl = $('details.pv');
    const pvOut = $('.pv-out');
    let pvTimer = null;

    function renderPreviewStats() {
      if (!state.plan || !state.videos) {
        pvEl.hidden = true;
        return null;
      }
      const sel = selectedPlan();
      if (!state.baseStats) state.baseStats = WLC.computeStats(state.videos, { watchedThreshold: state.settings.watchedThreshold });
      const ps = WLC.computePreviewStats(state.videos, sel, { base: state.baseStats, watchedThreshold: state.settings.watchedThreshold });
      state.previewStats = ps;
      pvEl.hidden = !state.plan.length;
      const H = WLC.formatHours;
      const m = ps.matched;
      const n = m.available + m.unavailable;
      const card = (v, l) => `<div class="card"><div class="v">${escapeHtml(v)}</div><div class="l">${escapeHtml(l)}</div></div>`;
      const pct = (k) => pctOf(k, n);
      const bucketRows = (defs, data) =>
        defs.concat([{ key: 'unknown', label: 'Unknown' }]).map((b) => ({ label: b.label, value: data[b.key] || 0, display: `${data[b.key] || 0} · ${pct(data[b.key] || 0)}` }));
      const ba = (label, before, after, fmt) => {
        const max = Math.max(1, before);
        return `<span>${escapeHtml(label)} now</span><span class="bt"><i style="width:100%"></i></span><span>${escapeHtml(fmt(before))}</span>
          <span>${escapeHtml(label)} after</span><span class="bt"><i class="after" style="width:${Math.round((after / max) * 100)}%"></i></span><span>${escapeHtml(fmt(after))}</span>`;
      };
      const num = (x) => x.toLocaleString('en-US');
      const crit = Object.entries(ps.criteria)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ label: k, value: v, display: `${num(v)} · ${pct(v)}` }));
      const overlap =
        state.settings.matchMode === 'all' || state.settings.removeAll
          ? ''
          : `<div class="note">Matched by one criterion: ${num(ps.overlap.single)} · by 2+: ${num(ps.overlap.multi)}${
              ps.overlap.combos.length ? ` (${ps.overlap.combos.map((c) => `${escapeHtml(c.combo)}: ${num(c.count)}`).join('; ')})` : ''
            }</div>`;
      const range = ps.addedRange
        ? `<div class="note">Added rank range: #${num(ps.addedRange.min)}–#${num(ps.addedRange.max)}${ps.addedRange.total ? ` of ${num(ps.addedRange.total)}` : ''} (oldest = 1)</div>`
        : '';
      pvOut.innerHTML = `
        <div class="cards">
          ${card(`${num(ps.count)} / ${num(ps.total)}`, `selected · ${Math.round(ps.pct * 100)}% of playlist`)}
          ${card(H(ps.freedSec), 'would be freed')}
          ${card(WLC.formatDuration(m.avgDurationSec), 'avg duration')}
          ${card(num(ps.after.videos), 'videos after')}
          ${card(H(ps.after.durationSec), 'hours after')}
        </div>
        <div class="ba">${ba('Videos', ps.before.videos, ps.after.videos, num)}${ba('Hours', ps.before.durationSec, ps.after.durationSec, H)}</div>
        ${range}
        <div class="a-grid">
          <div class="sec"><h4>Matched by criterion</h4>${bars(crit)}${overlap}</div>
          <div class="sec"><h4>Watch progress</h4>${bars([
            { label: 'Watched', value: m.watch.watched, display: `${m.watch.watched} · ${pct(m.watch.watched)}` },
            { label: 'Partially watched', value: m.watch.partial, display: `${m.watch.partial} · ${pct(m.watch.partial)}` },
            { label: 'Unwatched', value: m.watch.unwatched, display: `${m.watch.unwatched} · ${pct(m.watch.unwatched)}` },
            { label: 'Unavailable', value: m.unavailable, display: `${m.unavailable} · ${pct(m.unavailable)}` },
          ])}</div>
          <div class="sec"><h4>Published (age)</h4>${bars(bucketRows(WLC.AGE_BUCKETS, m.age))}</div>
          <div class="sec"><h4>Duration</h4>${bars(bucketRows(WLC.DURATION_BUCKETS, m.duration))}</div>
          <div class="sec"><h4>Top channels (click to keep)</h4>${bars(
            m.topChannelsByCount.slice(0, 10).map((c) => ({ label: c.channel, value: c.count, display: `${c.count} · ${H(c.durationSec)}` })),
            { exclude: true }
          )}</div>
        </div>`;
      return ps;
    }

    function schedulePreviewStats() {
      clearTimeout(pvTimer);
      pvTimer = setTimeout(renderPreviewStats, 60); // coalesce bursts of tick changes on big lists
    }

    /** Untick every preview row from a channel (keep them in Watch later). Returns the number unticked. */
    function excludeChannel(name) {
      if (!state.plan) return 0;
      let k = 0;
      listEl.querySelectorAll('input[data-i]').forEach((box) => {
        const m = state.plan[Number(box.dataset.i)];
        if (box.checked && m && (m.video.channel || '(unknown channel)') === name) {
          box.checked = false;
          k++;
        }
      });
      state.armed = false;
      updateRemoveButton();
      renderPreviewStats();
      setStatus(`Keeping ${k} video(s) from “${name}” — unticked in the list. ${selectedPlan().length} selected for removal.`);
      return k;
    }

    function tickAll() {
      listEl.querySelectorAll('input[data-i]').forEach((box) => (box.checked = true));
      state.armed = false;
      updateRemoveButton();
      renderPreviewStats();
    }

    function exportPreview(kind) {
      const videos = selectedPlan().map((m) => m.video);
      if (!videos.length) return '';
      const text = kind === 'csv' ? WLC.toCSV(videos) : WLC.toJSON(videos, state.previewStats ? state.previewStats.matched : undefined);
      download(`watch-later-preview-${stamp()}.${kind}`, text, kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
      return text;
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
      state.pending = []; // a new preview replaces any unfinished run
      setBusy(true);
      try {
        const sort = refreshSort();
        // The added-order criterion always needs the full list (the oldest-added are at the end when newest-first).
        const loadAll = s.loadAllFirst || s.addedOrder;
        state.log = [];
        let using = s.removalMode;
        setStatus(using === 'fast' ? 'Loading the list (Fast)…' : loadAll ? 'Loading all videos (auto-scrolling)…' : 'Reading video details…');
        const listed = await WLC.listVideos({
          mode: s.removalMode,
          api: fastApi(),
          doc,
          loadAll,
          needPageOrder: s.addedOrder,
          shouldStop: () => state.stop,
          onLog: logEvent,
          onFallback: () => {
            using = 'classic';
            setStatus(loadAll ? 'Fast mode unavailable — loading all videos (auto-scrolling)…' : 'Fast mode unavailable — reading the page…');
          },
          onProgress: (n) => setStatus(`Loading all videos (${modeLabel(using)})… ${n} loaded`),
        });
        state.lastMode = listed.mode;
        const incomplete = listed.incomplete;
        const headerCount = WLC.getPlaylistCount(doc);
        const videos = listed.videos;
        WLC.annotateAddedOrder(videos, sort.available ? sort.direction : null);
        const ctx = { addedOrder: { available: sort.available, direction: sort.direction, incomplete } };
        const plan = WLC.selectVideos(videos, s, ctx);
        const matched = new Set(plan.map((m) => m.video));
        const kept = s.showKept ? videos.filter((v) => !matched.has(v)) : [];
        state.plan = plan;
        state.videos = videos;
        state.baseStats = null;
        renderList(plan, kept);
        renderPreviewStats();
        setBar(0);
        const unknown = videos.filter((v) => !v.unavailable && v.ageDays == null).length;
        const ageNote = s.olderThan && unknown ? ` ${unknown} video(s) have an unknown age and are never matched by the age filter.` : '';
        let addedNote = '';
        if (s.addedOrder && !sort.available) addedNote = ` Added order ignored: ${sort.reason}`;
        else if (s.addedOrder && incomplete) {
          addedNote = ` ⚠ The list didn't finish loading (${videos.length} loaded${headerCount ? ` of ${headerCount}` : ''})${
            sort.direction === 'newest' && s.addedMode === 'oldestN' ? ' — "Oldest N added" matched nothing; try Preview again' : ''
          }.`;
        } else if (s.addedOrder && headerCount && headerCount > videos.length) {
          addedNote = ` Header says ${headerCount.toLocaleString('en-US')} videos, ${videos.length.toLocaleString('en-US')} listed (hidden unavailable videos aren't ranked).`;
        }
        if (s.matchMode === 'all') addedNote += ' Match: all ticked criteria.';
        const modeNote = listed.fallbackReason ? ` [Classic: Fast mode unavailable — ${listed.fallbackReason}]` : ` [${modeLabel(listed.mode)}]`;
        setStatus(
          (plan.length
            ? `Dry run: ${plan.length} of ${videos.length} videos match. Untick any to keep, then click Remove and confirm.`
            : `Dry run: no matches among ${videos.length} videos.`) + ageNote + addedNote + modeNote
        );
        return plan;
      } finally {
        setBusy(false);
        if (state.plan) updateRemoveButton();
      }
    }

    function stepSummary(steps) {
      return Object.entries(steps || {})
        .map(([k, n]) => `${k} ×${n}`)
        .join(', ');
    }

    async function runRemoval(entries) {
      state.stop = false;
      setBusy(true);
      const s = state.settings;
      let stats;
      try {
        stats = await WLC.removeWithFallback(entries, {
          mode: s.removalMode,
          api: fastApi(),
          doc,
          delayMs: s.delayMs,
          fallbackPosition: s.menuFallbackPosition,
          shouldStop: () => state.stop,
          onLog: logEvent,
          onFallback: (reason) => setStatus(`Fast mode failed (${reason}) — switching to Classic (page clicks)…`),
          onProgress: (p) => {
            setBar((p.done + p.failed + p.skipped) / p.total);
            let msg = `Removing (${modeLabel(p.mode)})… ${p.done}/${p.total} removed`;
            if (p.failed) msg += `, ${p.failed} failed`;
            if (p.skipped) msg += `, ${p.skipped} already gone`;
            if (p.delayMs > s.delayMs) msg += ` (slowed to ${p.delayMs} ms — YouTube may be throttling)`;
            setStatus(msg);
          },
        });
      } finally {
        setBusy(false);
      }
      state.lastStats = stats;
      state.lastMode = stats.modeUsed;
      state.pending = stats.remaining;
      let msg = `${stats.stopped ? 'Stopped' : stats.aborted ? 'Paused' : 'Done'}: removed ${stats.done} of ${stats.total}.`;
      msg += stats.modeUsed === 'fast' ? ' [Fast]' : stats.modeUsed === 'fast→classic' ? ' [Fast → Classic fallback]' : stats.fallbackReason ? ' [Classic: Fast mode unavailable]' : ' [Classic]';
      if (stats.skipped) msg += ` ${stats.skipped} were already gone.`;
      if (stats.failed) msg += ` ${stats.failed} failed (${stepSummary(stats.steps)}).`;
      if (stats.aborted) msg += ` Paused after 8 failed videos in a row — YouTube may be throttling or its layout changed.`;
      if (stats.modeUsed === 'fast' && stats.done) msg += ' Removed rows were taken off this page; reload it to refresh the list from YouTube.';
      if (state.pending.length) msg += ` Click Resume to continue the remaining ${state.pending.length}.`;
      if (stats.failed || stats.aborted) msg += ' Use "Copy debug log" if this keeps happening.';
      setStatus(msg);
      updateSecondary();
      return stats;
    }

    async function remove() {
      if (state.busy || !state.plan) return;
      if (!state.armed) {
        state.armed = true; // require a second, explicit confirm click
        updateRemoveButton();
        setStatus(`Click "Confirm: remove ${selectedPlan().length}" to start. This cannot be undone from here.`);
        return;
      }
      const entries = selectedPlan().map((m) => WLC.toPlanEntry(m.video)); // ids, not DOM positions
      invalidatePlan();
      listEl.innerHTML = '';
      state.log = [];
      return runRemoval(entries);
    }

    async function resume() {
      if (state.busy || !state.pending.length) return;
      return runRemoval(state.pending.slice());
    }

    async function copyDebugLog() {
      let version = '?';
      try {
        version = chrome.runtime.getManifest().version;
      } catch (_) {
        /* not in an extension context */
      }
      const text = WLC.formatDebugLog({
        version,
        settings: state.settings,
        stats: state.lastStats || {},
        log: state.log,
        itemCount: WLC.getItems(doc).length,
      });
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (_) {
        const ta = doc.createElement('textarea');
        ta.value = text;
        shadow.appendChild(ta);
        ta.select();
        try {
          ok = doc.execCommand('copy');
        } catch (_e) {
          /* clipboard unavailable */
        }
        ta.remove();
      }
      setStatus(ok ? `Debug log copied (${state.log.length} attempts). Paste it into your bug report.` : 'Could not access the clipboard.');
      return text;
    }

    // ---------- Analytics tab ----------
    const aStatus = $('.a-status');
    const aOut = $('.a-out');
    const btnAnalyze = $('.btn-analyze');
    const btnCsv = $('.btn-csv');
    const btnJson = $('.btn-json');

    function showTab(name) {
      shadow.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
      shadow.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.view !== name));
      state.tab = name;
    }

    function setExpanded(on) {
      panelEl.classList.toggle('expanded', Boolean(on));
      $('.expand').title = on ? 'Narrower panel' : 'Wider panel';
    }

    function bars(rows, opts = {}) {
      const max = Math.max(1, ...rows.map((r) => r.value));
      return rows
        .map((r) => {
          const pct = Math.round((r.value / max) * 100);
          const attrs = opts.exclude
            ? ` class="brow click" data-exclude-channel="${escapeHtml(r.label)}" title="Keep all videos from “${escapeHtml(r.label)}” (untick them)"`
            : opts.channel
              ? ` class="brow click" data-channel="${escapeHtml(r.label)}" title="Use “${escapeHtml(r.label)}” as channel filter"`
              : ' class="brow"';
          return `<div${attrs}><span class="bl" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span><span class="bt"><i style="width:${pct}%"></i></span><span class="bv">${escapeHtml(r.display)}</span></div>`;
        })
        .join('');
    }

    function pctOf(n, total) {
      return total ? `${Math.round((n / total) * 100)}%` : '0%';
    }

    function renderAnalytics(st) {
      const H = WLC.formatHours;
      const n = st.available;
      const card = (v, l) => `<div class="card"><div class="v">${escapeHtml(v)}</div><div class="l">${escapeHtml(l)}</div></div>`;
      const bucketRows = (defs, data) =>
        defs.concat([{ key: 'unknown', label: 'Unknown' }]).map((b) => ({ label: b.label, value: data[b.key] || 0, display: `${(data[b.key] || 0).toLocaleString('en-US')} · ${pctOf(data[b.key] || 0, n)}` }));
      const scriptRows = Object.entries(st.scripts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ label: k, value: v, display: `${v.toLocaleString('en-US')} · ${pctOf(v, n)}` }));
      const mini = (v, extra) =>
        `<div class="mini">${v.videoId ? `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}" target="_blank" rel="noopener">` : ''}${escapeHtml(v.title || '(untitled)')}${v.videoId ? '</a>' : ''} <span>· ${escapeHtml(v.channel || '—')} · ${escapeHtml(extra(v))}</span></div>`;
      aOut.innerHTML = `
        <div class="cards">
          ${card(st.total.toLocaleString('en-US'), 'videos')}
          ${card(H(st.totalDurationSec), 'total duration')}
          ${card(WLC.formatDuration(st.avgDurationSec), 'avg duration')}
          ${card(H(st.remainingDurationSec), 'left to watch')}
          ${card(st.channelsCount.toLocaleString('en-US'), 'channels')}
          ${card(st.unavailable.toLocaleString('en-US'), 'unavailable')}
        </div>
        <div class="a-grid">
          <div class="sec"><h4>Watch progress</h4>${bars([
            { label: `Watched (≥ ${state.settings.watchedThreshold}%)`, value: st.watch.watched, display: `${st.watch.watched.toLocaleString('en-US')} · ${pctOf(st.watch.watched, n)}` },
            { label: 'Partially watched', value: st.watch.partial, display: `${st.watch.partial.toLocaleString('en-US')} · ${pctOf(st.watch.partial, n)}` },
            { label: 'Unwatched', value: st.watch.unwatched, display: `${st.watch.unwatched.toLocaleString('en-US')} · ${pctOf(st.watch.unwatched, n)}` },
          ])}</div>
          <div class="sec"><h4>Published (age)</h4>${bars(bucketRows(WLC.AGE_BUCKETS, st.age))}</div>
          <div class="sec"><h4>Duration</h4>${bars(bucketRows(WLC.DURATION_BUCKETS, st.duration))}</div>
          <div class="sec"><h4>Title script</h4>${bars(scriptRows)}</div>
          <div class="sec"><h4>Top channels by videos</h4>${bars(
            st.topChannelsByCount.map((c) => ({ label: c.channel, value: c.count, display: `${c.count.toLocaleString('en-US')}` })),
            { channel: true }
          )}</div>
          <div class="sec"><h4>Top channels by duration</h4>${bars(
            st.topChannelsByDuration.map((c) => ({ label: c.channel, value: c.durationSec, display: H(c.durationSec) })),
            { channel: true }
          )}</div>
          ${
            st.addedOrder
              ? `<div class="sec"><h4>Added order (publish age)</h4>${bars([
                  { label: `Oldest ${st.addedOrder.sampleSize} added`, value: st.addedOrder.oldestAvgAgeDays || 0, display: `avg ${WLC.formatDays(st.addedOrder.oldestAvgAgeDays) || '—'}` },
                  { label: `Newest ${st.addedOrder.sampleSize} added`, value: st.addedOrder.newestAvgAgeDays || 0, display: `avg ${WLC.formatDays(st.addedOrder.newestAvgAgeDays) || '—'}` },
                ])}</div>`
              : ''
          }
          <div class="sec"><h4>Oldest</h4>${st.oldest.map((v) => mini(v, (x) => x.ageText)).join('') || '<div class="mini">—</div>'}</div>
          <div class="sec"><h4>Longest</h4>${st.longest.map((v) => mini(v, (x) => WLC.formatDuration(x.durationSec))).join('') || '<div class="mini">—</div>'}</div>
        </div>`;
    }

    async function analyze() {
      if (state.busy) return null;
      state.settings = readForm();
      setBusy(true);
      btnAnalyze.disabled = true;
      try {
        const t0 = Date.now();
        aStatus.textContent = state.settings.removalMode === 'fast' ? 'Loading the list (Fast)…' : 'Reading video details…';
        const listed = await WLC.listVideos({
          mode: state.settings.removalMode,
          api: fastApi(),
          doc,
          loadAll: state.settings.loadAllFirst,
          shouldStop: () => state.stop,
          onProgress: (k) => (aStatus.textContent = `Loading all videos… ${k} loaded`),
        });
        const videos = listed.videos;
        const sort = refreshSort();
        WLC.annotateAddedOrder(videos, sort.available ? sort.direction : null);
        const stats = WLC.computeStats(videos, { watchedThreshold: state.settings.watchedThreshold });
        state.analytics = { videos, stats };
        renderAnalytics(stats);
        const noDur = stats.available - stats.withDuration;
        aStatus.textContent =
          `Analyzed ${videos.length.toLocaleString('en-US')} videos in ${((Date.now() - t0) / 1000).toFixed(1)} s (${modeLabel(listed.mode)}).` +
          (noDur ? ` ${noDur} without a duration badge (live/upcoming or not rendered) are excluded from duration totals.` : '');
        btnCsv.disabled = btnJson.disabled = !videos.length;
        return stats;
      } finally {
        setBusy(false);
        btnAnalyze.disabled = false;
      }
    }

    function download(name, text, type) {
      const blob = new Blob([text], { type });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = name;
      shadow.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    const stamp = () => new Date().toISOString().slice(0, 10);
    function exportCsv() {
      if (!state.analytics) return '';
      const text = WLC.toCSV(state.analytics.videos);
      download(`watch-later-${stamp()}.csv`, text, 'text/csv;charset=utf-8');
      return text;
    }
    function exportJson() {
      if (!state.analytics) return '';
      const text = WLC.toJSON(state.analytics.videos, state.analytics.stats);
      download(`watch-later-${stamp()}.json`, text, 'application/json');
      return text;
    }

    function useChannelFilter(name) {
      const next = Object.assign({}, readForm(), { channelFilter: true, channelKeywords: name });
      state.settings = WLC.normalizeSettings(next);
      writeForm(state.settings);
      WLC.saveSettings(state.settings);
      invalidatePlan();
      showTab('clean');
      setStatus(`Channel filter set to “${name}”. Click Preview to see what would be removed.`);
    }

    shadow.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('.expand').addEventListener('click', () => setExpanded(!panelEl.classList.contains('expanded')));
    btnAnalyze.addEventListener('click', () => analyze());
    btnCsv.addEventListener('click', () => exportCsv());
    btnJson.addEventListener('click', () => exportJson());
    aOut.addEventListener('click', (e) => {
      const row = e.target.closest && e.target.closest('[data-channel]');
      if (row) useChannelFilter(row.getAttribute('data-channel'));
    });

    pvOut.addEventListener('click', (e) => {
      const row = e.target.closest && e.target.closest('[data-exclude-channel]');
      if (row) excludeChannel(row.getAttribute('data-exclude-channel'));
    });
    $('.btn-pv-tick').addEventListener('click', () => tickAll());
    $('.btn-pv-csv').addEventListener('click', () => exportPreview('csv'));
    $('.btn-pv-json').addEventListener('click', () => exportPreview('json'));
    btnPreview.addEventListener('click', () => preview());
    btnRemove.addEventListener('click', () => remove());
    btnResume.addEventListener('click', () => resume());
    btnLog.addEventListener('click', () => copyDebugLog());
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
        if (t.dataset.k === 'addedSortOverride') refreshSort();
        else applyAddedState();
        if (t.dataset.k === 'removalMode') applyModeNote();
      } else if (t.matches('input[data-i]')) {
        state.armed = false;
        updateRemoveButton();
        schedulePreviewStats();
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
        refreshSort();
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
      resume,
      copyDebugLog,
      analyze,
      renderPreviewStats,
      excludeChannel,
      tickAll,
      exportPreview,
      exportCsv,
      exportJson,
      showTab,
      setExpanded,
      useChannelFilter,
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
        refreshSort();
      },
      refreshSort,
      fastApi,
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
            refreshSort();
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
