import { describe, expect, test } from 'bun:test';
import {
  parseHeliconeLogs,
  parseLangSmithLogs,
  parseOpenAiChatLogs,
  parseSyntheticTemplate,
  SyntheticTemplateError,
} from './adapters.ts';

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

describe('parseOpenAiChatLogs', () => {
  test('extracts last user + first assistant from messages[]', () => {
    const text = line({
      messages: [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'refund please' },
        { role: 'assistant', content: 'sure, processing.' },
      ],
    });
    const cases = parseOpenAiChatLogs(text);
    expect(cases.length).toBe(1);
    expect(cases[0]!.input).toBe('refund please');
    expect((cases[0]!.metadata as { langfuse: { output: string } }).langfuse.output).toBe('sure, processing.');
  });

  test('extracts from request/response wrapper shape', () => {
    const text = line({
      request: { messages: [{ role: 'user', content: 'hi' }] },
      response: { choices: [{ message: { content: 'hello!' } }] },
    });
    const cases = parseOpenAiChatLogs(text);
    expect(cases[0]!.input).toBe('hi');
    expect((cases[0]!.metadata as { langfuse: { output: string } }).langfuse.output).toBe('hello!');
  });

  test('reports the offending line number on missing fields', () => {
    const text = line({ messages: [{ role: 'user', content: 'orphan' }] });
    expect(() => parseOpenAiChatLogs(text)).toThrow(/line 1/);
  });
});

describe('parseHeliconeLogs', () => {
  test('extracts input/output and maps rating=true to positive', () => {
    const text = line({
      request: { body: { messages: [{ role: 'user', content: 'cancel my order' }] } },
      response: { body: { choices: [{ message: { content: 'canceled.' } }] } },
      feedback: { rating: true, reason: 'fast' },
    });
    const cases = parseHeliconeLogs(text);
    expect(cases[0]!.input).toBe('cancel my order');
    const md = cases[0]!.metadata as { langfuse: { output: string; feedback?: { polarity: string; reason?: string } } };
    expect(md.langfuse.output).toBe('canceled.');
    expect(md.langfuse.feedback).toEqual({ polarity: 'positive', reason: 'fast' });
  });

  test('maps rating=false to negative', () => {
    const text = line({
      request_body: { messages: [{ role: 'user', content: 'q' }] },
      response_body: { choices: [{ message: { content: 'a' } }] },
      feedback: { rating: false },
    });
    const cases = parseHeliconeLogs(text);
    const md = cases[0]!.metadata as { langfuse: { feedback?: { polarity: string } } };
    expect(md.langfuse.feedback).toEqual({ polarity: 'negative' });
  });

  test('omits feedback when not present', () => {
    const text = line({
      request: { body: { messages: [{ role: 'user', content: 'q' }] } },
      response: { body: { choices: [{ message: { content: 'a' } }] } },
    });
    const cases = parseHeliconeLogs(text);
    const md = cases[0]!.metadata as { langfuse: { feedback?: unknown } };
    expect(md.langfuse.feedback).toBeUndefined();
  });
});

describe('parseLangSmithLogs', () => {
  test('extracts inputs.input + outputs.output', () => {
    const text = line({
      inputs: { input: 'where is my package?' },
      outputs: { output: 'in transit' },
    });
    const cases = parseLangSmithLogs(text);
    expect(cases[0]!.input).toBe('where is my package?');
    const md = cases[0]!.metadata as { langfuse: { output: string } };
    expect(md.langfuse.output).toBe('in transit');
  });

  test('maps feedback.score >= 0.5 to positive, < 0.5 to negative', () => {
    const textPos = line({
      inputs: { question: 'q' },
      outputs: { generations: [{ text: 'a' }] },
      feedback: [{ key: 'helpfulness', score: 0.9, comment: 'nice' }],
    });
    const cpos = parseLangSmithLogs(textPos);
    const md1 = cpos[0]!.metadata as { langfuse: { feedback?: { polarity: string; reason?: string } } };
    expect(md1.langfuse.feedback).toEqual({ polarity: 'positive', reason: 'nice' });

    const textNeg = line({
      inputs: { input: 'q' },
      outputs: { output: 'a' },
      feedback: [{ key: 'helpfulness', score: 0.1 }],
    });
    const cneg = parseLangSmithLogs(textNeg);
    const md2 = cneg[0]!.metadata as { langfuse: { feedback?: { polarity: string } } };
    expect(md2.langfuse.feedback).toEqual({ polarity: 'negative' });
  });

  test('falls back to messages when inputs.input absent', () => {
    const text = line({
      inputs: { messages: [{ role: 'user', content: 'hello' }] },
      outputs: { output: 'hi back' },
    });
    const cases = parseLangSmithLogs(text);
    expect(cases[0]!.input).toBe('hello');
  });
});

