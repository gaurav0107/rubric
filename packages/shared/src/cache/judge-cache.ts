/**
 * Cell-level cache for `rubric watch`.
 *
 * Named "judge cache" in the v2.2 design doc, but it caches the ENTIRE cell
 * (both provider outputs + the judge verdict) keyed on the upstream inputs
 * that determine the answer. One lookup per cell; warm-cache edit loops make
 * zero network calls.
 *
 * Content-addressed by SHA256 of a stable JSON form of the key. Same inputs
 * → same entry → skip both generate calls and the judge call. Cross-project
 * hits are intentional: if two workspaces produce the same 9-field key, the
 * answer is identical by definition.
 *
 * Key fields (all participate in the hash; documented here because the design
 * doc is the authoritative spec):
 *   1. promptA                   — rendered A-side prompt sent to the provider
 *   2. promptB                   — rendered B-side prompt
 *   3. inputText                 — case.input
 *   4. modelA                    — A-side resolved provider/model
 *   5. modelB                    — B-side resolved provider/model (same as A in compare-prompts)
 *   6. judgeModelId              — config.judge.model
 *   7. judgeRubricId             — stable rubric identifier; see `judgeRubricId()` below
 *   8. judgePromptTemplateVersion — bump when `judge.ts` system/user prompt is edited
 *   9. rubricCliMajorVersion     — escape hatch for breaking changes
 *
 * The design doc talks about a singular `promptText`; in practice a cell has
 * two sides, both pinned here so edits to either invalidate correctly.
 *
 * Writes are atomic (tmp → rename). A corrupt read logs miss and returns
 * undefined so the caller re-evals — the bad file is left in place rather
 * than deleted, so ops can inspect it after the fact.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { JudgeResult, ModelId } from '../types.ts';

/** Bump when the judge system+user prompt template in `judge.ts` changes. */
export const JUDGE_PROMPT_TEMPLATE_VERSION = 1;

/** Major version of the rubric CLI. Only the major digit participates. */
export const RUBRIC_CLI_MAJOR_VERSION = 2;

export interface CellCacheKey {
  promptA: string;
  promptB: string;
  inputText: string;
  modelA: ModelId;
  modelB: ModelId;
  judgeModelId: ModelId;
  /** See `judgeRubricId()`. Callers must pass a stable string. */
  judgeRubricId: string;
  judgePromptTemplateVersion?: number;
  rubricCliMajorVersion?: number;
}

export interface CellCacheValue {
  outputA: string;
  outputB: string;
  judge: JudgeResult;
}

export interface CachedCellEntry {
  version: 1;
  /** Full hash key the entry was written under — useful for debugging. */
  keyHash: string;
  modelA: ModelId;
  modelB: ModelId;
  judgeModelId: ModelId;
  writtenAt: string;
  value: CellCacheValue;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Deterministic rubric id from the resolved criteria string.
 *
 *   "default" | "model-comparison" | "structural-json" → passed through (canned)
 *   other strings → sha256("custom:" + text)
 *
 * Callers with `{ custom: "..." }` should pass `criteria.custom`. File-backed
 * rubrics resolve to their file contents upstream; pass those contents here.
 */
export function judgeRubricId(criteria: string): string {
  if (criteria === 'default' || criteria === 'model-comparison' || criteria === 'structural-json') {
    return criteria;
  }
  return sha256('custom:' + criteria);
}

export function hashCellKey(key: CellCacheKey): string {
  // Property order is fixed here — JSON.stringify is deterministic when the
  // input is an object literal with explicit field order.
  const normalized = {
    promptA: key.promptA,
    promptB: key.promptB,
    inputText: key.inputText,
    modelA: key.modelA,
    modelB: key.modelB,
    judgeModelId: key.judgeModelId,
    judgeRubricId: key.judgeRubricId,
    judgePromptTemplateVersion: key.judgePromptTemplateVersion ?? JUDGE_PROMPT_TEMPLATE_VERSION,
    rubricCliMajorVersion: key.rubricCliMajorVersion ?? RUBRIC_CLI_MAJOR_VERSION,
  };
  return sha256(JSON.stringify(normalized));
}

/**
 * Default cache root. Shared across projects on the same machine — if two
 * repos produce the same 9-field key, the answer is identical by definition.
 * Respects RUBRIC_HOME for tests and NFS-mounted team dirs.
 */
export function defaultCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RUBRIC_HOME && env.RUBRIC_HOME.length > 0) {
    return join(env.RUBRIC_HOME, 'cache', 'judge');
  }
  return join(homedir(), '.rubric', 'cache', 'judge');
}

function entryPath(root: string, hash: string): string {
  // Shard by first 2 hex chars so a single dir never grows past a few thousand files.
  return join(root, hash.slice(0, 2), hash + '.json');
}

export interface CellCacheLookup {
  value?: CellCacheValue;
  hit: boolean;
  hash: string;
}

export interface CellCache {
  lookup(key: CellCacheKey): CellCacheLookup;
  write(key: CellCacheKey, value: CellCacheValue): string;
  readonly root: string;
  readonly disabled: boolean;
}

export interface CreateCellCacheOptions {
  root?: string;
  /** Disable reads and writes; every lookup reports miss. Used by tests and `--no-cache`. */
  disabled?: boolean;
}

export function createCellCache(opts: CreateCellCacheOptions = {}): CellCache {
  const root = resolve(opts.root ?? defaultCacheRoot());
  const disabled = opts.disabled === true;

  return {
    root,
    disabled,
    lookup(key: CellCacheKey): CellCacheLookup {
      const hash = hashCellKey(key);
      if (disabled) return { hit: false, hash };
      const p = entryPath(root, hash);
      if (!existsSync(p)) return { hit: false, hash };
      try {
        const raw = readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw) as CachedCellEntry;
        if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
          return { hit: false, hash };
        }
        const v = parsed.value;
        if (!v || typeof v !== 'object' || typeof v.outputA !== 'string' || typeof v.outputB !== 'string' || typeof v.judge !== 'object') {
          return { hit: false, hash };
        }
        return { hit: true, hash, value: v };
      } catch {
        return { hit: false, hash };
      }
    },
    write(key: CellCacheKey, value: CellCacheValue): string {
      const hash = hashCellKey(key);
      if (disabled) return hash;
      const p = entryPath(root, hash);
      mkdirSync(dirname(p), { recursive: true });
      const entry: CachedCellEntry = {
        version: 1,
        keyHash: hash,
        modelA: key.modelA,
        modelB: key.modelB,
        judgeModelId: key.judgeModelId,
        writtenAt: new Date().toISOString(),
        value,
      };
      const serialized = JSON.stringify(entry);
      const tmp = p + '.tmp.' + process.pid + '.' + Date.now();
      writeFileSync(tmp, serialized, 'utf8');
      renameSync(tmp, p);
      return hash;
    },
  };
}
