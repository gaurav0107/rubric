/**
 * `rubric runs` — inspection commands over the local run registry.
 *
 * Subcommands:
 *   rubric runs list                     — tabulate recent runs
 *   rubric runs show <id>                — render the stored summary
 *   rubric runs diff <a> <b>             — print summary delta
 *   rubric runs status <id>              — print status + progress
 *   rubric runs rerun <id>               — re-execute with the same config
 */
import {
  defaultRegistryRoot,
  listRuns,
  readCells,
  readManifest,
  statCellsFile,
  toSummaryRow,
  type RunManifest,
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

export function parseCellsForInspect(root: string, id: string): number {
  return readCells(root, id).length;
}
