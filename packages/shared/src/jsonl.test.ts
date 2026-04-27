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
});
