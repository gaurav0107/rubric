/**
 * Local-first run registry.
 *
 * Every `rubric run` writes to `~/.rubric/runs/<runId>/`:
 *   manifest.json    — static metadata + end state
 *   cells.jsonl      — append-only, one line per completed cell (resumable)
 *   log              — stderr/progress capture
 *   lock             — optional; present while a worker owns the run
 *
 * This module is pure and cwd-free: the CLI passes the registry root
 * explicitly (defaulting to `~/.rubric/runs`) so tests can point at a tmpdir.
 *
 * Design rule: cells.jsonl is the source of truth for per-cell results. The
 * manifest is the cheap-to-stat index. Resume reads cells.jsonl to skip
 * already-completed work; if the manifest says "complete" but cells.jsonl is
 * short, we trust cells.jsonl and heal the manifest on next finalize.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { CellResult, Config, ModelId, RunSummary } from './../types.ts';

export type RunStatus = 'pending' | 'running' | 'complete' | 'failed' | 'abandoned';

export interface RunManifest {
  /** Schema version — future migrations key off this. */
  version: 1;
  id: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  /** Where the config was loaded from, for human-level provenance. */
  configPath?: string;
  /** sha256 of the config object as parsed — stable under re-formatting. */
  configHash: string;
  /** sha256 of the dataset file contents at run start. */
  datasetHash: string;
  /** sha256 of each prompt file at run start. */
  promptsHash: { baseline: string; candidate: string };
  models: ModelId[];
  judgeModel: ModelId;
  /** Total expected cells — set when the plan is known. */
  plannedCells?: number;
  /** Populated when the run finalizes. */
  summary?: RunSummary;
  /** Optional tag/note from the user ("--note refund-classifier-v3"). */
  note?: string;
}

export interface CreateRunOptions {
  root?: string;
  id?: string;
  config: Config;
  configPath?: string;
  /** Contents of baseline/candidate prompt files. */
  prompts: { baseline: string; candidate: string };
  /** Contents of the dataset file (as read from disk). */
  datasetText: string;
  plannedCells?: number;
  note?: string;
}

export class RunRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunRegistryError';
  }
}

/**
 * Default registry root. Respects RUBRIC_HOME if set — useful for tests and
 * for teams sharing a dir on NFS. Falls back to `~/.rubric/runs`.
 */
export function defaultRegistryRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RUBRIC_HOME && env.RUBRIC_HOME.length > 0) {
    return join(env.RUBRIC_HOME, 'runs');
  }
  return join(homedir(), '.rubric', 'runs');
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Generate a sortable run id. Not a full ULID — we avoid the dependency and
 * use a compact `r-<ts>-<random>` shape that sorts lexically in creation order
 * and is URL-safe.
 */
export function generateRunId(now: Date = new Date(), rng: () => Buffer = () => randomBytes(6)): string {
  const ts = now.getTime().toString(36).padStart(9, '0');
  const rnd = rng().toString('base64url').slice(0, 8);
  return `r-${ts}-${rnd}`;
}

function runDir(root: string, id: string): string {
  return join(root, id);
}

export interface RunPaths {
  dir: string;
  manifest: string;
  cells: string;
  log: string;
  lock: string;
}

export function runPaths(root: string, id: string): RunPaths {
  const dir = runDir(root, id);
  return {
    dir,
    manifest: join(dir, 'manifest.json'),
    cells: join(dir, 'cells.jsonl'),
    log: join(dir, 'log'),
    lock: join(dir, 'lock'),
  };
}

export function createRun(opts: CreateRunOptions): { id: string; paths: RunPaths; manifest: RunManifest } {
  const root = resolve(opts.root ?? defaultRegistryRoot());
  const id = opts.id ?? generateRunId();
  const paths = runPaths(root, id);
  mkdirSync(paths.dir, { recursive: true });

  const manifest: RunManifest = {
    version: 1,
    id,
    status: 'pending',
    startedAt: new Date().toISOString(),
    configHash: sha256(JSON.stringify(opts.config)),
    datasetHash: sha256(opts.datasetText),
    promptsHash: {
      baseline: sha256(opts.prompts.baseline),
      candidate: sha256(opts.prompts.candidate),
    },
    models: opts.config.models,
    judgeModel: opts.config.judge.model,
  };
  if (opts.configPath) manifest.configPath = opts.configPath;
  if (opts.plannedCells !== undefined) manifest.plannedCells = opts.plannedCells;
  if (opts.note) manifest.note = opts.note;

  writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  writeFileSync(paths.cells, '', 'utf8');
  writeFileSync(paths.log, '', 'utf8');
  return { id, paths, manifest };
}

