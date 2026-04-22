import { describe, expect, test } from 'bun:test';
import {
  ProviderNotConfiguredError,
  createOpenAIProvider,
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

  // Live path is covered by an integration test gated on OPENAI_API_KEY; not asserted here.
});
