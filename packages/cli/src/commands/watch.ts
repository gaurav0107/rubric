/**
 * `rubric watch` — the v2.2 wedge.
 *
 * File watcher on baseline/candidate. On quiet-save, plans cells, looks each
 * one up in the cell cache, evaluates misses, streams verdicts to the terminal.
 * Warm cache = <10s cycle; the whole point is compressing the edit-to-verdict
 * loop for teams that treat prompts like code.
 *
 * State machine:
 *   idle ─save─▶ debouncing (500ms quiet-time)
 *   debouncing ─settle─▶ planning (read files, build plan, compare to last)
 *   planning ─▶ running (per-cell: cache lookup + miss→eval, stream result)
 *   running ─save─▶ abort in-flight, back to debouncing
 *   running ─done─▶ idle (results stay on screen)
 *
 * One watch session = one registry run. Iterations append cells tagged with
 * an iteration counter so `rubric runs show <id>` can surface latest or a
 * specific pass.
 */
import { readFileSync, statSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  appendCell,
  computeContentKey,
  createCellCache,
  createConfiguredProviders,
  createMockJudge,
  createMockProvider,
  createOpenAIJudge,
  createRun,
  createStructuralJudge,
  defaultCacheRoot,
  defaultRegistryRoot,
  hashCellKey,
  judgeRubricId,
  loadActiveOverrides,
  loadConfig,
  parseCasesJsonl,
  renderPrompt,
  resolveCriteria,
  updateManifest,
  type ActiveOverride,
  type Case,
  type CellCache,
  type CellCacheKey,
  type CellCacheValue,
  type CellResult,
  type Config,
  type Judge,
  type JudgeResult,
  type ModelId,
  type Provider,
  type RunSummary,
  type Verdict,
} from '../../../shared/src/index.ts';

const DEFAULT_CONFIG = 'rubric.config.json';
const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_CONCURRENCY = 4;

export interface WatchOptions {
  configPath?: string;
  cwd?: string;
  mock?: boolean;
  /** Override config.concurrency. */
  concurrency?: number;
  /** Disable the cell cache (every iteration re-evals). Default: false. */
  noCache?: boolean;
  /** Override the cache root (tests). */
  cacheRoot?: string;
  /** Override the registry root (tests). */
  registryRoot?: string;
  /** Override the overrides-log root (tests). */
  overridesRoot?: string;
  /** Override the debounce window (tests; defaults to 500ms). */
  debounceMs?: number;
  /** Output stream for the terminal UI. Defaults to process.stdout. */
  write?: (line: string) => void;
  /**
   * Single-iteration mode: run once against the current files and return,
   * rather than installing watchers. Used by tests and by future
   * `rubric watch --once` invocations.
   */
  once?: boolean;
  /** Internal seam: test hook fired after each iteration settles. */
  onIteration?: (report: IterationReport) => void;
}

export interface WatchResult {
  /** Registry run id (one per watch session). */
  runId: string;
  /** Number of iterations that completed (Promise-wise; aborted runs don't count). */
  iterations: number;
  /** Exit code. 0 on graceful shutdown. */
  exitCode: number;
}

export interface IterationReport {
  /** 1-indexed iteration number within this watch session. */
  iteration: number;
  summary: RunSummary;
  cacheHits: number;
  cacheMisses: number;
  wallMs: number;
  aborted: boolean;
  /** Number of cells whose displayed verdict was overridden by an active override. */
  overridesApplied: number;
}

type State = 'idle' | 'debouncing' | 'planning' | 'running';

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function verdictGlyph(v: Verdict): string {
  if (v === 'b') return 'win';
  if (v === 'a') return 'loss';
  return 'tie';
}

function buildProviders(mock: boolean, config: Config, baseDir: string): Provider[] {
  if (mock) return [createMockProvider({ acceptAll: true })];
  return createConfiguredProviders(config.providers, baseDir);
}

function buildJudge(mock: boolean, config: Config, providers: Provider[], criteriaText: string, originalCriteria: Config['judge']['criteria']): Judge {
  if (mock) return createMockJudge({ verdict: 'tie', reason: 'mock judge' });
  if (originalCriteria === 'structural-json') return createStructuralJudge();
  const judgeProvider = providers.find((p) => p.supports(config.judge.model));
  if (!judgeProvider) {
    throw new Error(`no provider accepts judge.model "${config.judge.model}"`);
  }
  return createOpenAIJudge({ provider: judgeProvider, model: config.judge.model, criteria: criteriaText });
}

interface PlannedCell {
  caseIndex: number;
  model: ModelId;
  key: CellCacheKey;
}