describe('parseSyntheticTemplate', () => {
  test('passes through a top-level array of cases', () => {
    const text = JSON.stringify([
      { input: 'q1', expected: 'a1' },
      { input: 'q2' },
    ]);
    const cases = parseSyntheticTemplate(text);
    expect(cases.length).toBe(2);
    expect(cases[0]).toEqual({ input: 'q1', expected: 'a1' });
    expect(cases[1]).toEqual({ input: 'q2' });
  });

  test('passes through { cases: [...] }', () => {
    const text = JSON.stringify({ cases: [{ input: 'q', expected: 'a', metadata: { tag: 'x' } }] });
    const cases = parseSyntheticTemplate(text);
    expect(cases[0]).toEqual({ input: 'q', expected: 'a', metadata: { tag: 'x' } });
  });

  test('cartesian-expands template + variables', () => {
    const text = JSON.stringify({
      template: { input: 'summarize {{topic}} as a {{style}}' },
      variables: { topic: ['cats', 'dogs'], style: ['haiku', 'ode'] },
    });
    const cases = parseSyntheticTemplate(text);
    expect(cases.length).toBe(4);
    const inputs = cases.map((c) => c.input).sort();
    expect(inputs).toEqual([
      'summarize cats as a haiku',
      'summarize cats as a ode',
      'summarize dogs as a haiku',
      'summarize dogs as a ode',
    ]);
  });

  test('substitutes placeholders in expected too', () => {
    const text = JSON.stringify({
      template: { input: 'translate "{{word}}" to french', expected: 'le {{word}}' },
      variables: { word: ['chat', 'chien'] },
    });
    const cases = parseSyntheticTemplate(text);
    expect(cases[0]!.expected).toBe('le chat');
    expect(cases[1]!.expected).toBe('le chien');
  });

  test('emits single case when template has no variables', () => {
    const text = JSON.stringify({ template: { input: 'static input' } });
    const cases = parseSyntheticTemplate(text);
    expect(cases).toEqual([{ input: 'static input' }]);
  });

  test('throws on unknown placeholder', () => {
    const text = JSON.stringify({
      template: { input: 'hi {{nope}}' },
      variables: { other: ['x'] },
    });
    expect(() => parseSyntheticTemplate(text)).toThrow(SyntheticTemplateError);
  });

  test('throws on invalid JSON', () => {
    expect(() => parseSyntheticTemplate('not json {')).toThrow(SyntheticTemplateError);
  });

  test('throws when template object is missing input', () => {
    const text = JSON.stringify({ template: { expected: 'a' } });
    expect(() => parseSyntheticTemplate(text)).toThrow(SyntheticTemplateError);
  });

  test('throws when neither cases nor template provided', () => {
    const text = JSON.stringify({ unrelated: 'field' });
    expect(() => parseSyntheticTemplate(text)).toThrow(SyntheticTemplateError);
  });

  test('throws when variables array is empty', () => {
    const text = JSON.stringify({
      template: { input: 'hi {{x}}' },
      variables: { x: [] },
    });
    expect(() => parseSyntheticTemplate(text)).toThrow(SyntheticTemplateError);
  });
});
