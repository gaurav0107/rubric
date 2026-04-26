import type { CalibrationReport } from './calibrate.ts';
import type { EvaluatorGateBreach, MetricSummary } from './evaluators.ts';
import type { CellResult, ModelId, RunSummary, Verdict } from './types.ts';

export interface PrCommentInput {
  summary: RunSummary;
  /** Used for the per-model breakdown. Omit if only aggregate matters. */
  cells?: CellResult[];
  models: ModelId[];
  judge: { model: ModelId };
  /**
   * When omitted, the comment renders the "unverified judge" banner. When
   * present, it shows the agreement %. A separate minAgreement threshold
   * governs whether calibrated-but-weak is called out.
   */
  calibration?: CalibrationReport;
  /** Bar below which a calibrated judge is flagged as weak. Default 0.8. */
  minAgreement?: number;
  /** Optional absolute URL to a generated HTML report. */
  reportUrl?: string;
  /** e.g. baseline.md -> candidate.md; shown in the header if provided. */
  title?: string;
  /** Per-metric evaluator summary — renders a collapsible breakdown below the main summary table. */
  metrics?: MetricSummary[];
  /** failOn breaches — highlighted as a bold line above the metrics table when present. */
  gateBreaches?: EvaluatorGateBreach[];
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
  const map = new Map<ModelId, ModelTally>();
  for (const cell of cells) {
    let t = map.get(cell.model);
    if (!t) {
      t = { model: cell.model, wins: 0, losses: 0, ties: 0, errors: 0 };
      map.set(cell.model, t);
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

function calibrationSection(
  calibration: CalibrationReport | undefined,
  judgeModel: ModelId,
  minAgreement: number,
): string {
  if (!calibration) {
    return [
      `### Judge: \`${judgeModel}\` · calibration: **unverified**`,
      '',
      '> This judge has not been calibrated against human labels. Run `rubric calibrate` to measure agreement before trusting this verdict.',
    ].join('\n');
  }
  const decisive = calibration.agreements + calibration.disagreements;
  const weak = calibration.agreement < minAgreement;
  const label = weak ? 'weak' : 'calibrated';
  const lines = [
    `### Judge: \`${judgeModel}\` · calibration: **${label}**`,
    '',
    `- Agreement: **${pct(calibration.agreement)}** (${calibration.agreements} / ${decisive} decisive, ${calibration.errors} error${calibration.errors === 1 ? '' : 's'})`,
    `- Labels: ${calibration.total}`,
  ];
  if (weak) {
    lines.push('', `> Judge agreement is below the ${pct(minAgreement)} threshold — treat verdicts as indicative, not authoritative.`);
  }
  return lines.join('\n');
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
  const minAgreement = input.minAgreement ?? 0.8;

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

  const metricsBlock = metricsSection(input.metrics, input.gateBreaches);
  if (metricsBlock) parts.push('', metricsBlock);

  parts.push('', calibrationSection(input.calibration, input.judge.model, minAgreement));

  if (input.reportUrl) {
    parts.push('', `[Full report](${input.reportUrl})`);
  }

  parts.push('', '<sub>Posted by [rubric](https://rubric.dev).</sub>');

  return parts.join('\n') + '\n';
}
