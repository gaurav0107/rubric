import { describe, expect, test } from 'bun:test';
import { JsonlParseError, parseCasesJsonl } from './jsonl.ts';

describe('parseCasesJsonl', () => {
  test('parses plain cases, skipping blank lines and // comments', () => {
    const text = [
      '{"input":"one"}',
      '',
      '// a comment',
      '{"input":"two","expected":"2"}',
      '{"input":"three","metadata":{"tag":"x"}}',
      '',
    ].join('\n');

    const cases = parseCasesJsonl(text);
    expect(cases).toEqual([
      { input: 'one' },
      { input: 'two', expected: '2' },
      { input: 'three', metadata: { tag: 'x' } },
    ]);
  });

  test('rejects invalid JSON with a line number', () => {
    const text = '{"input":"ok"}\n{not json\n';
    try {
      parseCasesJsonl(text);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonlParseError);
      expect((err as JsonlParseError).line).toBe(2);
    }
  });

  test('rejects missing input', () => {
    try {
      parseCasesJsonl('{"expected":"x"}');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonlParseError);
      expect((err as Error).message).toMatch(/`input` is required/);
    }
  });

  test('rejects Langfuse fields unless allowLangfuse is set', () => {
    const line = '{"input":"hi","output":"there"}';
    try {
      parseCasesJsonl(line);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonlParseError);
      expect((err as Error).message).toMatch(/allowLangfuse/);
    }
  });

  test('accepts Langfuse lines and stores output + feedback under metadata.langfuse', () => {
    const text = [
      '{"input":"q1","output":"a1","feedback":"positive"}',
      '{"input":"q2","output":"a2","feedback":{"polarity":"negative","reason":"hallucinated"}}',
      '{"input":"q3","output":"a3"}',
    ].join('\n');

    const cases = parseCasesJsonl(text, { allowLangfuse: true });
    expect(cases.length).toBe(3);

    expect(cases[0]!.metadata).toEqual({
      langfuse: { output: 'a1', feedback: { polarity: 'positive' } },
    });
    expect(cases[1]!.metadata).toEqual({
      langfuse: { output: 'a2', feedback: { polarity: 'negative', reason: 'hallucinated' } },
    });
    expect(cases[2]!.metadata).toEqual({
      langfuse: { output: 'a3', feedback: undefined },
    });
  });

  test('rejects feedback with bad polarity', () => {
    const line = '{"input":"q","output":"a","feedback":{"polarity":"meh"}}';
    try {
      parseCasesJsonl(line, { allowLangfuse: true });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonlParseError);
      expect((err as Error).message).toMatch(/polarity/);
    }
  });
});
