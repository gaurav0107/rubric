import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendCell,
  checkEvaluatorGates,
  completedCellKeys,
  createConfiguredProviders,
  createMockJudge,
  createMockProvider,
  createOpenAIJudge,
  createRun,
  createStructuralJudge,
  defaultRegistryRoot,
  loadConfig,
  parseCasesJsonl,
  redactHeaders,
  resolveCriteria,
  renderBadgeSvg,
  renderCostCsv,
  renderReportHtml,
  runEval,
  summarizeEvaluations,
  updateManifest,
  validateRunInputs,
  type CalibrationReport,
  type CellResult,
  type Config,
  type Criteria,
  type EvaluatorGateBreach,
  type Judge,
  type MetricSummary,
  type ModelId,
  type Provider,
  type ProviderConfig,
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
  /** Disable registry writes (used internally by `runs rerun` to avoid nested bookkeeping, not a user-facing flag). */
  skipRegistry?: boolean;
  /** Override registry root (`RUBRIC_HOME` / tests). */
  registryRoot?: string;
  /** Free-form note stored in the run manifest. */
  note?: string;
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
   * Equivalent to `format: 'json'`; kept as a separate flag for backwards
   * compatibility.
   */
  json?: boolean;
  /**
   * Output format.
   * - `human` (default): the multi-line progress + summary block.
   * - `json`: same payload as `json: true` — machine-readable JSON on stdout,
   *   human chatter on stderr.
   * - `compact`: one stable grep-friendly line on stdout with the key
   *   metrics, human chatter suppressed. Intended for shell pipelines and
   *   PR-comment bots that don't want to parse JSON.
   */
  format?: 'human' | 'json' | 'compact';
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
  /**
   * Spawn a detached worker and exit. The parent prints the run id and
   * returns immediately; the child runs `rubric runs resume <id>` under its
   * own pid with stdio redirected to the run's log file.
   */
  detach?: boolean;
  /**
   * When true, print a diagnostics block before the sweep: each configured
   * provider's base URL, redacted headers, and key source. All secrets are
   * scrubbed via the shared `redactHeaders` helper — no bearer token should
   * ever reach the user's terminal. Intended for debugging 401/403 against
   * corporate gateways; safe to paste into a GitHub issue.
   */
  verbose?: boolean;
  /**
   * Internal seam: lets tests substitute a fake spawner so we don't actually
   * fork a process. Returns the child's pid.
   */
  spawnWorker?: (runId: string, registryRoot: string) => number;
  /** When `detach` is true, use this to locate the CLI entrypoint (defaults to the current bin.ts). */
  binPath?: string;
}

export interface RunResult {
  total: number;
  summary: RunSummary;
  exitCode: number;
  /** Present when the run was recorded in the registry (every live run by default). */
  runId?: string;
  /** When true, the run was backgrounded via `--detach` and `summary`/`total` are placeholders. */
  detached?: boolean;
  /** Pid of the detached worker, when `detached` is true. */
  workerPid?: number;
}

const DEFAULT_CONFIG = 'rubric.config.json';

/**
 * Locate the CLI entrypoint (bin.ts) so --detach can re-invoke ourselves.
 * In dev we resolve relative to this module; in a shipped build the caller
 * can override via `binPath`.
 */
function defaultBinPath(): string {
  const here = fileURLToPath(import.meta.url);
  // run.ts lives at packages/cli/src/commands/run.ts; bin.ts at packages/cli/src/bin.ts
  return resolve(here, '..', '..', 'bin.ts');
}

/**
 * Default detached spawner. Redirects stdio to the run's log so the parent
 * can exit cleanly without leaving pipes open.
 */
function defaultSpawnWorker(
  runId: string,
  registryRoot: string,
  binPath: string,
  extra: { mock?: boolean; concurrency?: number } = {},
): number {
  const args = [binPath, 'runs', 'resume', runId, '--registry-root', registryRoot];
  if (extra.mock) args.push('--mock');
  if (extra.concurrency !== undefined) args.push('--concurrency', String(extra.concurrency));
  const spawnOpts: SpawnOptions = {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  };
  const child = nodeSpawn(process.execPath, args, spawnOpts);
  child.unref();
  if (child.pid === undefined) {
    throw new Error('failed to spawn detached worker (no pid)');
  }
  return child.pid;
}