function planCells(args: {
  cases: Case[];
  config: Config;
  prompts: { baseline: string; candidate: string };
  criteriaText: string;
}): PlannedCell[] {
  const { cases, config, prompts, criteriaText } = args;
  const rubricId = judgeRubricId(criteriaText);
  const cells: PlannedCell[] = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i] as Case;
    for (const model of config.models) {
      const promptA = renderPrompt(prompts.baseline, c);
      const promptB = renderPrompt(prompts.candidate, c);
      cells.push({
        caseIndex: i,
        model,
        key: {
          promptA,
          promptB,
          inputText: c.input,
          modelA: model,
          modelB: model,
          judgeModelId: config.judge.model,
          judgeRubricId: rubricId,
        },
      });
    }
  }
  return cells;
}

async function evalCell(
  planned: PlannedCell,
  providers: Provider[],
  judge: Judge,
  criteriaText: string,
  caseExpected: string | undefined,
  signal: AbortSignal,
): Promise<CellCacheValue> {
  const provider = providers.find((p) => p.supports(planned.model));
  if (!provider) throw new Error(`no provider for ${planned.model}`);

  const [outA, outB] = await Promise.all([
    provider.generate({ modelId: planned.model, prompt: planned.key.promptA, signal }),
    provider.generate({ modelId: planned.model, prompt: planned.key.promptB, signal }),
  ]);
  const verdict: JudgeResult = await judge.judge({
    caseInput: planned.key.inputText,
    ...(caseExpected !== undefined ? { expected: caseExpected } : {}),
    outputA: outA.text,
    outputB: outB.text,
    criteria: criteriaText,
  });
  return { outputA: outA.text, outputB: outB.text, judge: verdict };
}

/**
 * Bounded-parallel map that also respects an abort signal. Workers that see
 * the signal tripped short-circuit to an aborted result instead of starting
 * a new cell.
 */
async function mapBounded<T, R>(
  items: T[],
  limit: number,
  signal: AbortSignal,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<R | { aborted: true; index: number }>> {
  const results = new Array<R | { aborted: true; index: number }>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      if (signal.aborted) {
        results[i] = { aborted: true, index: i };
        continue;
      }
      const item = items[i] as T;
      try {
        results[i] = await fn(item, i);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError' || signal.aborted) {
          results[i] = { aborted: true, index: i };
        } else {
          throw err;
        }
      }
    }
  };
  const w = Math.min(Math.max(1, limit), Math.max(1, items.length));
  await Promise.all(Array.from({ length: w }, () => worker()));
  return results;
}

interface RunIterationArgs {
  iteration: number;
  cases: Case[];
  prompts: { baseline: string; candidate: string };
  config: Config;
  resolvedConfig: Config;
  criteriaText: string;
  providers: Provider[];
  judge: Judge;
  cache: CellCache;
  concurrency: number;
  signal: AbortSignal;
  write: (line: string) => void;
  onCellDone: (cell: CellResult) => void;
  /** Active overrides keyed by contentKey; empty map if none. */
  overrides: Map<string, ActiveOverride>;
}

