/**
 * Single-file HTML UI for `rubric serve`. Zero build step: this is
 * plain HTML + inline CSS + a tiny vanilla-JS controller that talks to
 * /api/workspace, /api/prompts, and /api/run (SSE).
 *
 * Kept as a TypeScript string literal export so the server can embed it
 * at runtime without filesystem coupling.
 */

export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>rubric</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* ============================================================
     rubric — hacker terminal theme
     mono-only, phosphor green on near-black, sharp edges, scanlines
     ============================================================ */
  :root {
    --bg:         #030603;
    --panel:      #070b07;
    --panel-2:    #0a100a;
    --panel-3:    #0d150d;
    --border:     #1a3a1a;
    --border-hi:  #2c5a2c;
    --text:       #c4ffd1;
    --text-hi:    #e6ffe9;
    --muted:      #5a9e6a;
    --muted-2:    #2a4a32;
    --accent:     #39ff14;
    --accent-dim: #1aa30b;
    --accent-weak:#0a1f0a;
    --win:        #39ff14;
    --loss:       #ff3860;
    --tie:        #ffb000;
    --err:        #ff3860;
    --mono: ui-monospace, "JetBrains Mono", "Fira Code", "IBM Plex Mono", "Berkeley Mono", SFMono-Regular, Menlo, Consolas, monospace;
    --sans: var(--mono);
    --glow: 0 0 1px currentColor, 0 0 6px rgba(57,255,20,.35);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; font-family: var(--mono); }

  /* Keyboard focus — high-contrast phosphor ring. Only on keyboard nav
     so mouse clicks stay clean. */
  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Skip link — visually hidden until focused. Lets keyboard users jump
     past the header into editable content. */
  .skip-link {
    position: absolute; left: 8px; top: -40px;
    background: var(--accent-weak); color: var(--accent);
    padding: 8px 12px; border: 1px solid var(--accent-dim);
    font: 12px/1 var(--mono); text-transform: uppercase; letter-spacing: 0.1em;
    z-index: 50; text-decoration: none;
    transition: top .1s;
  }
  .skip-link:focus { top: 8px; }

  body {
    background: var(--bg); color: var(--text);
    font: 13px/1.5 var(--mono);
    font-feature-settings: "zero", "ss01";
    display: flex; flex-direction: column;
    position: relative;
    /* subtle vignette so the center glows */
    background-image:
      radial-gradient(ellipse at 50% 0%, rgba(57,255,20,0.04) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 100%, rgba(57,255,20,0.02) 0%, transparent 60%);
  }
  /* CRT scanlines — fixed overlay, non-interactive */
  body::before {
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 1000;
    background: repeating-linear-gradient(
      to bottom,
      rgba(0,0,0,0) 0px,
      rgba(0,0,0,0) 2px,
      rgba(0,0,0,0.18) 3px,
      rgba(0,0,0,0) 4px
    );
    mix-blend-mode: multiply;
  }
  /* faint green grid on the bg so the surface feels like a terminal graph */
  body::after {
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      linear-gradient(rgba(57,255,20,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(57,255,20,0.025) 1px, transparent 1px);
    background-size: 24px 24px;
    mask-image: radial-gradient(ellipse at center, rgba(0,0,0,0.9), transparent 70%);
  }

  /* Selection */
  ::selection { background: var(--accent); color: #000; }

  /* Scrollbars */
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: var(--panel); }
  ::-webkit-scrollbar-thumb { background: var(--border); border: 1px solid var(--panel); }
  ::-webkit-scrollbar-thumb:hover { background: var(--border-hi); }

  header {
    display: flex; align-items: center; gap: 14px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, var(--panel-2) 0%, var(--panel) 100%);
    position: relative; z-index: 2;
  }
  /* bottom hairline glow */
  header::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent-dim), transparent);
    opacity: .5;
  }
  header h1 {
    margin: 0; font-size: 16px; font-weight: 700;
    letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--accent); text-shadow: var(--glow);
    font-family: var(--mono);
    position: relative; padding-right: 10px;
  }
  header h1::before { content: ">_ "; color: var(--accent-dim); }
  header h1::after {
    content: "█"; display: inline-block; margin-left: 6px; color: var(--accent);
    animation: cursor-blink 1.06s steps(2, start) infinite;
  }
  @keyframes cursor-blink { to { visibility: hidden; } }

  header .sub {
    color: var(--muted); font-size: 11px; font-family: var(--mono);
    letter-spacing: 0.02em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 420px;
  }
  header .sub::before { content: "cfg:"; color: var(--muted-2); margin-right: 6px; }
  header .spacer { flex: 1; }

  header button, header label {
    background: var(--panel-3); color: var(--text);
    border: 1px solid var(--border); border-radius: 0;
    padding: 6px 12px; min-height: 32px;
    display: inline-flex; align-items: center;
    font: 12px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase;
    cursor: pointer;
    transition: color .08s, border-color .08s, background .08s, box-shadow .08s;
  }
  header button:hover, header label:hover {
    color: var(--accent); border-color: var(--accent-dim);
    box-shadow: inset 0 0 0 1px var(--accent-dim), 0 0 8px rgba(57,255,20,0.15);
  }
  header button.primary {
    background: var(--accent-weak); color: var(--accent);
    border-color: var(--accent-dim);
    text-shadow: 0 0 4px rgba(57,255,20,0.5);
  }
  header button.primary:hover {
    background: var(--accent); color: #000;
    text-shadow: none;
    box-shadow: 0 0 12px rgba(57,255,20,0.6);
  }
  header button:disabled { opacity: .35; cursor: not-allowed; box-shadow: none; color: var(--muted); border-color: var(--border); background: var(--panel-3); }
  header label { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
  header input[type=checkbox] {
    appearance: none; -webkit-appearance: none;
    width: 14px; height: 14px; margin: 0;
    border: 1px solid var(--border-hi); background: var(--panel);
    position: relative; cursor: pointer;
  }
  header input[type=checkbox]:checked {
    background: var(--accent-weak); border-color: var(--accent);
  }
  header input[type=checkbox]:checked::after {
    content: "×"; position: absolute; inset: -2px 0 0 0;
    text-align: center; color: var(--accent); font-weight: 700;
    text-shadow: var(--glow); line-height: 14px;
  }

  main {
    display: grid; grid-template-columns: 1fr 320px 1.3fr;
    gap: 0; flex: 1; min-height: 0;
    position: relative; z-index: 2;
  }
  section {
    display: flex; flex-direction: column;
    border-right: 1px solid var(--border); min-width: 0; min-height: 0;
    background: var(--panel);
  }
  section:last-child { border-right: none; }

  .pane-title {
    margin: 0;
    padding: 7px 14px; font-size: 10px; text-transform: uppercase; letter-spacing: .22em;
    color: var(--muted); border-bottom: 1px solid var(--border);
    background: var(--panel-2);
    display: flex; align-items: center; gap: 10px;
    font-family: var(--mono); font-weight: 600;
  }
  .pane-title::before { content: "[ "; color: var(--border-hi); }
  .pane-title > span:first-child, .pane-title > :not(.dot):first-child {}
  .pane-title .dot {
    width: 8px; height: 8px; border-radius: 0; background: var(--muted-2);
    box-shadow: inset 0 0 0 1px var(--muted-2);
  }
  .pane-title .dot.dirty { background: var(--tie); box-shadow: 0 0 6px var(--tie); }
  .pane-title .dot.saved { background: var(--accent); box-shadow: 0 0 6px var(--accent); }

  .prompts-pane { display: flex; flex-direction: column; }
  .prompts-pane .tabs {
    display: flex; border-bottom: 1px solid var(--border); background: var(--panel);
  }
  .prompts-pane .tabs button {
    flex: 1; background: transparent; border: 0;
    padding: 9px 12px;
    color: var(--muted); font: 12px/1 var(--mono); letter-spacing: 0.08em;
    text-transform: uppercase; cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color .1s, border-color .1s;
  }
  .prompts-pane .tabs button.active {
    color: var(--accent); border-bottom-color: var(--accent);
    text-shadow: 0 0 4px rgba(57,255,20,0.4);
    background: var(--accent-weak);
  }
  .prompts-pane .tabs button:hover:not(.active) { color: var(--text); }

  .prompts-pane textarea {
    flex: 1; width: 100%; resize: none; padding: 14px 16px; border: 0;
    background: var(--panel); color: var(--text-hi);
    font-family: var(--mono); font-size: 13px; line-height: 1.6;
    outline: none; caret-color: var(--accent);
    text-shadow: 0 0 1px currentColor;
  }
  .prompts-pane textarea::placeholder { color: var(--muted-2); }

  .prompts-pane .footer {
    padding: 8px 12px; border-top: 1px solid var(--border);
    display: flex; gap: 8px; align-items: center; background: var(--panel-2);
  }
  .prompts-pane .footer button {
    background: var(--panel-3); color: var(--text);
    border: 1px solid var(--border); border-radius: 0;
    padding: 6px 11px;
    font: 11px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase;
    cursor: pointer;
    transition: color .08s, border-color .08s, box-shadow .08s;
  }
  .prompts-pane .footer button:hover {
    color: var(--accent); border-color: var(--accent-dim);
    box-shadow: 0 0 8px rgba(57,255,20,0.15);
  }
  .prompts-pane .footer .hint {
    color: var(--muted); font-size: 11px;
    font-family: var(--mono); letter-spacing: 0.02em;
  }
  .prompts-pane .footer .hint::before { content: "// "; color: var(--muted-2); }

  .cases-pane .list { overflow-y: auto; }
  .case-row {
    padding: 9px 14px; border-bottom: 1px solid var(--border);
    cursor: default;
    transition: background .08s, border-color .08s;
    position: relative;
  }
  .case-row:hover { background: var(--panel-2); }
  .case-row::before {
    content: "$ "; color: var(--muted-2); font-family: var(--mono); font-size: 11px;
    position: absolute; left: 3px; top: 9px;
  }
  .case-row .meta {
    display: flex; gap: 6px; font-size: 10px; color: var(--muted); margin-bottom: 4px;
    text-transform: uppercase; letter-spacing: 0.08em;
  }
  .case-row .meta .tag {
    background: var(--accent-weak); color: var(--accent-dim);
    padding: 1px 7px; border-radius: 0; border: 1px solid var(--muted-2);
    font-family: var(--mono);
  }
  .case-row .input {
    font-size: 12px; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-family: var(--mono);
  }

  .results-pane { display: flex; flex-direction: column; }
  .results-pane .summary {
    display: grid; grid-template-columns: repeat(7, 1fr);
    gap: 1px; background: var(--border);
    border-bottom: 1px solid var(--border);
  }
  .results-pane .summary .cell {
    background: var(--panel); padding: 12px 10px; text-align: center;
    position: relative;
    transition: background .1s;
  }
  .results-pane .summary .cell:hover { background: var(--panel-2); }
  .results-pane .summary .cell .n {
    font-size: 22px; font-weight: 700;
    font-variant-numeric: tabular-nums;
    font-family: var(--mono);
    line-height: 1.1;
    color: var(--text-hi);
  }
  .results-pane .summary .cell .k {
    font-size: 9px; text-transform: uppercase; letter-spacing: .18em;
    color: var(--muted); margin-top: 4px;
    font-family: var(--mono);
  }
  .results-pane .summary .cell.win  .n { color: var(--win);  text-shadow: 0 0 6px rgba(57,255,20,0.45); }
  .results-pane .summary .cell.loss .n { color: var(--loss); text-shadow: 0 0 6px rgba(255,56,96,0.45); }
  .results-pane .summary .cell.tie  .n { color: var(--tie);  text-shadow: 0 0 6px rgba(255,176,0,0.35); }
  .results-pane .summary .cell.err  .n { color: var(--err);  text-shadow: 0 0 6px rgba(255,56,96,0.45); }

  .grid-wrap { flex: 1; overflow: auto; }
  table.grid {
    width: 100%; border-collapse: collapse; font-size: 12px;
    font-family: var(--mono);
  }
  table.grid th, table.grid td {
    border-bottom: 1px solid var(--border); padding: 8px 12px; text-align: left;
    vertical-align: top;
  }
  table.grid th {
    position: sticky; top: 0; background: var(--panel-2);
    font-weight: 600; color: var(--muted); text-transform: uppercase;
    font-size: 10px; letter-spacing: .18em;
    border-bottom: 1px solid var(--border-hi);
  }
  table.grid td.idx {
    color: var(--accent-dim); font-family: var(--mono); width: 40px;
    font-weight: 600;
  }
  table.grid td.model { font-family: var(--mono); color: var(--muted); width: 140px; }
  table.grid td.input {
    max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    color: var(--text);
  }
  table.grid td.verdict {
    width: 80px; font-weight: 700; font-family: var(--mono);
    text-transform: uppercase; letter-spacing: 0.1em; font-size: 11px;
  }
  table.grid td.verdict.win  { color: var(--win);  text-shadow: 0 0 4px rgba(57,255,20,0.4); }
  table.grid td.verdict.loss { color: var(--loss); }
  table.grid td.verdict.tie  { color: var(--tie); }
  table.grid td.verdict.err  { color: var(--err); }
  table.grid td.reason { color: var(--muted); font-size: 11px; line-height: 1.5; }
  table.grid tr.header-row { cursor: pointer; transition: background .08s; }
  table.grid tr.header-row:hover { background: var(--accent-weak); }
  table.grid tr.header-row:hover td.idx { color: var(--accent); text-shadow: 0 0 4px rgba(57,255,20,0.5); }
  table.grid tr.detail-row td {
    padding: 0; background: var(--panel-2);
    border-bottom: 1px solid var(--border);
    border-left: 2px solid var(--accent-dim);
  }
  .detail-verdict {
    padding: 12px 16px; background: var(--panel-2);
    border-bottom: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 8px; font-size: 12px;
  }
  .detail-verdict .headline {
    display: flex; align-items: center; gap: 10px;
    font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: .14em;
    color: var(--muted);
  }
  .detail-verdict .headline .pill {
    padding: 3px 10px; border-radius: 0; font-weight: 700;
    background: var(--panel-3); border: 1px solid var(--border);
    font-family: var(--mono); letter-spacing: 0.1em;
  }
  .detail-verdict.winner-a .pill   { color: var(--loss); border-color: var(--loss); background: rgba(255,56,96,0.08); }
  .detail-verdict.winner-b .pill   { color: var(--win);  border-color: var(--win);  background: var(--accent-weak); text-shadow: 0 0 4px rgba(57,255,20,0.4); }
  .detail-verdict.winner-tie .pill { color: var(--tie);  border-color: var(--tie);  background: rgba(255,176,0,0.08); }
  .detail-verdict.err .pill        { color: var(--err);  border-color: var(--err);  background: rgba(255,56,96,0.08); }
  .detail-verdict .reason {
    color: var(--text); font-size: 12px; line-height: 1.55;
    padding: 4px 0; white-space: pre-wrap; word-break: break-word;
    font-family: var(--mono);
    padding-left: 10px; border-left: 2px solid var(--border);
  }
  .detail-verdict .expected {
    font-size: 11px; color: var(--muted); display: flex; gap: 8px; align-items: baseline;
  }
  .detail-verdict .expected .k {
    font-family: var(--mono); text-transform: uppercase; letter-spacing: .14em; font-size: 9px;
    color: var(--muted-2);
  }
  .detail-verdict .expected .v {
    color: var(--text); font-family: var(--mono); font-size: 11px;
    white-space: pre-wrap; word-break: break-word;
  }
  .detail-box {
    display: grid; grid-template-columns: 1fr 1fr; gap: 1px;
    background: var(--border);
  }
  .detail-side {
    padding: 12px 14px; background: var(--panel);
    display: flex; flex-direction: column; gap: 8px;
  }
  .detail-side .side-title {
    font-size: 10px; text-transform: uppercase; letter-spacing: .18em; color: var(--muted);
    display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-weight: 600;
  }
  .detail-side .side-title::before { content: "▎"; color: var(--accent-dim); }
  .detail-side .side-title .model-tag {
    font-family: var(--mono); color: var(--accent); text-transform: none; letter-spacing: 0;
    background: var(--accent-weak); padding: 2px 7px; border-radius: 0;
    font-size: 10px; border: 1px solid var(--muted-2);
  }
  .detail-side pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font-family: var(--mono); font-size: 12px; color: var(--text);
    max-height: 220px; overflow: auto;
    background: var(--panel-2); padding: 10px 12px;
    border: 1px solid var(--border); border-left: 2px solid var(--accent-dim);
    line-height: 1.55;
  }
  .empty {
    padding: 40px 16px; color: var(--muted); text-align: center;
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em;
  }
  .empty::before { content: "// "; color: var(--muted-2); }

  .idle-banner {
    padding: 34px 16px 42px; text-align: center;
    font-family: var(--mono); color: var(--muted-2);
    font-size: 10px; line-height: 1.55; letter-spacing: 0.04em;
    user-select: none;
  }
  .idle-banner pre {
    margin: 0 auto; display: inline-block; text-align: left;
    color: #1f5a18; font-size: 10px; line-height: 1.0;
    letter-spacing: 0; font-family: ui-monospace, "JetBrains Mono", "Fira Code", Menlo, monospace;
    white-space: pre;
    text-shadow: 0 0 8px rgba(57,255,20,0.15);
  }
  .idle-banner .sub-hint {
    margin-top: 10px; color: var(--muted-2); font-size: 10px;
    letter-spacing: 0.08em; font-family: var(--mono);
  }
  .idle-banner .hint {
    margin-top: 16px; color: var(--muted); font-size: 11px;
    letter-spacing: 0.14em; text-transform: uppercase;
  }
  .idle-banner .hint .k {
    color: var(--accent); text-shadow: var(--glow);
    padding: 1px 6px; border: 1px solid var(--border-hi);
    background: var(--accent-weak);
  }
  .idle-banner .blink { animation: cursor-blink 1.1s steps(1) infinite; color: var(--accent); }

  .dim { color: var(--muted-2); font-family: var(--mono); }

  .err-banner {
    padding: 10px 16px; background: rgba(255,56,96,0.08);
    color: var(--loss); border-bottom: 1px solid var(--loss);
    font-family: var(--mono); font-size: 12px; letter-spacing: 0.04em;
    position: relative; z-index: 3;
  }
  .err-banner::before {
    content: "ERROR:: "; font-weight: 700; letter-spacing: 0.14em;
    text-shadow: 0 0 4px rgba(255,56,96,0.5);
  }

  /* Runs drawer — slides in from the right when RUNS is clicked. */
  .runs-drawer {
    position: fixed; top: 0; right: 0; bottom: 0; width: 540px;
    background: var(--panel); border-left: 2px solid var(--accent-dim);
    display: flex; flex-direction: column;
    transform: translateX(100%); transition: transform .18s ease-out;
    z-index: 40; box-shadow: -8px 0 32px rgba(0,0,0,.7), -1px 0 0 var(--accent-dim);
  }
  .runs-drawer.open { transform: translateX(0); }
  .runs-drawer .title {
    padding: 10px 16px;
    font-size: 12px; font-weight: 700; font-family: var(--mono);
    letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--accent); text-shadow: var(--glow);
    border-bottom: 1px solid var(--border);
    background: var(--panel-2);
    display: flex; align-items: center; gap: 10px;
  }
  .runs-drawer .title strong::before { content: "[ "; color: var(--border-hi); font-weight: 400; }
  .runs-drawer .title strong::after  { content: " ]"; color: var(--border-hi); font-weight: 400; }
  .runs-drawer .title .spacer { flex: 1; }
  .runs-drawer .title button {
    background: var(--panel-3); color: var(--text); border: 1px solid var(--border);
    border-radius: 0; padding: 5px 11px;
    font: 10px/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase;
    cursor: pointer;
    transition: all .08s;
  }
  .runs-drawer .title button:hover { color: var(--accent); border-color: var(--accent-dim); }
  .runs-drawer .title button.primary {
    border-color: var(--accent); color: var(--accent);
    background: var(--accent-weak);
  }
  .runs-drawer .title button.primary:hover { background: var(--accent); color: #000; box-shadow: 0 0 8px rgba(57,255,20,0.5); }
  .runs-drawer .title button:disabled { opacity: .3; cursor: not-allowed; box-shadow: none; }

  .runs-drawer .body { flex: 1; overflow: auto; padding: 14px 16px; }
  .runs-drawer .empty {
    color: var(--muted); font-size: 11px; padding: 24px 0; text-align: center;
    font-family: var(--mono); letter-spacing: 0.12em;
  }
  .runs-drawer .runs-list { display: flex; flex-direction: column; gap: 6px; }
  .runs-drawer .run-row {
    display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center;
    padding: 9px 11px; border: 1px solid var(--border); border-radius: 0;
    background: var(--panel-2); cursor: pointer; font-size: 12px;
    transition: all .08s;
  }
  .runs-drawer .run-row:hover {
    border-color: var(--accent-dim);
    background: var(--accent-weak);
  }
  .runs-drawer .run-row.selected {
    border-color: var(--accent);
    background: var(--accent-weak);
    box-shadow: inset 0 0 0 1px var(--accent-dim), 0 0 8px rgba(57,255,20,0.2);
  }
  .runs-drawer .run-row input[type=checkbox] {
    appearance: none; -webkit-appearance: none;
    width: 14px; height: 14px; margin: 0;
    border: 1px solid var(--border-hi); background: var(--panel);
    position: relative; cursor: pointer;
  }
  .runs-drawer .run-row input[type=checkbox]:checked {
    background: var(--accent-weak); border-color: var(--accent);
  }
  .runs-drawer .run-row input[type=checkbox]:checked::after {
    content: "×"; position: absolute; inset: -3px 0 0 0;
    text-align: center; color: var(--accent); font-weight: 700; line-height: 14px;
    text-shadow: var(--glow);
  }
  .runs-drawer .run-row .rid {
    font-family: var(--mono); font-size: 11px; color: var(--text-hi);
    letter-spacing: 0.04em;
  }
  .runs-drawer .run-row .meta {
    color: var(--muted); font-family: var(--mono); font-size: 10px;
    letter-spacing: 0.04em;
  }
  .runs-drawer .run-row .status {
    padding: 2px 8px; border-radius: 0;
    font-size: 9px; text-transform: uppercase; letter-spacing: .18em;
    font-family: var(--mono); font-weight: 600;
    border: 1px solid currentColor;
  }
  .runs-drawer .run-row .status.complete  { color: var(--accent); text-shadow: 0 0 4px rgba(57,255,20,0.4); }
  .runs-drawer .run-row .status.running   { color: var(--tie); }
  .runs-drawer .run-row .status.failed    { color: var(--loss); }
  .runs-drawer .run-row .status.pending,
  .runs-drawer .run-row .status.abandoned { color: var(--muted); border-color: var(--border); }

  .runs-drawer .run-detail {
    margin-top: 16px; padding: 14px;
    border: 1px solid var(--border); border-left: 2px solid var(--accent-dim);
    background: var(--panel-2); font-size: 12px;
  }
  .runs-drawer .run-detail h4 {
    margin: 0 0 10px 0; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .2em; color: var(--accent);
    font-family: var(--mono); text-shadow: var(--glow);
  }
  .runs-drawer .run-detail h4::before { content: "▸ "; color: var(--accent-dim); }
  .runs-drawer .run-detail dl {
    display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0;
    font-family: var(--mono); font-size: 11px;
  }
  .runs-drawer .run-detail dt {
    color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; font-size: 10px;
  }
  .runs-drawer .run-detail dd { margin: 0; color: var(--text); }

  .runs-drawer .diff-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px;
  }
  .runs-drawer .diff-col {
    border: 1px solid var(--border); border-radius: 0;
    padding: 10px 12px; background: var(--panel-3);
    border-top: 2px solid var(--accent-dim);
  }
  .runs-drawer .diff-col h5 {
    margin: 0 0 8px 0; font-size: 10px; font-family: var(--mono); color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.2em; font-weight: 700;
  }

  .runs-drawer-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 35;
    display: none;
    backdrop-filter: blur(2px);
  }
  .runs-drawer-backdrop.open { display: block; }

  @media (max-width: 768px) {
    header {
      flex-wrap: wrap; gap: 8px 12px; padding: 8px 12px;
    }
    header .sub { order: 10; flex-basis: 100%; font-size: 11px; }
    main {
      grid-template-columns: 1fr; grid-auto-rows: minmax(220px, auto);
    }
    section { border-right: none; border-bottom: 1px solid var(--border); }
    section:last-child { border-bottom: none; }
    .results-pane .summary {
      grid-template-columns: repeat(4, 1fr);
    }
    .results-pane .summary .cell:nth-child(n+5) {
      border-top: 1px solid var(--border);
    }
    .runs-drawer { width: 100%; max-width: 100%; }
  }

  @media (pointer: coarse) {
    header button, header label,
    .prompts-pane .tabs button,
    .prompts-pane .footer button,
    .runs-drawer-header button,
    .runs-drawer-row button {
      min-height: 44px;
    }
  }
