import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, loadConfig, resolveRubric, validateConfig } from './config.ts';

describe('validateConfig', () => {
  test('accepts a minimal valid config', () => {
    const cfg = validateConfig({
      prompts: { baseline: 'a.md', candidate: 'b.md' },
      dataset: 'data.jsonl',
      models: ['openai/gpt-4o-mini'],
      judge: { model: 'openai/gpt-4o', rubric: 'default' },
    });
    expect(cfg.models).toEqual(['openai/gpt-4o-mini']);
    expect(cfg.judge.rubric).toBe('default');
    expect(cfg.concurrency).toBeUndefined();
  });

  test('accepts custom rubric and optional fields', () => {
    const cfg = validateConfig({
      prompts: { baseline: 'a.md', candidate: 'b.md' },
      dataset: 'data.jsonl',
      models: ['openai/gpt-4o-mini', 'anthropic/claude-3-5-sonnet'],
      judge: { model: 'openai/gpt-4o', rubric: { custom: 'judge harshly' } },
      concurrency: 8,
      mode: 'compare-models',
    });
    expect(cfg.judge.rubric).toEqual({ custom: 'judge harshly' });
    expect(cfg.concurrency).toBe(8);
    expect(cfg.mode).toBe('compare-models');
  });

  test.each([
    [{}, /prompts\.baseline/],
    [{ prompts: { baseline: 'a.md', candidate: 'b.md' } }, /dataset/],
    [
      { prompts: { baseline: 'a.md', candidate: 'b.md' }, dataset: 'x.jsonl', models: [] },
      /models must be a non-empty array/,
    ],
    [
      {
        prompts: { baseline: 'a.md', candidate: 'b.md' },
        dataset: 'x.jsonl',
        models: ['noslash'],
        judge: { model: 'openai/x', rubric: 'default' },
      },
      /provider\/model/,
    ],
    [
      {
        prompts: { baseline: 'a.md', candidate: 'b.md' },
        dataset: 'x.jsonl',
        models: ['openai/x'],
        judge: { model: 'openai/x', rubric: 'bogus' },
      },
      /judge\.rubric/,
    ],
    [
      {
        prompts: { baseline: 'a.md', candidate: 'b.md' },
        dataset: 'x.jsonl',
        models: ['openai/x'],
        judge: { model: 'openai/x', rubric: 'default' },
        concurrency: 0,
      },
      /concurrency/,
    ],
    [
      {
        prompts: { baseline: 'a.md', candidate: 'b.md' },
        dataset: 'x.jsonl',
        models: ['openai/x'],
        judge: { model: 'openai/x', rubric: 'default' },
        mode: 'compare-everything',
      },
      /mode/,
    ],
  ])('rejects invalid config %#', (input, pattern) => {
    expect(() => validateConfig(input)).toThrow(pattern);
  });
});

describe('loadConfig', () => {
  test('reads + resolves relative paths from config dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffprompt-cfg-'));
    try {
      const configPath = join(dir, 'diffprompt.config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          $schema: 'https://example/schema.json',
          prompts: { baseline: 'prompts/a.md', candidate: 'prompts/b.md' },
          dataset: 'data/cases.jsonl',
          models: ['openai/gpt-4o-mini'],
          judge: { model: 'openai/gpt-4o', rubric: 'default' },
        }),
      );

      const loaded = loadConfig(configPath);
      expect(loaded.baseDir).toBe(dir);
      expect(loaded.resolved.baseline).toBe(join(dir, 'prompts/a.md'));
      expect(loaded.resolved.dataset).toBe(join(dir, 'data/cases.jsonl'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws ConfigError on missing file', () => {
    expect(() => loadConfig('/tmp/this-file-does-not-exist-diffprompt.json')).toThrow(ConfigError);
  });
});

describe('resolveRubric', () => {
  test('passes built-in string rubrics through', () => {
    expect(resolveRubric('default', '/irrelevant')).toBe('default');
    expect(resolveRubric('model-comparison', '/irrelevant')).toBe('model-comparison');
  });

  test('inlines custom rubric text', () => {
    expect(resolveRubric({ custom: 'be strict' }, '/irrelevant')).toBe('be strict');
  });

  test('loads rubric from a file relative to baseDir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffprompt-rubric-'));
    try {
      writeFileSync(join(dir, 'rubric.md'), '# Team rubric\nJudge harshly but fairly.');
      const text = resolveRubric({ file: 'rubric.md' }, dir);
      expect(text).toBe('# Team rubric\nJudge harshly but fairly.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws ConfigError when the rubric file is missing', () => {
    expect(() => resolveRubric({ file: 'nope.md' }, '/tmp')).toThrow(ConfigError);
  });
});

describe('validateConfig — team rubric file', () => {
  test('accepts { file: "path.md" } rubric', () => {
    const cfg = validateConfig({
      prompts: { baseline: 'a.md', candidate: 'b.md' },
      dataset: 'data.jsonl',
      models: ['openai/gpt-4o-mini'],
      judge: { model: 'openai/gpt-4o', rubric: { file: 'rubric.md' } },
    });
    expect(cfg.judge.rubric).toEqual({ file: 'rubric.md' });
  });
});

describe('validateConfig — structural rubric', () => {
  test('accepts "structural-json" rubric', () => {
    const cfg = validateConfig({
      prompts: { baseline: 'a.md', candidate: 'b.md' },
      dataset: 'data.jsonl',
      models: ['openai/gpt-4o-mini'],
      judge: { model: 'openai/gpt-4o', rubric: 'structural-json' },
    });
    expect(cfg.judge.rubric).toBe('structural-json');
  });
});
