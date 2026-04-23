import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createMockJudge,
  createMockProvider,
  createOpenAIJudge,
  createOpenAIProvider,
  loadConfig,
  parseCasesJsonl,
  resolveRubric,
  renderBadgeSvg,
  renderCostCsv,
  renderReportHtml,
  runEval,
  validateRunInputs,
  type CalibrationReport,
  type CellResult,
  type Config,
  type Judge,
  type ModelId,
  type Provider,
  type RunLimits,
  type RunSummary,
  type Verdict,
} from '../../../shared/src/index.ts';

export interface RunOptions {
  configPath?: string;
  cwd?: string;
  mock?: boolean;
  concurrency?: number;
  allowLangfuse?: boolean;
  /** If set, write an HTML report to this absolute or cwd-relative path. */
  reportPath?: string;
  /**
   * Exit non-zero when candidate lost more cells than it won.
   * Intended for CI gates — `summary.losses > summary.wins`.
   */
  failOnRegress?: boolean;
  /**
   * Emit a single machine-readable JSON object to `writeJson` and suppress
   * human progress chatter on `write`. Intended for CI / PR-bot consumers.
   */
  json?: boolean;
  /** When set, write the JSON payload to this path (stdout still gets it if `json` is true). */
  jsonPath?: string;
  /** When set, write a self-contained status SVG badge to this path. */
  badgePath?: string;
  /** Optional calibration JSON path; colors the badge accordingly. */
  calibrationPath?: string;
  /** When set, write a per-cell cost/latency CSV for spreadsheet analysis. */
  costCsvPath?: string;
  /**
   * Input caps enforced before any provider call. Local CLI defaults leave
   * these undefined (permissive). The hosted sandbox enforces 4k prompt /
   * 20 cases / PII-scan per the v1 abuse budget.
   */
  limits?: RunLimits;
  /** Stream of human-readable output; defaults to process.stdout. */
  write?: (line: string) => void;
  /** Stream for the JSON payload when `json` is true; defaults to process.stdout. */
  writeJson?: (payload: string) => void;
}

export interface RunResult {
  total: number;
  summary: RunSummary;
  exitCode: number;
}

const DEFAULT_CONFIG = 'diffprompt.config.json';

function buildProviders(mock: boolean): Provider[] {
  if (mock) return [createMockProvider({ acceptAll: true })];
  return [createOpenAIProvider()];
}

