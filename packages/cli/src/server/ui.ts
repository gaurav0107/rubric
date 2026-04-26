/**
 * Single-file HTML UI for `rubric serve`. Zero build step: this is
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
<title>rubric</title>
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

  .mode-toggle {
    display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
    background: var(--panel-2);
  }
  .mode-toggle button {
    background: transparent; border: 0; padding: 6px 10px; color: var(--muted); cursor: pointer;
    font: inherit; border-radius: 0;
  }
  .mode-toggle button.active { background: var(--accent-weak); color: var(--text); }
  .mode-toggle .label { padding: 6px 8px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .1em; }

  .prompts-pane.locked-candidate .tabs button[data-which=candidate] {
    opacity: .4; cursor: not-allowed;
  }
  .mode-hint {
    padding: 6px 12px; border-bottom: 1px solid var(--border);
    background: var(--accent-weak); color: var(--text); font-size: 11px; font-family: var(--mono);
  }

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
    display: grid; grid-template-columns: repeat(7, 1fr);
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
  table.grid tr.header-row { cursor: pointer; }
  table.grid tr.header-row:hover { background: rgba(255,255,255,0.02); }
  table.grid tr.detail-row td { padding: 0; background: var(--panel-2); border-bottom: 1px solid var(--border); }
  .detail-verdict {
    padding: 10px 14px; background: var(--panel); border-bottom: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 6px; font-size: 12px;
  }
  .detail-verdict .headline {
    display: flex; align-items: center; gap: 8px;
    font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
  }
  .detail-verdict .headline .pill {
    padding: 2px 8px; border-radius: 3px; font-weight: 600;
    background: var(--panel-2); border: 1px solid var(--border);
  }
  .detail-verdict.winner-a .pill { color: var(--loss); border-color: var(--loss); }
  .detail-verdict.winner-b .pill { color: var(--win); border-color: var(--win); }
  .detail-verdict.winner-tie .pill { color: var(--tie); border-color: var(--border); }
  .detail-verdict.err .pill { color: var(--err); border-color: var(--err); }
  .detail-verdict .reason {
    color: var(--text); font-size: 13px; line-height: 1.45;
    padding: 2px 0; white-space: pre-wrap; word-break: break-word;
  }
  .detail-verdict .expected {
    font-size: 12px; color: var(--muted); display: flex; gap: 6px; align-items: baseline;
  }
  .detail-verdict .expected .k {
    font-family: var(--mono); text-transform: uppercase; letter-spacing: .08em; font-size: 10px;
  }
  .detail-verdict .expected .v {
    color: var(--text); font-family: var(--mono); font-size: 12px;
    white-space: pre-wrap; word-break: break-word;
  }
  .detail-box { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); }
  .detail-side {
    padding: 10px 12px; background: var(--panel-2);
    display: flex; flex-direction: column; gap: 6px;
  }
  .detail-side .side-title {
    font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted);
    display: flex; align-items: center; gap: 6px;
  }
  .detail-side .side-title .model-tag {
    font-family: var(--mono); color: var(--text); text-transform: none; letter-spacing: 0;
    background: var(--panel); padding: 1px 6px; border-radius: 3px; font-size: 10px;
  }
  .detail-side pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font-family: var(--mono); font-size: 12px; color: var(--text);
    max-height: 220px; overflow: auto;
  }
  .detail-side .label-row { display: flex; gap: 6px; align-items: center; }
  .detail-side .label-row .hint { color: var(--muted); font-size: 11px; margin-left: auto; }
  .detail-side button.lbl {
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 3px 8px; font: inherit; font-size: 11px; cursor: pointer;
  }
  .detail-side button.lbl.pos:hover { border-color: var(--win); color: var(--win); }
  .detail-side button.lbl.neg:hover { border-color: var(--loss); color: var(--loss); }
  .detail-side button.lbl:disabled { opacity: .5; cursor: not-allowed; }
  .detail-side .saved { color: var(--win); font-size: 11px; font-family: var(--mono); }
  .detail-side .save-err { color: var(--loss); font-size: 11px; font-family: var(--mono); }

  .empty { padding: 32px 16px; color: var(--muted); text-align: center; }

  .err-banner {
    padding: 10px 16px; background: #3a1f1f; color: #ffbbbb; border-bottom: 1px solid var(--border);
    font-family: var(--mono); font-size: 12px;
  }

  .steelman-panel {
    border-top: 1px solid var(--border); background: var(--panel-2);
    padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px;
  }
  .steelman-panel.err { background: #3a1f1f; color: #ffbbbb; }
  .steelman-panel .title {
    display: flex; align-items: center; gap: 8px;
    font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted);
  }
  .steelman-panel .title .spacer { flex: 1; }
  .steelman-panel .title button {
    background: var(--panel); color: var(--text); border: 1px solid var(--border);
    border-radius: 4px; padding: 3px 8px; font: inherit; font-size: 11px; cursor: pointer;
  }
  .steelman-panel .title button.apply { border-color: var(--accent); color: var(--accent); }
  .steelman-panel .rationale { color: var(--text); line-height: 1.45; }
  .steelman-panel pre.revised {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font-family: var(--mono); font-size: 12px; color: var(--text);
    background: var(--panel); padding: 8px 10px; border-radius: 4px;
    max-height: 240px; overflow: auto;
  }

  .detail-verdict .steelman-row { display: flex; align-items: center; gap: 8px; }
  .detail-verdict .steelman-row button {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 4px; padding: 3px 8px; font: inherit; font-size: 11px; cursor: pointer;
  }
  .detail-verdict .steelman-row button:hover { border-color: var(--accent); color: var(--accent); }
  .detail-verdict .steelman-row button:disabled { opacity: .5; cursor: not-allowed; }
  .detail-verdict .micro-steelman {
    margin-top: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 4px;
    padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; font-size: 12px;
  }
  .detail-verdict .micro-steelman.err { border-color: var(--loss); color: #ffbbbb; }
  .detail-verdict .micro-steelman .ms-title {
    font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted);
    display: flex; align-items: center; gap: 8px;
  }
  .detail-verdict .micro-steelman .ms-title .spacer { flex: 1; }
  .detail-verdict .micro-steelman .ms-title button {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 4px; padding: 2px 6px; font: inherit; font-size: 10px; cursor: pointer;
  }
  .detail-verdict .micro-steelman .ms-title button.apply { border-color: var(--accent); color: var(--accent); }
  .detail-verdict .micro-steelman pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font-family: var(--mono); font-size: 11px; color: var(--text);
  }

  /* Runs drawer — overlay that slides in from the right when "📜 Runs" is clicked. */
  .runs-drawer {
    position: fixed; top: 0; right: 0; bottom: 0; width: 520px;
    background: var(--panel); border-left: 1px solid var(--border);
    display: flex; flex-direction: column;
    transform: translateX(100%); transition: transform .18s ease-out;
    z-index: 40; box-shadow: -8px 0 24px rgba(0,0,0,.4);
  }
  .runs-drawer.open { transform: translateX(0); }
  .runs-drawer .title {
    padding: 10px 14px; font-size: 13px; font-weight: 600;
    border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px;
  }
  .runs-drawer .title .spacer { flex: 1; }
  .runs-drawer .title button {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 4px; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer;
  }
  .runs-drawer .title button.primary { border-color: var(--accent); color: var(--accent); }
  .runs-drawer .title button:disabled { opacity: .5; cursor: not-allowed; }
  .runs-drawer .body { flex: 1; overflow: auto; padding: 12px 14px; }
  .runs-drawer .empty { color: var(--muted); font-size: 12px; padding: 24px 0; text-align: center; }
  .runs-drawer .runs-list { display: flex; flex-direction: column; gap: 6px; }
  .runs-drawer .run-row {
    display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center;
    padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--panel-2); cursor: pointer; font-size: 12px;
  }
  .runs-drawer .run-row:hover { border-color: var(--accent-weak); }
  .runs-drawer .run-row.selected { border-color: var(--accent); }
  .runs-drawer .run-row input[type=checkbox] { accent-color: var(--accent); }
  .runs-drawer .run-row .rid { font-family: var(--mono); font-size: 11px; color: var(--text); }
  .runs-drawer .run-row .meta { color: var(--muted); font-family: var(--mono); font-size: 10px; }
  .runs-drawer .run-row .status { padding: 1px 6px; border-radius: 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
  .runs-drawer .run-row .status.complete { background: var(--accent-weak); color: var(--accent); }
  .runs-drawer .run-row .status.running  { background: #3a3217; color: var(--tie); }
  .runs-drawer .run-row .status.failed   { background: #3a1f1f; color: var(--loss); }
  .runs-drawer .run-row .status.pending,
  .runs-drawer .run-row .status.abandoned { background: #1f2a38; color: var(--muted); }
  .runs-drawer .run-detail {
    margin-top: 14px; padding: 12px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--panel-2); font-size: 12px;
  }
  .runs-drawer .run-detail h4 { margin: 0 0 6px 0; font-size: 12px; font-weight: 600; }
  .runs-drawer .run-detail dl {
    display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0;
    font-family: var(--mono); font-size: 11px;
  }
  .runs-drawer .run-detail dt { color: var(--muted); }
  .runs-drawer .run-detail dd { margin: 0; color: var(--text); }
  .runs-drawer .diff-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px;
  }
  .runs-drawer .diff-col { border: 1px solid var(--border); border-radius: 6px; padding: 8px; background: var(--panel-2); }
  .runs-drawer .diff-col h5 {
    margin: 0 0 6px 0; font-size: 11px; font-family: var(--mono); color: var(--muted);
  }
  .runs-drawer .clusters { margin-top: 12px; }
  .runs-drawer .clusters .cluster-row {
    display: grid; grid-template-columns: auto 1fr; gap: 6px 10px;
    padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--panel-2); margin-bottom: 6px;
  }
  .runs-drawer .clusters .cluster-row .count {
    font-family: var(--mono); font-size: 11px; color: var(--loss);
    background: #3a1f1f; padding: 1px 6px; border-radius: 10px; align-self: start;
  }
  .runs-drawer .clusters .cluster-row .label {
    font-family: var(--mono); font-size: 11px; color: var(--text); align-self: start;
  }
  .runs-drawer .clusters .cluster-row .sample {
    grid-column: 1 / -1; color: var(--muted); font-size: 11px; line-height: 1.35;
  }
  .runs-drawer .clusters .cluster-row .indices {
    grid-column: 1 / -1; color: var(--muted); font-family: var(--mono); font-size: 10px;
  }
  .runs-drawer-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 35;
    display: none;
  }
  .runs-drawer-backdrop.open { display: block; }
