import type { EvaluatorGateBreach, MetricSummary } from './evaluators.ts';
import type { CellResult, ModelId, RunSummary, Verdict } from './types.ts';

export interface PrCommentInput {
  summary: RunSummary;
  /** Used for the per-model breakdown. Omit if only aggregate matters. */
  cells?: CellResult[];
  models: ModelId[];
  judge: { model: ModelId };
  /** Optional absolute URL to a generated HTML report. */
  reportUrl?: string;
  /** e.g. baseline.md -> candidate.md; shown in the header if provided. */
  title?: string;
  /** Per-metric evaluator summary — renders a collapsible breakdown below the main summary table. */
  metrics?: MetricSummary[];
  /** failOn breaches — highlighted as a bold line above the metrics table when present. */
  gateBreaches?: EvaluatorGateBreach[];
  /** caseIndex → case input text. Enables the "top regressions" block to show WHICH case regressed, not just that one did. */
  caseInputs?: Map<number, string>;
}

export type PrVerdict = 'pass' | 'regress' | 'tie' | 'error';

export function classifyVerdict(summary: RunSummary): PrVerdict {
  const decisive = summary.wins + summary.losses;
  if (decisive === 0) {
    return summary.errors > 0 ? 'error' : 'tie';
  }
  if (summary.wins > summary.losses) return 'pass';
  if (summary.losses > summary.wins) return 'regress';
  return 'tie';
}

interface ModelTally {
  model: ModelId;
  wins: number;
  losses: number;
  ties: number;
  errors: number;
}

