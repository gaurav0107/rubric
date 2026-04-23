/**
 * Single-file HTML UI for `diffprompt serve`. Zero build step: this is
 * plain HTML + inline CSS + a tiny vanilla-JS controller that talks to
 * /api/workspace, /api/prompts, and /api/run (SSE).
 *
 * Kept as a TypeScript string literal export so the server can embed it
 * at runtime without filesystem coupling.
 */

export const INDEX_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>diffprompt</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #0b0f14;
    --panel: #11171f;
    --panel-2: #161d27;
    --border: #1f2a38;
    --text: #d8e1ec;
    --muted: #7c8a9d;
    --accent: #4cc2ff;
    --accent-weak: #1b3a4d;
    --win: #4caf50;
    --loss: #ef5350;
    --tie: #d4a94b;
    --err: #b26eff;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; flex-direction: column;
  }
  header {
    display: flex; align-items: center; gap: 16px;
    padding: 10px 16px; border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  header h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .02em; }
  header .sub { color: var(--muted); font-size: 12px; font-family: var(--mono); }
  header .spacer { flex: 1; }
  header button, header label {
    background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 12px; font: inherit; cursor: pointer;
  }
  header button.primary {
    background: var(--accent); color: #001018; border-color: var(--accent); font-weight: 600;
  }
  header button:disabled { opacity: .5; cursor: not-allowed; }
  header label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  header input[type=checkbox] { accent-color: var(--accent); }

  main {
    display: grid; grid-template-columns: 1fr 320px 1.3fr;
    gap: 0; flex: 1; min-height: 0;
  }
  section {
    display: flex; flex-direction: column;
    border-right: 1px solid var(--border); min-width: 0; min-height: 0;
  }
  section:last-child { border-right: none; }
  .pane-title {
    padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .12em;
    color: var(--muted); border-bottom: 1px solid var(--border); background: var(--panel);
    display: flex; align-items: center; gap: 8px;
  }
  .pane-title .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
  .pane-title .dot.dirty { background: var(--tie); }
  .pane-title .dot.saved { background: var(--win); }

  .prompts-pane { display: flex; flex-direction: column; }
  .prompts-pane .tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--panel-2); }
  .prompts-pane .tabs button {
    flex: 1; background: transparent; border: 0; padding: 8px 12px;
    color: var(--muted); font: inherit; cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .prompts-pane .tabs button.active {
    color: var(--text); border-bottom-color: var(--accent);
  }
  .prompts-pane textarea {
    flex: 1; width: 100%; resize: none; padding: 14px; border: 0;
    background: var(--panel); color: var(--text);
    font-family: var(--mono); font-size: 13px; line-height: 1.55;
    outline: none;
  }
  .prompts-pane .footer {
    padding: 8px 12px; border-top: 1px solid var(--border);
    display: flex; gap: 8px; align-items: center; background: var(--panel-2);
  }
  .prompts-pane .footer button {
    background: var(--accent-weak); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 5px 10px; font: inherit; cursor: pointer;
  }
  .prompts-pane .footer .hint { color: var(--muted); font-size: 12px; }

  .cases-pane .list { overflow-y: auto; }
  .case-row {
    padding: 10px 12px; border-bottom: 1px solid var(--border);
    cursor: default;
  }
  .case-row .meta {
    display: flex; gap: 8px; font-size: 11px; color: var(--muted); margin-bottom: 4px;
  }
  .case-row .meta .tag {
    background: var(--panel-2); padding: 1px 6px; border-radius: 3px;
    font-family: var(--mono); text-transform: lowercase;
  }
  .case-row .input {
    font-size: 13px; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .results-pane { display: flex; flex-direction: column; }
  .results-pane .summary {
    display: grid; grid-template-columns: repeat(5, 1fr);
    gap: 1px; background: var(--border);
    border-bottom: 1px solid var(--border);
  }
  .results-pane .summary .cell {
    background: var(--panel); padding: 10px 12px; text-align: center;
  }
  .results-pane .summary .cell .n { font-size: 20px; font-weight: 600; }
  .results-pane .summary .cell .k { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
  .results-pane .summary .cell.win .n { color: var(--win); }
  .results-pane .summary .cell.loss .n { color: var(--loss); }
  .results-pane .summary .cell.tie .n { color: var(--tie); }
  .results-pane .summary .cell.err .n { color: var(--err); }

  .grid-wrap { flex: 1; overflow: auto; }
  table.grid {
    width: 100%; border-collapse: collapse; font-size: 12px;
  }
  table.grid th, table.grid td {
    border-bottom: 1px solid var(--border); padding: 8px 10px; text-align: left;
    vertical-align: top;
  }
  table.grid th {
    position: sticky; top: 0; background: var(--panel-2);
    font-weight: 500; color: var(--muted); text-transform: uppercase; font-size: 10px; letter-spacing: .12em;
  }
  table.grid td.idx { color: var(--muted); font-family: var(--mono); width: 32px; }
  table.grid td.model { font-family: var(--mono); color: var(--muted); width: 120px; }
  table.grid td.input { max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  table.grid td.verdict { width: 80px; font-weight: 600; font-family: var(--mono); }
  table.grid td.verdict.win { color: var(--win); }
  table.grid td.verdict.loss { color: var(--loss); }
  table.grid td.verdict.tie { color: var(--tie); }
  table.grid td.verdict.err { color: var(--err); }
  table.grid td.reason { color: var(--muted); font-size: 11px; }

  .empty { padding: 32px 16px; color: var(--muted); text-align: center; }

  .err-banner {
    padding: 10px 16px; background: #3a1f1f; color: #ffbbbb; border-bottom: 1px solid var(--border);
    font-family: var(--mono); font-size: 12px;
  }
</style>
</head>
<body>
  <header>
    <h1>diffprompt</h1>
    <span class="sub" id="config-path">—</span>
    <span class="spacer"></span>
    <label><input type="checkbox" id="mock-toggle"> mock mode</label>
    <button id="run-btn" class="primary">▶ Run</button>
  </header>

  <div id="err" class="err-banner" style="display:none"></div>

  <main>
    <section class="prompts-pane">
      <div class="pane-title">
        <span class="dot saved" id="prompt-dot"></span>
        prompts
      </div>
      <div class="tabs">
        <button id="tab-baseline" class="active" data-which="baseline">baseline</button>
        <button id="tab-candidate" data-which="candidate">candidate</button>
      </div>
      <textarea id="prompt-editor" spellcheck="false"></textarea>
      <div class="footer">
        <button id="save-btn">Save (⌘S)</button>
        <span class="hint" id="save-hint">editor is clean</span>
      </div>
    </section>

    <section class="cases-pane">
      <div class="pane-title">cases <span id="case-count" style="color:var(--muted);margin-left:auto"></span></div>
      <div class="list" id="cases-list"></div>
    </section>

    <section class="results-pane">
      <div class="pane-title">
        results
        <span id="progress" style="color:var(--muted);margin-left:auto;font-family:var(--mono);font-size:11px"></span>
      </div>
      <div class="summary" id="summary">
        <div class="cell win"><div class="n" id="sum-wins">0</div><div class="k">wins</div></div>
        <div class="cell loss"><div class="n" id="sum-losses">0</div><div class="k">losses</div></div>
        <div class="cell tie"><div class="n" id="sum-ties">0</div><div class="k">ties</div></div>
        <div class="cell err"><div class="n" id="sum-errors">0</div><div class="k">errors</div></div>
        <div class="cell"><div class="n" id="sum-rate">—</div><div class="k">win rate</div></div>
      </div>
      <div class="grid-wrap">
        <table class="grid">
          <thead>
            <tr><th>#</th><th>model</th><th>input</th><th>winner</th><th>reason</th></tr>
          </thead>
          <tbody id="grid-body">
            <tr><td colspan="5"><div class="empty">Run an evaluation to populate the grid.</div></td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    workspace: null,
    active: 'baseline',
    dirty: false,
    running: false,
  };

  function setError(msg) {
    const el = $('err');
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block'; el.textContent = msg;
  }

  function setDirty(d) {
    state.dirty = d;
    $('prompt-dot').className = 'dot ' + (d ? 'dirty' : 'saved');
    $('save-hint').textContent = d ? 'unsaved changes' : 'editor is clean';
  }

  function activateTab(which) {
    state.active = which;
    for (const btn of document.querySelectorAll('.tabs button')) {
      btn.classList.toggle('active', btn.dataset.which === which);
    }
    $('prompt-editor').value = state.workspace ? state.workspace.prompts[which] : '';
    setDirty(false);
  }

  function renderCases() {
    const list = $('cases-list');
    const ws = state.workspace;
    if (!ws || ws.cases.length === 0) {
      list.innerHTML = '<div class="empty">No cases found in dataset.</div>';
      $('case-count').textContent = '';
      return;
    }
    $('case-count').textContent = ws.cases.length + ' case' + (ws.cases.length === 1 ? '' : 's');
    list.innerHTML = ws.cases.map((c, i) => {
      const cat = c.metadata && c.metadata.category ? c.metadata.category : '';
      return (
        '<div class="case-row" data-idx="' + i + '">' +
          '<div class="meta"><span class="tag">#' + i + '</span>' +
          (cat ? '<span class="tag">' + escapeHtml(cat) + '</span>' : '') +
          '</div>' +
          '<div class="input" title="' + escapeHtml(c.input) + '">' + escapeHtml(c.input) + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function resetGrid() {
    $('grid-body').innerHTML = '';
    $('sum-wins').textContent = '0';
    $('sum-losses').textContent = '0';
    $('sum-ties').textContent = '0';
    $('sum-errors').textContent = '0';
    $('sum-rate').textContent = '—';
    $('progress').textContent = '';
  }

  function verdictLabel(j) {
    if (j.error) return { cls: 'err', label: 'ERR' };
    if (j.winner === 'b') return { cls: 'win', label: 'CAND' };
    if (j.winner === 'a') return { cls: 'loss', label: 'BASE' };
    return { cls: 'tie', label: 'TIE' };
  }

  const counts = { wins: 0, losses: 0, ties: 0, errors: 0 };

  function addCellRow(evt) {
    const cell = evt.cell;
    const ws = state.workspace;
    const caseInput = ws.cases[cell.caseIndex] ? ws.cases[cell.caseIndex].input : '(missing)';
    const v = verdictLabel(cell.judge);
    if (v.cls === 'win') counts.wins++;
    else if (v.cls === 'loss') counts.losses++;
    else if (v.cls === 'tie') counts.ties++;
    else counts.errors++;
    const reason = cell.judge.error || cell.judge.reason || '';
    const row = document.createElement('tr');
    row.innerHTML =
      '<td class="idx">' + cell.caseIndex + '</td>' +
      '<td class="model">' + escapeHtml(cell.model) + '</td>' +
      '<td class="input" title="' + escapeHtml(caseInput) + '">' + escapeHtml(caseInput) + '</td>' +
      '<td class="verdict ' + v.cls + '">' + v.label + '</td>' +
      '<td class="reason">' + escapeHtml(reason) + '</td>';
    $('grid-body').appendChild(row);

    $('sum-wins').textContent = counts.wins;
    $('sum-losses').textContent = counts.losses;
    $('sum-ties').textContent = counts.ties;
    $('sum-errors').textContent = counts.errors;
    const decisive = counts.wins + counts.losses;
    $('sum-rate').textContent = decisive === 0 ? '—' : Math.round((counts.wins / decisive) * 100) + '%';
    $('progress').textContent = evt.progress.done + '/' + evt.progress.total;
  }

  async function loadWorkspace() {
    try {
      const res = await fetch('/api/workspace');
      if (!res.ok) throw new Error(await res.text());
      state.workspace = await res.json();
      $('config-path').textContent = state.workspace.configPath;
      $('mock-toggle').checked = false;
      activateTab(state.active);
      renderCases();
      setError(null);
    } catch (err) {
      setError('failed to load workspace: ' + (err.message || err));
    }
  }

  async function savePrompt() {
    if (!state.dirty) return;
    const which = state.active;
    const content = $('prompt-editor').value;
    try {
      const res = await fetch('/api/prompts', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ which, content }),
      });
      if (!res.ok) throw new Error(await res.text());
      state.workspace.prompts[which] = content;
      setDirty(false);
      setError(null);
    } catch (err) {
      setError('save failed: ' + (err.message || err));
    }
  }

  async function runSweep() {
    if (state.running) return;
    state.running = true;
    $('run-btn').disabled = true;
    $('run-btn').textContent = '▶ Running…';
    setError(null);
    resetGrid();
    counts.wins = 0; counts.losses = 0; counts.ties = 0; counts.errors = 0;

    const mock = $('mock-toggle').checked;
    const controller = new AbortController();
    let buffered = '';
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mock }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      const reader = res.body.getReader();
      const dec = new TextDecoder('utf-8');
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += dec.decode(value, { stream: true });
        for (;;) {
          const split = buffered.indexOf('\n\n');
          if (split === -1) break;
          const raw = buffered.slice(0, split);
          buffered = buffered.slice(split + 2);
          const lines = raw.split('\n');
          let event = 'message'; let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!data) continue;
          const payload = JSON.parse(data);
          if (event === 'cell') addCellRow(payload);
          else if (event === 'error') setError(payload.message || 'run failed');
          else if (event === 'done') { /* no-op; summary already built */ }
        }
      }
    } catch (err) {
      setError('run failed: ' + (err.message || err));
    } finally {
      state.running = false;
      $('run-btn').disabled = false;
      $('run-btn').textContent = '▶ Run';
    }
  }

  // Wire events
  for (const btn of document.querySelectorAll('.tabs button')) {
    btn.addEventListener('click', () => {
      if (state.dirty && !confirm('You have unsaved changes. Discard them?')) return;
      activateTab(btn.dataset.which);
    });
  }
  $('prompt-editor').addEventListener('input', () => setDirty(true));
  $('save-btn').addEventListener('click', savePrompt);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); savePrompt(); }
  });
  $('run-btn').addEventListener('click', runSweep);

  loadWorkspace();
})();
</script>
</body>
</html>
`;