</style>
</head>
<body>
  <header>
    <h1>rubric</h1>
    <span class="sub" id="config-path">—</span>
    <span class="spacer"></span>
    <div class="mode-toggle" id="mode-toggle" role="tablist" aria-label="compare mode">
      <span class="label">vary</span>
      <button data-mode="compare-prompts" class="active" aria-pressed="true">prompts</button>
      <button data-mode="compare-models" aria-pressed="false">models</button>
    </div>
    <label><input type="checkbox" id="mock-toggle"> mock mode</label>
    <button id="runs-btn" title="Browse past runs from the registry">📜 Runs</button>
    <button id="run-btn" class="primary">▶ Run</button>
  </header>

  <div id="err" class="err-banner" style="display:none"></div>

  <main>
    <section class="prompts-pane" id="prompts-pane">
      <div class="pane-title">
        <span class="dot saved" id="prompt-dot"></span>
        <span id="prompts-title">prompts</span>
      </div>
      <div class="mode-hint" id="mode-hint" style="display:none"></div>
      <div class="tabs">
        <button id="tab-baseline" class="active" data-which="baseline">baseline</button>
        <button id="tab-candidate" data-which="candidate">candidate</button>
      </div>
      <textarea id="prompt-editor" spellcheck="false"></textarea>
      <div class="footer">
        <button id="save-btn">Save (⌘S)</button>
        <button id="steelman-btn" title="Ask the judge model to strengthen this prompt">✨ Steelman</button>
        <span class="hint" id="save-hint">editor is clean</span>
      </div>
      <div id="steelman-panel" class="steelman-panel" style="display:none"></div>
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
        <div class="cell"><div class="n" id="sum-cost">—</div><div class="k">cost</div></div>
        <div class="cell"><div class="n" id="sum-time">—</div><div class="k">wall sum</div></div>
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

  <div id="runs-backdrop" class="runs-drawer-backdrop"></div>
  <aside id="runs-drawer" class="runs-drawer" aria-hidden="true">
    <div class="title">
      <strong>Runs</strong>
      <span class="spacer"></span>
      <button id="runs-diff-btn" class="primary" disabled title="Select two runs to compare">Diff 2</button>
      <button id="runs-close-btn">Close</button>
    </div>
    <div class="body" id="runs-body">
      <div class="empty">Loading…</div>
    </div>
  </aside>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    workspace: null,
    active: 'baseline',
    dirty: false,
    running: false,
    mode: 'compare-prompts',
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
    if (state.mode === 'compare-models' && which === 'candidate') return;
    state.active = which;
    for (const btn of document.querySelectorAll('.tabs button')) {
      btn.classList.toggle('active', btn.dataset.which === which);
    }
    $('prompt-editor').value = state.workspace ? state.workspace.prompts[which] : '';
    setDirty(false);
  }

  function applyMode() {
    const pane = $('prompts-pane');
    const hint = $('mode-hint');
    const title = $('prompts-title');
    const headerBtns = document.querySelectorAll('#mode-toggle button');
    for (const btn of headerBtns) {
      const active = btn.dataset.mode === state.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    if (state.mode === 'compare-models') {
      pane.classList.add('locked-candidate');
      title.textContent = 'shared prompt';
      const models = (state.workspace && state.workspace.config && state.workspace.config.models) || [];
      const pair = models.length >= 2 ? models[0] + ' vs ' + models[1] : 'needs ≥2 models in config';
      hint.textContent = 'compare-models: ' + pair + ' — candidate tab is disabled (single shared prompt)';
      hint.style.display = 'block';
      if (state.active === 'candidate') activateTab('baseline');
    } else {
      pane.classList.remove('locked-candidate');
      title.textContent = 'prompts';
      hint.style.display = 'none';
      hint.textContent = '';
    }
  }

  function setMode(m) {
    if (state.running) return;
    if (m !== 'compare-prompts' && m !== 'compare-models') return;
    if (state.mode === m) return;
    state.mode = m;
    applyMode();
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
    $('sum-cost').textContent = '—';
    $('sum-time').textContent = '—';
    $('progress').textContent = '';
    costRoll.totalUsd = 0;
    costRoll.costed = 0;
    costRoll.totalMs = 0;
    costRoll.timed = 0;
  }

  const costRoll = { totalUsd: 0, costed: 0, totalMs: 0, timed: 0 };

  function fmtCost(usd) {
    if (usd === 0) return '$0.00';
    if (usd < 0.01) return '$' + usd.toFixed(4);
    return '$' + usd.toFixed(2);
  }
  function fmtMs(ms) {
    if (ms < 1000) return Math.round(ms) + 'ms';
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    return Math.floor(s / 60) + 'm' + Math.round(s % 60) + 's';
  }

  function verdictLabel(j) {
    if (j.error) return { cls: 'err', label: 'ERR' };
    if (state.mode === 'compare-models') {
      if (j.winner === 'b') return { cls: 'win', label: 'B' };
      if (j.winner === 'a') return { cls: 'loss', label: 'A' };
      return { cls: 'tie', label: 'TIE' };
    }
    if (j.winner === 'b') return { cls: 'win', label: 'CAND' };
    if (j.winner === 'a') return { cls: 'loss', label: 'BASE' };
    return { cls: 'tie', label: 'TIE' };
  }

  const counts = { wins: 0, losses: 0, ties: 0, errors: 0 };

  function addCellRow(evt) {
    const cell = evt.cell;
    const ws = state.workspace;
    const caseRec = ws.cases[cell.caseIndex];
    const caseInput = caseRec ? caseRec.input : '(missing)';
    const caseExpected = caseRec && typeof caseRec.expected === 'string' ? caseRec.expected : null;
    const v = verdictLabel(cell.judge);
    if (v.cls === 'win') counts.wins++;
    else if (v.cls === 'loss') counts.losses++;
    else if (v.cls === 'tie') counts.ties++;
    else counts.errors++;
    const reason = cell.judge.error || cell.judge.reason || '';
    const modelLabel = cell.modelB ? (cell.model + ' vs ' + cell.modelB) : cell.model;
    const row = document.createElement('tr');
    row.className = 'header-row';
    row.innerHTML =
      '<td class="idx">▸ ' + cell.caseIndex + '</td>' +
      '<td class="model">' + escapeHtml(modelLabel) + '</td>' +
      '<td class="input" title="' + escapeHtml(caseInput) + '">' + escapeHtml(caseInput) + '</td>' +
      '<td class="verdict ' + v.cls + '">' + v.label + '</td>' +
      '<td class="reason">' + escapeHtml(reason) + '</td>';
    const detailRow = document.createElement('tr');
    detailRow.className = 'detail-row';
    detailRow.style.display = 'none';
    detailRow.appendChild(buildDetailCell(cell, caseInput, caseExpected));
    row.addEventListener('click', () => {
      const open = detailRow.style.display !== 'none';
      detailRow.style.display = open ? 'none' : '';
      row.firstChild.innerHTML = (open ? '▸ ' : '▾ ') + cell.caseIndex;
    });
    const body = $('grid-body');
    body.appendChild(row);
    body.appendChild(detailRow);

    $('sum-wins').textContent = counts.wins;
    $('sum-losses').textContent = counts.losses;
    $('sum-ties').textContent = counts.ties;
    $('sum-errors').textContent = counts.errors;
    const decisive = counts.wins + counts.losses;
    $('sum-rate').textContent = decisive === 0 ? '—' : Math.round((counts.wins / decisive) * 100) + '%';
    if (typeof cell.costUsd === 'number') {
      costRoll.totalUsd += cell.costUsd;
      costRoll.costed++;
      $('sum-cost').textContent = fmtCost(costRoll.totalUsd);
    }
    if (typeof cell.latencyMs === 'number') {
      costRoll.totalMs += cell.latencyMs;
      costRoll.timed++;
      $('sum-time').textContent = fmtMs(costRoll.totalMs);
    }
    $('progress').textContent = evt.progress.done + '/' + evt.progress.total;
  }

  function buildDetailCell(cell, caseInput, caseExpected) {
    const td = document.createElement('td');
    td.colSpan = 5;

    td.appendChild(buildVerdictBanner(cell, caseExpected));

    const box = document.createElement('div');
    box.className = 'detail-box';

    const labelA = cell.modelB ? cell.model : 'A (baseline)';
    const labelB = cell.modelB ? cell.modelB : 'B (candidate)';
    box.appendChild(detailSide('A', labelA, cell.outputA, caseInput));
    box.appendChild(detailSide('B', labelB, cell.outputB, caseInput));
    td.appendChild(box);
    return td;
  }

  function buildVerdictBanner(cell, caseExpected) {
    const j = cell.judge;
    const block = document.createElement('div');
    block.className = 'detail-verdict';

    let pillLabel, headline;
    if (j.error) {
      block.classList.add('err');
      pillLabel = 'ERROR';
      headline = 'Judge errored before returning a verdict';
    } else if (j.winner === 'b') {
      block.classList.add('winner-b');
      pillLabel = state.mode === 'compare-models' ? 'B WINS' : 'CAND WINS';
      headline = 'Why this side won';
    } else if (j.winner === 'a') {
      block.classList.add('winner-a');
      pillLabel = state.mode === 'compare-models' ? 'A WINS' : 'BASE WINS';
      headline = state.mode === 'compare-models' ? 'Why B lost' : 'Why the candidate lost';
    } else {
      block.classList.add('winner-tie');
      pillLabel = 'TIE';
      headline = 'Judge called this a tie';
    }

    const head = document.createElement('div');
    head.className = 'headline';
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = pillLabel;
    const hl = document.createElement('span');
    hl.textContent = headline;
    head.appendChild(pill);
    head.appendChild(hl);
    block.appendChild(head);

    const reasonText = j.error || j.reason || '';
    if (reasonText) {
      const reason = document.createElement('div');
      reason.className = 'reason';
      reason.textContent = reasonText;
      block.appendChild(reason);
    }

    if (caseExpected) {
      const exp = document.createElement('div');
      exp.className = 'expected';
      exp.innerHTML = '<span class="k">expected</span><span class="v"></span>';
      exp.querySelector('.v').textContent = caseExpected;
      block.appendChild(exp);
    }

    if (!j.error && (j.winner === 'a' || j.winner === 'b')) {
      const row = document.createElement('div');
      row.className = 'steelman-row';
      const btn = document.createElement('button');
      btn.textContent = '✨ Steelman the losing prompt';
      const hint = document.createElement('span');
      hint.style.color = 'var(--muted)';
      hint.style.fontSize = '11px';
      hint.textContent = 'rewrite using this case as the anchor';
      row.appendChild(btn);
      row.appendChild(hint);
      block.appendChild(row);

      const target = document.createElement('div');
      block.appendChild(target);

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await runMicroSteelman(cell, block, target, btn);
      });
    }

    block.addEventListener('click', (e) => e.stopPropagation());
    return block;
  }

  async function runMicroSteelman(cell, block, target, btn) {
    const j = cell.judge;
    if (j.error || (j.winner !== 'a' && j.winner !== 'b')) return;

    const ws = state.workspace;
    const caseRec = ws.cases[cell.caseIndex];
    if (!caseRec) return;

    const which = state.mode === 'compare-models'
      ? 'baseline'
      : (j.winner === 'a' ? 'candidate' : 'baseline');
    const failedOutput = j.winner === 'a' ? cell.outputB : cell.outputA;
    const betterOutput = j.winner === 'a' ? cell.outputA : cell.outputB;

    const failing = [{
      input: caseRec.input,
      failedOutput: failedOutput || '',
      betterOutput: betterOutput || '',
      judgeReason: j.reason || '',
    }];
    if (typeof caseRec.expected === 'string') failing[0].expected = caseRec.expected;

    btn.disabled = true;
    btn.textContent = '✨ Thinking…';
    target.innerHTML = '';

    const mock = $('mock-toggle').checked;
    try {
      const res = await fetch('/api/steelman', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ which, failingCases: failing, mock }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

      const panel = document.createElement('div');
      panel.className = 'micro-steelman';

      const head = document.createElement('div');
      head.className = 'ms-title';
      const lbl = document.createElement('span');
      lbl.textContent = 'steelman of ' + which + ' (anchored on this case)';
      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      const applyBtn = document.createElement('button');
      applyBtn.className = 'apply';
      applyBtn.textContent = 'Apply → editor';
      const dismissBtn = document.createElement('button');
      dismissBtn.textContent = 'Dismiss';
      head.appendChild(lbl);
      head.appendChild(spacer);
      head.appendChild(applyBtn);
      head.appendChild(dismissBtn);
      panel.appendChild(head);

      const rationale = document.createElement('div');
      rationale.style.color = 'var(--muted)';
      rationale.textContent = data.rationale;
      panel.appendChild(rationale);

      const pre = document.createElement('pre');
      pre.textContent = data.revised;
      panel.appendChild(pre);

      applyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activateTab(which);
        $('prompt-editor').value = data.revised;
        setDirty(true);
      });
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        target.innerHTML = '';
      });

      target.appendChild(panel);
    } catch (err) {
      const panel = document.createElement('div');
      panel.className = 'micro-steelman err';
      panel.textContent = 'steelman failed: ' + (err.message || err);
      target.appendChild(panel);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Steelman the losing prompt';
    }
  }

  function detailSide(side, modelName, output, caseInput) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-side';

    const title = document.createElement('div');
    title.className = 'side-title';
    title.innerHTML = side + ' <span class="model-tag">' + escapeHtml(modelName) + '</span>';
    wrap.appendChild(title);

    const pre = document.createElement('pre');
    pre.textContent = output || '(empty)';
    pre.addEventListener('click', (e) => e.stopPropagation());
    wrap.appendChild(pre);

    const row = document.createElement('div');
    row.className = 'label-row';
    const pos = document.createElement('button');
    pos.className = 'lbl pos';
    pos.textContent = '+ good';
    const neg = document.createElement('button');
    neg.className = 'lbl neg';
    neg.textContent = '− bad';
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'calibrate';
    row.appendChild(pos);
    row.appendChild(neg);
    row.appendChild(hint);
    wrap.appendChild(row);

    const feedback = document.createElement('div');
    feedback.className = 'saved';
    feedback.style.display = 'none';
    wrap.appendChild(feedback);

    async function fire(polarity) {
      pos.disabled = neg.disabled = true;
      feedback.textContent = 'saving…';
      feedback.className = 'saved';
      feedback.style.display = 'block';
      try {
        const res = await fetch('/api/calibration', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: caseInput, output: output || '', polarity }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        feedback.textContent = 'saved (' + data.entryCount + ' labels)';
      } catch (err) {
        feedback.className = 'save-err';
        feedback.textContent = 'save failed: ' + (err.message || err);
      } finally {
        pos.disabled = neg.disabled = false;
      }
    }
    pos.addEventListener('click', (e) => { e.stopPropagation(); fire('positive'); });
    neg.addEventListener('click', (e) => { e.stopPropagation(); fire('negative'); });
    return wrap;
  }

  async function loadWorkspace() {
    try {
      const res = await fetch('/api/workspace');
      if (!res.ok) throw new Error(await res.text());
      state.workspace = await res.json();
      $('config-path').textContent = state.workspace.configPath;
      $('mock-toggle').checked = false;
      const cfgMode = state.workspace.config && state.workspace.config.mode;
      state.mode = cfgMode === 'compare-models' ? 'compare-models' : 'compare-prompts';
      applyMode();
      activateTab(state.mode === 'compare-models' ? 'baseline' : state.active);
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
    const mode = state.mode;
    const controller = new AbortController();
    let buffered = '';
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mock, mode }),
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
  for (const btn of document.querySelectorAll('#mode-toggle button')) {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  }
  $('steelman-btn').addEventListener('click', steelmanActivePrompt);

  async function steelmanActivePrompt() {
    if (!state.workspace) return;
    const which = state.active;
    const panel = $('steelman-panel');
    const btn = $('steelman-btn');
    btn.disabled = true;
    btn.textContent = '✨ Thinking…';
    panel.style.display = 'block';
    panel.className = 'steelman-panel';
    panel.innerHTML = '<div class="title">steelman of ' + which + '</div><div class="rationale" style="color:var(--muted)">asking the judge model…</div>';

    const mock = $('mock-toggle').checked;
    try {
      const res = await fetch('/api/steelman', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ which, mock }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

      panel.innerHTML = '';

      const title = document.createElement('div');
      title.className = 'title';
      const tlabel = document.createElement('span');
      tlabel.textContent = 'steelman of ' + which;
      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      const applyBtn = document.createElement('button');
      applyBtn.className = 'apply';
      applyBtn.textContent = 'Apply → editor';
      const dismissBtn = document.createElement('button');
      dismissBtn.textContent = 'Dismiss';
      title.appendChild(tlabel);
      title.appendChild(spacer);
      title.appendChild(applyBtn);
      title.appendChild(dismissBtn);
      panel.appendChild(title);

      const rationale = document.createElement('div');
      rationale.className = 'rationale';
      rationale.textContent = data.rationale;
      panel.appendChild(rationale);

      const pre = document.createElement('pre');
      pre.className = 'revised';
      pre.textContent = data.revised;
      panel.appendChild(pre);

      applyBtn.addEventListener('click', () => {
        activateTab(which);
        $('prompt-editor').value = data.revised;
        setDirty(true);
      });
      dismissBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        panel.innerHTML = '';
      });
    } catch (err) {
      panel.className = 'steelman-panel err';
      panel.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = 'steelman failed';
      const body = document.createElement('div');
      body.textContent = err.message || String(err);
      panel.appendChild(title);
      panel.appendChild(body);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Steelman';
    }
  }

  // ── Runs drawer ────────────────────────────────────────────────────────────
  // Browse the local registry (~/.rubric/runs), open one for summary+cells, or
  // select two via checkboxes to side-by-side diff their summaries. Zero-dep
  // vanilla JS to match the rest of the file.
  const runsState = {
    open: false,
    runs: [],           // list manifests
    selected: new Set(),// ids checked for diff
    active: null,       // id currently expanded
  };

  function shortTs(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  function formatPct(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return (n * 100).toFixed(1) + '%';
  }

  function openRunsDrawer() {
    runsState.open = true;
    $('runs-drawer').classList.add('open');
    $('runs-drawer').setAttribute('aria-hidden', 'false');
    $('runs-backdrop').classList.add('open');
    loadRunsList();
  }

  function closeRunsDrawer() {
    runsState.open = false;
    runsState.active = null;
    runsState.selected.clear();
    $('runs-drawer').classList.remove('open');
    $('runs-drawer').setAttribute('aria-hidden', 'true');
    $('runs-backdrop').classList.remove('open');
    updateDiffButton();
  }

  function updateDiffButton() {
    $('runs-diff-btn').disabled = runsState.selected.size !== 2;
  }

  async function loadRunsList() {
    const body = $('runs-body');
    body.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const res = await fetch('/api/runs?limit=50');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      runsState.runs = data.runs || [];
      renderRunsList();
    } catch (err) {
      body.innerHTML = '';
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'failed to load runs: ' + (err.message || err);
      body.appendChild(e);
    }
  }

  function renderRunsList() {
    const body = $('runs-body');
    body.innerHTML = '';
    if (runsState.runs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No runs in registry yet. Run rubric run to create one.';
      body.appendChild(empty);
      return;
    }
    const hint = document.createElement('div');
    hint.className = 'empty';
    hint.style.textAlign = 'left';
    hint.style.padding = '0 0 8px 0';
    hint.textContent = 'Click a row to inspect. Check two rows and "Diff 2" to compare.';
    body.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'runs-list';
    for (const r of runsState.runs) {
      const row = document.createElement('div');
      row.className = 'run-row';
      row.dataset.runId = r.id;
      if (runsState.active === r.id) row.classList.add('selected');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = runsState.selected.has(r.id);
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (runsState.selected.size >= 2) {
            cb.checked = false;
            return;
          }
          runsState.selected.add(r.id);
        } else {
          runsState.selected.delete(r.id);
        }
        updateDiffButton();
      });
      row.appendChild(cb);

      const meta = document.createElement('div');
      meta.style.flex = '1';
      meta.style.minWidth = '0';
      const rid = document.createElement('div');
      rid.className = 'rid';
      rid.textContent = r.id;
      const sub = document.createElement('div');
      sub.className = 'meta';
      const when = shortTs(r.finishedAt || r.startedAt);
      const sum = r.summary
        ? r.summary.wins + 'W/' + r.summary.losses + 'L/' + r.summary.ties + 'T · ' + formatPct(r.summary.winRate)
        : '—';
      sub.textContent = when + ' · ' + sum;
      meta.appendChild(rid);
      meta.appendChild(sub);
      row.appendChild(meta);

      const status = document.createElement('span');
      status.className = 'status ' + (r.status || 'pending');
      status.textContent = r.status || '?';
      row.appendChild(status);

      row.addEventListener('click', () => openRunDetail(r.id));
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  async function openRunDetail(id) {
    runsState.active = id;
    for (const row of document.querySelectorAll('.run-row')) {
      row.classList.toggle('selected', row.dataset.runId === id);
    }
    const body = $('runs-body');
    const existing = body.querySelector('.run-detail');
    if (existing) existing.remove();
    const detail = document.createElement('div');
    detail.className = 'run-detail';
    detail.innerHTML = '<div class="empty">Loading…</div>';
    body.appendChild(detail);
    try {
      const res = await fetch('/api/runs/' + encodeURIComponent(id));
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || ('HTTP ' + res.status));
      }
      const data = await res.json();
      renderRunDetail(detail, data.manifest, data.cells);
      // Clustering is best-effort — a failure there shouldn't break the detail view.
      fetch('/api/runs/' + encodeURIComponent(id) + '/clusters')
        .then((r) => (r.ok ? r.json() : null))
        .then((c) => { if (c && Array.isArray(c.clusters)) renderRunClusters(detail, c.clusters); })
        .catch(() => {});
    } catch (err) {
      detail.innerHTML = '';
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'failed to load run: ' + (err.message || err);
      detail.appendChild(e);
    }
  }

  function renderRunClusters(container, clusters) {
    if (!clusters || clusters.length === 0) return;
    const existing = container.querySelector('.clusters');
    if (existing) existing.remove();
    const wrap = document.createElement('div');
    wrap.className = 'clusters';
    const h = document.createElement('h4');
    h.style.marginTop = '10px';
    h.textContent = 'failure clusters (' + clusters.length + ')';
    wrap.appendChild(h);
    for (const c of clusters) {
      const row = document.createElement('div');
      row.className = 'cluster-row';
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = '×' + c.count;
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = c.label;
      const sample = document.createElement('div');
      sample.className = 'sample';
      sample.textContent = c.sampleReason || '';
      const indices = document.createElement('div');
      indices.className = 'indices';
      const idxPreview = c.caseIndices.slice(0, 8).join(', ');
      indices.textContent = 'cases: ' + idxPreview + (c.caseIndices.length > 8 ? ', … (' + (c.caseIndices.length - 8) + ' more)' : '');
      row.appendChild(count);
      row.appendChild(label);
      row.appendChild(sample);
      row.appendChild(indices);
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
  }

  function renderRunDetail(container, manifest, cells) {
    container.innerHTML = '';
    const h = document.createElement('h4');
    h.textContent = manifest.id;
    container.appendChild(h);

    const dl = document.createElement('dl');
    const rows = [
      ['status', manifest.status || '—'],
      ['started', shortTs(manifest.startedAt)],
      ['finished', shortTs(manifest.finishedAt)],
      ['cells', (manifest.summary
        ? (manifest.summary.wins + manifest.summary.losses + manifest.summary.ties + manifest.summary.errors)
        : cells.length) + ' of ' + (manifest.plannedCells || '?')],
      ['win rate', manifest.summary ? formatPct(manifest.summary.winRate) : '—'],
      ['W/L/T/E', manifest.summary
        ? [manifest.summary.wins, manifest.summary.losses, manifest.summary.ties, manifest.summary.errors].join(' / ')
        : '—'],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = String(v);
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    container.appendChild(dl);

    if (cells && cells.length > 0) {
      const h2 = document.createElement('h4');
      h2.style.marginTop = '10px';
      h2.textContent = 'cells (' + cells.length + ')';
      container.appendChild(h2);
      const table = document.createElement('table');
      table.className = 'grid-table';
      table.innerHTML =
        '<thead><tr><th>#</th><th>model</th><th>winner</th><th>reason</th></tr></thead>';
      const tbody = document.createElement('tbody');
      for (const c of cells.slice(0, 20)) {
        const tr = document.createElement('tr');
        const w = (c.judge && c.judge.winner) || (c.error ? 'error' : '—');
        const r = (c.judge && c.judge.reason) || (c.error || '');
        tr.innerHTML =
          '<td>' + c.caseIndex + '</td>' +
          '<td class="mono">' + String(c.model || '') + '</td>' +
          '<td>' + w + '</td>' +
          '<td>' + r.replace(/[<>&]/g, (ch) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch])) + '</td>';
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      container.appendChild(table);
      if (cells.length > 20) {
        const more = document.createElement('div');
        more.className = 'empty';
        more.style.textAlign = 'left';
        more.textContent = '… ' + (cells.length - 20) + ' more cell(s) hidden.';
        container.appendChild(more);
      }
    }
  }

  async function diffSelected() {
    if (runsState.selected.size !== 2) return;
    const [idA, idB] = [...runsState.selected];
    const body = $('runs-body');
    const existing = body.querySelector('.run-detail');
    if (existing) existing.remove();
    const detail = document.createElement('div');
    detail.className = 'run-detail';
    detail.innerHTML = '<div class="empty">Diffing…</div>';
    body.appendChild(detail);
    try {
      const [rA, rB] = await Promise.all([
        fetch('/api/runs/' + encodeURIComponent(idA)).then((r) => r.json()),
        fetch('/api/runs/' + encodeURIComponent(idB)).then((r) => r.json()),
      ]);
      renderRunDiff(detail, rA, rB);
    } catch (err) {
      detail.innerHTML = '';
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'diff failed: ' + (err.message || err);
      detail.appendChild(e);
    }
  }

  function renderRunDiff(container, A, B) {
    container.innerHTML = '';
    const h = document.createElement('h4');
    h.textContent = 'diff · ' + A.manifest.id.slice(-8) + ' vs ' + B.manifest.id.slice(-8);
    container.appendChild(h);

    const grid = document.createElement('div');
    grid.className = 'diff-grid';
    for (const side of [A, B]) {
      const col = document.createElement('div');
      col.className = 'diff-col';
      const h5 = document.createElement('h5');
      h5.textContent = side.manifest.id;
      col.appendChild(h5);
      const s = side.manifest.summary || {};
      const dl = document.createElement('dl');
      const rows = [
        ['status', side.manifest.status || '—'],
        ['finished', shortTs(side.manifest.finishedAt)],
        ['wins', s.wins ?? '—'],
        ['losses', s.losses ?? '—'],
        ['ties', s.ties ?? '—'],
        ['errors', s.errors ?? '—'],
        ['win rate', typeof s.winRate === 'number' ? formatPct(s.winRate) : '—'],
      ];
      for (const [k, v] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = String(v);
        dl.appendChild(dt);
        dl.appendChild(dd);
      }
      col.appendChild(dl);
      grid.appendChild(col);
    }
    container.appendChild(grid);

    const delta = document.createElement('div');
    delta.style.marginTop = '10px';
    delta.style.fontSize = '12px';
    const wrA = A.manifest.summary && A.manifest.summary.winRate;
    const wrB = B.manifest.summary && B.manifest.summary.winRate;
    if (typeof wrA === 'number' && typeof wrB === 'number') {
      const d = wrB - wrA;
      const sign = d > 0 ? '+' : '';
      delta.textContent = 'Δ win rate (B − A): ' + sign + (d * 100).toFixed(1) + '%';
    } else {
      delta.textContent = 'Δ win rate unavailable (missing summary on one side).';
    }
    container.appendChild(delta);
  }

  $('runs-btn').addEventListener('click', openRunsDrawer);
  $('runs-close-btn').addEventListener('click', closeRunsDrawer);
  $('runs-backdrop').addEventListener('click', closeRunsDrawer);
  $('runs-diff-btn').addEventListener('click', diffSelected);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && runsState.open) closeRunsDrawer();
  });

  loadWorkspace();
})();
</script>
</body>
</html>
`;
