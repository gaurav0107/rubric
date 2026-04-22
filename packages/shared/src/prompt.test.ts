import { describe, expect, test } from 'bun:test';
import { PromptRenderError, listTemplateVars, renderPrompt } from './prompt.ts';
import type { Case } from './types.ts';

const base: Case = {
  input: 'How many planets?',
  expected: '8',
  metadata: { tag: 'astro', langfuse: { output: 'Eight.' } },
};

describe('renderPrompt', () => {
  test('substitutes top-level and dotted metadata paths', () => {
    const out = renderPrompt(
      'Q: {{input}}\nE: {{expected}}\nT: {{metadata.tag}}\nO: {{metadata.langfuse.output}}',
      base,
    );
    expect(out).toBe('Q: How many planets?\nE: 8\nT: astro\nO: Eight.');
  });

  test('throws on missing variable by default', () => {
    expect(() => renderPrompt('Hello {{nope}}', base)).toThrow(PromptRenderError);
  });

  test('onMissing "empty" inserts empty string', () => {
    expect(renderPrompt('Hello [{{nope}}]', base, { onMissing: 'empty' })).toBe('Hello []');
  });

  test('onMissing "keep" leaves token intact', () => {
    expect(renderPrompt('Hello {{nope}}', base, { onMissing: 'keep' })).toBe('Hello {{nope}}');
  });

  test('tolerates whitespace inside braces', () => {
    expect(renderPrompt('{{  input  }}', base)).toBe('How many planets?');
  });

  test('stringifies non-string values', () => {
    const c: Case = { input: 'x', metadata: { n: 42, flag: true, obj: { a: 1 } } };
    expect(renderPrompt('{{metadata.n}}-{{metadata.flag}}-{{metadata.obj}}', c)).toBe('42-true-{"a":1}');
  });
});

describe('listTemplateVars', () => {
  test('returns unique variable names', () => {
    const vars = listTemplateVars('{{input}} and {{metadata.tag}} and {{ input }}');
    expect(vars.sort()).toEqual(['input', 'metadata.tag']);
  });
});
