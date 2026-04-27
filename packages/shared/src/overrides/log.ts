/**
 * Override log — append-only JSONL of user-entered verdict overrides.
 *
 * File layout: `~/.rubric/overrides/<project-slug>.jsonl`. One file per
 * project (keyed on the absolute config path). Each line is either an
 * override or an undo record. Reader collapses the stream to
 * latest-non-undone per contentKey.
 *
 * contentKey is a hash over (promptA, promptB, inputText, modelA, modelB,
 * judgeModelId, judgeRubricId) — identical to the cell cache key MINUS the
 * version fields. An override follows the content, not a specific run id, so
 * editing the candidate prompt invalidates old overrides (same rule as the
 * cache — if the content changed, the override is no longer load-bearing).
 *
 * Conflict resolution: latest wins. `--undo` appends an undo record; no
 * destructive deletes. That gives us a perfect audit trail for v2.3's
 * passive-calibration derivation.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import type { Verdict } from '../types.ts';

export interface OverrideRecord {
  /** Schema version — future migrations key off this. */
  version: 1;
  op: 'override' | 'undo';
  /** ISO-8601 timestamp. */
  ts: string;
  /** Human-readable cell ref like `case-17/openai/gpt-4o`. Informational. */
  cellRef: string;
  /** Stable content hash — drives override-to-cell matching. */
  contentKey: string;
  /** The verdict the user asserts. Ignored for `undo` records. */
  verdict?: Verdict;
  /** User-provided reason. Optional for undo. */
  reason?: string;
  /** Run id the override was first entered against — informational only. */
  runId?: string;
}

export interface OverridesLogPaths {
  /** Directory holding all per-project override logs. */
  dir: string;
  /** Absolute path of this project's log file. */
  file: string;
  /** The slug used in the file name — exposed for debugging/tests. */
  slug: string;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Default overrides root. Respects RUBRIC_HOME for tests and NFS-mounted
 * team dirs. Falls back to `~/.rubric/overrides`.
 */
export function defaultOverridesRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RUBRIC_HOME && env.RUBRIC_HOME.length > 0) {
    return join(env.RUBRIC_HOME, 'overrides');
  }
  return join(homedir(), '.rubric', 'overrides');
}

/**
 * Derive a stable, human-readable slug from the absolute config path.
 * Shape: `<basename-of-baseDir>-<hash8>` — directory name is recoverable at
 * a glance, the 8-hex-char suffix collides with probability ~1/2^32 across a
 * user's projects.
 */
export function projectSlug(absConfigPath: string): string {
  const abs = resolve(absConfigPath);
  const baseDir = dirname(abs);
  const dirName = basename(baseDir) || 'root';
  const hash8 = sha256(abs).slice(0, 8);
  // Sanitize the directory basename — lowercase, alphanumerics + dashes only,
  // no leading dash or dot so the filename behaves across platforms.
  const sane = dirName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  return `${sane}-${hash8}`;
}

export function overridesLogPaths(absConfigPath: string, root: string = defaultOverridesRoot()): OverridesLogPaths {
  const slug = projectSlug(absConfigPath);
  const dir = resolve(root);
  return { dir, file: join(dir, `${slug}.jsonl`), slug };
}

/**
 * Canonical content key. Callers that want to match overrides against a plan
 * cell should build the same key with identical field ordering. The hash
 * MUST match what `packages/shared/src/cache/judge-cache.ts` would compute
 * for the cell without the two version fields — overrides follow content,
 * not CLI major versions.
 */
export interface ContentKeyInput {
  promptA: string;
  promptB: string;
  inputText: string;
  modelA: string;
  modelB: string;
  judgeModelId: string;
  judgeRubricId: string;
}

export function computeContentKey(k: ContentKeyInput): string {
  const normalized = {
    promptA: k.promptA,
    promptB: k.promptB,
    inputText: k.inputText,
    modelA: k.modelA,
    modelB: k.modelB,
    judgeModelId: k.judgeModelId,
    judgeRubricId: k.judgeRubricId,
  };
  return sha256(JSON.stringify(normalized));
}

export interface AppendOverrideInput {
  op: 'override' | 'undo';
  cellRef: string;
  contentKey: string;
  verdict?: Verdict;
  reason?: string;
  runId?: string;
  /** Override the timestamp (tests). */
  now?: Date;
}

