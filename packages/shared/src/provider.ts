import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { ModelId } from './types.ts';

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
  /** Optional override; defaults to process.env.OPENAI_API_KEY. */
  baseURL?: string;
}

export function createOpenAIProvider(opts: OpenAIProviderOptions = {}): Provider {
  const apiKey = opts.apiKey ?? (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : undefined);
  const providerOpts: OpenAICompatibleOptions = {
    name: 'openai',
    prefix: 'openai',
    ...(apiKey ? { apiKey } : {}),
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    keyHint: 'set OPENAI_API_KEY or pass { apiKey } to createOpenAIProvider()',
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

      const callOpts: Parameters<typeof generateText>[0] = {
        model: client(model),
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