function tallyByModel(cells: CellResult[]): ModelTally[] {
  const map = new Map<string, ModelTally>();
  for (const cell of cells) {
    // In compare-models mode the row is the pairing "A vs B"; in compare-prompts
    // it's just the single model (A === B). Using the label string as the key
    // keeps both modes on the same code path.
    const label = (cell.modelB && cell.modelB !== cell.model)
      ? (`${cell.model} vs ${cell.modelB}` as ModelId)
      : cell.model;
    let t = map.get(label);
    if (!t) {
      t = { model: label, wins: 0, losses: 0, ties: 0, errors: 0 };
      map.set(label, t);
    }
    if ('error' in cell.judge) {
      t.errors++;
    } else {
      const v: Verdict = cell.judge.winner;
      if (v === 'b') t.wins++;
      else if (v === 'a') t.losses++;
      else t.ties++;
    }
  }
  return [...map.values()];
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function statusLine(v: PrVerdict, summary: RunSummary): string {
  const decisive = summary.wins + summary.losses;
  const rate = decisive === 0 ? '—' : pct(summary.winRate);
  switch (v) {
    case 'pass':
      return `**PASS** — candidate wins ${summary.wins} / ${decisive} decisive (${rate}).`;
    case 'regress':
      return `**REGRESSION** — candidate loses ${summary.losses} > wins ${summary.wins} (${rate} win rate).`;
    case 'tie':
      return `**TIE** — wins ${summary.wins}, losses ${summary.losses}, ties ${summary.ties}.`;
    case 'error':
      return `**ERROR** — all ${summary.errors} cell(s) failed before a verdict could be reached.`;
  }
}

function judgeSection(judgeModel: ModelId): string {
  return [
    `### Judge: \`${judgeModel}\``,
    '',
    '> Verdicts reflect the judge model. Override any cell you disagree with via `rubric disagree`; the override log becomes the calibration corpus.',
  ].join('\n');
}

function summaryTable(summary: RunSummary): string {
  const decisive = summary.wins + summary.losses;
  const rate = decisive === 0 ? '—' : pct(summary.winRate);
  return [
    '| wins | losses | ties | errors | win rate |',
    '| ---: | -----: | ---: | -----: | -------: |',
    `| ${summary.wins} | ${summary.losses} | ${summary.ties} | ${summary.errors} | ${rate} |`,
  ].join('\n');
}

function fmtUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function costLine(summary: RunSummary): string | null {
  if (summary.totalCostUsd === undefined) return null;
  const cells = summary.costedCells ?? 0;
  const avg = cells > 0 ? summary.totalCostUsd / cells : 0;
  return `Cost: **${fmtUsd(summary.totalCostUsd)}** across ${cells} cell${cells === 1 ? '' : 's'} (avg ${fmtUsd(avg)}/cell).`;
}

function metricsSection(
  metrics: MetricSummary[] | undefined,
  breaches: EvaluatorGateBreach[] | undefined,
): string {
  if (!metrics || metrics.length === 0) return '';
  const rows = metrics.map((m) => {
    const rate = m.passRate !== undefined ? pct(m.passRate) : '—';
    const mean = m.mean !== undefined ? m.mean.toFixed(2) : '—';
    const side = m.side === 'a' ? 'A' : m.side === 'b' ? 'B' : m.side === 'both' ? 'A+B' : 'mixed';
    return `| \`${m.metric}\` | ${side} | ${m.count} | ${mean} | ${rate} |`;
  });
  const out: string[] = [];
  if (breaches && breaches.length > 0) {
    const items = breaches.map((b) => `\`${b.metric}\` ${pct(b.actual)} < ${pct(b.threshold)} (failOn, n=${b.sample})`);
    out.push(`> **Gate breached** — ${items.join('; ')}. CI exit code 2.`);
    out.push('');
  }
  out.push('<details><summary>Evaluator metrics</summary>');
  out.push('');
  out.push('| metric | side | n | mean | pass rate |');
  out.push('| --- | --- | ---: | ---: | ---: |');
  out.push(...rows);
  out.push('');
  out.push('</details>');
  return out.join('\n');
}

/** Max chars to show per case input / model output inside the regressions block. Keeps the comment scannable on GitHub. */
const REGRESSION_TEXT_CAP = 280;

function trim(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return text.slice(0, cap - 1).trimEnd() + '…';
}

/**
 * Surface the 3 most impactful losses so the PR reader can triage without
 * leaving the comment. Ranking: losses first (errors and ties ignored), then
 * by judge.reason length (longer ≈ judge had more to say ≈ more load-bearing),
 * then by caseIndex ascending (stable for repeatable snapshots).
 */
function topRegressionsSection(cells: CellResult[] | undefined, caseInputs: Map<number, string> | undefined): string {
  if (!cells || cells.length === 0) return '';
  const losses = cells.filter((c) => !('error' in c.judge) && c.judge.winner === 'a');
  if (losses.length === 0) return '';
  const ranked = [...losses].sort((x, y) => {
    const xr = 'reason' in x.judge ? (x.judge.reason?.length ?? 0) : 0;
    const yr = 'reason' in y.judge ? (y.judge.reason?.length ?? 0) : 0;
    if (yr !== xr) return yr - xr;
    return x.caseIndex - y.caseIndex;
  });
  const top = ranked.slice(0, 3);

  const lines: string[] = [];
  lines.push(`<details><summary>Top regressions (${top.length} of ${losses.length} losses)</summary>`);
  lines.push('');
  for (const c of top) {
    const inputText = caseInputs?.get(c.caseIndex);
    const reason = 'reason' in c.judge ? (c.judge.reason ?? '') : '';
    const modelLabel = c.modelB && c.modelB !== c.model ? `${c.model} vs ${c.modelB}` : c.model;
    lines.push(`#### case-${c.caseIndex} — \`${modelLabel}\``);
    if (inputText && inputText.length > 0) {
      lines.push('');
      lines.push('**Input**');
      lines.push('');
      lines.push('```');
      lines.push(trim(inputText, REGRESSION_TEXT_CAP));
      lines.push('```');
    }
    if (reason.length > 0) {
      lines.push('');
      lines.push(`**Why baseline won:** ${trim(reason, REGRESSION_TEXT_CAP)}`);
    }
    // Only render outputs when we actually captured them (new JSON payload
    // format; legacy callers that pass empty strings stay silent here).
    if (c.outputA.length > 0 || c.outputB.length > 0) {
      lines.push('');
      lines.push('<table><tr><th>A (baseline, won)</th><th>B (candidate, lost)</th></tr><tr><td>');
      lines.push('');
      lines.push('```');
      lines.push(trim(c.outputA || '(empty)', REGRESSION_TEXT_CAP));
      lines.push('```');
      lines.push('');
      lines.push('</td><td>');
      lines.push('');
      lines.push('```');
      lines.push(trim(c.outputB || '(empty)', REGRESSION_TEXT_CAP));
      lines.push('```');
      lines.push('');
      lines.push('</td></tr></table>');
    }
    lines.push('');
  }
  lines.push('</details>');
  return lines.join('\n');
}

function modelTable(tallies: ModelTally[]): string {
  if (tallies.length === 0) return '';
  const rows = tallies.map((t) => {
    const decisive = t.wins + t.losses;
    const rate = decisive === 0 ? '—' : pct(t.wins / decisive);
    return `| \`${t.model}\` | ${t.wins} | ${t.losses} | ${t.ties} | ${t.errors} | ${rate} |`;
  });
  return [
    '<details><summary>Per-model breakdown</summary>',
    '',
    '| model | wins | losses | ties | errors | win rate |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    '</details>',
  ].join('\n');
}

export function renderPrComment(input: PrCommentInput): string {
  const verdict = classifyVerdict(input.summary);

  const header = input.title ? `# rubric — ${input.title}` : '# rubric';
  const parts: string[] = [
    header,
    '',
    statusLine(verdict, input.summary),
    '',
    summaryTable(input.summary),
  ];

  const costStr = costLine(input.summary);
  if (costStr) parts.push('', costStr);

  if (input.cells && input.cells.length > 0 && input.models.length > 1) {
    const tallies = tallyByModel(input.cells);
    if (tallies.length > 0) {
      parts.push('', modelTable(tallies));
    }
  }

  const regressionsBlock = topRegressionsSection(input.cells, input.caseInputs);
  if (regressionsBlock) parts.push('', regressionsBlock);

  const metricsBlock = metricsSection(input.metrics, input.gateBreaches);
  if (metricsBlock) parts.push('', metricsBlock);

  parts.push('', judgeSection(input.judge.model));

  if (input.reportUrl) {
    parts.push('', `[Full report](${input.reportUrl})`);
  }

  parts.push('', '<sub>Posted by [rubric](https://rubric.dev).</sub>');

  return parts.join('\n') + '\n';
}
