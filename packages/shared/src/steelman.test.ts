import { describe, expect, test } from 'bun:test';
import { createMockProvider } from './mock.ts';
import {
  parseSteelmanResponse,
  runSteelman,
  SteelmanParseError,
  type SteelmanFailingCase,
} from './steelman.ts';

describe('parseSteelmanResponse', () => {
  test('parses a well-formed JSON reply', () => {
    const r = parseSteelmanResponse('{"revised":"better prompt","rationale":"added specificity"}');
    expect(r.revised).toBe('better prompt');
    expect(r.rationale).toBe('added specificity');
  });

  test('tolerates surrounding prose via bracket extraction', () => {
    const raw = 'Here you go:\n{"revised":"better","rationale":"why"}\nHope this helps.';
    const r = parseSteelmanResponse(raw);
    expect(r.revised).toBe('better');
  });

  test('throws when JSON is missing', () => {
    expect(() => parseSteelmanResponse('no json here')).toThrow(SteelmanParseError);
  });

  test('throws when revised field is missing or empty', () => {
    expect(() => parseSteelmanResponse('{"rationale":"x"}')).toThrow(SteelmanParseError);
    expect(() => parseSteelmanResponse('{"revised":"","rationale":"x"}')).toThrow(SteelmanParseError);
  });

  test('throws when rationale is missing', () => {
    expect(() => parseSteelmanResponse('{"revised":"x"}')).toThrow(SteelmanParseError);
  });

  test('throws when top-level JSON is not an object', () => {
    expect(() => parseSteelmanResponse('[1,2,3]')).toThrow(SteelmanParseError);
  });
});

describe('runSteelman', () => {
  test('sends system + user to the provider and returns parsed result', async () => {
    let lastReq: { system?: string; prompt: string } | null = null;
    const provider = createMockProvider({
      acceptAll: true,
      respond: (req) => {
        lastReq = { prompt: req.prompt };
        if (req.system !== undefined) lastReq.system = req.system;
        return '{"revised":"strengthened prompt","rationale":"added a format constraint"}';
      },
    });

    const result = await runSteelman({
      provider,
      model: 'openai/gpt-4o-mini',
      prompt: 'Summarize the article.',
    });

    expect(result.revised).toBe('strengthened prompt');
    expect(result.rationale).toBe('added a format constraint');
    expect(lastReq).not.toBeNull();
    expect(lastReq!.system).toContain('prompt-engineering critic');
    expect(lastReq!.prompt).toContain('Summarize the article.');
  });

  test('includes failing cases in the user prompt', async () => {
    let captured = '';
    const provider = createMockProvider({
      acceptAll: true,
      respond: (req) => {
        captured = req.prompt;
        return '{"revised":"r","rationale":"why"}';
      },
    });

    const failing: SteelmanFailingCase[] = [
      {
        input: 'refund my order',
        failedOutput: 'ok',
        betterOutput: 'I can see your order and have issued a refund...',
        judgeReason: 'A is specific, B is not',
      },
    ];

    await runSteelman({
      provider,
      model: 'openai/gpt-4o-mini',
      prompt: 'Reply to the customer.',
      failingCases: failing,
    });

    expect(captured).toContain('Failing examples');
    expect(captured).toContain('refund my order');
    expect(captured).toContain('Better output');
    expect(captured).toContain('A is specific');
  });

  test('includes user guidance when provided', async () => {
    let captured = '';
    const provider = createMockProvider({
      acceptAll: true,
      respond: (req) => {
        captured = req.prompt;
        return '{"revised":"r","rationale":"why"}';
      },
    });

    await runSteelman({
      provider,
      model: 'openai/gpt-4o-mini',
      prompt: 'do the thing',
      guidance: 'keep it under 100 words',
    });

    expect(captured).toContain('Additional guidance');
    expect(captured).toContain('keep it under 100 words');
  });

  test('propagates parse errors from the provider response', async () => {
    const provider = createMockProvider({
      acceptAll: true,
      respond: () => 'sorry, I cannot do that',
    });
    await expect(
      runSteelman({
        provider,
        model: 'openai/gpt-4o-mini',
        prompt: 'x',
      }),
    ).rejects.toThrow(SteelmanParseError);
  });

  test('omits guidance and failing cases when absent', async () => {
    let captured = '';
    const provider = createMockProvider({
      acceptAll: true,
      respond: (req) => {
        captured = req.prompt;
        return '{"revised":"r","rationale":"why"}';
      },
    });
    await runSteelman({
      provider,
      model: 'openai/gpt-4o-mini',
      prompt: 'original',
    });
    expect(captured).not.toContain('Failing examples');
    expect(captured).not.toContain('Additional guidance');
  });
});