function buildProviders(mock: boolean, userProviders: ProviderConfig[] | undefined, baseDir: string): Provider[] {
  if (mock) return [createMockProvider({ acceptAll: true })];
  return createConfiguredProviders(userProviders, baseDir);
}

/**
 * Emit a provider diagnostics block for `--verbose`. The rule: NEVER print a
 * bearer token, an API key, or anything else that could compromise a live
 * credential. We show:
 *   - the provider's name and baseUrl (both public)
 *   - its extra headers, routed through `redactHeaders` so `Authorization`
 *     / `x-api-key` / `*token*` / `*secret*` collapse to `***`
 *   - the key source (env var name OR file path — never the value)
 * Users pasting this block into a GitHub issue should be able to do so
 * without thinking twice about what they're about to leak.
 */
export function writeProviderDiagnostics(
  write: (line: string) => void,
  userProviders: ProviderConfig[] | undefined,
): void {
  write(`\nverbose: provider diagnostics\n`);
  write(`  built-ins: openai/ groq/ openrouter/ ollama/ (key source: env *_API_KEY)\n`);
  const list = userProviders ?? [];
  if (list.length === 0) {
    write(`  no user-declared providers\n`);
    return;
  }
  for (const p of list) {
    write(`  ${p.name}/\n`);
    write(`    baseUrl:    ${p.baseUrl}\n`);
    if (p.keyEnv) write(`    keySource:  env ${p.keyEnv}\n`);
    else if (p.keyFile) write(`    keySource:  file ${p.keyFile}\n`);
    else write(`    keySource:  (unset — resolveProviderKey will throw on first request)\n`);
    const redacted = redactHeaders(p.headers);
    const entries = Object.entries(redacted);
    if (entries.length === 0) {
      write(`    headers:    (none)\n`);
    } else {
      write(`    headers:    ${JSON.stringify(redacted)}\n`);
    }
  }
}

