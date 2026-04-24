/**
 * Fine-tune orchestration config.
 *
 * rubric treats fine-tunes as first-class — every run can point at a custom
 * model the user trained, and the CLI knows how to go from "I have cases
 * labelled by my judge" to "I have a base + candidate fine-tune I can run
 * through the usual eval pipeline."
 *
 * Config lives at `finetunes.json` next to `rubric.config.json`:
 *
 *   {
 *     "version": 1,
 *     "jobs": [
 *       {
 *         "name": "refund-classifier",
 *         "base": "openai/gpt-4o-mini",
 *         "trainData": "data/cases.jsonl",
 *         "validData": "data/validation.jsonl",
 *         "promptTemplate": "prompts/candidate.md",
 *         "hyper": { "nEpochs": 3, "batchSize": 1 },
 *         "expose": "openai/ft:refund-classifier"
 *       }
 *     ]
 *   }
 *
 * We deliberately keep this a plain JSON file — no YAML dep — so it round-
 * trips through the existing share/pull bundle machinery unchanged.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';

export interface FinetuneJob {
  /** Stable identifier — the state dir is keyed on this. */
  name: string;
  /** Base model (must be fine-tunable; today that's OpenAI SFT-eligible models). */
  base: string;
  /**
   * Source JSONL of training data. Each line is a Case-shaped record whose
   * `input`/`expected` drive message generation. Must exist at prepare time.
   */
  trainData: string;
  /** Optional held-out validation set; same shape as trainData. */
  validData?: string;
  /**
   * Prompt file whose contents are templated into the `user` role for every
   * training example. Usually `prompts/candidate.md`.
   */
  promptTemplate: string;
  /** Hyperparameters forwarded to the provider's fine-tune API. */
  hyper?: FinetuneHyper;
  /**
   * Alias the launched model should expose to the rest of rubric. Defaults
   * to "openai/ft:<name>". The launched job's real id (e.g. `ft:...`) is
   * resolved to this alias in the provider layer so configs can pin by name
   * without churning every time a job is re-launched.
   */
  expose?: string;
  /** Optional one-line description — surfaced in `finetune status`. */
  note?: string;
}

export interface FinetuneHyper {
  nEpochs?: number;
  batchSize?: number;
  learningRateMultiplier?: number;
}

export interface FinetuneConfig {
  version: 1;
  jobs: FinetuneJob[];
}

export class FinetuneConfigError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = 'FinetuneConfigError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateFinetuneConfig(raw: unknown, pathForError?: string): FinetuneConfig {
  if (!isRecord(raw)) throw new FinetuneConfigError('expected a JSON object', pathForError);
  if (raw.version !== 1) {
    throw new FinetuneConfigError(`unsupported version ${JSON.stringify(raw.version)} (expected 1)`, pathForError);
  }
  if (!Array.isArray(raw.jobs)) {
    throw new FinetuneConfigError('`jobs` must be an array', pathForError);
  }
  const seen = new Set<string>();
  const jobs: FinetuneJob[] = [];
  for (let i = 0; i < raw.jobs.length; i++) {
    const j = raw.jobs[i];
    if (!isRecord(j)) throw new FinetuneConfigError(`jobs[${i}] must be an object`, pathForError);
    const name = j.name;
    const base = j.base;
    const trainData = j.trainData;
    const promptTemplate = j.promptTemplate;
    if (typeof name !== 'string' || name.length === 0) {
      throw new FinetuneConfigError(`jobs[${i}].name must be a non-empty string`, pathForError);
    }
    if (/[^a-zA-Z0-9_.-]/.test(name)) {
      throw new FinetuneConfigError(
        `jobs[${i}].name "${name}" contains invalid characters (use [a-zA-Z0-9_.-])`,
        pathForError,
      );
    }
    if (seen.has(name)) {
      throw new FinetuneConfigError(`duplicate job name "${name}"`, pathForError);
    }
    seen.add(name);
    if (typeof base !== 'string' || base.length === 0) {
      throw new FinetuneConfigError(`jobs[${i}].base must be a non-empty string`, pathForError);
    }
    if (typeof trainData !== 'string' || trainData.length === 0) {
      throw new FinetuneConfigError(`jobs[${i}].trainData must be a non-empty string`, pathForError);
    }
    if (typeof promptTemplate !== 'string' || promptTemplate.length === 0) {
      throw new FinetuneConfigError(`jobs[${i}].promptTemplate must be a non-empty string`, pathForError);
    }
    const job: FinetuneJob = { name, base, trainData, promptTemplate };
    if (typeof j.validData === 'string' && j.validData.length > 0) job.validData = j.validData;
    if (typeof j.expose === 'string' && j.expose.length > 0) job.expose = j.expose;
    if (typeof j.note === 'string' && j.note.length > 0) job.note = j.note;
    if (isRecord(j.hyper)) {
      const h: FinetuneHyper = {};
      if (typeof j.hyper.nEpochs === 'number' && Number.isFinite(j.hyper.nEpochs) && j.hyper.nEpochs > 0) {
        h.nEpochs = Math.floor(j.hyper.nEpochs);
      }
      if (typeof j.hyper.batchSize === 'number' && Number.isFinite(j.hyper.batchSize) && j.hyper.batchSize > 0) {
        h.batchSize = Math.floor(j.hyper.batchSize);
      }
      if (typeof j.hyper.learningRateMultiplier === 'number' && Number.isFinite(j.hyper.learningRateMultiplier) && j.hyper.learningRateMultiplier > 0) {
        h.learningRateMultiplier = j.hyper.learningRateMultiplier;
      }
      if (Object.keys(h).length > 0) job.hyper = h;
    }
    jobs.push(job);
  }
  return { version: 1, jobs };
}

export interface LoadedFinetuneConfig {
  config: FinetuneConfig;
  path: string;
  baseDir: string;
  /** Absolute paths derived from each job, for convenience. */
  resolved: Array<{ name: string; trainData: string; validData?: string; promptTemplate: string }>;
}

function resolveFrom(baseDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

export function loadFinetuneConfig(configPath: string): LoadedFinetuneConfig {
  const abs = resolve(configPath);
  if (!existsSync(abs)) {
    throw new FinetuneConfigError(`finetune config not found at ${abs}`, abs);
  }
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (err) {
    throw new FinetuneConfigError(
      `failed to read finetune config: ${err instanceof Error ? err.message : String(err)}`,
      abs,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new FinetuneConfigError(
      `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      abs,
    );
  }
  const config = validateFinetuneConfig(parsed, abs);
  const baseDir = dirname(abs);
  const resolved = config.jobs.map((j) => {
    const row: { name: string; trainData: string; validData?: string; promptTemplate: string } = {
      name: j.name,
      trainData: resolveFrom(baseDir, j.trainData),
      promptTemplate: resolveFrom(baseDir, j.promptTemplate),
    };
    if (j.validData) row.validData = resolveFrom(baseDir, j.validData);
    return row;
  });
  return { config, path: abs, baseDir, resolved };
}

export function findJob(config: FinetuneConfig, name: string): FinetuneJob {
  const hit = config.jobs.find((j) => j.name === name);
  if (!hit) {
    const available = config.jobs.map((j) => j.name).join(', ') || '(none)';
    throw new FinetuneConfigError(`no job named "${name}" (available: ${available})`);
  }
  return hit;
}

export function defaultExposeAlias(job: FinetuneJob): string {
  return job.expose ?? `openai/ft:${job.name}`;
}
