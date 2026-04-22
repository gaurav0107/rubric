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
  let client: OpenAIProvider | null = null;

  const clientOptions: Parameters<typeof createOpenAI>[0] = {};
  if (apiKey) clientOptions.apiKey = apiKey;
  if (opts.baseURL) clientOptions.baseURL = opts.baseURL;

  return {
    name: 'openai',
    supports(modelId: ModelId): boolean {
      try {
        return splitModelId(modelId).providerPrefix === 'openai';
      } catch {
        return false;
      }
    },
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (!apiKey) {
        throw new ProviderNotConfiguredError(
          'openai',
          'set OPENAI_API_KEY or pass { apiKey } to createOpenAIProvider()',
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
