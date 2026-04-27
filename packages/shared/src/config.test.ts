import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, loadConfig, resolveCriteria, validateConfig } from './config.ts';

describe('validateConfig', () => {
  test('accepts a minimal valid config', () => {
    const cfg = validateConfig({
      prompts: { baseline: 'a.md', candidate: 'b.md' },
      dataset: 'data.jsonl',
      models: ['openai/gpt-4o-mini'],
      judge: { model: 'openai/gpt-4o', criteria: 'default' },
    });
    expect(cfg.models).toEqual(['openai/gpt-4o-mini']);
    expect(cfg.judge.criteria).toBe('default');
    expect(cfg.concurrency).toBeUndefined();
  });

  test('accepts custom rubric and optional fields', () => {
    const cfg = validateConfig({
      prompts: { baseline: 'a.md', candidate: 'b.md' },
      dataset: 'data.jsonl',
      models: ['openai/gpt-4o-mini', 'anthropic/claude-3-5-sonnet'],
      judge: { model: 'openai/gpt-4o', criteria: { custom: 'judge harshly' } },
      concurrency: 8,
      mode: 'compare-prompts',
    });
    expect(cfg.judge.criteria).toEqual({ custom: 'judge harshly' });
    expect(cfg.concurrency).toBe(8);
    expect(cfg.mode).toBe('compare-prompts');
  });

  test('rejects removed compare-models mode with a pointer to the replacement', () => {
    expect(() =>
      validateConfig({
        prompts: { baseline: 'a.md', candidate: 'b.md' },
        dataset: 'data.jsonl',
        models: ['openai/gpt-4o-mini'],
        judge: { model: 'openai/gpt-4o', criteria: 'default' },
        mode: 'compare-models',
      }),
    ).toThrow(/compare-models.*removed/i);
  });

  test('warns on legacy top-level keys (v2.1 configs load without throwing)', () => {
    const warnings: string[] = [];
    const cfg = validateConfig(
      {
        prompts: { baseline: 'a.md', candidate: 'b.md' },
        dataset: 'data.jsonl',
        models: ['openai/gpt-4o-mini'],
        judge: { model: 'openai/gpt-4o', criteria: 'default' },
        finetunes: [{ model: 'openai/gpt-4o-mini', dataset: 'train.jsonl' }],
        share: { token: 'xxx' },
      },
      undefined,
      warnings,
    );
    expect(cfg.models).toEqual(['openai/gpt-4o-mini']);
    expect(warnings).toContain(`key 'finetunes' removed in v2.2, ignored`);
    expect(warnings).toContain(`key 'share' removed in v2.2, ignored`);
  });

  test('warns on legacy cluster/steelman evaluators and drops them', () => {
    const warnings: string[] = [];
    const cfg = validateConfig(
      {
        prompts: { baseline: 'a.md', candidate: 'b.md' },
        dataset: 'data.jsonl',
        models: ['openai/gpt-4o-mini'],
        judge: { model: 'openai/gpt-4o', criteria: 'default' },
        evaluators: [
          { type: 'cluster', failOn: 0.5 },
          { type: 'json-valid' },
        ],
      },
      undefined,
      warnings,
    );
    expect(cfg.evaluators).toEqual([{ type: 'json-valid' }]);
    expect(warnings.some((w) => w.includes(`evaluators[0].type 'cluster' removed in v2.2`))).toBe(true);
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
        judge: { model: 'openai/x', criteria: 'default' },
      },
      /provider\/model/,
    ],
    [
      {
        prompts: { baseline: 'a.md', candidate: 'b.md' },
        dataset: 'x.jsonl',
        models: ['openai/x'],
        judge: { model: 'openai/x', criteria: 'bogus' },
      },
      /judge\.criteria/,
    ],
    [
      {
        prompts: { baseline: 'a.md', candidate: 'b.md' },
        dataset: 'x.jsonl',
        models: ['openai/x'],
        judge: { model: 'openai/x', criteria: 'default' },
        concurrency: 0,
      },
      /concurrency/,
    ],
    [
      {
        prompts: { baseline: 'a.md', candidate: 'b.md' },
        dataset: 'x.jsonl',
        models: ['openai/x'],
        judge: { model: 'openai/x', criteria: 'default' },
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
    const dir = mkdtempSync(join(tmpdir(), 'rubric-cfg-'));
    try {
      const configPath = join(dir, 'rubric.config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          $schema: 'https://example/schema.json',
          prompts: { baseline: 'prompts/a.md', candidate: 'prompts/b.md' },
          dataset: 'data/cases.jsonl',
          models: ['openai/gpt-4o-mini'],
          judge: { model: 'openai/gpt-4o', criteria: 'default' },
        }),
      );

      const loaded = loadConfig(configPath);
      expect(loaded.baseDir).toBe(dir);
      expect(loaded.resolved.baseline).toBe(join(dir, 'prompts/a.md'));
      expect(loaded.resolved.dataset).toBe(join(dir, 'data/cases.jsonl'));
      expect(loaded.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('surfaces legacy-key warnings through LoadedConfig.warnings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rubric-cfg-'));
    try {
      const configPath = join(dir, 'rubric.config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          prompts: { baseline: 'a.md', candidate: 'b.md' },
          dataset: 'data.jsonl',
          models: ['openai/gpt-4o-mini'],
          judge: { model: 'openai/gpt-4o', criteria: 'default' },
          finetunes: [],
        }),
      );
      const loaded = loadConfig(configPath);
      expect(loaded.warnings).toContain(`key 'finetunes' removed in v2.2, ignored`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws ConfigError on missing file', () => {
    expect(() => loadConfig('/tmp/this-file-does-not-exist-rubric.json')).toThrow(ConfigError);
  });
});

describe('resolveCriteria', () => {
  test('passes built-in string rubrics through', () => {
    expect(resolveCriteria('default', '/irrelevant')).toBe('default');
    expect(resolveCriteria('model-comparison', '/irrelevant')).toBe('model-comparison');
  });

  test('inlines custom rubric text', () => {
    expect(resolveCriteria({ custom: 'be strict' }, '/irrelevant')).toBe('be strict');
  });

  test('loads rubric from a file relative to baseDir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rubric-rubric-'));
    try {
      writeFileSync(join(dir, 'rubric.md'), '# Team rubric\nJudge harshly but fairly.');
      const text = resolveCriteria({ file: 'rubric.md' }, dir);
      expect(text).toBe('# Team rubric\nJudge harshly but fairly.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws ConfigError when the rubric file is missing', () => {
    expect(() => resolveCriteria({ file: 'nope.md' }, '/tmp')).toThrow(ConfigError);
  });
});

describe('validateConfig — team rubric file', () => {
  test('accepts { file: "path.md" } rubric', () => {
    const cfg = validateConfig({
      prompts: { baseline: 'a.md', candidate: 'b.md' },
      dataset: 'data.jsonl',
      models: ['openai/gpt-4o-mini'],
      judge: { model: 'openai/gpt-4o', criteria: { file: 'rubric.md' } },
    });
    expect(cfg.judge.criteria).toEqual({ file: 'rubric.md' });
  });
});

describe('validateConfig — structural rubric', () => {
  test('accepts "structural-json" rubric', () => {
    const cfg = validateConfig({
      prompts: { baseline: 'a.md', candidate: 'b.md' },
      dataset: 'data.jsonl',
      models: ['openai/gpt-4o-mini'],
      judge: { model: 'openai/gpt-4o', criteria: 'structural-json' },
    });
    expect(cfg.judge.criteria).toBe('structural-json');
  });
});
