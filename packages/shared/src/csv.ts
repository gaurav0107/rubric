import type { CellResult, RunSummary } from './types.ts';

const COLUMNS = [
  'caseIndex',
  'model',
  'verdict',
  'reason',
  'error',
  'latencyMs',
  'costUsd',
] as const;

/**
 * Minimal RFC 4180 CSV escaper: wrap in quotes when the value contains a
 * comma, quote, CR, or LF. Internal quotes are doubled. Non-string values
 * are rendered via String(v); undefined/null become empty cells.
 */
function csvEscape(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface CostCsvInput {
  cells: CellResult[];
  summary: RunSummary;
}

/**
 * Render a per-cell cost/latency CSV for post-run analysis.
 *
 * One row per cell; columns match COLUMNS above. A trailing "TOTAL" row
 * aggregates latency and cost so spreadsheet users see roll-ups without
 * needing a SUM() formula. Verdict for the total row is left blank.
 */
export function renderCostCsv(input: CostCsvInput): string {
  const lines: string[] = [];
  lines.push(COLUMNS.join(','));
  for (const cell of input.cells) {
    const error = 'error' in cell.judge ? cell.judge.error : undefined;
    const verdict = 'winner' in cell.judge ? cell.judge.winner : undefined;
    const reason = 'reason' in cell.judge ? cell.judge.reason : undefined;
    const row = [
      cell.caseIndex,
      cell.model,
      verdict ?? '',
      reason ?? '',
      error ?? '',
      cell.latencyMs ?? '',
      cell.costUsd ?? '',
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  const totalRow = [
    'TOTAL',
    '',
    '',
    `wins=${input.summary.wins} losses=${input.summary.losses} ties=${input.summary.ties} errors=${input.summary.errors}`,
    '',
    input.summary.totalLatencyMs ?? '',
    input.summary.totalCostUsd ?? '',
  ];
  lines.push(totalRow.map(csvEscape).join(','));
  return lines.join('\n') + '\n';
}