function buildJudge(mock: boolean, config: Config, providers: Provider[], criteria: string, originalCriteria: Criteria): Judge {
  if (mock) return createMockJudge({ verdict: 'tie', reason: 'mock judge' });

  // Structural criteria skip the LLM and judge outputs deterministically
  // against `expected` — useful for tool-call / structured-output evals.
  if (originalCriteria === 'structural-json') return createStructuralJudge();

  const judgeProvider = providers.find((p) => p.supports(config.judge.model));
  if (!judgeProvider) {
    const userNames = (config.providers ?? []).map((p) => `${p.name}/`).join(', ');
    const configured = userNames ? `, plus user-declared: ${userNames}` : '';
    throw new Error(
      `no provider accepts judge.model "${config.judge.model}". Built-in prefixes: openai/, groq/, openrouter/, ollama/${configured}.`,
    );
  }
  return createOpenAIJudge({
    provider: judgeProvider,
    model: config.judge.model,
    criteria,
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
 * Pure exit-code decision for `rubric run`.
 *
 * Precedence: regression / evaluator breach (2) wins over errors (1).
 * Rationale: if CI is gating, a judge error during a losing run should not
 * be quieter than a clean loss — surface the gate breach first.
 */
export function decideExitCode(
  summary: RunSummary,
  failOnRegress: boolean,
  gateBreaches: EvaluatorGateBreach[] = [],
): number {
  if (failOnRegress && summary.losses > summary.wins) return 2;
  if (gateBreaches.length > 0) return 2;
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
  metrics?: MetricSummary[];
  gateBreaches?: EvaluatorGateBreach[];
}

/**
 * Build the stable one-line `key=value` summary for `--format compact`.
 * Ordering is load-bearing — downstream consumers (PR-bot, CI grep) can rely
 * on positional awk. Always includes exit, summary counts, winRate. Includes
 * cost/time only when the run captured them. Appends `gate=<metric>:<actual>`
 * entries when any failOn gate breached.
 */
export function buildCompactLine(args: {
  runId?: string;
  summary: RunSummary;
  exitCode: number;
  gateBreaches?: EvaluatorGateBreach[];
}): string {
  const s = args.summary;
  const parts: string[] = [];
  parts.push(`exit=${args.exitCode}`);
  if (args.runId) parts.push(`run=${args.runId}`);
  parts.push(`wins=${s.wins}`);
  parts.push(`losses=${s.losses}`);
  parts.push(`ties=${s.ties}`);
  parts.push(`errors=${s.errors}`);
  parts.push(`winRate=${s.winRate.toFixed(4)}`);
  if (s.totalCostUsd !== undefined) parts.push(`costUsd=${s.totalCostUsd.toFixed(6)}`);
  if (s.totalLatencyMs !== undefined) parts.push(`latencyMs=${Math.round(s.totalLatencyMs)}`);
  for (const b of args.gateBreaches ?? []) {
    parts.push(`gate=${b.metric}:${b.actual.toFixed(4)}<${b.threshold}`);
  }
  return parts.join(' ');
}

export function buildJsonPayload(args: {
  config: Config;
  cells: CellResult[];
  summary: RunSummary;
  exitCode: number;
  metrics?: MetricSummary[];
  gateBreaches?: EvaluatorGateBreach[];
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
  const payload: JsonPayload = {
    version: 1,
    summary: args.summary,
    exitCode: args.exitCode,
    models: args.config.models,
    judge: { model: args.config.judge.model },
    totalCells: args.cells.length,
    cells,
  };
  if (args.metrics && args.metrics.length > 0) payload.metrics = args.metrics;
  if (args.gateBreaches && args.gateBreaches.length > 0) payload.gateBreaches = args.gateBreaches;
  return payload;
}

export async function runRun(opts: RunOptions = {}): Promise<RunResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, DEFAULT_CONFIG);
  const mock = opts.mock ?? false;
  // --json is kept as an alias; explicit `format` wins when both are set.
  const format: 'human' | 'json' | 'compact' = opts.format ?? (opts.json === true ? 'json' : 'human');
  const json = format === 'json';
  const compact = format === 'compact';
  // In json/compact mode, route human chatter to stderr so stdout stays a
  // clean stream for downstream tools.
  const defaultWrite = json || compact
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

  write(`rubric: ${cases.length} case(s) x ${loaded.config.models.length} model(s) = ${cases.length * loaded.config.models.length} cell(s)\n`);
  write(`  config:   ${loaded.path}\n`);
  write(`  mode:     ${mock ? 'mock' : 'live'}\n`);

  // Flatten { file: path } criteria to text before the engine sees them; the
  // engine is cwd-free and can't resolve file paths itself.
  const criteriaText = resolveCriteria(loaded.config.judge.criteria, loaded.baseDir);
  const resolvedConfig: Config = {
    ...loaded.config,
    judge: { ...loaded.config.judge, criteria: { custom: criteriaText } },
  };
  const providers = buildProviders(mock, loaded.config.providers, loaded.baseDir);
  if (opts.verbose === true && !mock) {
    writeProviderDiagnostics(write, loaded.config.providers);
  }
  const judge = buildJudge(mock, resolvedConfig, providers, criteriaText, loaded.config.judge.criteria);

  const wantRegistry = opts.skipRegistry !== true;
  const registryRoot = opts.registryRoot ?? defaultRegistryRoot();
  let runId: string | undefined;
  if (wantRegistry) {
    const created = createRun({
      root: registryRoot,
      config: loaded.config,
      configPath: loaded.path,
      prompts,
      datasetText,
      plannedCells: cases.length * loaded.config.models.length,
      ...(opts.note !== undefined ? { note: opts.note } : {}),
    });
    runId = created.id;
    updateManifest(registryRoot, runId, { status: 'running' });
    write(`  run id:  ${runId}\n`);
  }

  // --detach: fork a worker that resumes this pre-created run, then exit.
  // We must return BEFORE building providers/judge so the parent process
  // never holds network sockets on behalf of the child.
  if (opts.detach === true) {
    if (!runId) throw new Error('--detach requires a registry-backed run (cannot combine with --skip-registry)');
    const bin = opts.binPath ?? defaultBinPath();
    const extra: { mock?: boolean; concurrency?: number } = {};
    if (mock) extra.mock = true;
    if (opts.concurrency !== undefined) extra.concurrency = opts.concurrency;
    const spawner = opts.spawnWorker ?? ((id: string, root: string) => defaultSpawnWorker(id, root, bin, extra));
    const pid = spawner(runId, registryRoot);
    write(`  detached: worker pid ${pid}\n`);
    write(`  next:    rubric runs wait ${runId}\n`);
    return {
      total: 0,
      summary: { wins: 0, losses: 0, ties: 0, errors: 0, winRate: 0 },
      exitCode: 0,
      runId,
      detached: true,
      workerPid: pid,
    };
  }

  const onCell = (cell: CellResult, p: { done: number; total: number }) => {
    write(`  [${p.done}/${p.total}]\n`);
    if (runId) {
      try {
        appendCell(registryRoot, runId, cell);
      } catch (err) {
        // Registry write failure must never take down the run. Log and continue.
        write(`  ⚠ registry append failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
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

  let cells: CellResult[] = [];
  let summary: RunSummary;
  try {
    const res = await runEval(runOpts);
    cells = res.cells;
    summary = res.summary;
  } catch (err) {
    if (runId) {
      updateManifest(registryRoot, runId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
      });
    }
    throw err;
  }

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

  const metricSummary = summarizeEvaluations(cells);
  const gateBreaches = checkEvaluatorGates(loaded.config.evaluators, metricSummary);
  if (metricSummary.metrics.length > 0) {
    write(`\nMetrics:\n`);
    for (const m of metricSummary.metrics) {
      const rate = m.passRate !== undefined ? fmtPct(m.passRate) : '—';
      const mean = m.mean !== undefined ? ` (mean ${m.mean.toFixed(1)})` : '';
      write(`  ${m.metric.padEnd(22)} ${rate}${mean}  [${m.passCount}/${m.count}]\n`);
    }
    if (metricSummary.skipCount > 0 || metricSummary.errorCount > 0) {
      write(`  (${metricSummary.skipCount} skipped, ${metricSummary.errorCount} errored)\n`);
    }
  }

  if (opts.reportPath) {
    const absReport = resolve(cwd, opts.reportPath);
    const reportInput: Parameters<typeof renderReportHtml>[0] = {
      config: loaded.config, cases, cells, summary,
    };
    if (metricSummary.metrics.length > 0) reportInput.metrics = metricSummary.metrics;
    if (gateBreaches.length > 0) reportInput.gateBreaches = gateBreaches;
    const html = renderReportHtml(reportInput);
    writeFileSync(absReport, html, 'utf8');
    write(`\n  report:  ${absReport}\n`);
  }

  const failOnRegress = opts.failOnRegress === true;
  const exitCode = decideExitCode(summary, failOnRegress, gateBreaches);
  if (failOnRegress && summary.losses > summary.wins) {
    write(`\n  REGRESSION: candidate lost ${summary.losses} > won ${summary.wins} — failing per --fail-on-regress.\n`);
  }
  for (const b of gateBreaches) {
    write(`  GATE: ${b.metric} = ${fmtPct(b.actual)} < ${fmtPct(b.threshold)} (failOn) — sample ${b.sample}\n`);
  }

  const wantJson = json || opts.jsonPath !== undefined;
  if (wantJson) {
    const payload = buildJsonPayload({
      config: loaded.config,
      cells,
      summary,
      exitCode,
      metrics: metricSummary.metrics,
      gateBreaches,
    });
    const serialized = JSON.stringify(payload) + '\n';
    if (json) writeJson(serialized);
    if (opts.jsonPath) {
      const absJson = resolve(cwd, opts.jsonPath);
      writeFileSync(absJson, serialized, 'utf8');
      if (!json) write(`\n  json:    ${absJson}\n`);
    }
  }

  if (compact) {
    const line = buildCompactLine({
      ...(runId !== undefined ? { runId } : {}),
      summary,
      exitCode,
      gateBreaches,
    });
    writeJson(line + '\n');
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

  if (runId) {
    updateManifest(registryRoot, runId, {
      status: exitCode === 0 ? 'complete' : 'failed',
      finishedAt: new Date().toISOString(),
      summary,
    });
  }

  const result: RunResult = {
    total: cells.length,
    summary,
    exitCode,
  };
  if (runId) result.runId = runId;
  return result;
}
