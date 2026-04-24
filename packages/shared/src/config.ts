import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Config, ModelId, ProviderConfig, Rubric } from './types.ts';

const PROVIDER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RESERVED_PROVIDER_NAMES = new Set(['openai', 'groq', 'openrouter', 'ollama']);

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

function validateProviders(v: unknown, path?: string): ProviderConfig[] {
  if (!Array.isArray(v)) {
    throw new ConfigError('providers must be an array', path);
  }
  const out: ProviderConfig[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < v.length; i++) {
    const raw = v[i];
    const fld = `providers[${i}]`;
    if (!isRecord(raw)) {
      throw new ConfigError(`${fld} must be an object`, path);
    }

    // Security rule: inline `key` is rejected with a loud error. Operators
    // must use keyEnv or keyFile so tokens never live in config files.
    if ('key' in raw) {
      throw new ConfigError(
        `${fld}.key is not permitted — tokens must come from keyEnv (env var) or keyFile (gitignored path), never inline`,
        path,
      );
    }

    const { name, baseUrl, wireFormat, keyEnv, keyFile, headers } = raw as Record<string, unknown>;

    if (typeof name !== 'string' || !PROVIDER_NAME_RE.test(name)) {
      throw new ConfigError(
        `${fld}.name must match /^[a-z0-9][a-z0-9-]{0,31}$/ (lowercase letters/digits/dashes, ≤32 chars)`,
        path,
      );
    }
    if (RESERVED_PROVIDER_NAMES.has(name)) {
      throw new ConfigError(
        `${fld}.name "${name}" collides with a built-in provider — choose a different name`,
        path,
      );
    }
    if (seen.has(name)) {
      throw new ConfigError(`${fld}.name "${name}" is declared more than once`, path);
    }
    seen.add(name);

    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
      throw new ConfigError(`${fld}.baseUrl must be a non-empty URL`, path);
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      throw new ConfigError(`${fld}.baseUrl must start with http:// or https://`, path);
    }

    if (wireFormat !== undefined && wireFormat !== 'openai-chat') {
      throw new ConfigError(
        `${fld}.wireFormat: only "openai-chat" is supported (got ${JSON.stringify(wireFormat)})`,
        path,
      );
    }

    const hasEnv = typeof keyEnv === 'string' && keyEnv.length > 0;
    const hasFile = typeof keyFile === 'string' && keyFile.length > 0;
    if (hasEnv && hasFile) {
      throw new ConfigError(`${fld}: set exactly one of keyEnv or keyFile, not both`, path);
    }
    if (!hasEnv && !hasFile) {
      throw new ConfigError(`${fld}: one of keyEnv or keyFile is required`, path);
    }

    const entry: ProviderConfig = { name, baseUrl };
    if (wireFormat !== undefined) entry.wireFormat = wireFormat as 'openai-chat';
    if (hasEnv) entry.keyEnv = keyEnv as string;
    if (hasFile) entry.keyFile = keyFile as string;

    if (headers !== undefined) {
      if (!isRecord(headers)) {
        throw new ConfigError(`${fld}.headers must be an object of string → string`, path);
      }
      const hdrs: Record<string, string> = {};
      for (const [k, val] of Object.entries(headers)) {
        if (typeof val !== 'string') {
          throw new ConfigError(`${fld}.headers.${k} must be a string`, path);
        }
        hdrs[k] = val;
      }
      if (Object.keys(hdrs).length > 0) entry.headers = hdrs;
    }

    out.push(entry);
  }
  return out;
}

function validateRubric(v: unknown, path?: string): Rubric {
  if (v === 'default' || v === 'model-comparison' || v === 'structural-json') return v;
  if (isRecord(v) && typeof v.custom === 'string' && v.custom.length > 0) {
    return { custom: v.custom };
  }
  if (isRecord(v) && typeof v.file === 'string' && v.file.length > 0) {
    return { file: v.file };
  }
  throw new ConfigError(
    'judge.rubric must be "default", "model-comparison", "structural-json", { custom: string }, or { file: string }',
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

  if (raw.providers !== undefined) {
    out.providers = validateProviders(raw.providers, path);
  }

  return out;
}

/**
 * Flatten a Rubric into the plain-text form the judge/grader consumes.
 *
 * - string rubrics ("default" | "model-comparison") pass through verbatim;
 *   the judge implementation resolves them against its built-in rubric map.
 * - { custom } inlines the rubric text.
 * - { file } loads the rubric text from `path` (resolved against baseDir).
 *
 * Callers that previously did `typeof rubric === 'string' ? rubric :
 * rubric.custom` should switch to this helper so shared-rubric-file configs
 * work transparently.
 */
export function resolveRubric(rubric: Rubric, baseDir: string): string {
  if (typeof rubric === 'string') return rubric;
  if ('custom' in rubric) return rubric.custom;
  const filePath = isAbsolute(rubric.file) ? rubric.file : resolve(baseDir, rubric.file);
  try {
    return readFileSync(filePath, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`failed to read rubric file (${msg})`, filePath);
  }
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
