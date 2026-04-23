import { describe, expect, test } from 'bun:test';
import { parseHeliconeLogs, parseLangSmithLogs, parseOpenAiChatLogs } from './adapters.ts';

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
