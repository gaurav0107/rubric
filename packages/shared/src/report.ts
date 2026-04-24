import type { Case, CellResult, Config, RunSummary, Verdict } from './types.ts';

export interface RenderReportInput {
  config: Config;
  cases: Case[];
  cells: CellResult[];
  summary: RunSummary;
  /** Overrides for the header; defaults to the config's prompt paths. */
  title?: string;
  generatedAt?: Date;
}

export function renderReportHtml(input: RenderReportInput): string {
  const when = input.generatedAt ?? new Date();
  const title = input.title ?? 'rubric report';
  const { config, cases, cells, summary } = input;

  const header = renderHeader(title, config, summary, when);
  const body = renderCells(cases, cells);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${header}
${body}
</main>
</body>
</html>
`;
}

function renderHeader(title: string, config: Config, summary: RunSummary, when: Date): string {
  const decisive = summary.wins + summary.losses;
  const winRatePct = decisive === 0 ? '—' : `${(summary.winRate * 100).toFixed(1)}%`;
  const criteria = typeof config.judge.criteria === 'string'
    ? config.judge.criteria
    : 'file' in config.judge.criteria ? `file:${config.judge.criteria.file}` : 'custom';

  const extraStats: string[] = [];
  if (summary.totalCostUsd !== undefined) {
    const usd = summary.totalCostUsd;
    const fmt = usd === 0 ? '$0.00' : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
    extraStats.push(`<div class="stat stat-cost"><span class="n">${escape(fmt)}</span><span class="l">total cost (${summary.costedCells ?? 0} cells)</span></div>`);
  }

  return `
<header>
  <h1>${escape(title)}</h1>
  <p class="meta">
    ${escape(when.toISOString())} · ${escape(config.mode ?? 'compare-prompts')} · judge: ${escape(config.judge.model)} (${escape(criteria)})
  </p>
  <div class="summary">
    <div class="stat stat-win"><span class="n">${summary.wins}</span><span class="l">wins</span></div>
    <div class="stat stat-loss"><span class="n">${summary.losses}</span><span class="l">losses</span></div>
    <div class="stat stat-tie"><span class="n">${summary.ties}</span><span class="l">ties</span></div>
    <div class="stat stat-err"><span class="n">${summary.errors}</span><span class="l">errors</span></div>
    <div class="stat stat-rate"><span class="n">${escape(winRatePct)}</span><span class="l">win rate (of ${decisive} decisive)</span></div>
    ${extraStats.join('\n    ')}
  </div>
</header>
`;
}

function renderCells(cases: Case[], cells: CellResult[]): string {
  if (cells.length === 0) return '<p>No cells.</p>';

  // Group by caseIndex for a stable layout.
  const byCase = new Map<number, CellResult[]>();
  for (const cell of cells) {
    const list = byCase.get(cell.caseIndex) ?? [];
    list.push(cell);
    byCase.set(cell.caseIndex, list);
  }
  const indices = [...byCase.keys()].sort((a, b) => a - b);

  return indices
    .map((i) => {
      const c = cases[i];
      const group = byCase.get(i) ?? [];
      return `
<section class="case">
  <h2>case #${i + 1}</h2>
  <pre class="input">${escape(c?.input ?? '(missing)')}</pre>
  ${c?.expected !== undefined ? `<p class="expected"><strong>expected:</strong> ${escape(c.expected)}</p>` : ''}
  ${group.map(renderCell).join('\n')}
</section>
`;
    })
    .join('\n');
}

function verdictLabel(v: Verdict): string {
  if (v === 'a') return 'A (baseline)';
  if (v === 'b') return 'B (candidate)';
  return 'tie';
}

function verdictClass(v: Verdict): string {
  return `verdict-${v}`;
}

function renderCell(cell: CellResult): string {
  const judgeBlock = 'error' in cell.judge
    ? `<div class="judge judge-err"><strong>error:</strong> ${escape(cell.judge.error)}</div>`
    : `<div class="judge ${verdictClass(cell.judge.winner)}">
         <strong>verdict:</strong> ${escape(verdictLabel(cell.judge.winner))}
         ${cell.judge.reason ? ` — ${escape(cell.judge.reason)}` : ''}
       </div>`;

  const meta: string[] = [`model: ${escape(cell.model)}`];
  if (typeof cell.latencyMs === 'number') meta.push(`${cell.latencyMs}ms`);
  if (typeof cell.costUsd === 'number') meta.push(`$${cell.costUsd.toFixed(4)}`);

  return `
<article class="cell">
  <div class="cell-meta">${meta.join(' · ')}</div>
  ${judgeBlock}
  <div class="outputs">
    <div class="out out-a"><div class="label">baseline</div><pre>${escape(cell.outputA)}</pre></div>
    <div class="out out-b"><div class="label">candidate</div><pre>${escape(cell.outputB)}</pre></div>
  </div>
</article>
`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
  :root {
    --fg: #1a1a1a;
    --bg: #fafaf8;
    --muted: #6b7280;
    --border: #e5e7eb;
    --card: #ffffff;
    --win: #16a34a;
    --loss: #dc2626;
    --tie: #6b7280;
    --err: #b91c1c;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px; }
  header h1 { margin: 0 0 4px; font-size: 24px; }
  header .meta { color: var(--muted); margin: 0 0 16px; font-size: 13px; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 32px; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    padding: 12px 16px; min-width: 100px; }
  .stat .n { display: block; font-size: 22px; font-weight: 600; }
  .stat .l { color: var(--muted); font-size: 12px; }
  .stat-win .n { color: var(--win); }
  .stat-loss .n { color: var(--loss); }
  .stat-tie .n { color: var(--tie); }
  .stat-err .n { color: var(--err); }
  .case { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    padding: 16px; margin-bottom: 20px; }
  .case h2 { margin: 0 0 8px; font-size: 15px; color: var(--muted); font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.03em; }
  .case .input { background: #f3f4f6; padding: 10px 12px; border-radius: 6px;
    margin: 0 0 8px; white-space: pre-wrap; word-break: break-word; }
  .case .expected { margin: 0 0 12px; color: var(--muted); font-size: 13px; }
  .cell { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; }
  .cell-meta { color: var(--muted); font-size: 12px; margin-bottom: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .judge { padding: 8px 10px; border-radius: 6px; margin-bottom: 10px; font-size: 13px; }
  .verdict-a { background: #fef2f2; border-left: 3px solid var(--loss); }
  .verdict-b { background: #ecfdf5; border-left: 3px solid var(--win); }
  .verdict-tie { background: #f3f4f6; border-left: 3px solid var(--tie); }
  .judge-err { background: #fef2f2; border-left: 3px solid var(--err); color: var(--err); }
  .outputs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .out { border: 1px solid var(--border); border-radius: 6px; padding: 10px; background: #fbfbfa; }
  .out .label { font-size: 11px; color: var(--muted); text-transform: uppercase;
    letter-spacing: 0.05em; margin-bottom: 6px; }
  .out pre { margin: 0; white-space: pre-wrap; word-break: break-word;
    font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
  @media (max-width: 700px) { .outputs { grid-template-columns: 1fr; } }
`;
