/**
 * `rubric runs` — inspection commands over the local run registry.
 *
 * Subcommands:
 *   rubric runs list                     — tabulate recent runs
 *   rubric runs show <id>                — render the stored summary
 *   rubric runs diff <a> <b>             — print summary delta
 *   rubric runs status <id>              — print status + progress
 *   rubric runs wait <id>                — block until the run finishes
 *   rubric runs resume <id>              — finish a partial run using cells.jsonl
 *   rubric runs rerun <id>               — re-execute with the same config
 */
import { readFileSync } from 'node:fs';
import {
  acquireLock,
  appendCell,
  completedCellKeys,
  createConfiguredProviders,
  createMockJudge,
  createMockProvider,
  createOpenAIJudge,
  createStructuralJudge,
  defaultRegistryRoot,
  listRuns,
  loadConfig,
  parseCasesJsonl,
  readCells,
  readManifest,
  releaseLock,
  resolveCriteria,
  runEval,
  statCellsFile,
  toSummaryRow,
  updateManifest,
  waitForRun,
  type CellResult,
  type Config,
  type Judge,
  type Provider,
  type RunManifest,
  type RunSummary,
  type RunSummaryRow,
} from '../../../shared/src/index.ts';
import { runRun } from './run.ts';

export interface RunsListOptions {
  registryRoot?: string;
  limit?: number;
  write?: (line: string) => void;
}

function pct(n: number | undefined): string {
  if (n === undefined) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function truncateId(id: string, width: number): string {
  if (id.length <= width) return id.padEnd(width);
  return id.slice(0, width - 1) + '…';
}

export function runRunsList(opts: RunsListOptions = {}): { exitCode: number; rows: RunSummaryRow[] } {
  const root = opts.registryRoot ?? defaultRegistryRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));
  const all = listRuns(root);
  const limit = opts.limit ?? 20;
  const rows = all.slice(0, limit).map((m) => toSummaryRow(m));

  if (rows.length === 0) {
    write(`no runs in ${root}\n`);
    return { exitCode: 0, rows };
  }

  write(`${'id'.padEnd(30)}  ${'status'.padEnd(10)}  ${'started'.padEnd(25)}  ${'win'.padEnd(6)}  models\n`);
  for (const r of rows) {
    const models = r.models.slice(0, 3).join(',') + (r.models.length > 3 ? `+${r.models.length - 3}` : '');
    write(
      `${truncateId(r.id, 30)}  ${r.status.padEnd(10)}  ${r.startedAt.slice(0, 25).padEnd(25)}  ${pct(r.winRate).padEnd(6)}  ${models}\n`,
    );
  }
  return { exitCode: 0, rows };
}

export interface RunsShowOptions {
  id: string;
  registryRoot?: string;
  write?: (line: string) => void;
}

export function runRunsShow(opts: RunsShowOptions): { exitCode: number; manifest: RunManifest } {
  const root = opts.registryRoot ?? defaultRegistryRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));
  const m = readManifest(root, opts.id);
  const { lines } = statCellsFile(root, opts.id);
  write(`run:       ${m.id}\n`);
  write(`status:    ${m.status}\n`);
  write(`started:   ${m.startedAt}\n`);
  if (m.finishedAt) write(`finished:  ${m.finishedAt}\n`);
  write(`models:    ${m.models.join(', ')}\n`);
  write(`judge:     ${m.judgeModel}\n`);
  if (m.note) write(`note:      ${m.note}\n`);
  if (m.plannedCells !== undefined) write(`progress:  ${lines}/${m.plannedCells} cells\n`);
  if (m.summary) {
    write(`\nsummary:\n`);
    write(`  wins:    ${m.summary.wins}\n`);
    write(`  losses:  ${m.summary.losses}\n`);
    write(`  ties:    ${m.summary.ties}\n`);
    write(`  errors:  ${m.summary.errors}\n`);
    write(`  winRate: ${pct(m.summary.winRate)}\n`);
  }
  return { exitCode: 0, manifest: m };
}

export interface RunsStatusOptions {
  id: string;
  registryRoot?: string;
  write?: (line: string) => void;
}

export function runRunsStatus(opts: RunsStatusOptions): { exitCode: number; status: string; done: number; total: number } {
  const root = opts.registryRoot ?? defaultRegistryRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));
  const m = readManifest(root, opts.id);
  const { lines } = statCellsFile(root, opts.id);
  const total = m.plannedCells ?? 0;
  write(`${m.status}  ${lines}/${total}\n`);
  return { exitCode: 0, status: m.status, done: lines, total };
}

export interface RunsDiffOptions {
  a: string;
  b: string;
  registryRoot?: string;
  write?: (line: string) => void;
}

function delta(b: number | undefined, a: number | undefined): string {
  if (a === undefined || b === undefined) return '—';
  const d = b - a;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}`;
}

function deltaPct(b: number | undefined, a: number | undefined): string {
  if (a === undefined || b === undefined) return '—';
  const d = (b - a) * 100;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}pp`;
}