</style>
</head>
<body>
  <a href="#prompts-pane" class="skip-link">skip to prompts</a>
  <header>
    <h1>rubric</h1>
    <span class="sub" id="config-path">—</span>
    <span class="spacer"></span>
    <label><input type="checkbox" id="mock-toggle"> mock mode</label>
    <button id="runs-btn" aria-label="browse past runs from the registry" title="Browse past runs from the registry">runs.log</button>
    <button id="run-btn" class="primary" aria-label="run evaluation">&gt; run</button>
  </header>

  <div id="err" class="err-banner" role="alert" aria-live="assertive" style="display:none"></div>

  <main>
    <section class="prompts-pane" id="prompts-pane" role="region" aria-labelledby="prompts-pane-title">
      <h2 class="pane-title" id="prompts-pane-title">
        <span class="dot saved" id="prompt-dot" aria-hidden="true"></span>
        <span id="prompts-title">prompts</span>
      </h2>
      <div class="tabs">
        <button id="tab-baseline" class="active" data-which="baseline">baseline</button>
        <button id="tab-candidate" data-which="candidate">candidate</button>
      </div>
      <textarea id="prompt-editor" spellcheck="false" aria-label="prompt editor"></textarea>
      <div class="footer">
        <button id="save-btn" aria-label="save prompt">:w (⌘S)</button>
        <span class="hint" id="save-hint">editor is clean</span>
      </div>
    </section>

    <section class="cases-pane" role="region" aria-labelledby="cases-pane-title">
      <h2 class="pane-title" id="cases-pane-title">cases <span id="case-count" style="color:var(--muted);margin-left:auto"></span></h2>
      <div class="list" id="cases-list"></div>
    </section>

    <section class="results-pane" role="region" aria-labelledby="results-pane-title">
      <h2 class="pane-title" id="results-pane-title">
        results
        <span id="progress" style="color:var(--muted);margin-left:auto;font-family:var(--mono);font-size:11px"></span>
      </h2>
      <div class="summary" id="summary">
        <div class="cell win"><div class="n" id="sum-wins">0</div><div class="k">wins</div></div>
        <div class="cell loss"><div class="n" id="sum-losses">0</div><div class="k">losses</div></div>
        <div class="cell tie"><div class="n" id="sum-ties">0</div><div class="k">ties</div></div>
        <div class="cell err"><div class="n" id="sum-errors">0</div><div class="k">errors</div></div>
        <div class="cell"><div class="n dim" id="sum-rate">--</div><div class="k">win rate</div></div>
        <div class="cell"><div class="n dim" id="sum-cost">--</div><div class="k">cost</div></div>
        <div class="cell"><div class="n dim" id="sum-time">--</div><div class="k">wall sum</div></div>
      </div>
      <div class="grid-wrap">
        <table class="grid">
          <thead>
            <tr><th>#</th><th>model</th><th>input</th><th>winner</th><th>reason</th></tr>
          </thead>
          <tbody id="grid-body">
            <tr><td colspan="5">
              <div class="idle-banner">
                <pre>  ██████  ██    ██ ██████  ██████  ██  ██████
  ██   ██ ██    ██ ██   ██ ██   ██ ██ ██
  ██████  ██    ██ ██████  ██████  ██ ██
  ██   ██ ██    ██ ██   ██ ██   ██ ██ ██
  ██   ██  ██████  ██████  ██   ██ ██  ██████
