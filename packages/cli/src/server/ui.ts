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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Geist:wght@400;500;600;700&display=swap">
<style>
  /* ============================================================
     rubric · "graphite"
     Warm slate dark theme with a single ochre accent.
     Geist for chrome, JetBrains Mono for data.
     ============================================================ */
  :root {
    /* Surfaces — warm slate, never pure black. Each level is ~3% lighter
       than the one below it, which keeps depth readable without lines. */
    --bg-0:        #0f1113;      /* page background */
    --bg-1:        #15181b;      /* primary panel surface */
    --bg-2:        #1b1f23;      /* raised surface (hover, header, tab-strip) */
    --bg-3:        #23282d;      /* pressed / selected / code blocks */
    --bg-4:        #2d3339;      /* dividers that need to feel like borders */

    /* Borders — hairlines at low alpha so stacked panels don't compound. */
    --line:        rgba(255,255,255,0.06);
    --line-hi:     rgba(255,255,255,0.10);

    /* Text */
    --fg:          #e6e8eb;      /* primary */
    --fg-hi:       #ffffff;      /* emphasis / hover text */
    --fg-mut:      #9aa0a6;      /* secondary labels */
    --fg-dim:      #6b7177;      /* tertiary, hints, placeholders */
    --fg-faint:    #4a4f55;      /* disabled, dim stats */

    /* Accent — ochre. Chosen deliberately: Linear uses purple, Vercel is
       monochrome, GitHub is blue. Ochre reads as "editorial" and "careful",
       which matches the eval-tool vibe better than any saturated primary. */
    --accent:      #d4a056;
    --accent-hi:   #e7b36a;
    --accent-soft: rgba(212,160,86,0.12);
    --accent-line: rgba(212,160,86,0.35);

    /* Semantic — muted so they don't scream. */
    --win:         #7fb685;      /* sage green */
    --win-soft:    rgba(127,182,133,0.14);
    --loss:        #d96c6c;      /* brick red */
    --loss-soft:   rgba(217,108,108,0.14);
    --tie:         #d4a056;      /* same ochre as accent — verdict=neutral reads as accent */
    --tie-soft:    rgba(212,160,86,0.12);
    --err:         #d96c6c;
    --err-soft:    rgba(217,108,108,0.10);

    /* Typography */
    --sans: "Geist", ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

    /* Shape */
    --radius:      6px;
    --radius-sm:   4px;
    --shadow-1:    0 1px 0 rgba(255,255,255,0.03) inset, 0 1px 2px rgba(0,0,0,0.3);
    --shadow-2:    0 4px 12px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset;
    --shadow-drawer: -32px 0 80px rgba(0,0,0,0.55);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; font-family: var(--sans); }

  /* Keyboard focus — subtle ochre ring. Only shows on keyboard nav. */
  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  /* Skip link — visually hidden until focused. */
  .skip-link {
    position: absolute; left: 12px; top: -48px;
    background: var(--bg-3); color: var(--fg-hi);
    padding: 8px 14px; border: 1px solid var(--line-hi);
    border-radius: var(--radius);
    font: 500 13px/1 var(--sans);
    z-index: 50; text-decoration: none;
    transition: top .12s;
    box-shadow: var(--shadow-1);
  }
  .skip-link:focus { top: 12px; }

  body {
    background: var(--bg-0); color: var(--fg);
    font: 13.5px/1.55 var(--sans);
    font-feature-settings: "cv11", "ss01";
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    display: flex; flex-direction: column;
    position: relative;
    letter-spacing: -0.003em;
  }

  /* Selection */
  ::selection { background: var(--accent-soft); color: var(--fg-hi); }

  /* Scrollbars — thin, understated, no "terminal" look. */
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: var(--bg-4);
    border: 2px solid transparent;
    background-clip: padding-box;
    border-radius: 10px;
  }
  ::-webkit-scrollbar-thumb:hover { background-color: #3a4148; background-clip: padding-box; }
  * { scrollbar-width: thin; scrollbar-color: var(--bg-4) transparent; }

  /* Code-like text helper, used for model ids, case inputs, timestamps. */
  .mono, code, kbd {
    font-family: var(--mono);
    font-feature-settings: "zero", "ss02";
    letter-spacing: 0;
  }
  kbd {
    display: inline-block;
    padding: 1px 6px 2px;
    font-size: 11px; line-height: 1;
    color: var(--fg); background: var(--bg-3);
    border: 1px solid var(--line-hi);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
  }

  /* Small-caps label — the one piece of terminal DNA we keep from the old UI. */
  .eyebrow {
    font-family: var(--sans);
    font-size: 10.5px; font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-mut);
  }

  header {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-1);
    position: relative; z-index: 2;
    min-height: 52px;
  }
  header h1 {
    margin: 0;
    font-family: var(--sans);
    font-size: 15px; font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--fg-hi);
    display: inline-flex; align-items: center; gap: 10px;
  }
  /* Brand mark — small filled square that echoes the results-grid cells. Uses
     the ochre accent as the one splash of color in the header. Subtle, not a
     logo, but unmistakably "this app". */
  header h1::before {
    content: "";
    display: inline-block; width: 10px; height: 10px;
    background: var(--accent);
    border-radius: 2px;
    box-shadow: 0 0 0 3px rgba(212,160,86,0.14);
  }
  header .sub {
    color: var(--fg-dim);
    font: 500 12px/1.4 var(--mono);
    letter-spacing: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 360px;
    padding: 3px 8px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }
  header .spacer { flex: 1; }

  /* Generic header button — ghost style. The primary button is the only one
     with color. */
  header button, header > label {
    background: transparent; color: var(--fg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 6px 12px; height: 32px;
    display: inline-flex; align-items: center; gap: 6px;
    font: 500 13px/1 var(--sans);
    cursor: pointer;
    transition: background .12s ease, border-color .12s ease, color .12s ease;
  }
  header button:hover, header > label:hover {
    background: var(--bg-2); border-color: var(--line-hi); color: var(--fg-hi);
  }
  header button:active { background: var(--bg-3); }
  header button.primary {
    background: var(--accent); color: #1a1410;
    border-color: transparent;
    font-weight: 600;
    padding: 6px 14px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.12) inset, 0 1px 2px rgba(0,0,0,0.35);
  }
  header button.primary:hover { background: var(--accent-hi); color: #1a1410; }
  header button.primary:active { background: #c18f46; }
  header button:disabled {
    opacity: .45; cursor: not-allowed;
    background: transparent; color: var(--fg-dim);
    border-color: var(--line);
  }
  header button.primary:disabled {
    background: var(--bg-3); color: var(--fg-faint); box-shadow: none;
  }

  /* Mock-mode checkbox — pill-shaped toggle instead of the terminal × box. */
  header label.mock {
    gap: 8px; padding-right: 10px;
    color: var(--fg-mut);
  }
  header input[type=checkbox] {
    appearance: none; -webkit-appearance: none;
    width: 28px; height: 16px; margin: 0;
    border: 1px solid var(--line-hi); background: var(--bg-2);
    border-radius: 999px;
    position: relative; cursor: pointer;
    transition: background .14s ease, border-color .14s ease;
  }
  header input[type=checkbox]::after {
    content: ""; position: absolute;
    top: 1px; left: 1px; width: 12px; height: 12px;
    background: var(--fg-dim); border-radius: 50%;
    transition: transform .16s ease, background .16s ease;
  }
  header input[type=checkbox]:checked {
    background: var(--accent-soft); border-color: var(--accent-line);
  }
  header input[type=checkbox]:checked::after {
    transform: translateX(12px);
    background: var(--accent);
  }

  /* Model-selector groups. Label on one line, input/select on the next line
     might be nicer, but horizontal keeps the header slim. */
  header label.sel-group {
    gap: 8px; padding: 0 12px; cursor: default;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    height: 32px;
    transition: border-color .12s ease;
  }
  header label.sel-group:hover { border-color: var(--line-hi); background: var(--bg-2); color: inherit; }
  header label.sel-group:focus-within { border-color: var(--accent-line); background: var(--bg-2); }
  header label.sel-group .k {
    font: 500 11px/1 var(--sans);
    letter-spacing: 0;
    color: var(--fg-dim);
  }

  /* Free-text fallback inputs. */
  header input.model-input {
    appearance: none; -webkit-appearance: none;
    font: 500 12.5px/1 var(--mono);
    color: var(--fg-hi);
    background: transparent; border: 0;
    padding: 0; height: 28px;
    min-width: 190px; max-width: 340px;
    outline: none;
  }
  header input.model-input::placeholder { color: var(--fg-dim); }
  header input.model-input.saved + * ~ *,
  header label.sel-group:has(input.model-input.saved),
  header label.sel-group:has(select.model-select.saved) {
    border-color: var(--win); background: rgba(127,182,133,0.06);
    transition: border-color .2s ease, background .2s ease;
  }
  header label.sel-group:has(input.model-input.err),
  header label.sel-group:has(select.model-select.err) {
    border-color: var(--loss); background: var(--loss-soft);
  }

  /* Custom dropdown. Native <select> that we restyle; the chevron is an inline
     SVG data URI so no extra assets. */
  header select.model-select {
    appearance: none; -webkit-appearance: none;
    font: 500 12.5px/1 var(--mono); color: var(--fg-hi);
    background: transparent;
    border: 0; outline: none;
    padding: 0 22px 0 0; min-width: 190px; max-width: 340px;
    height: 28px;
    cursor: pointer;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa0a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>");
    background-repeat: no-repeat;
    background-position: right 2px center;
  }
  header select.model-select[multiple] {
    background-image: none; padding-right: 0;
  }
  header select.model-select option {
    background: var(--bg-2); color: var(--fg);
    font-family: var(--mono); padding: 4px 6px;
  }
  header select.model-select option.custom { color: var(--tie); font-style: italic; }

  main {
    display: grid; grid-template-columns: minmax(360px, 1fr) 320px minmax(420px, 1.3fr);
    gap: 0; flex: 1; min-height: 0;
    position: relative; z-index: 2;
    background: var(--bg-1);
  }
  section {
    display: flex; flex-direction: column;
    border-right: 1px solid var(--line); min-width: 0; min-height: 0;
    background: var(--bg-1);
  }
  section:last-child { border-right: none; }

  .pane-title {
    margin: 0;
    padding: 11px 18px;
    font: 600 11px/1 var(--sans);
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--fg-mut);
    border-bottom: 1px solid var(--line);
    display: flex; align-items: center; gap: 10px;
    height: 40px;
    background: var(--bg-1);
  }
  .pane-title .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--fg-faint);
    transition: background .18s ease, box-shadow .18s ease;
  }
  .pane-title .dot.dirty { background: var(--tie); box-shadow: 0 0 0 3px var(--tie-soft); }
  .pane-title .dot.saved { background: var(--win); }

  /* Prompts pane */
  .prompts-pane { display: flex; flex-direction: column; }
  .prompts-pane .tabs {
    display: flex;
    border-bottom: 1px solid var(--line);
    background: var(--bg-1);
    padding: 0 12px;
    gap: 2px;
  }
  .prompts-pane .tabs button {
    background: transparent; border: 0;
    padding: 9px 14px;
    color: var(--fg-mut);
    font: 500 13px/1 var(--sans);
    letter-spacing: -0.005em;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: color .12s ease, border-color .12s ease;
    position: relative;
  }
  .prompts-pane .tabs button:hover:not(.active) { color: var(--fg); }
  .prompts-pane .tabs button.active {
    color: var(--fg-hi);
    border-bottom-color: var(--accent);
  }

  .prompts-pane textarea {
    flex: 1; width: 100%; resize: none;
    padding: 18px 20px;
    border: 0; background: var(--bg-1); color: var(--fg-hi);
    font-family: var(--mono); font-size: 13px; line-height: 1.65;
    outline: none;
    caret-color: var(--accent);
  }
  .prompts-pane textarea::placeholder { color: var(--fg-dim); }

  .prompts-pane .footer {
    padding: 10px 16px; border-top: 1px solid var(--line);
    display: flex; gap: 12px; align-items: center;
    background: var(--bg-1);
  }
  .prompts-pane .footer button {
    background: var(--bg-3); color: var(--fg);
    border: 1px solid var(--line-hi);
    border-radius: var(--radius-sm);
    padding: 6px 12px;
    font: 500 12.5px/1 var(--sans);
    cursor: pointer;
    transition: background .12s ease, color .12s ease, border-color .12s ease;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .prompts-pane .footer button:hover {
    background: var(--bg-4); color: var(--fg-hi); border-color: var(--line-hi);
  }
  .prompts-pane .footer .hint {
    color: var(--fg-dim); font-size: 12px;
    font-family: var(--sans);
  }

  /* Cases pane */
  .cases-pane .list {
    overflow-y: auto;
    padding: 4px 0;
  }
  .case-row {
    padding: 10px 18px 11px;
    border-bottom: 1px solid var(--line);
    cursor: default;
    transition: background .1s ease;
    position: relative;
  }
  .case-row:last-child { border-bottom: 0; }
  .case-row:hover { background: var(--bg-2); }
  .case-row .meta {
    display: flex; gap: 6px; margin-bottom: 6px;
    font: 500 10.5px/1 var(--sans);
    letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--fg-dim);
    align-items: center;
  }
  .case-row .meta .tag {
    font-family: var(--mono);
    background: var(--bg-3);
    color: var(--fg-mut);
    padding: 2px 7px;
    border-radius: 3px;
    font-size: 10.5px;
    letter-spacing: 0;
    text-transform: none;
  }
  .case-row .meta .tag:first-child {
    background: transparent; color: var(--fg-dim); padding-left: 0;
  }
  .case-row .input {
    font-size: 13px; color: var(--fg);
    line-height: 1.45;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-family: var(--mono);
  }

  /* Results pane */
  .results-pane { display: flex; flex-direction: column; }
  .results-pane .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(82px, 1fr));
    border-bottom: 1px solid var(--line);
    background: var(--bg-1);
  }
  .results-pane .summary .cell {
    padding: 14px 12px 12px;
    text-align: left;
    position: relative;
    transition: background .12s ease;
    border-right: 1px solid var(--line);
  }
  .results-pane .summary .cell:last-child { border-right: 0; }
  .results-pane .summary .cell .n {
    font: 600 22px/1 var(--sans);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    color: var(--fg-hi);
  }
  .results-pane .summary .cell .n.dim { color: var(--fg-faint); }
  .results-pane .summary .cell .k {
    margin-top: 6px;
    font: 500 10.5px/1 var(--sans);
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--fg-dim);
  }
  .results-pane .summary .cell.win  .n { color: var(--win); }
  .results-pane .summary .cell.loss .n { color: var(--loss); }
  .results-pane .summary .cell.tie  .n { color: var(--tie); }
  .results-pane .summary .cell.err  .n { color: var(--err); }

  .grid-wrap { flex: 1; overflow: auto; background: var(--bg-1); }
  table.grid {
    width: 100%; border-collapse: collapse; font-size: 13px;
    font-family: var(--sans);
  }
  table.grid th, table.grid td {
    padding: 11px 14px; text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--line);
  }
  table.grid th {
    position: sticky; top: 0;
    background: var(--bg-1);
    font: 600 10.5px/1 var(--sans);
    color: var(--fg-dim);
    letter-spacing: 0.06em; text-transform: uppercase;
    padding-top: 10px; padding-bottom: 10px;
    border-bottom: 1px solid var(--line-hi);
    z-index: 1;
  }
  table.grid td.idx {
    color: var(--fg-mut);
    font-family: var(--mono);
    width: 60px;
    font-weight: 500;
    font-size: 12px;
  }
  table.grid td.model {
    font-family: var(--mono);
    color: var(--fg-mut);
    width: 180px;
    font-size: 12px;
  }
  table.grid td.input {
    max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    color: var(--fg);
    font-family: var(--mono); font-size: 12.5px;
  }
  /* Verdict "pill" — small rounded rect with muted tint. Reads at a glance
     without screaming. */
  table.grid td.verdict {
    width: 90px;
  }
  table.grid td.verdict::before {
    content: attr(data-label);
    display: inline-block;
    padding: 3px 9px;
    font: 600 10.5px/1.2 var(--sans);
    letter-spacing: 0.04em;
    border-radius: 999px;
    border: 1px solid transparent;
  }
  table.grid td.verdict.win   { color: var(--win); }
  table.grid td.verdict.win::before   { background: var(--win-soft);  color: var(--win);   border-color: rgba(127,182,133,0.25); }
  table.grid td.verdict.loss::before  { background: var(--loss-soft); color: var(--loss);  border-color: rgba(217,108,108,0.25); }
  table.grid td.verdict.tie::before   { background: var(--tie-soft);  color: var(--tie);   border-color: rgba(212,160,86,0.25); }
  table.grid td.verdict.err::before   { background: var(--err-soft);  color: var(--err);   border-color: rgba(217,108,108,0.25); }

  table.grid td.reason {
    color: var(--fg-mut); font-size: 12.5px; line-height: 1.5;
    font-family: var(--sans);
  }
  table.grid tr.header-row {
    cursor: pointer;
    transition: background .1s ease;
  }
  table.grid tr.header-row:hover { background: var(--bg-2); }
  table.grid tr.header-row:hover td.idx { color: var(--fg); }
  table.grid tr.detail-row td {
    padding: 0;
    background: var(--bg-1);
    border-bottom: 1px solid var(--line);
    border-left: 2px solid var(--accent);
  }
  /* Detail block — expanded state for a cell. */
  .detail-verdict {
    padding: 16px 20px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--line);
    display: flex; flex-direction: column; gap: 12px;
  }
  .detail-verdict .headline {
    display: flex; align-items: center; gap: 10px;
    font: 500 12px/1.2 var(--sans);
    color: var(--fg-mut);
  }
  .detail-verdict .headline .pill {
    padding: 3px 10px;
    border-radius: 999px;
    font: 600 10.5px/1.2 var(--sans);
    letter-spacing: 0.04em;
    border: 1px solid transparent;
  }
  .detail-verdict.winner-a .pill   { color: var(--loss); background: var(--loss-soft); border-color: rgba(217,108,108,0.25); }
  .detail-verdict.winner-b .pill   { color: var(--win);  background: var(--win-soft);  border-color: rgba(127,182,133,0.25); }
  .detail-verdict.winner-tie .pill { color: var(--tie);  background: var(--tie-soft);  border-color: rgba(212,160,86,0.25); }
  .detail-verdict.err .pill        { color: var(--err);  background: var(--err-soft);  border-color: rgba(217,108,108,0.25); }

  .detail-verdict .reason {
    color: var(--fg); font-size: 13px; line-height: 1.6;
    padding: 10px 14px;
    white-space: pre-wrap; word-break: break-word;
    font-family: var(--sans);
    background: var(--bg-2);
    border-left: 2px solid var(--accent);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }
  .detail-verdict .expected {
    font-size: 12px; color: var(--fg-mut);
    display: flex; gap: 10px; align-items: baseline;
  }
  .detail-verdict .expected .k {
    font: 600 10.5px/1 var(--sans);
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--fg-dim);
    flex-shrink: 0;
  }
  .detail-verdict .expected .v {
    color: var(--fg); font-family: var(--mono); font-size: 12px;
    white-space: pre-wrap; word-break: break-word;
  }

  /* Override widget — refined pill-buttons. Still reads as power-user
     territory; still fast to click. */
  .override-row {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    margin-top: 4px;
  }
  .override-row .label {
    font: 600 10.5px/1 var(--sans);
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--fg-dim);
    margin-right: 2px;
  }
  .override-row button.v-btn {
    font: 500 12px/1 var(--mono);
    padding: 6px 10px;
    background: var(--bg-2); color: var(--fg-mut);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    cursor: pointer;
    min-width: 36px;
    transition: background .12s ease, border-color .12s ease, color .12s ease;
  }
  .override-row button.v-btn:hover {
    background: var(--bg-3); color: var(--fg-hi); border-color: var(--line-hi);
  }
  .override-row button.v-btn.active {
    background: var(--accent-soft); color: var(--accent-hi);
    border-color: var(--accent-line);
  }
  .override-row button.v-btn.active[data-v="a"] {
    background: var(--loss-soft); color: var(--loss); border-color: rgba(217,108,108,0.35);
  }
  .override-row button.v-btn.active[data-v="b"] {
    background: var(--win-soft); color: var(--win); border-color: rgba(127,182,133,0.35);
  }
  .override-row button.v-btn.active[data-v="tie"] {
    background: var(--tie-soft); color: var(--tie); border-color: var(--accent-line);
  }
  .override-row input.reason-in {
    flex: 1; min-width: 180px;
    font-family: var(--sans); font-size: 12.5px;
    background: var(--bg-2); color: var(--fg-hi);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 6px 10px; height: 30px;
    transition: border-color .12s ease;
  }
  .override-row input.reason-in::placeholder { color: var(--fg-dim); }
  .override-row input.reason-in:focus {
    border-color: var(--accent-line); outline: none;
    background: var(--bg-2);
  }
  .override-row button.undo-btn {
    font: 500 12px/1 var(--sans);
    padding: 6px 10px; background: transparent; color: var(--fg-mut);
    border: 1px solid var(--line); border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background .12s ease, border-color .12s ease, color .12s ease;
  }
  .override-row button.undo-btn:hover {
    background: var(--bg-2); color: var(--fg); border-color: var(--line-hi);
  }
  .override-row .ovr-status {
    font: 500 11.5px/1.2 var(--sans);
    color: var(--fg-dim);
  }
  .override-row .ovr-status.on { color: var(--accent); }
  /* Row-level pencil glyph — renders on the idx column when a cell has an
     active override. Small dot, not a screaming badge. */
  table.grid tr.header-row td.idx .ovr-glyph {
    color: var(--accent); margin-left: 6px;
    font-size: 11px;
  }
  /* Delta glyph — per-case diff vs. the previous run. Lives in its own
     column so rows align cleanly; color carries meaning (green up, red
     down), neutral dot for unchanged or first-seen. */
  table.grid td.delta {
    width: 28px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--fg-faint);
    text-align: center;
    padding-left: 0; padding-right: 0;
  }
  table.grid td.delta.delta-up   { color: var(--win);  }
  table.grid td.delta.delta-down { color: var(--loss); }
  table.grid td.delta.delta-new  { color: var(--fg-dim); }
  table.grid td.delta.delta-same { color: var(--fg-faint); }
  /* Summary cells for the delta stats get the same neutral palette as the
     rest of the strip; they're additive context, not a primary signal. */
  .results-pane .summary .cell.delta-up   .n { color: var(--win); }
  .results-pane .summary .cell.delta-down .n { color: var(--loss); }
  /* Prior-run chip in the header-ish area inside the detail pane. Tells the
     user what they're diffing against without asking. */
  .prev-tag {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 2px 8px;
    background: var(--bg-2); color: var(--fg-mut);
    border: 1px solid var(--line);
    border-radius: 999px;
    font: 500 11px/1.3 var(--sans);
  }
  .prev-tag .k { color: var(--fg-dim); font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; }
  .prev-tag .v { font-family: var(--mono); color: var(--fg); }
  /* "Then / Now" stack inside a regressed-or-improved detail pane. Shows
     the prior verdict + reason above the current one, so the user can see
     exactly what the edit changed. */
  .compare-stack {
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px 14px;
    margin-top: 4px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    font-size: 12.5px;
  }
  .compare-stack .row { display: flex; align-items: baseline; gap: 10px; }
  .compare-stack .row .k {
    font: 600 10.5px/1.2 var(--sans);
    letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--fg-dim); width: 42px; flex-shrink: 0;
  }
  .compare-stack .row .reason {
    color: var(--fg); line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
  }
  .compare-stack .row.was .reason { color: var(--fg-mut); }
  .compare-stack .pill {
    padding: 2px 8px; border-radius: 999px;
    font: 600 10.5px/1.2 var(--sans);
    letter-spacing: 0.04em;
    border: 1px solid transparent;
    flex-shrink: 0;
  }
  .compare-stack .pill.a   { color: var(--loss); background: var(--loss-soft); border-color: rgba(217,108,108,0.25); }
  .compare-stack .pill.b   { color: var(--win);  background: var(--win-soft);  border-color: rgba(127,182,133,0.25); }
  .compare-stack .pill.tie { color: var(--tie);  background: var(--tie-soft);  border-color: rgba(212,160,86,0.25); }
  .compare-stack .pill.error,
  .compare-stack .pill.err { color: var(--err);  background: var(--err-soft);  border-color: rgba(217,108,108,0.25); }

  .detail-box {
    display: grid; grid-template-columns: 1fr 1fr;
    background: var(--bg-1);
    border-top: 1px solid var(--line);
  }
  .detail-side {
    padding: 14px 18px;
    background: var(--bg-1);
    display: flex; flex-direction: column; gap: 10px;
    border-right: 1px solid var(--line);
  }
  .detail-side:last-child { border-right: 0; }
  .detail-side .side-title {
    display: flex; align-items: center; gap: 10px;
    font: 600 10.5px/1 var(--sans);
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--fg-mut);
  }
  .detail-side .side-title .model-tag {
    font-family: var(--mono);
    background: var(--bg-3); color: var(--fg);
    padding: 3px 8px; border-radius: 3px;
    font-size: 10.5px; letter-spacing: 0; text-transform: none;
    font-weight: 500;
    border: 1px solid var(--line);
  }
  .detail-side pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font-family: var(--mono); font-size: 12.5px; color: var(--fg);
    max-height: 260px; overflow: auto;
    background: var(--bg-2);
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    line-height: 1.6;
  }
  .empty {
    padding: 44px 20px;
    color: var(--fg-dim);
    text-align: center;
    font: 500 13px/1.5 var(--sans);
  }

  /* Idle state — a calm, centered panel inviting the first run. Replaces the
     ASCII banner with a single focus: a cell-shaped placeholder and one CTA.
     Feels like the empty state in a well-designed SaaS product, not like a
     BBS login screen. */
  .idle-banner {
    padding: 64px 24px;
    text-align: center;
    color: var(--fg-mut);
    user-select: none;
    display: flex; flex-direction: column; align-items: center; gap: 16px;
  }
  .idle-banner .mark {
    width: 48px; height: 48px;
    border-radius: 10px;
    background: var(--bg-2);
    border: 1px solid var(--line-hi);
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--accent);
    box-shadow: var(--shadow-1);
    position: relative;
    overflow: hidden;
  }
  .idle-banner .mark::before {
    content: ""; position: absolute; inset: -1px;
    background: radial-gradient(circle at 30% 30%, rgba(212,160,86,0.25), transparent 60%);
  }
  .idle-banner .mark svg { position: relative; z-index: 1; }
  .idle-banner h3 {
    margin: 0;
    font: 600 16px/1.4 var(--sans);
    color: var(--fg-hi);
    letter-spacing: -0.015em;
  }
  .idle-banner .sub {
    font: 400 13px/1.55 var(--sans);
    color: var(--fg-mut);
    max-width: 380px;
  }
  .idle-banner .hint {
    font: 500 12.5px/1 var(--sans);
    color: var(--fg-mut);
    display: inline-flex; align-items: center; gap: 8px;
    margin-top: 6px;
  }

  .dim { color: var(--fg-faint); }

  /* Error banner — subtle, not frightening. */
  .err-banner {
    padding: 10px 18px;
    background: var(--err-soft);
    color: var(--loss);
    border-bottom: 1px solid rgba(217,108,108,0.3);
    font: 500 13px/1.5 var(--sans);
    position: relative; z-index: 3;
    display: flex; align-items: center; gap: 10px;
  }
  .err-banner::before {
    content: ""; flex-shrink: 0;
    width: 14px; height: 14px;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23d96c6c' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10'/><line x1='12' y1='8' x2='12' y2='12'/><line x1='12' y1='16' x2='12.01' y2='16'/></svg>");
    background-repeat: no-repeat; background-position: center;
  }

  /* Runs drawer — slides in from the right. */
  .runs-drawer {
    position: fixed; top: 0; right: 0; bottom: 0; width: 560px; max-width: 100vw;
    background: var(--bg-1);
    border-left: 1px solid var(--line);
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform .22s cubic-bezier(.2, .8, .2, 1);
    z-index: 40;
    box-shadow: var(--shadow-drawer);
  }
  .runs-drawer.open { transform: translateX(0); }
  .runs-drawer .title {
    padding: 14px 20px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-1);
    display: flex; align-items: center; gap: 10px;
    min-height: 52px;
  }
  .runs-drawer .title strong {
    font: 600 14px/1 var(--sans);
    color: var(--fg-hi);
    letter-spacing: -0.01em;
  }
  .runs-drawer .title .spacer { flex: 1; }
  .runs-drawer .title button {
    background: transparent; color: var(--fg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 6px 12px; height: 30px;
    font: 500 12.5px/1 var(--sans);
    cursor: pointer;
    transition: background .12s ease, border-color .12s ease, color .12s ease;
  }
  .runs-drawer .title button:hover {
    background: var(--bg-2); color: var(--fg-hi); border-color: var(--line-hi);
  }
  .runs-drawer .title button.primary {
    background: var(--accent); color: #1a1410;
    border-color: transparent; font-weight: 600;
  }
  .runs-drawer .title button.primary:hover { background: var(--accent-hi); }
  .runs-drawer .title button:disabled {
    opacity: .45; cursor: not-allowed;
    background: transparent; border-color: var(--line);
    color: var(--fg-dim);
  }
  .runs-drawer .title button.primary:disabled {
    background: var(--bg-3); color: var(--fg-faint);
  }

  .runs-drawer .body { flex: 1; overflow: auto; padding: 16px 20px; }
  .runs-drawer .empty {
    color: var(--fg-dim); padding: 32px 0;
    text-align: center;
    font: 500 13px/1.5 var(--sans);
  }
  .runs-drawer .runs-list {
    display: flex; flex-direction: column; gap: 6px;
  }
  .runs-drawer .run-row {
    display: grid; grid-template-columns: auto 1fr auto; gap: 12px;
    align-items: center;
    padding: 11px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-2);
    cursor: pointer;
    transition: background .12s ease, border-color .12s ease;
  }
  .runs-drawer .run-row:hover {
    background: var(--bg-3);
    border-color: var(--line-hi);
  }
  .runs-drawer .run-row.selected {
    border-color: var(--accent-line);
    background: var(--accent-soft);
  }
  .runs-drawer .run-row input[type=checkbox] {
    appearance: none; -webkit-appearance: none;
    width: 16px; height: 16px; margin: 0;
    border: 1px solid var(--line-hi);
    background: var(--bg-1);
    border-radius: 3px;
    position: relative; cursor: pointer;
    transition: background .12s ease, border-color .12s ease;
  }
  .runs-drawer .run-row input[type=checkbox]:checked {
    background: var(--accent); border-color: var(--accent);
  }
  .runs-drawer .run-row input[type=checkbox]:checked::after {
    content: ""; position: absolute;
    left: 4px; top: 1px; width: 5px; height: 9px;
    border: solid #1a1410;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .runs-drawer .run-row .rid {
    font-family: var(--mono); font-size: 12.5px;
    color: var(--fg-hi);
    font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .runs-drawer .run-row .meta {
    color: var(--fg-dim);
    font: 500 11.5px/1.3 var(--sans);
    margin-top: 3px;
  }
  .runs-drawer .run-row .status {
    padding: 3px 9px;
    border-radius: 999px;
    font: 600 10.5px/1.2 var(--sans);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .runs-drawer .run-row .status.complete  { color: var(--win);  background: var(--win-soft);  border: 1px solid rgba(127,182,133,0.25); }
  .runs-drawer .run-row .status.running   { color: var(--tie);  background: var(--tie-soft);  border: 1px solid var(--accent-line); }
  .runs-drawer .run-row .status.failed    { color: var(--loss); background: var(--loss-soft); border: 1px solid rgba(217,108,108,0.25); }
  .runs-drawer .run-row .status.pending,
  .runs-drawer .run-row .status.abandoned { color: var(--fg-mut); background: var(--bg-3); border: 1px solid var(--line); }

  .runs-drawer .run-detail {
    margin-top: 16px;
    padding: 16px 18px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-2);
  }
  .runs-drawer .run-detail h4 {
    margin: 0 0 12px 0;
    font: 600 13px/1 var(--sans);
    letter-spacing: -0.01em;
    color: var(--fg-hi);
    font-family: var(--mono);
  }
  .runs-drawer .run-detail dl {
    display: grid; grid-template-columns: 100px 1fr;
    gap: 6px 16px; margin: 0;
    font-size: 12.5px;
  }
  .runs-drawer .run-detail dt {
    color: var(--fg-dim);
    font: 500 11.5px/1.3 var(--sans);
    letter-spacing: 0.02em; text-transform: uppercase;
  }
  .runs-drawer .run-detail dd {
    margin: 0; color: var(--fg);
    font-family: var(--mono); font-size: 12.5px;
  }
  .runs-drawer .run-detail table.grid-table {
    width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 12px;
  }
  .runs-drawer .run-detail table.grid-table th,
  .runs-drawer .run-detail table.grid-table td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    text-align: left;
  }
  .runs-drawer .run-detail table.grid-table th {
    font: 600 10.5px/1 var(--sans); color: var(--fg-dim);
    letter-spacing: 0.06em; text-transform: uppercase;
    background: transparent;
  }
  .runs-drawer .run-detail table.grid-table td.mono,
  .runs-drawer .run-detail table.grid-table td:first-child {
    font-family: var(--mono); color: var(--fg-mut);
  }

  .runs-drawer .diff-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px;
  }
  .runs-drawer .diff-col {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
    background: var(--bg-1);
  }
  .runs-drawer .diff-col h5 {
    margin: 0 0 10px 0;
    font: 500 12px/1 var(--mono);
    color: var(--fg-hi);
    letter-spacing: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .runs-drawer-backdrop {
    position: fixed; inset: 0;
    background: rgba(10,12,14,0.55);
    z-index: 35;
    display: none;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  .runs-drawer-backdrop.open { display: block; animation: fade-in .2s ease; }
  @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }

  @media (max-width: 960px) {
    header {
      flex-wrap: wrap; gap: 8px 10px;
      padding: 10px 14px; min-height: 0;
    }
    header .sub { order: 10; flex-basis: 100%; max-width: none; }
    header label.sel-group { flex: 1 1 200px; min-width: 160px; }
    main { grid-template-columns: 1fr; grid-auto-rows: minmax(240px, auto); }
    section { border-right: none; border-bottom: 1px solid var(--line); }
    section:last-child { border-bottom: none; }
    .results-pane .summary {
      grid-template-columns: repeat(4, 1fr);
    }
    .results-pane .summary .cell {
      border-bottom: 1px solid var(--line);
    }
    .results-pane .summary .cell:nth-last-child(-n+4) {
      border-bottom: 0;
    }
    .detail-box { grid-template-columns: 1fr; }
    .detail-side { border-right: 0; border-bottom: 1px solid var(--line); }
    .detail-side:last-child { border-bottom: 0; }
    .runs-drawer { width: 100%; }
  }

  @media (pointer: coarse) {
    header button, header > label,
    .prompts-pane .tabs button,
    .prompts-pane .footer button,
    .runs-drawer .title button {
      min-height: 40px;
    }
  }

  /* Reduce motion — honor the system preference. */
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  }
</style>
</head>
<body>
  <a href="#prompts-pane" class="skip-link">Skip to prompts</a>
  <header>
    <h1>Rubric</h1>
    <span class="sub" id="config-path">—</span>
    <span class="spacer"></span>
    <label class="sel-group" title="Models the sweep will run. Cmd or Ctrl-click to pick more than one.">
      <span class="k">Models</span>
      <!-- Rendered as a multi-select when .secrets/available_models has entries,
           otherwise falls back to the free-text #models-input below. -->
      <select id="models-select" class="model-select" multiple size="1" style="display:none"></select>
      <input type="text" id="models-input" class="model-input" spellcheck="false" autocomplete="off" placeholder="provider/model, …">
    </label>
    <label class="sel-group" title="Judge model — the LLM that picks a verdict per cell.">
      <span class="k">Judge</span>
      <select id="judge-model-select" class="model-select" style="display:none"></select>
      <input type="text" id="judge-model-input" class="model-input" spellcheck="false" autocomplete="off" placeholder="provider/model">
    </label>
    <label class="mock" title="Run against deterministic mock provider + judge. No tokens spent."><input type="checkbox" id="mock-toggle"> Mock</label>
    <button id="runs-btn" aria-label="Browse past runs from the registry" title="Browse past runs from the registry">Runs</button>
    <button id="run-btn" class="primary" aria-label="Run evaluation">Run</button>
  </header>

  <div id="err" class="err-banner" role="alert" aria-live="assertive" style="display:none"></div>

  <main>
    <section class="prompts-pane" id="prompts-pane" role="region" aria-labelledby="prompts-pane-title">
      <h2 class="pane-title" id="prompts-pane-title">
        <span class="dot saved" id="prompt-dot" aria-hidden="true"></span>
        <span id="prompts-title">Prompts</span>
      </h2>
      <div class="tabs">
        <button id="tab-baseline" class="active" data-which="baseline">Baseline</button>
        <button id="tab-candidate" data-which="candidate">Candidate</button>
        <button id="tab-judge" data-which="judge" title="Judge criteria — the rubric text the judge model receives.">Judge</button>
      </div>
      <textarea id="prompt-editor" spellcheck="false" aria-label="Prompt editor"></textarea>
      <div class="footer">
        <button id="save-btn" aria-label="Save prompt">Save <kbd>⌘S</kbd></button>
        <span class="hint" id="save-hint">No changes</span>
      </div>
    </section>

    <section class="cases-pane" role="region" aria-labelledby="cases-pane-title">
      <h2 class="pane-title" id="cases-pane-title">Cases <span id="case-count" style="color:var(--fg-dim);margin-left:auto;font-weight:500;text-transform:none;letter-spacing:0"></span></h2>
      <div class="list" id="cases-list"></div>
    </section>

    <section class="results-pane" role="region" aria-labelledby="results-pane-title">
      <h2 class="pane-title" id="results-pane-title">
        Results
        <span id="progress" style="color:var(--fg-dim);margin-left:auto;font-family:var(--mono);font-size:12px;letter-spacing:0;text-transform:none;font-weight:500"></span>
      </h2>
      <div class="summary" id="summary">
        <div class="cell win"><div class="n" id="sum-wins">0</div><div class="k">Wins</div></div>
        <div class="cell loss"><div class="n" id="sum-losses">0</div><div class="k">Losses</div></div>
        <div class="cell tie"><div class="n" id="sum-ties">0</div><div class="k">Ties</div></div>
        <div class="cell err"><div class="n" id="sum-errors">0</div><div class="k">Errors</div></div>
        <div class="cell"><div class="n dim" id="sum-rate">—</div><div class="k">Win rate</div></div>
        <div class="cell" id="sum-delta-up-cell" title="Cases that improved vs. the previous run."><div class="n dim" id="sum-delta-up">—</div><div class="k">Improved</div></div>
        <div class="cell" id="sum-delta-down-cell" title="Cases that regressed vs. the previous run."><div class="n dim" id="sum-delta-down">—</div><div class="k">Regressed</div></div>
        <div class="cell"><div class="n dim" id="sum-cost">—</div><div class="k">Cost</div></div>
        <div class="cell"><div class="n dim" id="sum-time">—</div><div class="k">Wall time</div></div>
        <div class="cell"><div class="n dim" id="sum-overrides">0</div><div class="k">Overrides</div></div>
      </div>
      <div class="grid-wrap">
        <table class="grid">
          <thead>
            <tr><th>#</th><th title="Change vs. the previous run">Δ</th><th>Model</th><th>Input</th><th>Winner</th><th>Reason</th></tr>
          </thead>
          <tbody id="grid-body">
            <tr><td colspan="6">
              <div class="idle-banner">
                <div class="mark" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                </div>
                <h3>No run yet</h3>
                <div class="sub">Prompts and cases are loaded. Click <strong style="color:var(--fg-hi);font-weight:600">Run</strong> to sweep them through the judge.</div>
                <div class="hint">Shortcut <kbd>R</kbd> &nbsp;or&nbsp; <kbd>⌘⏎</kbd></div>
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
      <strong>Run history</strong>
      <span class="spacer"></span>
      <button id="runs-diff-btn" class="primary" disabled title="Select two runs to compare">Compare</button>
      <button id="runs-close-btn" title="Close (Esc)">Close</button>
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
    /* Curated allowlist from .secrets/available_models; empty → free-text inputs. */
    availableModels: [],
    /* Map<string, {verdict, reason?, ts}>. Key = caseIndex + '|' + model ('|' + modelB when set).
       Populated from GET /api/overrides at load and after every POST. */
    overrides: new Map(),
    /* Cells currently rendered in the grid, keyed by the same index-key so
       individual rows can be repainted (glyph, active button, reason field)
       without replaying the whole sweep. */
    cellRows: new Map(),
    /* Most-recent prior run from the registry. Used to paint per-cell deltas
       (flipped, improved, regressed, unchanged) next to each result row so
       users can see whether their last prompt edit actually helped. Keyed
       by caseIndex|modelA(|modelB) like the others. */
    previousRun: { id: null, cells: new Map(), loaded: false },
  };

  /** Key used to match a grid cell against the previous-run lookup map. */
  function compareKey(caseIndex, model, modelB) {
    return caseIndex + '|' + model + (modelB && modelB !== model ? '|' + modelB : '');
  }

  /** Normalize a cell's verdict into one of: 'a' | 'b' | 'tie' | 'error'. */
  function cellVerdict(cell) {
    const j = cell && cell.judge;
    if (!j) return null;
    if ('error' in j && j.error) return 'error';
    return j.winner || null;
  }

  /**
   * Given a previous cell + current cell, classify the transition. "Better"
   * means the candidate (B) is doing better than it was before. Errors and
   * missing prior cells render as a neutral "new" state — we don't punish
   * first-time cases in the delta column.
   */
  function classifyDelta(prev, cur) {
    if (!prev) return { kind: 'new', glyph: '·', label: 'New' };
    const pv = cellVerdict(prev);
    const cv = cellVerdict(cur);
    if (pv === cv) return { kind: 'same', glyph: '·', label: 'No change' };
    // Rank verdicts by how good they are for the candidate (B):
    //   error < a (baseline wins) < tie < b (candidate wins)
    const rank = { error: 0, a: 1, tie: 2, b: 3 };
    const pr = rank[pv] ?? -1;
    const cr = rank[cv] ?? -1;
    if (cr > pr) return { kind: 'up',   glyph: '▲', label: 'Improved (' + (pv || '—') + ' → ' + (cv || '—') + ')' };
    if (cr < pr) return { kind: 'down', glyph: '▼', label: 'Regressed (' + (pv || '—') + ' → ' + (cv || '—') + ')' };
    return { kind: 'same', glyph: '·', label: 'No change' };
  }

  function overrideKey(cell) {
    return cell.caseIndex + '|' + cell.model + (cell.modelB ? '|' + cell.modelB : '');
  }

  function updateOverrideCounter() {
    const el = $('sum-overrides');
    if (!el) return;
    const n = state.overrides.size;
    el.textContent = String(n);
    if (n > 0) el.classList.remove('dim'); else el.classList.add('dim');
  }

  async function loadOverrides() {
    try {
      const res = await fetch('/api/overrides');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      state.overrides.clear();
      for (const o of body.overrides || []) {
        // We can't re-derive the index key without (caseIndex, model) — the
        // cellRef (case-N/provider/model) carries both. Parse it.
        const m = /^case-(\\d+)\\/(.+)$/.exec(o.cellRef);
        if (!m) continue;
        const caseIndex = Number(m[1]);
        const model = m[2];
        // modelB is not in the cellRef today — overrides.jsonl keys by contentKey;
        // we use the no-modelB form for lookup and fall back to matching modelA
        // when iterating the grid (which is fine: compare-models has one cell per case).
        state.overrides.set(caseIndex + '|' + model, { verdict: o.verdict, reason: o.reason, ts: o.ts });
      }
      updateOverrideCounter();
      // Repaint any visible rows so the ✎ glyph and button-active state follow the log.
      for (const [key, entry] of state.cellRows) {
        const { cell, headRow, detailRow } = entry;
        const active = state.overrides.get(overrideKey(cell)) || null;
        paintRowOverride(headRow, cell, active);
        if (detailRow && detailRow.__ovrRow) repaintOverrideRow(detailRow.__ovrRow, cell, active);
      }
    } catch (err) {
      /* non-fatal — the UI keeps working even if the log read fails. */
    }
  }

  function paintRowOverride(row, cell, active) {
    const idxTd = row.querySelector('td.idx');
    if (!idxTd) return;
    let glyph = idxTd.querySelector('.ovr-glyph');
    if (active) {
      if (!glyph) {
        glyph = document.createElement('span');
        glyph.className = 'ovr-glyph';
        glyph.title = 'you overrode this cell — see details';
        glyph.textContent = '✎';
        idxTd.appendChild(glyph);
      }
    } else if (glyph) {
      glyph.remove();
    }
  }

  async function submitOverride(cell, body) {
    const payload = {
      caseIndex: cell.caseIndex,
      model: cell.model,
      ...body,
    };
    if (cell.modelB) payload.modelB = cell.modelB;
    try {
      const res = await fetch('/api/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError('override failed: ' + (err.error || res.status));
        return false;
      }
      await loadOverrides();
      setError(null);
      return true;
    } catch (err) {
      setError('override failed: ' + (err.message || err));
      return false;
    }
  }

  function repaintOverrideRow(row, cell, active) {
    const verdictBtns = row.querySelectorAll('button.v-btn');
    verdictBtns.forEach((b) => {
      b.classList.toggle('active', Boolean(active) && active.verdict === b.dataset.v);
    });
    const status = row.querySelector('.ovr-status');
    if (status) {
      if (active) {
        status.classList.add('on');
        const v = active.verdict === 'a' ? 'Baseline' : active.verdict === 'b' ? 'Candidate' : 'Tie';
        status.textContent = 'You → ' + v + (active.reason ? ' · "' + active.reason + '"' : '');
      } else {
        status.classList.remove('on');
        status.textContent = 'No override';
      }
    }
    const undoBtn = row.querySelector('button.undo-btn');
    if (undoBtn) undoBtn.style.display = active ? 'inline-block' : 'none';
    const reasonIn = row.querySelector('input.reason-in');
    if (reasonIn && active && active.reason && reasonIn.value === '') reasonIn.value = active.reason;
  }

  function buildOverrideRow(cell) {
    const row = document.createElement('div');
    row.className = 'override-row';
    row.addEventListener('click', (e) => e.stopPropagation());

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Your verdict';
    row.appendChild(label);

    const verdicts = [
      { v: 'a', text: 'Baseline' },
      { v: 'b', text: 'Candidate' },
      { v: 'tie', text: 'Tie' },
    ];
    for (const opt of verdicts) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v-btn';
      btn.dataset.v = opt.v;
      btn.textContent = opt.text;
      btn.title = 'override verdict: ' + opt.v.toUpperCase();
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const reason = reasonIn.value.trim();
        const body = { verdict: opt.v };
        if (reason) body.reason = reason;
        await submitOverride(cell, body);
      });
      row.appendChild(btn);
    }

    const reasonIn = document.createElement('input');
    reasonIn.type = 'text';
    reasonIn.className = 'reason-in';
    reasonIn.placeholder = 'Why? (optional)';
    reasonIn.maxLength = 400;
    row.appendChild(reasonIn);

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'undo-btn';
    undoBtn.textContent = 'Clear';
    undoBtn.style.display = 'none';
    undoBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await submitOverride(cell, { undo: true });
    });
    row.appendChild(undoBtn);

    const status = document.createElement('span');
    status.className = 'ovr-status';
    status.textContent = 'No override';
    row.appendChild(status);

    return row;
  }

  function setError(msg) {
    const el = $('err');
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block'; el.textContent = msg;
  }

  function setDirty(d) {
    state.dirty = d;
    $('prompt-dot').className = 'dot ' + (d ? 'dirty' : 'saved');
    $('save-hint').textContent = d ? 'Unsaved changes' : 'No changes';
  }

  function activateTab(which) {
    state.active = which;
    for (const btn of document.querySelectorAll('.tabs button')) {
      btn.classList.toggle('active', btn.dataset.which === which);
    }
    const ta = $('prompt-editor');
    if (!state.workspace) {
      ta.value = '';
    } else if (which === 'judge') {
      ta.value = state.workspace.judgeCriteriaText || '';
      ta.setAttribute('aria-label', 'judge criteria editor');
    } else {
      ta.value = state.workspace.prompts[which] || '';
      ta.setAttribute('aria-label', 'prompt editor');
    }
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
    state.cellRows.clear();
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
    // Delta summary cells — only shown meaningfully when a previous run
    // exists. Until the first cell of this sweep lands we show "—".
    const hasPrev = state.previousRun && state.previousRun.cells && state.previousRun.cells.size > 0;
    $('sum-delta-up').textContent = hasPrev ? '0' : '—';
    $('sum-delta-down').textContent = hasPrev ? '0' : '—';
    $('sum-delta-up').classList.toggle('dim', !hasPrev);
    $('sum-delta-down').classList.toggle('dim', !hasPrev);
    $('sum-delta-up-cell').classList.remove('delta-up');
    $('sum-delta-down-cell').classList.remove('delta-down');
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
    // Shorter labels now that each verdict renders as a pill — 3-4 chars
    // reads cleanly at the small pill size.
    if (j.error) return { cls: 'err', label: 'Error' };
    if (j.winner === 'b') return { cls: 'win', label: 'Cand' };
    if (j.winner === 'a') return { cls: 'loss', label: 'Base' };
    return { cls: 'tie', label: 'Tie' };
  }

  const counts = { wins: 0, losses: 0, ties: 0, errors: 0, deltaUp: 0, deltaDown: 0 };

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

    // Previous-run lookup. Uses the same (caseIndex, model, modelB?) tuple
    // that the override log uses, so compare-prompts and compare-models both
    // work without per-mode branching.
    const prevCell = state.previousRun.cells.get(
      compareKey(cell.caseIndex, cell.model, cell.modelB)
    ) || null;
    const delta = classifyDelta(prevCell, cell);
    if (delta.kind === 'up') counts.deltaUp++;
    else if (delta.kind === 'down') counts.deltaDown++;

    const reason = cell.judge.error || cell.judge.reason || '';
    const row = document.createElement('tr');
    row.className = 'header-row';
    row.innerHTML =
      '<td class="idx">▸ ' + cell.caseIndex + '</td>' +
      '<td class="delta delta-' + delta.kind + '" title="' + escapeHtml(delta.label) + '">' + delta.glyph + '</td>' +
      '<td class="model">' + escapeHtml(cell.model) + '</td>' +
      '<td class="input" title="' + escapeHtml(caseInput) + '">' + escapeHtml(caseInput) + '</td>' +
      '<td class="verdict ' + v.cls + '" data-label="' + escapeHtml(v.label) + '"></td>' +
      '<td class="reason">' + escapeHtml(reason) + '</td>';
    const detailRow = document.createElement('tr');
    detailRow.className = 'detail-row';
    detailRow.style.display = 'none';
    const { td, overrideRow } = buildDetailCell(cell, caseExpected, prevCell);
    detailRow.appendChild(td);
    detailRow.__ovrRow = overrideRow;
    row.addEventListener('click', () => {
      const open = detailRow.style.display !== 'none';
      detailRow.style.display = open ? 'none' : '';
      // Preserve any ✎ glyph on the idx cell when toggling open/closed.
      const idxTd = row.querySelector('td.idx');
      const glyph = idxTd ? idxTd.querySelector('.ovr-glyph') : null;
      idxTd.innerHTML = (open ? '▸ ' : '▾ ') + cell.caseIndex;
      if (glyph) idxTd.appendChild(glyph);
    });
    const body = $('grid-body');
    body.appendChild(row);
    body.appendChild(detailRow);
    // Apply any already-known override to this freshly-added row.
    const active = state.overrides.get(overrideKey(cell)) || null;
    paintRowOverride(row, cell, active);
    if (overrideRow) repaintOverrideRow(overrideRow, cell, active);
    state.cellRows.set(overrideKey(cell), { cell, headRow: row, detailRow });

    $('sum-wins').textContent = counts.wins;
    $('sum-losses').textContent = counts.losses;
    $('sum-ties').textContent = counts.ties;
    $('sum-errors').textContent = counts.errors;
    // Delta stats only update when a prior run was loaded. Without one the
    // cells stay in the "—" state established by resetGrid().
    if (state.previousRun.cells.size > 0) {
      $('sum-delta-up').textContent = String(counts.deltaUp);
      $('sum-delta-down').textContent = String(counts.deltaDown);
      $('sum-delta-up').classList.toggle('dim', counts.deltaUp === 0);
      $('sum-delta-down').classList.toggle('dim', counts.deltaDown === 0);
      $('sum-delta-up-cell').classList.toggle('delta-up', counts.deltaUp > 0);
      $('sum-delta-down-cell').classList.toggle('delta-down', counts.deltaDown > 0);
    }
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

  function buildDetailCell(cell, caseExpected, prevCell) {
    const td = document.createElement('td');
    td.colSpan = 6;

    const banner = buildVerdictBanner(cell, caseExpected, prevCell);
    const overrideRow = buildOverrideRow(cell);
    banner.appendChild(overrideRow);
    td.appendChild(banner);

    const box = document.createElement('div');
    box.className = 'detail-box';

    box.appendChild(detailSide('A', 'Baseline', cell.outputA));
    box.appendChild(detailSide('B', 'Candidate', cell.outputB));
    td.appendChild(box);
    return { td, overrideRow };
  }

  function buildVerdictBanner(cell, caseExpected, prevCell) {
    const j = cell.judge;
    const block = document.createElement('div');
    block.className = 'detail-verdict';

    let pillLabel, headline;
    if (j.error) {
      block.classList.add('err');
      pillLabel = 'Error';
      headline = 'Judge errored before returning a verdict';
    } else if (j.winner === 'b') {
      block.classList.add('winner-b');
      pillLabel = 'Candidate';
      headline = 'Why the candidate won';
    } else if (j.winner === 'a') {
      block.classList.add('winner-a');
      pillLabel = 'Baseline';
      headline = 'Why the candidate lost';
    } else {
      block.classList.add('winner-tie');
      pillLabel = 'Tie';
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

    // "Then / Now" stack — only shown when there's a prior run AND the
    // verdict (or error state) actually changed. Lets you see what the
    // edit flipped without leaving the pane.
    if (prevCell && cellVerdict(prevCell) !== cellVerdict(cell)) {
      const stack = buildCompareStack(prevCell, cell);
      if (stack) block.appendChild(stack);
    }

    block.addEventListener('click', (e) => e.stopPropagation());
    return block;
  }

  /** Stacked "Then → Now" view shown inside the detail pane when a verdict
   *  flipped between the previous run and this one. Reasons are truncated
   *  visually by the CSS; full text is preserved in the DOM. */
  function buildCompareStack(prev, cur) {
    const prevV = cellVerdict(prev);
    const curV = cellVerdict(cur);
    const stack = document.createElement('div');
    stack.className = 'compare-stack';

    const label = document.createElement('div');
    label.className = 'eyebrow';
    label.textContent = 'Change from previous run';
    stack.appendChild(label);

    const render = (kind, cell, verdict) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row ' + kind;
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = kind === 'was' ? 'Was' : 'Now';
      const pill = document.createElement('span');
      pill.className = 'pill ' + (verdict || 'error');
      pill.textContent = verdict === 'a' ? 'Baseline'
        : verdict === 'b' ? 'Candidate'
        : verdict === 'tie' ? 'Tie'
        : 'Error';
      const reason = document.createElement('span');
      reason.className = 'reason';
      const j = cell && cell.judge;
      reason.textContent = (j && (j.error || j.reason)) || '—';
      rowEl.appendChild(k);
      rowEl.appendChild(pill);
      rowEl.appendChild(reason);
      return rowEl;
    };

    stack.appendChild(render('was', prev, prevV));
    stack.appendChild(render('now', cur, curV));
    return stack;
  }

  function detailSide(side, modelName, output) {
    const wrap = document.createElement('div');
    wrap.className = 'detail-side';

    const title = document.createElement('div');
    title.className = 'side-title';
    // The side arg (A or B) is kept as a tiny prefix because the judge's
    // verdict uses those letters; users scanning see which side won at once.
    title.innerHTML = side + ' · <span class="model-tag">' + escapeHtml(modelName) + '</span>';
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
      // Pull overrides + available-models + previous-run in parallel —
      // the header picker rehydrates once the allowlist lands; the delta
      // column rehydrates once the registry lookup lands. Non-blocking
      // for the initial render.
      loadOverrides();
      loadAvailableModels();
      loadPreviousRun();
    } catch (err) {
      setError('failed to load workspace: ' + (err.message || err));
    }
  }

  /**
   * Pull the most recent completed run from the registry and index its cells
   * by (caseIndex, model, modelB?) so the grid can show per-row deltas.
   * Silent on failure — the UI degrades to "no delta column" instead of
   * yelling about a registry that might be empty on first use.
   */
  async function loadPreviousRun() {
    try {
      const listRes = await fetch('/api/runs?limit=10');
      if (!listRes.ok) return;
      const listBody = await listRes.json();
      const runs = (listBody && listBody.runs) || [];
      const latest = runs.find((r) => r && r.status === 'complete');
      if (!latest) { afterPreviousRunLoaded(); return; }

      const detailRes = await fetch('/api/runs/' + encodeURIComponent(latest.id));
      if (!detailRes.ok) { afterPreviousRunLoaded(); return; }
      const detailBody = await detailRes.json();
      const cells = (detailBody && detailBody.cells) || [];

      state.previousRun.id = latest.id;
      state.previousRun.cells = new Map();
      for (const c of cells) {
        if (c && typeof c.caseIndex === 'number' && typeof c.model === 'string') {
          state.previousRun.cells.set(compareKey(c.caseIndex, c.model, c.modelB), c);
        }
      }
      state.previousRun.loaded = true;
      afterPreviousRunLoaded();
    } catch {
      /* Non-fatal — the grid just loses the delta column. */
      afterPreviousRunLoaded();
    }
  }

  function afterPreviousRunLoaded() {
    // Rebuild the idle-state delta cells so they show "0" instead of "—"
    // immediately when a previous run exists; otherwise keep them dim.
    const hasPrev = state.previousRun.cells.size > 0;
    $('sum-delta-up').textContent = hasPrev ? '0' : '—';
    $('sum-delta-down').textContent = hasPrev ? '0' : '—';
    $('sum-delta-up').classList.toggle('dim', true);   // starts dim; lights up once cells arrive
    $('sum-delta-down').classList.toggle('dim', true);
  }

  async function loadAvailableModels() {
    let available = [];
    try {
      const res = await fetch('/api/available-models');
      if (res.ok) {
        const body = await res.json();
        available = Array.isArray(body.available) ? body.available : [];
      }
    } catch {
      /* non-fatal — just fall back to free-text inputs. */
    }
    state.availableModels = available;
    renderModelPickers();
  }

  /**
   * Swap between dropdown and text-input based on whether we have a curated
   * allowlist. Config values not in the list stay selectable — preserved as
   * amber "(custom)" entries so existing configs don't get silently nuked.
   */
  function renderModelPickers() {
    const ws = state.workspace;
    if (!ws) return;
    const configured = ws.config.models || [];
    const judgeConfigured = ws.config.judge ? ws.config.judge.model : '';
    const allow = state.availableModels || [];

    const modelsSel = $('models-select');
    const modelsIn = $('models-input');
    const judgeSel = $('judge-model-select');
    const judgeIn = $('judge-model-input');

    if (allow.length === 0) {
      // No curated list → show free-text inputs, hide selects.
      modelsSel.style.display = 'none';
      judgeSel.style.display = 'none';
      modelsIn.style.display = '';
      judgeIn.style.display = '';
      modelsIn.value = configured.join(', ');
      judgeIn.value = judgeConfigured;
      return;
    }

    // Curated list available → populate and show selects, hide free-text.
    const unionModels = [...allow];
    for (const m of configured) if (!unionModels.includes(m)) unionModels.push(m);
    const unionJudge = [...allow];
    if (judgeConfigured && !unionJudge.includes(judgeConfigured)) unionJudge.push(judgeConfigured);

    const buildOptions = (sel, list, selectedSet) => {
      sel.innerHTML = '';
      for (const m of list) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m + (allow.includes(m) ? '' : ' (custom)');
        if (!allow.includes(m)) opt.className = 'custom';
        if (selectedSet.has(m)) opt.selected = true;
        sel.appendChild(opt);
      }
    };

    buildOptions(modelsSel, unionModels, new Set(configured));
    // Size the multi-select to show ~6 rows without dominating the header.
    modelsSel.size = Math.min(6, Math.max(1, unionModels.length));

    buildOptions(judgeSel, unionJudge, new Set([judgeConfigured]));

    modelsSel.style.display = '';
    judgeSel.style.display = '';
    modelsIn.style.display = 'none';
    judgeIn.style.display = 'none';
  }

  /** Flash a model-id input green on save, red on failure. Auto-clears after ~1.2s. */
  function flashInput(el, ok) {
    el.classList.remove('saved', 'err');
    el.classList.add(ok ? 'saved' : 'err');
    setTimeout(() => el.classList.remove('saved', 'err'), 1200);
  }

  async function saveModelsInput() {
    const sel = $('models-select');
    const txt = $('models-input');
    const useSelect = sel.style.display !== 'none';
    const el = useSelect ? sel : txt;
    let models;
    if (useSelect) {
      models = Array.from(sel.selectedOptions).map((o) => o.value);
    } else {
      const raw = txt.value.trim();
      models = raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (models.length === 0) {
      flashInput(el, false);
      setError('models: must be a non-empty list of provider/model ids');
      return;
    }
    try {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ models }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || await res.text());
      }
      state.workspace.config.models = models;
      flashInput(el, true);
      setError(null);
    } catch (err) {
      flashInput(el, false);
      setError('save failed: ' + (err.message || err));
    }
  }

  async function saveJudgeModelInput() {
    const sel = $('judge-model-select');
    const txt = $('judge-model-input');
    const useSelect = sel.style.display !== 'none';
    const el = useSelect ? sel : txt;
    const judgeModel = (useSelect ? sel.value : txt.value).trim();
    if (judgeModel.length === 0 || !judgeModel.includes('/')) {
      flashInput(el, false);
      setError('judge: must be a "provider/model" string');
      return;
    }
    try {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ judgeModel }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || await res.text());
      }
      state.workspace.config.judge.model = judgeModel;
      flashInput(el, true);
      setError(null);
    } catch (err) {
      flashInput(el, false);
      setError('save failed: ' + (err.message || err));
    }
  }

  async function savePrompt() {
    if (!state.dirty) return;
    const which = state.active;
    const content = $('prompt-editor').value;
    try {
      if (which === 'judge') {
        // Judge criteria save goes through /api/config (patches judge.criteria
        // into { custom: ... }). Baseline/candidate go through the existing
        // /api/prompts file-write path. Two separate routes because they
        // mutate different kinds of state — files on disk vs JSON config.
        const res = await fetch('/api/config', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ judgeCriteriaCustom: content }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || await res.text());
        }
        state.workspace.judgeCriteriaText = content;
        state.workspace.judgeCriteriaKind = content.length > 0 ? 'custom' : 'preset';
      } else {
        const res = await fetch('/api/prompts', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ which, content }),
        });
        if (!res.ok) throw new Error(await res.text());
        state.workspace.prompts[which] = content;
      }
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
    $('run-btn').textContent = 'Running…';
    setError(null);
    resetGrid();
    counts.wins = 0; counts.losses = 0; counts.ties = 0; counts.errors = 0;
    counts.deltaUp = 0; counts.deltaDown = 0;

    const mock = $('mock-toggle').checked;
    const controller = new AbortController();
    let buffered = '';
    // Cells we render this sweep — snapshotted into state.previousRun on
    // 'done' so the NEXT Run click can diff against this one.
    const completedCells = [];
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
          if (event === 'cell') {
            addCellRow(payload);
            // Remember the cells we just rendered so we can rotate them into
            // the "previous run" lookup when the sweep finishes. This makes
            // the next click of Run diff against what the user just saw.
            if (payload && payload.cell) completedCells.push(payload.cell);
          } else if (event === 'error') {
            setError(payload.message || 'run failed');
          } else if (event === 'done') {
            // Rotate freshly-completed cells into the previous-run lookup so
            // the next Run click paints deltas against this sweep. The map
            // takes effect for rows added *after* the rotation — the current
            // grid keeps its own deltas.
            state.previousRun.cells = new Map();
            for (const c of completedCells) {
              if (c && typeof c.caseIndex === 'number' && typeof c.model === 'string') {
                state.previousRun.cells.set(compareKey(c.caseIndex, c.model, c.modelB), c);
              }
            }
            state.previousRun.loaded = true;
          }
        }
      }
    } catch (err) {
      setError('run failed: ' + (err.message || err));
    } finally {
      state.running = false;
      $('run-btn').disabled = false;
      $('run-btn').textContent = 'Run';
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
  // Model selectors — save on select-change when the dropdown is visible,
  // or on Enter/blur when falling back to the free-text input. Either way
  // the flash style makes success/failure immediately obvious without a
  // dedicated save button.
  const modelsIn = $('models-input');
  const modelsSel = $('models-select');
  modelsSel.addEventListener('change', saveModelsInput);
  modelsIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); modelsIn.blur(); }
  });
  modelsIn.addEventListener('blur', () => {
    const cur = (state.workspace && state.workspace.config.models || []).join(', ');
    if (modelsIn.value.trim() !== cur) saveModelsInput();
  });
  const judgeIn = $('judge-model-input');
  const judgeSel = $('judge-model-select');
  judgeSel.addEventListener('change', saveJudgeModelInput);
  judgeIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); judgeIn.blur(); }
  });
  judgeIn.addEventListener('blur', () => {
    const cur = state.workspace && state.workspace.config.judge ? state.workspace.config.judge.model : '';
    if (judgeIn.value.trim() !== cur) saveJudgeModelInput();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); savePrompt(); }
    // Run shortcuts: R or ⌘/Ctrl+Enter. Skip when a text field owns the
    // keystroke so users can still type the letter "r" inside the editor.
    const t = e.target;
    const typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault(); runSweep();
    } else if (!typing && e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); runSweep();
    }
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
      empty.textContent = 'No runs in registry yet. Click Run to create one.';
      body.appendChild(empty);
      return;
    }
    const hint = document.createElement('div');
    hint.className = 'empty';
    hint.style.textAlign = 'left';
    hint.style.padding = '0 2px 10px';
    hint.style.fontSize = '12.5px';
    hint.textContent = 'Click a row to inspect. Check two rows, then Compare.';
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
      h2.style.marginTop = '14px';
      h2.textContent = 'Cells (' + cells.length + ')';
      container.appendChild(h2);
      const table = document.createElement('table');
      table.className = 'grid-table';
      table.innerHTML =
        '<thead><tr><th>#</th><th>Model</th><th>Winner</th><th>Reason</th></tr></thead>';
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
    h.textContent = 'Comparison · ' + A.manifest.id.slice(-8) + ' vs ' + B.manifest.id.slice(-8);
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