export function appendOverride(absConfigPath: string, input: AppendOverrideInput, root: string = defaultOverridesRoot()): OverrideRecord {
  const paths = overridesLogPaths(absConfigPath, root);
  mkdirSync(paths.dir, { recursive: true });
  const record: OverrideRecord = {
    version: 1,
    op: input.op,
    ts: (input.now ?? new Date()).toISOString(),
    cellRef: input.cellRef,
    contentKey: input.contentKey,
  };
  if (input.verdict !== undefined) record.verdict = input.verdict;
  if (input.reason !== undefined) record.reason = input.reason;
  if (input.runId !== undefined) record.runId = input.runId;
  appendFileSync(paths.file, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

/**
 * Read all records in append order. Corrupt lines are skipped silently —
 * matches the registry's read-side rule.
 */
export function readOverrideLog(absConfigPath: string, root: string = defaultOverridesRoot()): OverrideRecord[] {
  const paths = overridesLogPaths(absConfigPath, root);
  if (!existsSync(paths.file)) return [];
  const raw = readFileSync(paths.file, 'utf8');
  if (raw.length === 0) return [];
  const out: OverrideRecord[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === 'object' && parsed.version === 1 && (parsed.op === 'override' || parsed.op === 'undo')) {
        out.push(parsed as OverrideRecord);
      }
    } catch {
      // skip malformed line — append-only file is authoritative and we don't
      // want one bad line to poison override application.
    }
  }
  return out;
}

export interface ActiveOverride {
  contentKey: string;
  cellRef: string;
  verdict: Verdict;
  reason?: string;
  ts: string;
  runId?: string;
}

/**
 * Collapse the append log to the set of currently-active overrides, one per
 * contentKey. Latest-wins: an `undo` record cancels the same contentKey's
 * most-recent override; a subsequent `override` reactivates it.
 */
export function activeOverrides(records: OverrideRecord[]): Map<string, ActiveOverride> {
  const latest = new Map<string, OverrideRecord>();
  for (const r of records) {
    // Append order is trusted; we overwrite in order so the last record for a
    // given contentKey wins regardless of op.
    latest.set(r.contentKey, r);
  }
  const out = new Map<string, ActiveOverride>();
  for (const [key, r] of latest) {
    if (r.op !== 'override') continue;
    if (r.verdict === undefined) continue;
    const active: ActiveOverride = {
      contentKey: key,
      cellRef: r.cellRef,
      verdict: r.verdict,
      ts: r.ts,
    };
    if (r.reason !== undefined) active.reason = r.reason;
    if (r.runId !== undefined) active.runId = r.runId;
    out.set(key, active);
  }
  return out;
}

/**
 * Convenience: `(path, root?) → Map<contentKey, ActiveOverride>`. Used by
 * watch to build its override display layer in one step.
 */
export function loadActiveOverrides(absConfigPath: string, root: string = defaultOverridesRoot()): Map<string, ActiveOverride> {
  return activeOverrides(readOverrideLog(absConfigPath, root));
}

/**
 * Parse a cell ref string `case-<n>/<provider>/<model>` into its parts.
 * Throws on malformed input. Exposed so the disagree command and the watch
 * display format-and-parse through one implementation.
 */
export function parseCellRef(ref: string): { caseIndex: number; modelA: string } {
  const trimmed = ref.trim();
  const slash = trimmed.indexOf('/');
  if (slash === -1) throw new Error(`cell ref "${ref}" must be "case-<N>/<provider>/<model>"`);
  const head = trimmed.slice(0, slash);
  const modelA = trimmed.slice(slash + 1);
  const m = /^case-(\d+)$/.exec(head);
  if (!m || !m[1]) throw new Error(`cell ref "${ref}" has invalid case segment; expected "case-<N>"`);
  if (modelA.length === 0 || !modelA.includes('/')) {
    throw new Error(`cell ref "${ref}" has invalid model segment; expected "<provider>/<model>"`);
  }
  return { caseIndex: Number.parseInt(m[1], 10), modelA };
}

export function formatCellRef(caseIndex: number, modelA: string): string {
  return `case-${caseIndex}/${modelA}`;
}
