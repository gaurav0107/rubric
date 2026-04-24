import type { Grader, GraderPolarity } from './grader.ts';

export interface CalibrationEntry {
  input: string;
  output: string;
  polarity: GraderPolarity;
  reason?: string;
}

export interface CalibrationEntryResult {
  entry: CalibrationEntry;
  judgePolarity: GraderPolarity | null;
  judgeReason?: string;
  error?: string;
}

export interface CalibrationReport {
  total: number;
  agreements: number;
  disagreements: number;
  errors: number;
  /** agreements / (agreements + disagreements); 0 if no decisive comparisons. */
  agreement: number;
  /** Confusion matrix against the human label as ground truth. */
  matrix: {
    humanPositiveJudgePositive: number;
    humanPositiveJudgeNegative: number;
    humanNegativeJudgePositive: number;
    humanNegativeJudgeNegative: number;
  };
  results: CalibrationEntryResult[];
}

export async function runCalibration(
  entries: CalibrationEntry[],
  grader: Grader,
  criteria: string,
  concurrency = 4,
): Promise<CalibrationReport> {
  const results = new Array<CalibrationEntryResult>(entries.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= entries.length) return;
      const entry = entries[i] as CalibrationEntry;
      try {
        const g = await grader.grade({ input: entry.input, output: entry.output, criteria });
        const res: CalibrationEntryResult = {
          entry,
          judgePolarity: g.polarity,
        };
        if (g.reason) res.judgeReason = g.reason;
        results[i] = res;
      } catch (err) {
        results[i] = {
          entry,
          judgePolarity: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, entries.length)) }, () => worker()),
  );

  let agreements = 0;
  let disagreements = 0;
  let errors = 0;
  const m = {
    humanPositiveJudgePositive: 0,
    humanPositiveJudgeNegative: 0,
    humanNegativeJudgePositive: 0,
    humanNegativeJudgeNegative: 0,
  };

  for (const r of results) {
    if (r.judgePolarity === null) {
      errors++;
      continue;
    }
    const agree = r.judgePolarity === r.entry.polarity;
    if (agree) agreements++;
    else disagreements++;

    if (r.entry.polarity === 'positive' && r.judgePolarity === 'positive') m.humanPositiveJudgePositive++;
    if (r.entry.polarity === 'positive' && r.judgePolarity === 'negative') m.humanPositiveJudgeNegative++;
    if (r.entry.polarity === 'negative' && r.judgePolarity === 'positive') m.humanNegativeJudgePositive++;
    if (r.entry.polarity === 'negative' && r.judgePolarity === 'negative') m.humanNegativeJudgeNegative++;
  }

  const decisive = agreements + disagreements;
  return {
    total: entries.length,
    agreements,
    disagreements,
    errors,
    agreement: decisive === 0 ? 0 : agreements / decisive,
    matrix: m,
    results,
  };
}

export function renderCalibrationHtml(report: CalibrationReport, generatedAt: Date = new Date()): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const m = report.matrix;

  const rows = report.results
    .map((r) => {
      const agree = r.judgePolarity !== null && r.judgePolarity === r.entry.polarity;
      const status = r.error ? 'err' : agree ? 'ok' : 'diff';
      return `
<tr class="row-${status}">
  <td class="col-label">${escapeHtml(r.entry.polarity)}</td>
  <td class="col-judge">${escapeHtml(r.judgePolarity ?? 'error')}</td>
  <td class="col-input"><pre>${escapeHtml(r.entry.input)}</pre></td>
  <td class="col-output"><pre>${escapeHtml(r.entry.output)}</pre></td>
  <td class="col-reason">${escapeHtml(r.error ?? r.judgeReason ?? r.entry.reason ?? '')}</td>
</tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>rubric calibration</title>
<style>
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; margin: 24px; color: #1a1a1a; background: #fafaf8; }
  h1 { font-size: 20px; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 16px; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
  .stat { background: #fff; border: 1px solid #e5e7eb; padding: 12px 16px; border-radius: 8px; min-width: 120px; }
  .stat .n { display: block; font-size: 22px; font-weight: 600; }
  .stat .l { color: #6b7280; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
  th { background: #f3f4f6; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
  tr.row-diff { background: #fef2f2; }
  tr.row-err  { background: #fff7ed; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 12px/1.4 ui-monospace, Menlo, monospace; }
  .col-label, .col-judge { width: 90px; }
</style></head>
<body>
<h1>rubric calibration</h1>
<p class="meta">${escapeHtml(generatedAt.toISOString())}</p>
<div class="summary">
  <div class="stat"><span class="n">${report.total}</span><span class="l">entries</span></div>
  <div class="stat"><span class="n">${report.agreements}</span><span class="l">agreements</span></div>
  <div class="stat"><span class="n">${report.disagreements}</span><span class="l">disagreements</span></div>
  <div class="stat"><span class="n">${report.errors}</span><span class="l">errors</span></div>
  <div class="stat"><span class="n">${pct(report.agreement)}</span><span class="l">agreement</span></div>
</div>
<table>
  <thead><tr><th>human</th><th>judge</th><th>input</th><th>output</th><th>notes</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<h3>confusion matrix</h3>
<table style="width:auto">
  <thead><tr><th></th><th>judge +</th><th>judge −</th></tr></thead>
  <tbody>
    <tr><th>human +</th><td>${m.humanPositiveJudgePositive}</td><td>${m.humanPositiveJudgeNegative}</td></tr>
    <tr><th>human −</th><td>${m.humanNegativeJudgePositive}</td><td>${m.humanNegativeJudgeNegative}</td></tr>
  </tbody>
</table>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
