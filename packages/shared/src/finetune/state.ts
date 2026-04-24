/**
 * Per-job state for fine-tune orchestration. Lives at
 *   ~/.rubric/finetunes/<name>/state.json
 * and tracks where a job is in the lifecycle (uploaded → queued → running →
 * succeeded → failed). The CLI refreshes this on every `finetune status`
 * call.
 *
 * This module is pure I/O over JSON — no network calls. The OpenAI adapter
 * in `./openai.ts` owns the API side and feeds updates through these
 * functions.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type FinetuneStatus =
  | 'pending'       // config exists, nothing uploaded yet
  | 'prepared'      // training JSONL written to disk
  | 'uploaded'      // file uploaded to provider, job not yet created
  | 'queued'        // job created, waiting to start
  | 'running'       // provider is training
  | 'succeeded'     // training finished, model id available
  | 'failed'        // provider returned an error
  | 'cancelled';    // user cancelled

export interface FinetuneState {
  /** Schema version — future migrations key off this. */
  version: 1;
  /** Job name, mirrors the entry in finetunes.json. */
  name: string;
  status: FinetuneStatus;
  /** Absolute path to the prepared SFT JSONL, when status >= 'prepared'. */
  preparedPath?: string;
  /** Provider's upload id (e.g. OpenAI file id), when status >= 'uploaded'. */
  fileId?: string;
  /** Provider's fine-tune job id, when status >= 'queued'. */
  jobId?: string;
  /** Final trained model id (e.g. ft:...), when status === 'succeeded'. */
  trainedModelId?: string;
  /** Last error message, when status === 'failed'. */
  error?: string;
  /** ISO timestamp; touched on every updateState call. */
  updatedAt: string;
  /** Free-form context for humans — not parsed by tooling. */
  note?: string;
}

export function defaultFinetuneRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RUBRIC_HOME && env.RUBRIC_HOME.length > 0) {
    return join(env.RUBRIC_HOME, 'finetunes');
  }
  return join(homedir(), '.rubric', 'finetunes');
}

export function finetuneStateDir(root: string, name: string): string {
  return join(root, name);
}

export function finetuneStatePath(root: string, name: string): string {
  return join(finetuneStateDir(root, name), 'state.json');
}

export function readState(root: string, name: string): FinetuneState | undefined {
  const p = finetuneStatePath(root, name);
  if (!existsSync(p)) return undefined;
  const raw = readFileSync(p, 'utf8');
  return JSON.parse(raw) as FinetuneState;
}

export function writeState(root: string, state: FinetuneState): void {
  const dir = finetuneStateDir(root, state.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(finetuneStatePath(root, state.name), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function updateState(root: string, name: string, patch: Partial<Omit<FinetuneState, 'version' | 'name'>>): FinetuneState {
  const prev = readState(root, name) ?? {
    version: 1 as const,
    name,
    status: 'pending' as FinetuneStatus,
    updatedAt: new Date().toISOString(),
  };
  const next: FinetuneState = { ...prev, ...patch, version: 1, name, updatedAt: new Date().toISOString() };
  writeState(root, next);
  return next;
}

export function listStates(root: string): FinetuneState[] {
  if (!existsSync(root)) return [];
  const out: FinetuneState[] = [];
  for (const entry of readdirSync(root)) {
    const p = finetuneStatePath(root, entry);
    if (!existsSync(p)) continue;
    try {
      out.push(JSON.parse(readFileSync(p, 'utf8')) as FinetuneState);
    } catch {
      // Skip corrupt state files — surface via `finetune status <name>`.
    }
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/**
 * Terminal states never flip back to an active state. Used by the CLI to
 * avoid hammering the provider with status polls for jobs that are done.
 */
export function isTerminal(s: FinetuneStatus): boolean {
  return s === 'succeeded' || s === 'failed' || s === 'cancelled';
}
