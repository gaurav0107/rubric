import { describe, expect, test } from 'bun:test';
import { JudgeParseError, createOpenAIJudge, parseJudgeResponse } from './judge.ts';
import type { Provider } from './provider.ts';
import type { ModelId } from './types.ts';

function stubProvider(text: string): Provider {
  return {
    name: 'stub',
    supports: () => true,
    async generate() {
      return { text, latencyMs: 1, resolvedModel: 'stub' };
    },
  };
}

describe('parseJudgeResponse', () => {
  test('parses clean JSON', () => {
    expect(parseJudgeResponse('{"winner":"b","reason":"clearer"}')).toEqual({
      winner: 'b',
      reason: 'clearer',
    });
  });

  test('strips leading prose and trailing code fences', () => {
    const raw = 'Here is my judgment:\n\n```\n{"winner":"a","reason":"more accurate"}\n```\n';
    expect(parseJudgeResponse(raw)).toEqual({ winner: 'a', reason: 'more accurate' });
  });

  test('allows missing reason (defaults to empty string)', () => {
    expect(parseJudgeResponse('{"winner":"tie"}')).toEqual({ winner: 'tie', reason: '' });
  });

  test('rejects invalid winner', () => {
    expect(() => parseJudgeResponse('{"winner":"neither"}')).toThrow(JudgeParseError);
  });

  test('rejects non-object JSON', () => {
    expect(() => parseJudgeResponse('"tie"')).toThrow(JudgeParseError);
  });

  test('rejects garbage', () => {
    expect(() => parseJudgeResponse('no JSON here at all')).toThrow(JudgeParseError);
  });
});

describe('createOpenAIJudge', () => {
  test('end-to-end with a stub provider', async () => {
    const judge = createOpenAIJudge({
      provider: stubProvider('{"winner":"b","reason":"ok"}'),
      model: 'openai/gpt-4o' as ModelId,
      rubric: 'default',
    });
    const result = await judge.judge({
      caseInput: 'q',
      outputA: 'a',
      outputB: 'b',
      rubric: 'default',
    });
    expect(result).toEqual({ winner: 'b', reason: 'ok' });
  });

  test('propagates JudgeParseError on bad model output', async () => {
    const judge = createOpenAIJudge({
      provider: stubProvider('lol what'),
      model: 'openai/gpt-4o' as ModelId,
      rubric: 'default',
    });
    await expect(
      judge.judge({ caseInput: 'q', outputA: 'a', outputB: 'b', rubric: 'default' }),
    ).rejects.toBeInstanceOf(JudgeParseError);
  });
});
