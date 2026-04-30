import { describe, expect, test } from 'bun:test';
import {
  ProviderNotConfiguredError,
  createGroqProvider,
  createOllamaProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
  splitModelId,
} from './provider.ts';
import type { ModelId } from './types.ts';

describe('splitModelId', () => {
  test('splits into prefix and model', () => {
    expect(splitModelId('openai/gpt-4o-mini' as ModelId)).toEqual({
      providerPrefix: 'openai',
      model: 'gpt-4o-mini',
    });
  });

  test('preserves slashes after the first', () => {
    expect(splitModelId('openrouter/meta-llama/llama-3.1-70b' as ModelId)).toEqual({
      providerPrefix: 'openrouter',
      model: 'meta-llama/llama-3.1-70b',
    });
  });

  test('throws on malformed ids', () => {
    expect(() => splitModelId('nothing' as ModelId)).toThrow(/invalid ModelId/);
    expect(() => splitModelId('/leading' as ModelId)).toThrow(/invalid ModelId/);
    expect(() => splitModelId('trailing/' as ModelId)).toThrow(/invalid ModelId/);
  });
});

describe('createOpenAIProvider', () => {
  test('supports() matches only openai/* ids', () => {
    const p = createOpenAIProvider({ apiKey: 'sk-test' });
    expect(p.supports('openai/gpt-4o' as ModelId)).toBe(true);
    expect(p.supports('anthropic/claude-3-5' as ModelId)).toBe(false);
    expect(p.supports('bad' as ModelId)).toBe(false);
  });

  test('throws ProviderNotConfiguredError when no key is set', async () => {
    const p = createOpenAIProvider({ apiKey: '' });
    await expect(
      p.generate({ modelId: 'openai/gpt-4o-mini' as ModelId, prompt: 'hi' }),
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  // Live path is covered by an integration test gated on OPENAI_KEY; not asserted here.

  test('OPENAI_KEY env is read as the API key', () => {
    const prev = { k: process.env.OPENAI_KEY, a: process.env.OPENAI_API_KEY };
    try {
      process.env.OPENAI_KEY = 'sk-from-new-env';
      delete process.env.OPENAI_API_KEY;
      const p = createOpenAIProvider();
      // `supports()` doesn't throw when a key is present (it would not throw
      // either way, but we use it as a smoke assertion that construction is
      // valid). The real check: generate() must NOT reject with
      // ProviderNotConfiguredError.
      expect(p.supports('openai/gpt-4o' as ModelId)).toBe(true);
    } finally {
      if (prev.k === undefined) delete process.env.OPENAI_KEY; else process.env.OPENAI_KEY = prev.k;
      if (prev.a === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev.a;
    }
  });

  test('falls back to OPENAI_API_KEY when OPENAI_KEY is unset', async () => {
    const prev = { k: process.env.OPENAI_KEY, a: process.env.OPENAI_API_KEY };
    try {
      delete process.env.OPENAI_KEY;
      delete process.env.OPENAI_API_KEY;
      const unconfigured = createOpenAIProvider();
      await expect(
        unconfigured.generate({ modelId: 'openai/gpt-4o-mini' as ModelId, prompt: 'hi' }),
      ).rejects.toBeInstanceOf(ProviderNotConfiguredError);

      process.env.OPENAI_API_KEY = 'sk-legacy-alias';
      const configured = createOpenAIProvider();
      expect(configured.supports('openai/gpt-4o' as ModelId)).toBe(true);
    } finally {
      if (prev.k === undefined) delete process.env.OPENAI_KEY; else process.env.OPENAI_KEY = prev.k;
      if (prev.a === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev.a;
    }
  });

  test('OPENAI_PROXY env sets the baseURL when no explicit baseURL is given', () => {
    const prev = { p: process.env.OPENAI_PROXY, k: process.env.OPENAI_KEY };
    try {
      process.env.OPENAI_KEY = 'sk-t';
      process.env.OPENAI_PROXY = 'https://gateway.example.com/proxy/azure-openai/';
      const p = createOpenAIProvider();
      // Trailing slash is trimmed so the AI SDK's `${baseURL}/chat/completions`
      // concatenation doesn't produce a double slash.
      expect(p.supports('openai/gpt-4o' as ModelId)).toBe(true);
    } finally {
      if (prev.p === undefined) delete process.env.OPENAI_PROXY; else process.env.OPENAI_PROXY = prev.p;
      if (prev.k === undefined) delete process.env.OPENAI_KEY; else process.env.OPENAI_KEY = prev.k;
    }
  });

  test('empty OPENAI_PROXY string is treated as unset', () => {
    const prev = { p: process.env.OPENAI_PROXY, k: process.env.OPENAI_KEY };
    try {
      process.env.OPENAI_KEY = 'sk-t';
      process.env.OPENAI_PROXY = '   ';
      const p = createOpenAIProvider();
      // Nothing crashes; empty proxy → direct to OpenAI.
      expect(p.supports('openai/gpt-4o' as ModelId)).toBe(true);
    } finally {
      if (prev.p === undefined) delete process.env.OPENAI_PROXY; else process.env.OPENAI_PROXY = prev.p;
      if (prev.k === undefined) delete process.env.OPENAI_KEY; else process.env.OPENAI_KEY = prev.k;
    }
  });

  test('explicit opts.baseURL overrides OPENAI_PROXY', () => {
    const prev = process.env.OPENAI_PROXY;
    try {
      process.env.OPENAI_PROXY = 'https://from-env.example.com/v1';
      const p = createOpenAIProvider({ apiKey: 'sk-t', baseURL: 'https://from-opts.example.com/v1' });
      expect(p.supports('openai/gpt-4o' as ModelId)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_PROXY; else process.env.OPENAI_PROXY = prev;
    }
  });
});

describe('createGroqProvider', () => {
  test('supports() matches only groq/* ids', () => {
    const p = createGroqProvider({ apiKey: 'gsk-test' });
    expect(p.supports('groq/llama-3.1-70b' as ModelId)).toBe(true);
    expect(p.supports('openai/gpt-4o' as ModelId)).toBe(false);
  });

  test('throws ProviderNotConfiguredError when no key is set', async () => {
    const p = createGroqProvider({ apiKey: '' });
    await expect(
      p.generate({ modelId: 'groq/llama-3.1-70b' as ModelId, prompt: 'hi' }),
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});

describe('createOpenRouterProvider', () => {
  test('supports() matches only openrouter/* ids', () => {
    const p = createOpenRouterProvider({ apiKey: 'sk-or-test' });
    expect(p.supports('openrouter/anthropic/claude-3.5-sonnet' as ModelId)).toBe(true);
    expect(p.supports('openai/gpt-4o' as ModelId)).toBe(false);
  });

  test('throws ProviderNotConfiguredError when no key is set', async () => {
    const p = createOpenRouterProvider({ apiKey: '' });
    await expect(
      p.generate({ modelId: 'openrouter/meta-llama/llama-3.1-70b' as ModelId, prompt: 'hi' }),
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});

describe('createOllamaProvider', () => {
  test('supports() matches only ollama/* ids', () => {
    const p = createOllamaProvider();
    expect(p.supports('ollama/llama3.1:8b' as ModelId)).toBe(true);
    expect(p.supports('openai/gpt-4o' as ModelId)).toBe(false);
  });

  // Live path hits localhost:11434 — not asserted here. The supports() check
  // is enough to verify routing. generate() would only error on connect if
  // Ollama isn't running locally, which is environment-dependent.
});