async function runIteration(args: RunIterationArgs): Promise<IterationReport> {
  const started = Date.now();
  const plan = planCells({
    cases: args.cases,
    config: args.config,
    prompts: args.prompts,
    criteriaText: args.criteriaText,
  });

  args.write(`\n  iteration ${args.iteration} — ${plan.length} cells, concurrency ${args.concurrency}\n`);

  const cells: CellResult[] = [];
  let wins = 0, losses = 0, ties = 0, errors = 0;
  let hits = 0, misses = 0;
  let aborted = false;
  let overridesApplied = 0;

  const results = await mapBounded(plan, args.concurrency, args.signal, async (p, index) => {
    const lookup = args.cache.lookup(p.key);
    const cellStarted = Date.now();
    let value: CellCacheValue;
    let fromCache = false;
    if (lookup.hit && lookup.value) {
      value = lookup.value;
      fromCache = true;
      hits++;
    } else {
      misses++;
      const c = args.cases[p.caseIndex] as Case;
      value = await evalCell(p, args.providers, args.judge, args.criteriaText, c.expected, args.signal);
      // Only cache successful verdicts — error verdicts shouldn't poison the cache.
      args.cache.write(p.key, value);
    }
    const cell: CellResult = {
      caseIndex: p.caseIndex,
      model: p.model,
      outputA: value.outputA,
      outputB: value.outputB,
      judge: value.judge,
      latencyMs: Date.now() - cellStarted,
    };
    // Content-addressed override lookup. Matches what `rubric disagree` wrote.
    const contentKey = computeContentKey({
      promptA: p.key.promptA,
      promptB: p.key.promptB,
      inputText: p.key.inputText,
      modelA: p.key.modelA,
      modelB: p.key.modelB,
      judgeModelId: p.key.judgeModelId,
      judgeRubricId: p.key.judgeRubricId,
    });
    const override = args.overrides.get(contentKey);
    const tag = fromCache ? '·' : '▸';
    if ('error' in cell.judge) {
      errors++;
      args.write(`    ${tag} [${index + 1}/${plan.length}] case-${p.caseIndex} ${p.model} err: ${cell.judge.error}\n`);
    } else {
      const judgeV = cell.judge.winner;
      const effectiveV: Verdict = override ? override.verdict : judgeV;
      if (effectiveV === 'b') wins++;
      else if (effectiveV === 'a') losses++;
      else ties++;
      if (override) {
        overridesApplied++;
        const disagreeSuffix = override.verdict !== judgeV
          ? ` (→judge: ${verdictGlyph(judgeV)}, you: ${verdictGlyph(override.verdict)}${override.reason ? `, "${override.reason}"` : ''})`
          : ` (override agrees)`;
        args.write(`    ${tag}✎ [${index + 1}/${plan.length}] case-${p.caseIndex} ${p.model} ${verdictGlyph(effectiveV)}${disagreeSuffix}\n`);
      } else {
        args.write(`    ${tag} [${index + 1}/${plan.length}] case-${p.caseIndex} ${p.model} ${verdictGlyph(judgeV)}\n`);
      }
    }
    return cell;
  });

  for (const r of results) {
    if (r && typeof r === 'object' && 'aborted' in r) {
      aborted = true;
      continue;
    }
    const cell = r as CellResult;
    cells.push(cell);
    args.onCellDone(cell);
  }

  const decisive = wins + losses;
  const summary: RunSummary = {
    wins, losses, ties, errors,
    winRate: decisive === 0 ? 0 : wins / decisive,
  };

  const wallMs = Date.now() - started;
  const cacheTotal = hits + misses;
  const hitPct = cacheTotal === 0 ? 0 : hits / cacheTotal;
  const overrideSuffix = overridesApplied > 0 ? ` · overrides ${overridesApplied}` : '';
  if (aborted) {
    args.write(`\n  ✗ iteration ${args.iteration} aborted (${cells.length}/${plan.length} cells, ${fmtDuration(wallMs)})\n`);
  } else {
    args.write(
      `\n  ✓ iteration ${args.iteration}: ${wins}W ${losses}L ${ties}T ${errors}E · ` +
      `winRate ${fmtPct(summary.winRate)} · cache ${hits}/${cacheTotal} (${fmtPct(hitPct)})${overrideSuffix} · ${fmtDuration(wallMs)}\n`,
    );
  }

  return {
    iteration: args.iteration,
    summary,
    cacheHits: hits,
    cacheMisses: misses,
    wallMs,
    aborted,
    overridesApplied,
  };
}

function loadPromptsAndDataset(config: Config, paths: { baseline: string; candidate: string; dataset: string }) {
  const prompts = {
    baseline: readFileSync(paths.baseline, 'utf8'),
    candidate: readFileSync(paths.candidate, 'utf8'),
  };
  const datasetText = readFileSync(paths.dataset, 'utf8');
  const cases = parseCasesJsonl(datasetText);
  return { prompts, datasetText, cases };
}

