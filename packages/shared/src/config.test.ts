import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, loadConfig, validateConfig } from './config.ts';

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
