import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { ModelId, ProviderConfig } from './types.ts';

export interface GenerateRequest {
  modelId: ModelId;
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Abort in-flight generation. */
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  /** Provider-reported input tokens, when available. */
  inputTokens?: number;
  outputTokens?: number;
  /** USD cost computed by the adapter, when pricing is known. */
  costUsd?: number;
  latencyMs: number;
  /** The concrete model string the provider received (after id splitting). */
  resolvedModel: string;
}

/**
 * Provider-neutral generation surface. Implementations may wrap the Vercel
 * AI SDK, fetch directly, or mock for tests.
 */
export interface Provider {
  readonly name: string;
  /** Returns true if this provider handles the given ModelId prefix. */
  supports(modelId: ModelId): boolean;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string, hint: string) {
    super(`${provider} provider is not configured: ${hint}`);
    this.name = 'ProviderNotConfiguredError';
  }
}

export function splitModelId(id: ModelId): { providerPrefix: string; model: string } {
  const idx = id.indexOf('/');
  if (idx <= 0 || idx === id.length - 1) {
    throw new Error(`invalid ModelId "${id}" — expected "provider/model"`);
  }
  return { providerPrefix: id.slice(0, idx), model: id.slice(idx + 1) };
}

export interface OpenAIProviderOptions {
  apiKey?: string;
  /**
   * Optional baseURL override. Precedence:
   *   1. opts.baseURL (caller-provided)
   *   2. process.env.OPENAI_PROXY (corporate / Azure gateway URL)
   *   3. AI SDK default (https://api.openai.com/v1)
   *
   * When OPENAI_PROXY is used, an `x-client-app: rubric` header is added —
   * most corp proxies require a client identifier. Caller can override via
   * a user-declared provider in `providers[]` if they need a different one.
   */
  baseURL?: string;
}

/**
 * Resolve the OpenAI API key from env. `OPENAI_KEY` is preferred; falls back
 * to `OPENAI_API_KEY` for back-compat with existing docs / CI configs.
 */
function envOpenAIKey(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env?.OPENAI_KEY || process.env?.OPENAI_API_KEY || undefined;
}

/**
 * Read the OpenAI proxy URL from env. Empty strings count as unset so users
 * can defeat the proxy for one shell session with `OPENAI_PROXY=`.
 */
function envOpenAIProxy(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  const v = process.env?.OPENAI_PROXY;
  return v && v.trim().length > 0 ? v.trim().replace(/\/$/, '') : undefined;
}

export function createOpenAIProvider(opts: OpenAIProviderOptions = {}): Provider {
  const apiKey = opts.apiKey ?? envOpenAIKey();
  const baseURL = opts.baseURL ?? envOpenAIProxy();
  const providerOpts: OpenAICompatibleOptions = {
    name: 'openai',
    prefix: 'openai',
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL, headers: { 'x-client-app': 'rubric' } } : {}),
    keyHint: 'set OPENAI_KEY (or OPENAI_API_KEY) or pass { apiKey } to createOpenAIProvider()',
  };
  return createOpenAICompatibleProvider(providerOpts);
}

export interface OpenAICompatibleOptions {
  /** Human-readable provider name surfaced in errors and logs. */
  name: string;
  /** The `provider/` prefix in ModelId that routes to this provider. */
  prefix: string;
  /** API key — may be omitted for local servers like Ollama. */
  apiKey?: string;
  /** OpenAI-compatible base URL (e.g. https://api.groq.com/openai/v1). */
  baseURL?: string;
  /** Hint surfaced in ProviderNotConfiguredError when apiKey is required. */
  keyHint?: string;
  /**
   * When false, generate() does not require an apiKey. Intended for local
   * OpenAI-compatible servers (Ollama) that accept unauthenticated calls.
   */
  requiresApiKey?: boolean;
  /** Extra request headers passed through on every generate() call. */
  headers?: Record<string, string>;
}

/**
 * Generic OpenAI-compatible provider. Powers openai, groq, openrouter, and
 * ollama — anything that speaks the OpenAI Chat Completions wire format via
 * a base URL. Each concrete factory below plugs in the right name/prefix/URL.
 */