export async function runWatch(opts: WatchOptions = {}): Promise<WatchResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, DEFAULT_CONFIG);
  const mock = opts.mock ?? false;
  const write = opts.write ?? ((line: string) => process.stdout.write(line));
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const loaded = loadConfig(configPath);
  for (const w of loaded.warnings) write(`  ⚠ config: ${w}\n`);
  const criteriaText = resolveCriteria(loaded.config.judge.criteria, loaded.baseDir);
  const resolvedConfig: Config = {
    ...loaded.config,
    judge: { ...loaded.config.judge, criteria: { custom: criteriaText } },
  };
  const concurrency = opts.concurrency ?? loaded.config.concurrency ?? DEFAULT_CONCURRENCY;
  const providers = buildProviders(mock, loaded.config, loaded.baseDir);
  const judge = buildJudge(mock, resolvedConfig, providers, criteriaText, loaded.config.judge.criteria);
  const cache = createCellCache({
    disabled: opts.noCache === true,
    ...(opts.cacheRoot !== undefined ? { root: opts.cacheRoot } : {}),
  });

  const registryRoot = opts.registryRoot ?? defaultRegistryRoot();

  const initial = loadPromptsAndDataset(loaded.config, loaded.resolved);

  write(`rubric watch — ${basename(loaded.resolved.baseline)} vs ${basename(loaded.resolved.candidate)}\n`);
  write(`  config:      ${loaded.path}\n`);
  write(`  cases:       ${initial.cases.length}\n`);
  write(`  models:      ${loaded.config.models.join(', ')}\n`);
  write(`  judge:       ${loaded.config.judge.model}\n`);
  write(`  mode:        ${mock ? 'mock' : 'live'}\n`);
  write(`  cache:       ${opts.noCache ? 'disabled' : cache.root}\n`);
  write(`  concurrency: ${concurrency}\n`);

  const run = createRun({
    root: registryRoot,
    config: loaded.config,
    configPath: loaded.path,
    prompts: initial.prompts,
    datasetText: initial.datasetText,
    plannedCells: initial.cases.length * loaded.config.models.length,
    note: 'watch session',
  });
  const runId = run.id;
  updateManifest(registryRoot, runId, { status: 'running' });
  write(`  run id:      ${runId}\n`);

  let state: State = 'idle';
  let iterations = 0;
  let completedIterations = 0;
  let abortCtl: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watchers: FSWatcher[] = [];
  let shuttingDown = false;
  let shutdownResolve: (() => void) | null = null;
  const shutdownPromise = new Promise<void>((r) => { shutdownResolve = r; });

  const transition = (next: State): void => {
    state = next;
  };

  const clearDebounce = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const runOnce = async (): Promise<void> => {
    if (shuttingDown) return;
    transition('planning');
    // Reload files every iteration — the whole point is that edits happened.
    let snapshot: ReturnType<typeof loadPromptsAndDataset>;
    try {
      snapshot = loadPromptsAndDataset(loaded.config, loaded.resolved);
    } catch (err) {
      write(`  ⚠ load error: ${err instanceof Error ? err.message : String(err)}\n`);
      transition('idle');
      return;
    }
    transition('running');
    iterations++;
    const myIteration = iterations;
    abortCtl = new AbortController();
    const ctl = abortCtl;

    // Reload overrides every iteration — `rubric disagree` edits between saves
    // should reflect on the very next pass without the user restarting watch.
    let overridesMap: Map<string, ActiveOverride>;
    try {
      overridesMap = loadActiveOverrides(loaded.path, opts.overridesRoot);
    } catch {
      overridesMap = new Map();
    }

    let report: IterationReport;
    try {
      report = await runIteration({
        iteration: myIteration,
        cases: snapshot.cases,
        prompts: snapshot.prompts,
        config: loaded.config,
        resolvedConfig,
        criteriaText,
        providers,
        judge,
        cache,
        concurrency,
        signal: ctl.signal,
        write,
        onCellDone: (cell) => {
          try { appendCell(registryRoot, runId, cell); } catch { /* best-effort */ }
        },
        overrides: overridesMap,
      });
    } catch (err) {
      write(`  ✗ iteration ${myIteration} crashed: ${err instanceof Error ? err.message : String(err)}\n`);
      transition('idle');
      return;
    }

    if (!report.aborted) completedIterations++;
    opts.onIteration?.(report);
    transition('idle');
    if (!shuttingDown) {
      write(`\n  waiting for changes (ctrl-c to exit)…\n`);
    }
  };

  const onFileEvent = (): void => {
    if (shuttingDown) return;
    if (state === 'running' && abortCtl) {
      abortCtl.abort();
      write(`  ↺ change detected — aborting in-flight iteration\n`);
    }
    clearDebounce();
    transition('debouncing');
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runOnce();
    }, debounceMs);
  };

  const installWatchers = (): void => {
    for (const target of [loaded.resolved.baseline, loaded.resolved.candidate]) {
      try {
        const w = fsWatch(target, { persistent: true }, () => onFileEvent());
        watchers.push(w);
      } catch (err) {
        write(`  ⚠ watcher failed on ${target}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  };

  const teardown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    write(`\n  shutting down (${reason}) — completed ${completedIterations} iteration${completedIterations === 1 ? '' : 's'}\n`);
    if (abortCtl) abortCtl.abort();
    clearDebounce();
    for (const w of watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    watchers = [];
    updateManifest(registryRoot, runId, { status: 'complete', finishedAt: new Date().toISOString() });
    shutdownResolve?.();
  };

  // First iteration runs immediately so the user sees output before editing anything.
  await runOnce();

  if (opts.once === true) {
    await teardown('once');
    return { runId, iterations: completedIterations, exitCode: 0 };
  }

  installWatchers();
  write(`\n  waiting for changes (ctrl-c to exit)…\n`);

  const sigint = () => { void teardown('SIGINT'); };
  const sigterm = () => { void teardown('SIGTERM'); };
  process.once('SIGINT', sigint);
  process.once('SIGTERM', sigterm);

  try {
    await shutdownPromise;
  } finally {
    process.removeListener('SIGINT', sigint);
    process.removeListener('SIGTERM', sigterm);
  }

  return { runId, iterations: completedIterations, exitCode: 0 };
}

// Internal exports for tests — narrow seams only.
export const __internal = {
  planCells,
  mapBounded,
  runIteration,
};
