import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Config, ModelId, Rubric } from './types.ts';

export class ConfigError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'ConfigError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateModelId(v: unknown, field: string, path?: string): ModelId {
  if (typeof v !== 'string' || !v.includes('/') || v.startsWith('/') || v.endsWith('/')) {
    throw new ConfigError(`${field} must be a "provider/model" string, got ${JSON.stringify(v)}`, path);
  }
  return v as ModelId;
}

function validateRubric(v: unknown, path?: string): Rubric {
  if (v === 'default' || v === 'model-comparison') return v;
  if (isRecord(v) && typeof v.custom === 'string' && v.custom.length > 0) {
    return { custom: v.custom };
  }
  throw new ConfigError(
    'judge.rubric must be "default", "model-comparison", or { custom: string }',
    path,
  );
}

export function validateConfig(raw: unknown, path?: string): Config {
  if (!isRecord(raw)) throw new ConfigError('config must be a JSON object', path);

  const prompts = raw.prompts;
  if (!isRecord(prompts) || typeof prompts.baseline !== 'string' || typeof prompts.candidate !== 'string') {
    throw new ConfigError('prompts.baseline and prompts.candidate must be strings', path);
  }

  if (typeof raw.dataset !== 'string' || raw.dataset.length === 0) {
    throw new ConfigError('dataset must be a non-empty string (path to JSONL)', path);
  }

  if (!Array.isArray(raw.models) || raw.models.length === 0) {
    throw new ConfigError('models must be a non-empty array of ModelId strings', path);
  }
  const models = raw.models.map((m, i) => validateModelId(m, `models[${i}]`, path));

  const judge = raw.judge;
  if (!isRecord(judge)) throw new ConfigError('judge must be an object', path);
  const judgeModel = validateModelId(judge.model, 'judge.model', path);
  const rubric = validateRubric(judge.rubric, path);

  const out: Config = {
    prompts: { baseline: prompts.baseline, candidate: prompts.candidate },
    dataset: raw.dataset,
    models,
    judge: { model: judgeModel, rubric },
  };

  if (raw.concurrency !== undefined) {
    if (typeof raw.concurrency !== 'number' || !Number.isInteger(raw.concurrency) || raw.concurrency < 1) {
      throw new ConfigError('concurrency must be a positive integer', path);
    }
    out.concurrency = raw.concurrency;
  }

  if (raw.mode !== undefined) {
    if (raw.mode !== 'compare-prompts' && raw.mode !== 'compare-models') {
      throw new ConfigError('mode must be "compare-prompts" or "compare-models"', path);
    }
    out.mode = raw.mode;
  }

  return out;
}

export interface LoadedConfig {
  config: Config;
  /** Absolute path the config was loaded from. */
  path: string;
  /** Directory used to resolve relative prompt/dataset paths. */
  baseDir: string;
  /** Absolute paths after resolving relative to baseDir. */
  resolved: {
    baseline: string;
    candidate: string;
    dataset: string;
  };
}

function resolveFrom(baseDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

export function loadConfig(configPath: string): LoadedConfig {
  const abs = resolve(configPath);
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`failed to read config (${msg})`, abs);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`invalid JSON (${msg})`, abs);
  }
  if (isRecord(parsed) && '$schema' in parsed) {
    // allow and ignore $schema for editor tooling
    delete (parsed as Record<string, unknown>).$schema;
  }

  const config = validateConfig(parsed, abs);
  const baseDir = dirname(abs);

  return {
    config,
    path: abs,
    baseDir,
    resolved: {
      baseline: resolveFrom(baseDir, config.prompts.baseline),
      candidate: resolveFrom(baseDir, config.prompts.candidate),
      dataset: resolveFrom(baseDir, config.dataset),
    },
  };
}