export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): Provider {
  const requiresApiKey = opts.requiresApiKey ?? true;
  let client: OpenAIProvider | null = null;

  const clientOptions: Parameters<typeof createOpenAI>[0] = {};
  if (opts.apiKey) clientOptions.apiKey = opts.apiKey;
  if (opts.baseURL) clientOptions.baseURL = opts.baseURL;
  if (opts.headers && Object.keys(opts.headers).length > 0) clientOptions.headers = opts.headers;

  return {
    name: opts.name,
    supports(modelId: ModelId): boolean {
      try {
        return splitModelId(modelId).providerPrefix === opts.prefix;
      } catch {
        return false;
      }
    },
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (requiresApiKey && !opts.apiKey) {
        throw new ProviderNotConfiguredError(
          opts.name,
          opts.keyHint ?? `${opts.name} requires an apiKey`,
        );
      }
      if (!client) client = createOpenAI(clientOptions);

      const { model } = splitModelId(req.modelId);
      const started = Date.now();

      // Use `client.chat(model)` (legacy /chat/completions) instead of
      // `client(model)` (new /responses endpoint). Corporate proxies like
      // Azure OpenAI behind a gateway typically only expose /chat/completions
      // — `client(model)` would 404 on the /responses path. Every OpenAI-
      // compatible provider we support (Groq, OpenRouter, Ollama) also speaks
      // /chat/completions, so chat() is the universally safe surface.
      const callOpts: Parameters<typeof generateText>[0] = {
        model: client.chat(model),
        prompt: req.prompt,
      };
      if (req.system !== undefined) callOpts.system = req.system;
      if (req.temperature !== undefined) callOpts.temperature = req.temperature;
      if (req.maxOutputTokens !== undefined) callOpts.maxOutputTokens = req.maxOutputTokens;
      if (req.signal) callOpts.abortSignal = req.signal;

      const result = await generateText(callOpts);

      const out: GenerateResult = {
        text: result.text,
        latencyMs: Date.now() - started,
        resolvedModel: model,
      };
      const usage = result.usage;
      if (usage) {
        if (typeof usage.inputTokens === 'number') out.inputTokens = usage.inputTokens;
        if (typeof usage.outputTokens === 'number') out.outputTokens = usage.outputTokens;
      }
      return out;
    },
  };
}

export interface GroqProviderOptions {
  apiKey?: string;
  baseURL?: string;
}

/** Groq — OpenAI-compatible, https://api.groq.com/openai/v1. ModelId prefix: groq/. */
export function createGroqProvider(opts: GroqProviderOptions = {}): Provider {
  const apiKey = opts.apiKey ?? (typeof process !== 'undefined' ? process.env?.GROQ_API_KEY : undefined);
  const compatibleOpts: OpenAICompatibleOptions = {
    name: 'groq',
    prefix: 'groq',
    baseURL: opts.baseURL ?? 'https://api.groq.com/openai/v1',
    keyHint: 'set GROQ_API_KEY or pass { apiKey } to createGroqProvider()',
  };
  if (apiKey) compatibleOpts.apiKey = apiKey;
  return createOpenAICompatibleProvider(compatibleOpts);
}

export interface OpenRouterProviderOptions {
  apiKey?: string;
  baseURL?: string;
}

/**
 * OpenRouter — OpenAI-compatible router across many providers. Model ids
 * carry their own vendor prefix (e.g. openrouter/anthropic/claude-3.5-sonnet),
 * so splitModelId() returns `anthropic/claude-3.5-sonnet` as the model string
 * — which OpenRouter expects verbatim.
 */
export function createOpenRouterProvider(opts: OpenRouterProviderOptions = {}): Provider {
  const apiKey = opts.apiKey ?? (typeof process !== 'undefined' ? process.env?.OPENROUTER_API_KEY : undefined);
  const compatibleOpts: OpenAICompatibleOptions = {
    name: 'openrouter',
    prefix: 'openrouter',
    baseURL: opts.baseURL ?? 'https://openrouter.ai/api/v1',
    keyHint: 'set OPENROUTER_API_KEY or pass { apiKey } to createOpenRouterProvider()',
  };
  if (apiKey) compatibleOpts.apiKey = apiKey;
  return createOpenAICompatibleProvider(compatibleOpts);
}

export interface OllamaProviderOptions {
  /** Defaults to http://localhost:11434/v1. */
  baseURL?: string;
}

/**
 * Ollama — local OpenAI-compatible server. No API key required; generate()
 * skips the configured-check so users can run fully offline. ModelId prefix:
 * ollama/ (e.g. ollama/llama3.1:8b).
 */
export function createOllamaProvider(opts: OllamaProviderOptions = {}): Provider {
  return createOpenAICompatibleProvider({
    name: 'ollama',
    prefix: 'ollama',
    baseURL: opts.baseURL ?? 'http://localhost:11434/v1',
    // Ollama ignores the key but the AI SDK sends one anyway — pass a dummy.
    apiKey: 'ollama',
    requiresApiKey: false,
  });
}