function buildJudge(mock: boolean, config: Config, providers: Provider[], rubric: string): Judge {
  if (mock) return createMockJudge({ verdict: 'tie', reason: 'mock judge' });

  const judgeProvider = providers.find((p) => p.supports(config.judge.model));
  if (!judgeProvider) {
    throw new Error(
      `no provider accepts judge.model "${config.judge.model}". Only openai/* judges are supported in live mode today.`,
    );
  }
  return createOpenAIJudge({
    provider: judgeProvider,
    model: config.judge.model,
    rubric,
  });
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m${rem.toFixed(0)}s`;
}

/**
 * Pure exit-code decision for `diffprompt run`.
 *
 * Precedence: regression (2) wins over errors (1). Rationale: if CI is gating
 * on --fail-on-regress, a judge error during a losing run should not be quieter
 * than a clean loss — surface the regression first.
 */
export function decideExitCode(summary: RunSummary, failOnRegress: boolean): number {
  if (failOnRegress && summary.losses > summary.wins) return 2;
  if (summary.errors > 0) return 1;
  return 0;
}

export interface JsonCell {
  caseIndex: number;
  model: ModelId;
  latencyMs: number;
  costUsd?: number;
  winner?: Verdict;
  reason?: string;
  error?: string;
}

export interface JsonPayload {
  version: 1;
  summary: RunSummary;
  exitCode: number;
  models: ModelId[];
  judge: { model: ModelId };
  totalCells: number;
  cells: JsonCell[];
}

export function buildJsonPayload(args: {
  config: Config;
  cells: CellResult[];
  summary: RunSummary;
  exitCode: number;
}): JsonPayload {
  const cells: JsonCell[] = args.cells.map((c) => {
    const out: JsonCell = {
      caseIndex: c.caseIndex,
      model: c.model,
      latencyMs: c.latencyMs ?? 0,
    };
    if (c.costUsd !== undefined) out.costUsd = c.costUsd;
    if ('error' in c.judge) {
      out.error = c.judge.error;
    } else {
      out.winner = c.judge.winner;
      out.reason = c.judge.reason;
    }
    return out;
  });
  return {
    version: 1,
    summary: args.summary,
    exitCode: args.exitCode,
    models: args.config.models,
    judge: { model: args.config.judge.model },
    totalCells: args.cells.length,
    cells,
  };
}

export async function runRun(opts: RunOptions = {}): Promise<RunResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, DEFAULT_CONFIG);
  const mock = opts.mock ?? false;
  const json = opts.json === true;
  // In --json mode, route human chatter to stderr so stdout stays a clean
  // JSON stream for downstream tools.
  const defaultWrite = json
    ? (line: string) => process.stderr.write(line)
    : (line: string) => process.stdout.write(line);
  const write = opts.write ?? defaultWrite;
  const writeJson = opts.writeJson ?? ((payload: string) => process.stdout.write(payload));

  const loaded = loadConfig(configPath);
  const prompts = {
    baseline: readFileSync(loaded.resolved.baseline, 'utf8'),
    candidate: readFileSync(loaded.resolved.candidate, 'utf8'),
  };
  const datasetText = readFileSync(loaded.resolved.dataset, 'utf8');
  const cases = parseCasesJsonl(datasetText, { allowLangfuse: opts.allowLangfuse ?? false });

  if (opts.limits) {
    const { errors, warnings } = validateRunInputs({ prompts, cases, limits: opts.limits });
    for (const w of warnings) write(`  ⚠ ${w.message}\n`);
    if (errors.length > 0) {
      for (const e of errors) write(`  ✖ ${e.message}\n`);
      throw new Error(`input validation failed (${errors.length} error${errors.length === 1 ? '' : 's'})`);
    }
  }

  write(`diffprompt: ${cases.length} case(s) x ${loaded.config.models.length} model(s) = ${cases.length * loaded.config.models.length} cell(s)\n`);
  write(`  config:   ${loaded.path}\n`);
  write(`  mode:     ${mock ? 'mock' : 'live'}\n`);

  // Flatten { file: path } rubrics to text before the engine sees them; the
  // engine is cwd-free and can't resolve file paths itself.
  const rubricText = resolveRubric(loaded.config.judge.rubric, loaded.baseDir);
  const resolvedConfig: Config = {
    ...loaded.config,
    judge: { ...loaded.config.judge, rubric: { custom: rubricText } },
  };
  const providers = buildProviders(mock);
  const judge = buildJudge(mock, resolvedConfig, providers, rubricText);

  const onCell = (_cell: unknown, p: { done: number; total: number }) => {
    write(`  [${p.done}/${p.total}]\n`);
  };

  const runOpts: Parameters<typeof runEval>[0] = {
    config: resolvedConfig,
    cases,
    prompts,
    providers,
    judge,
    onCell,
  };
  if (opts.concurrency !== undefined) runOpts.concurrency = opts.concurrency;

  const { cells, summary } = await runEval(runOpts);

  write(`\nSummary:\n`);
  write(`  wins:    ${summary.wins}\n`);
  write(`  losses:  ${summary.losses}\n`);
  write(`  ties:    ${summary.ties}\n`);
  write(`  errors:  ${summary.errors}\n`);
  write(`  winRate: ${fmtPct(summary.winRate)} (of decisive ${summary.wins + summary.losses})\n`);
  if (summary.totalCostUsd !== undefined) {
    const avg = summary.costedCells && summary.costedCells > 0 ? summary.totalCostUsd / summary.costedCells : 0;
    write(`  cost:    ${fmtCost(summary.totalCostUsd)} (avg ${fmtCost(avg)}/cell × ${summary.costedCells})\n`);
  }
  if (summary.totalLatencyMs !== undefined) {
    write(`  time:    ${fmtDuration(summary.totalLatencyMs)} wall-sum\n`);
  }

  if (opts.reportPath) {
    const absReport = resolve(cwd, opts.reportPath);
    const html = renderReportHtml({ config: loaded.config, cases, cells, summary });
    writeFileSync(absReport, html, 'utf8');
    write(`\n  report:  ${absReport}\n`);
  }

  const failOnRegress = opts.failOnRegress === true;
  const exitCode = decideExitCode(summary, failOnRegress);
  if (exitCode === 2) {
    write(`\n  REGRESSION: candidate lost ${summary.losses} > won ${summary.wins} — failing per --fail-on-regress.\n`);
  }

  const wantJson = json || opts.jsonPath !== undefined;
  if (wantJson) {
    const payload = buildJsonPayload({ config: loaded.config, cells, summary, exitCode });
    const serialized = JSON.stringify(payload) + '\n';
    if (json) writeJson(serialized);
    if (opts.jsonPath) {
      const absJson = resolve(cwd, opts.jsonPath);
      writeFileSync(absJson, serialized, 'utf8');
      if (!json) write(`\n  json:    ${absJson}\n`);
    }
  }

  if (opts.costCsvPath) {
    const absCsv = resolve(cwd, opts.costCsvPath);
    writeFileSync(absCsv, renderCostCsv({ cells, summary }), 'utf8');
    write(`\n  cost csv: ${absCsv}\n`);
  }

  if (opts.badgePath) {
    const absBadge = resolve(cwd, opts.badgePath);
    const badgeInput: Parameters<typeof renderBadgeSvg>[0] = { summary };
    if (opts.calibrationPath) {
      const calAbs = resolve(cwd, opts.calibrationPath);
      const raw = readFileSync(calAbs, 'utf8');
      const parsed = JSON.parse(raw) as CalibrationReport;
      badgeInput.calibration = parsed;
    }
    writeFileSync(absBadge, renderBadgeSvg(badgeInput), 'utf8');
    write(`\n  badge:   ${absBadge}\n`);
  }

  return {
    total: cells.length,
    summary,
    exitCode,
  };
}