export function runRunsDiff(opts: RunsDiffOptions): { exitCode: number } {
  const root = opts.registryRoot ?? defaultRegistryRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));
  const a = readManifest(root, opts.a);
  const b = readManifest(root, opts.b);
  write(`a:  ${a.id}  (${a.status})\n`);
  write(`b:  ${b.id}  (${b.status})\n`);
  if (a.summary && b.summary) {
    write(`\n              a         b         Δ\n`);
    write(`wins      ${String(a.summary.wins).padStart(5)}     ${String(b.summary.wins).padStart(5)}     ${delta(b.summary.wins, a.summary.wins).padStart(7)}\n`);
    write(`losses    ${String(a.summary.losses).padStart(5)}     ${String(b.summary.losses).padStart(5)}     ${delta(b.summary.losses, a.summary.losses).padStart(7)}\n`);
    write(`ties      ${String(a.summary.ties).padStart(5)}     ${String(b.summary.ties).padStart(5)}     ${delta(b.summary.ties, a.summary.ties).padStart(7)}\n`);
    write(`errors    ${String(a.summary.errors).padStart(5)}     ${String(b.summary.errors).padStart(5)}     ${delta(b.summary.errors, a.summary.errors).padStart(7)}\n`);
    write(`winRate   ${pct(a.summary.winRate).padStart(7)}   ${pct(b.summary.winRate).padStart(7)}   ${deltaPct(b.summary.winRate, a.summary.winRate).padStart(7)}\n`);
  } else {
    write(`\n(one or both runs have no summary yet — both must be complete to diff)\n`);
  }
  return { exitCode: 0 };
}

export interface RunsRerunOptions {
  id: string;
  registryRoot?: string;
  force?: boolean;
  mock?: boolean;
  write?: (line: string) => void;
}

/**
 * Re-execute a run's config with the CURRENT state of the prompts/dataset
 * files on disk. The source manifest is inspected only for the `configPath`
 * — every other input is re-read.
 */
export async function runRunsRerun(opts: RunsRerunOptions): Promise<{ exitCode: number; newRunId?: string }> {
  const root = opts.registryRoot ?? defaultRegistryRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));
  const m = readManifest(root, opts.id);
  if (!m.configPath) {
    write(`run ${m.id} has no configPath — cannot rerun\n`);
    return { exitCode: 1 };
  }
  write(`rerunning ${m.id} using ${m.configPath}\n`);
  const runOpts: Parameters<typeof runRun>[0] = {
    configPath: m.configPath,
    mock: opts.mock ?? false,
    registryRoot: root,
    note: `rerun of ${m.id}`,
  };
  const result = await runRun(runOpts);
  const out: { exitCode: number; newRunId?: string } = { exitCode: result.exitCode };
  if (result.runId) out.newRunId = result.runId;
  return out;
}

export interface RunsWaitOptions {
  id: string;
  registryRoot?: string;
  intervalMs?: number;
  timeoutMs?: number;
  write?: (line: string) => void;
}

/**
 * Block until a run leaves running/pending. Exits 0 on complete, 1 on failed,
 * 124 on timeout (matching `timeout(1)` convention — lets CI scripts tell
 * "it's still running" apart from "it failed").
 */
export async function runRunsWait(opts: RunsWaitOptions): Promise<{ exitCode: number; status: string }> {
  const root = opts.registryRoot ?? defaultRegistryRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));
  const waitOpts: Parameters<typeof waitForRun>[2] = {};
  if (opts.intervalMs !== undefined) waitOpts.intervalMs = opts.intervalMs;
  if (opts.timeoutMs !== undefined) waitOpts.timeoutMs = opts.timeoutMs;
  const final = await waitForRun(root, opts.id, waitOpts);
  write(`${final.status}\n`);
  if (final.status === 'complete') return { exitCode: 0, status: final.status };
  if (final.status === 'running' || final.status === 'pending') {
    // Timed out.
    return { exitCode: 124, status: final.status };
  }
  return { exitCode: 1, status: final.status };
}

export interface RunsResumeOptions {
  id: string;
  registryRoot?: string;
  mock?: boolean;
  concurrency?: number;
  /** Force takeover even if the lock belongs to a live pid. Useful when a worker is known-wedged. */
  force?: boolean;
  write?: (line: string) => void;
}

function buildProvidersForResume(mock: boolean, config: Config, baseDir: string): Provider[] {
  if (mock) return [createMockProvider({ acceptAll: true })];
  return createConfiguredProviders(config.providers, baseDir);
}

function buildJudgeForResume(mock: boolean, config: Config, providers: Provider[], criteria: string, originalCriteria: Config['judge']['criteria']): Judge {
  if (mock) return createMockJudge({ verdict: 'tie', reason: 'mock judge' });
  if (originalCriteria === 'structural-json') return createStructuralJudge();
  const judgeProvider = providers.find((p) => p.supports(config.judge.model));
  if (!judgeProvider) {
    throw new Error(`no provider accepts judge.model "${config.judge.model}"`);
  }
  return createOpenAIJudge({ provider: judgeProvider, model: config.judge.model, criteria });
}