/** Set of provider prefixes reserved for built-in factories. */
export const BUILTIN_PROVIDER_PREFIXES = new Set(['openai', 'groq', 'openrouter', 'ollama']);

/**
 * Convenience: produce the four built-in providers. CLI call sites use this
 * instead of repeating the list at every provider-registration point.
 */
export function createBuiltinProviders(): Provider[] {
  return [
    createOpenAIProvider(),
    createGroqProvider(),
    createOpenRouterProvider(),
    createOllamaProvider(),
  ];
}

/**
 * Produce the full live-mode provider list: the four built-ins plus any
 * user-declared entries from `config.providers`. `baseDir` is the config
 * file's directory, used to resolve `keyFile` paths.
 */
export function createConfiguredProviders(
  userProviders: ProviderConfig[] | undefined,
  baseDir: string,
): Provider[] {
  const out = createBuiltinProviders();
  for (const cfg of userProviders ?? []) {
    out.push(createConfiguredProvider(cfg, baseDir));
  }
  return out;
}

function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolvePath(homedir(), p.slice(2));
  return p;
}

/**
 * Read the bearer token for a user-declared provider from its configured
 * source. Exactly one of `keyEnv` / `keyFile` must be set — the config
 * validator enforces this, but we re-check defensively.
 *
 * `keyFile` paths are resolved relative to `baseDir` (the config file's
 * directory) unless absolute. `~` expands to $HOME. The file contents are
 * trimmed so trailing newlines from `echo`/editors don't poison the token.
 */
export function resolveProviderKey(cfg: ProviderConfig, baseDir: string): string {
  if (cfg.keyEnv && cfg.keyFile) {
    throw new ProviderNotConfiguredError(cfg.name, 'set exactly one of keyEnv or keyFile, not both');
  }
  if (cfg.keyEnv) {
    const v = typeof process !== 'undefined' ? process.env?.[cfg.keyEnv] : undefined;
    if (!v || v.length === 0) {
      throw new ProviderNotConfiguredError(cfg.name, `environment variable ${cfg.keyEnv} is not set`);
    }
    return v;
  }
  if (cfg.keyFile) {
    const expanded = expandTilde(cfg.keyFile);
    const abs = isAbsolute(expanded) ? expanded : resolvePath(baseDir, expanded);
    let raw: string;
    try {
      raw = readFileSync(abs, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderNotConfiguredError(cfg.name, `failed to read keyFile at ${abs}: ${msg}`);
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new ProviderNotConfiguredError(cfg.name, `keyFile at ${abs} is empty`);
    }
    return trimmed;
  }
  throw new ProviderNotConfiguredError(cfg.name, 'missing keyEnv or keyFile');
}

/**
 * Build a Provider from a user-declared `ProviderConfig`. Uses the
 * `openai-chat` wire format under the hood (the only format supported in
 * v1.1), so corp-proxies, Azure APIM, and other gateways fronting
 * OpenAI-compatible backends work with zero custom adapter code.
 *
 * Key resolution is lazy: the token is read on first `generate()` call, not
 * at construction time. This avoids crashing `rubric serve` or other
 * read-only commands just because a config declares a provider whose secret
 * isn't loaded yet.
 */
export function createConfiguredProvider(cfg: ProviderConfig, baseDir: string): Provider {
  let cachedKey: string | null = null;
  let cached: Provider | null = null;

  const buildInner = (): Provider => {
    if (cached) return cached;
    const key = cachedKey ?? resolveProviderKey(cfg, baseDir);
    cachedKey = key;
    const inner: OpenAICompatibleOptions = {
      name: cfg.name,
      prefix: cfg.name,
      baseURL: cfg.baseUrl,
      apiKey: key,
      keyHint: cfg.keyEnv
        ? `set environment variable ${cfg.keyEnv}`
        : cfg.keyFile
        ? `populate secrets file ${cfg.keyFile}`
        : `configure keyEnv or keyFile on providers[].${cfg.name}`,
    };
    if (cfg.headers && Object.keys(cfg.headers).length > 0) inner.headers = { ...cfg.headers };
    cached = createOpenAICompatibleProvider(inner);
    return cached;
  };

  return {
    name: cfg.name,
    supports(modelId: ModelId): boolean {
      try {
        return splitModelId(modelId).providerPrefix === cfg.name;
      } catch {
        return false;
      }
    },
    generate(req: GenerateRequest) {
      return buildInner().generate(req);
    },
  };
}