export function readManifest(root: string, id: string): RunManifest {
  const p = runPaths(root, id).manifest;
  if (!existsSync(p)) {
    throw new RunRegistryError(`run ${id} not found (no manifest at ${p})`);
  }
  const raw = readFileSync(p, 'utf8');
  return JSON.parse(raw) as RunManifest;
}

export function writeManifest(root: string, id: string, manifest: RunManifest): void {
  const p = runPaths(root, id).manifest;
  writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export function updateManifest(root: string, id: string, patch: Partial<RunManifest>): RunManifest {
  const prev = readManifest(root, id);
  const next: RunManifest = { ...prev, ...patch };
  writeManifest(root, id, next);
  return next;
}

export function appendCell(root: string, id: string, cell: CellResult): void {
  const p = runPaths(root, id).cells;
  appendFileSync(p, JSON.stringify(cell) + '\n', 'utf8');
}

export function readCells(root: string, id: string): CellResult[] {
  const p = runPaths(root, id).cells;
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, 'utf8');
  if (raw.length === 0) return [];
  const out: CellResult[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed) as CellResult);
    } catch {
      // Skip malformed tail lines — an in-progress worker may be mid-write.
    }
  }
  return out;
}

export function appendLog(root: string, id: string, line: string): void {
  const p = runPaths(root, id).log;
  const stamped = line.endsWith('\n') ? line : line + '\n';
  appendFileSync(p, stamped, 'utf8');
}

export function listRuns(root: string = defaultRegistryRoot()): RunManifest[] {
  if (!existsSync(root)) return [];
  const out: RunManifest[] = [];
  for (const entry of readdirSync(root)) {
    const manifest = join(root, entry, 'manifest.json');
    if (!existsSync(manifest)) continue;
    try {
      out.push(JSON.parse(readFileSync(manifest, 'utf8')) as RunManifest);
    } catch {
      // Skip corrupt manifests — surface via `runs show <id>` instead.
    }
  }
  // Newest first.
  out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return out;
}

export function deleteRun(root: string, id: string): void {
  const dir = runDir(root, id);
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Acquire a lock for a run id. Returns the pid that owned the previous lock
 * if there was one, or null if we acquired cleanly. The caller is responsible
 * for freshness checks (is the previous pid still alive?) — this module just
 * records ownership.
 *
 * The lock file contains `<pid>\n<iso-ts>\n`. On cleanup the caller calls
 * `releaseLock()`. If the process dies without releasing, the stale lock is
 * detectable via pid check.
 */
export function acquireLock(root: string, id: string, pid: number = process.pid): { acquired: boolean; previousPid?: number } {
  const p = runPaths(root, id).lock;
  if (existsSync(p)) {
    const raw = readFileSync(p, 'utf8').trim();
    const parts = raw.split('\n');
    const prev = Number(parts[0]);
    if (Number.isFinite(prev) && prev > 0) {
      // Is that pid still alive? On Unix, kill(pid, 0) throws if not.
      let alive = false;
      try {
        process.kill(prev, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) return { acquired: false, previousPid: prev };
    }
    // Stale lock — take it.
  }
  const body = `${pid}\n${new Date().toISOString()}\n`;
  const fd = openSync(p, 'w');
  try {
    writeSync(fd, body);
  } finally {
    closeSync(fd);
  }
  return { acquired: true };
}

export function releaseLock(root: string, id: string): void {
  const p = runPaths(root, id).lock;
  if (existsSync(p)) rmSync(p, { force: true });
}

export interface RunSummaryRow {
  id: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  models: ModelId[];
  judgeModel: ModelId;
  winRate?: number;
  wins?: number;
  losses?: number;
  ties?: number;
  errors?: number;
  cells?: number;
  note?: string;
}

export function toSummaryRow(m: RunManifest): RunSummaryRow {
  const row: RunSummaryRow = {
    id: m.id,
    status: m.status,
    startedAt: m.startedAt,
    models: m.models,
    judgeModel: m.judgeModel,
  };
  if (m.finishedAt) row.finishedAt = m.finishedAt;
  if (m.note) row.note = m.note;
  if (m.summary) {
    row.winRate = m.summary.winRate;
    row.wins = m.summary.wins;
    row.losses = m.summary.losses;
    row.ties = m.summary.ties;
    row.errors = m.summary.errors;
  }
  if (m.plannedCells !== undefined) row.cells = m.plannedCells;
  return row;
}

export function statCellsFile(root: string, id: string): { bytes: number; lines: number } {
  const p = runPaths(root, id).cells;
  if (!existsSync(p)) return { bytes: 0, lines: 0 };
  const s = statSync(p);
  if (s.size === 0) return { bytes: 0, lines: 0 };
  // Cheap line count — newline byte count works because we always terminate.
  const raw = readFileSync(p, 'utf8');
  let lines = 0;
  for (let i = 0; i < raw.length; i++) if (raw[i] === '\n') lines++;
  return { bytes: s.size, lines };
}