function summarizeMerged(cells: CellResult[]): RunSummary {
  let wins = 0, losses = 0, ties = 0, errors = 0;
  let totalCostUsd = 0, costedCells = 0;
  let totalLatencyMs = 0, latencyCells = 0;
  for (const cell of cells) {
    if ('error' in cell.judge) errors++;
    else {
      const w = cell.judge.winner;
      if (w === 'b') wins++;
      else if (w === 'a') losses++;
      else ties++;
    }
    if (typeof cell.costUsd === 'number') { totalCostUsd += cell.costUsd; costedCells++; }
    if (typeof cell.latencyMs === 'number') { totalLatencyMs += cell.latencyMs; latencyCells++; }
  }
  const decisive = wins + losses;
  const summary: RunSummary = { wins, losses, ties, errors, winRate: decisive === 0 ? 0 : wins / decisive };
  if (costedCells > 0) { summary.totalCostUsd = totalCostUsd; summary.costedCells = costedCells; }
  if (latencyCells > 0) summary.totalLatencyMs = totalLatencyMs;
  return summary;
}

/**
 * Finish a partially-executed run. Skips every (caseIndex, model[, modelB])
 * tuple already present in cells.jsonl; appends only the missing ones. The
 * manifest is finalized with a summary that merges old + new cells.
 *
 * Uses the run's configPath to re-read prompts/dataset from disk. If those
 * files drift between detach and resume, the resumed cells will reflect the
 * new prompts — we don't try to freeze the workspace, we just record it in
 * the manifest hashes for provenance.
 */
export async function runRunsResume(opts: RunsResumeOptions): Promise<{ exitCode: number; newCells: number; totalCells: number }> {
  const root = opts.registryRoot ?? defaultRegistryRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));
  const manifest = readManifest(root, opts.id);
  if (!manifest.configPath) {
    write(`run ${opts.id} has no configPath — cannot resume\n`);
    return { exitCode: 1, newCells: 0, totalCells: 0 };
  }

  const lock = acquireLock(root, opts.id);
  if (!lock.acquired && !opts.force) {
    write(`run ${opts.id} is locked by pid ${lock.previousPid} (pass --force to take over)\n`);
    return { exitCode: 1, newCells: 0, totalCells: 0 };
  }

  try {
    const loaded = loadConfig(manifest.configPath);
    const prompts = {
      baseline: readFileSync(loaded.resolved.baseline, 'utf8'),
      candidate: readFileSync(loaded.resolved.candidate, 'utf8'),
    };
    const datasetText = readFileSync(loaded.resolved.dataset, 'utf8');
    const cases = parseCasesJsonl(datasetText, { allowLangfuse: false });

    const existing = readCells(root, opts.id);
    const skip = completedCellKeys(root, opts.id);
    const plannedTotal = cases.length * loaded.config.models.length;
    write(`resuming ${opts.id}: ${existing.length}/${plannedTotal} cells already done, ${plannedTotal - existing.length} remaining\n`);

    if (skip.size >= plannedTotal) {
      const summary = summarizeMerged(existing);
      updateManifest(root, opts.id, { status: 'complete', finishedAt: new Date().toISOString(), summary });
      write(`already complete — finalized manifest\n`);
      return { exitCode: 0, newCells: 0, totalCells: existing.length };
    }

    updateManifest(root, opts.id, { status: 'running' });

    const mock = opts.mock ?? false;
    const criteriaText = resolveCriteria(loaded.config.judge.criteria, loaded.baseDir);
    const resolvedConfig: Config = {
      ...loaded.config,
      judge: { ...loaded.config.judge, criteria: { custom: criteriaText } },
    };
    const providers = buildProvidersForResume(mock, loaded.config, loaded.baseDir);
    const judge = buildJudgeForResume(mock, resolvedConfig, providers, criteriaText, loaded.config.judge.criteria);

    const onCell = (cell: CellResult, p: { done: number; total: number }) => {
      write(`  [${p.done}/${p.total}]\n`);
      try { appendCell(root, opts.id, cell); }
      catch (err) { write(`  ⚠ registry append failed: ${err instanceof Error ? err.message : String(err)}\n`); }
    };

    const runOpts: Parameters<typeof runEval>[0] = {
      config: resolvedConfig,
      cases,
      prompts,
      providers,
      judge,
      onCell,
      skipCellKeys: skip,
    };
    if (opts.concurrency !== undefined) runOpts.concurrency = opts.concurrency;

    let newCells: CellResult[] = [];
    try {
      const res = await runEval(runOpts);
      newCells = res.cells;
    } catch (err) {
      updateManifest(root, opts.id, { status: 'failed', finishedAt: new Date().toISOString() });
      throw err;
    }

    const merged = [...existing, ...newCells];
    const summary = summarizeMerged(merged);
    updateManifest(root, opts.id, { status: 'complete', finishedAt: new Date().toISOString(), summary });
    write(`resume complete: +${newCells.length} new cell(s), ${merged.length} total\n`);
    return { exitCode: 0, newCells: newCells.length, totalCells: merged.length };
  } finally {
    releaseLock(root, opts.id);
  }
}

export function parseCellsForInspect(root: string, id: string): number {
  return readCells(root, id).length;
}
