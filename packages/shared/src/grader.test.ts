import { describe, expect, test } from 'bun:test';
import { GraderParseError, createOpenAIGrader, parseGraderResponse } from './grader.ts';
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

describe('parseGraderResponse', () => {
  test('parses clean JSON', () => {
    expect(parseGraderResponse('{"polarity":"positive","reason":"correct"}')).toEqual({
      polarity: 'positive',
      reason: 'correct',
    });
  });

  test('extracts JSON embedded in prose', () => {
    const raw = 'Verdict: \n{"polarity":"negative","reason":"wrong city"}\n';
    expect(parseGraderResponse(raw)).toEqual({ polarity: 'negative', reason: 'wrong city' });
  });

  test('allows missing reason (defaults to empty string)', () => {
    expect(parseGraderResponse('{"polarity":"positive"}')).toEqual({
      polarity: 'positive',
      reason: '',
    });
  });

  test('rejects invalid polarity', () => {
    expect(() => parseGraderResponse('{"polarity":"maybe"}')).toThrow(GraderParseError);
  });

  test('rejects non-object JSON', () => {
    expect(() => parseGraderResponse('"positive"')).toThrow(GraderParseError);
  });

  test('rejects garbage', () => {
    expect(() => parseGraderResponse('no JSON here at all')).toThrow(GraderParseError);
  });
});

describe('createOpenAIGrader', () => {
  test('end-to-end with a stub provider', async () => {
    const grader = createOpenAIGrader({
      provider: stubProvider('{"polarity":"positive","reason":"matches"}'),
      model: 'openai/gpt-4o' as ModelId,
      rubric: 'default',
    });
    const result = await grader.grade({ input: 'q', output: 'a', rubric: 'default' });
    expect(result).toEqual({ polarity: 'positive', reason: 'matches' });
  });

  test('propagates GraderParseError on bad model output', async () => {
    const grader = createOpenAIGrader({
      provider: stubProvider('lol what'),
      model: 'openai/gpt-4o' as ModelId,
      rubric: 'default',
    });
    await expect(
      grader.grade({ input: 'q', output: 'a', rubric: 'default' }),
    ).rejects.toBeInstanceOf(GraderParseError);
  });
});