</pre>
                <div class="hint">awaiting input <span class="blink">█</span> &nbsp;press <span class="k">&gt; run</span> to populate grid</div>
                <div class="sub-hint">// no runs yet &middot; prompts and cases are ready</div>
              </div>
            </td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <div id="runs-backdrop" class="runs-drawer-backdrop"></div>
  <aside id="runs-drawer" class="runs-drawer" aria-hidden="true">
    <div class="title">
      <strong>runs.log</strong>
      <span class="spacer"></span>
      <button id="runs-diff-btn" class="primary" disabled title="Select two runs to compare">diff &lt;2&gt;</button>
      <button id="runs-close-btn">[esc]</button>
    </div>
    <div class="body" id="runs-body">
      <div class="empty">loading...</div>
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
      list.innerHTML = '<div class="empty">no cases found in dataset.</div>';
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
    $('sum-rate').textContent = '--';
    $('sum-cost').textContent = '--';
    $('sum-time').textContent = '--';
    $('sum-rate').classList.add('dim');
    $('sum-cost').classList.add('dim');
    $('sum-time').classList.add('dim');
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
    const row = document.createElement('tr');
    row.className = 'header-row';
    row.innerHTML =
      '<td class="idx">▸ ' + cell.caseIndex + '</td>' +
      '<td class="model">' + escapeHtml(cell.model) + '</td>' +
      '<td class="input" title="' + escapeHtml(caseInput) + '">' + escapeHtml(caseInput) + '</td>' +
      '<td class="verdict ' + v.cls + '">' + v.label + '</td>' +
      '<td class="reason">' + escapeHtml(reason) + '</td>';
    const detailRow = document.createElement('tr');
    detailRow.className = 'detail-row';
    detailRow.style.display = 'none';
    detailRow.appendChild(buildDetailCell(cell, caseExpected));
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
    if (decisive === 0) {
      $('sum-rate').textContent = '--';
      $('sum-rate').classList.add('dim');
    } else {
      $('sum-rate').textContent = Math.round((counts.wins / decisive) * 100) + '%';
      $('sum-rate').classList.remove('dim');
    }
    if (typeof cell.costUsd === 'number') {
      costRoll.totalUsd += cell.costUsd;
      costRoll.costed++;
      $('sum-cost').textContent = fmtCost(costRoll.totalUsd);
      $('sum-cost').classList.remove('dim');
    }
    if (typeof cell.latencyMs === 'number') {
      costRoll.totalMs += cell.latencyMs;
      costRoll.timed++;
      $('sum-time').textContent = fmtMs(costRoll.totalMs);
      $('sum-time').classList.remove('dim');
    }
    $('progress').textContent = evt.progress.done + '/' + evt.progress.total;
  }

  function buildDetailCell(cell, caseExpected) {
    const td = document.createElement('td');
    td.colSpan = 5;

    td.appendChild(buildVerdictBanner(cell, caseExpected));

    const box = document.createElement('div');
    box.className = 'detail-box';

    box.appendChild(detailSide('A', 'A (baseline)', cell.outputA));
    box.appendChild(detailSide('B', 'B (candidate)', cell.outputB));
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
      pillLabel = 'CAND WINS';
      headline = 'Why this side won';
    } else if (j.winner === 'a') {
      block.classList.add('winner-a');
      pillLabel = 'BASE WINS';
      headline = 'Why the candidate lost';
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

    block.addEventListener('click', (e) => e.stopPropagation());
    return block;
  }

  function detailSide(side, modelName, output) {
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

    return wrap;
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
    $('run-btn').textContent = '> running...';
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
          const split = buffered.indexOf('\\n\\n');
          if (split === -1) break;
          const raw = buffered.slice(0, split);
          buffered = buffered.slice(split + 2);
          const lines = raw.split('\\n');
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
      $('run-btn').textContent = '> run';
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
    body.innerHTML = '<div class="empty">loading...</div>';
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
    detail.innerHTML = '<div class="empty">loading...</div>';
    body.appendChild(detail);
    try {
      const res = await fetch('/api/runs/' + encodeURIComponent(id));
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || ('HTTP ' + res.status));
      }
      const data = await res.json();
      renderRunDetail(detail, data.manifest, data.cells);
    } catch (err) {
      detail.innerHTML = '';
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'failed to load run: ' + (err.message || err);
      detail.appendChild(e);
    }
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
    detail.innerHTML = '<div class="empty">computing diff...</div>';
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
