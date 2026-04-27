import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JUDGE_PROMPT_TEMPLATE_VERSION,
  RUBRIC_CLI_MAJOR_VERSION,
  createCellCache,
  hashCellKey,
  judgeRubricId,
  type CellCacheKey,
  type CellCacheValue,
} from './judge-cache.ts';

function makeKey(overrides: Partial<CellCacheKey> = {}): CellCacheKey {
  return {
    promptA: 'You are helpful. Input: {{input}}',
    promptB: 'You are concise. Input: {{input}}',
    inputText: 'Explain TCP.',
    modelA: 'openai/gpt-4o',
    modelB: 'openai/gpt-4o',
    judgeModelId: 'openai/gpt-4o',
    judgeRubricId: 'default',
    judgePromptTemplateVersion: JUDGE_PROMPT_TEMPLATE_VERSION,
    rubricCliMajorVersion: RUBRIC_CLI_MAJOR_VERSION,
    ...overrides,
  };
}

function sampleValue(): CellCacheValue {
  return {
    outputA: 'A output',
    outputB: 'B output',
    judge: { winner: 'b', reason: 'B is more concise' },
  };
}

describe('judgeRubricId', () => {
  it('passes through canned rubric names verbatim', () => {
    expect(judgeRubricId('default')).toBe('default');
    expect(judgeRubricId('model-comparison')).toBe('model-comparison');
    expect(judgeRubricId('structural-json')).toBe('structural-json');
  });

  it('hashes custom prose with the custom: prefix', () => {
    const a = judgeRubricId('Pick the more formal one.');
    const b = judgeRubricId('Pick the more formal one.');
    expect(a).toBe(b);
    expect(a).not.toBe('Pick the more formal one.');
    expect(a.length).toBe(64); // sha256 hex
  });

  it('different prose produces different ids', () => {
    expect(judgeRubricId('rubric A')).not.toBe(judgeRubricId('rubric B'));
  });
});

describe('hashCellKey', () => {
  it('is deterministic across calls', () => {
    const a = hashCellKey(makeKey());
    const b = hashCellKey(makeKey());
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });

  for (const field of [
    'promptA',
    'promptB',
    'inputText',
    'modelA',
    'modelB',
    'judgeModelId',
    'judgeRubricId',
  ] as const) {
    it(`invalidates when ${field} changes`, () => {
      const base = hashCellKey(makeKey());
      const changed = hashCellKey(makeKey({ [field]: field === 'modelA' || field === 'modelB' || field === 'judgeModelId' ? 'openai/different-model' : `${makeKey()[field]} changed` }));
      expect(changed).not.toBe(base);
    });
  }

  it('invalidates when judgePromptTemplateVersion changes', () => {
    const base = hashCellKey(makeKey());
    const changed = hashCellKey(makeKey({ judgePromptTemplateVersion: JUDGE_PROMPT_TEMPLATE_VERSION + 1 }));
    expect(changed).not.toBe(base);
  });

  it('invalidates when rubricCliMajorVersion changes', () => {
    const base = hashCellKey(makeKey());
    const changed = hashCellKey(makeKey({ rubricCliMajorVersion: RUBRIC_CLI_MAJOR_VERSION + 1 }));
    expect(changed).not.toBe(base);
  });

  it('applies default version fields when omitted', () => {
    const partial: CellCacheKey = {
      promptA: 'a', promptB: 'b', inputText: 'x',
      modelA: 'openai/x', modelB: 'openai/x',
      judgeModelId: 'openai/x', judgeRubricId: 'default',
    };
    const full: CellCacheKey = {
      ...partial,
      judgePromptTemplateVersion: JUDGE_PROMPT_TEMPLATE_VERSION,
      rubricCliMajorVersion: RUBRIC_CLI_MAJOR_VERSION,
    };
    expect(hashCellKey(partial)).toBe(hashCellKey(full));
  });
});

describe('createCellCache', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  function newRoot(): string {
    const d = mkdtempSync(join(tmpdir(), 'rubric-cache-'));
    tmpDirs.push(d);
    return d;
  }

  it('reports miss on an empty cache', () => {
    const cache = createCellCache({ root: newRoot() });
    const lookup = cache.lookup(makeKey());
    expect(lookup.hit).toBe(false);
    expect(lookup.value).toBeUndefined();
    expect(lookup.hash.length).toBe(64);
  });

  it('round-trips a value through write + lookup', () => {
    const root = newRoot();
    const cache = createCellCache({ root });
    const key = makeKey();
    const value = sampleValue();
    const hash = cache.write(key, value);
    const lookup = cache.lookup(key);
    expect(lookup.hit).toBe(true);
    expect(lookup.value).toEqual(value);
    expect(lookup.hash).toBe(hash);
  });

  it('stores entries sharded by hash prefix', () => {
    const root = newRoot();
    const cache = createCellCache({ root });
    const key = makeKey();
    const hash = cache.write(key, sampleValue());
    const shardDir = join(root, hash.slice(0, 2));
    expect(existsSync(join(shardDir, hash + '.json'))).toBe(true);
  });

  it('reports miss after a key field changes', () => {
    const root = newRoot();
    const cache = createCellCache({ root });
    cache.write(makeKey(), sampleValue());
    const different = cache.lookup(makeKey({ promptB: 'edited' }));
    expect(different.hit).toBe(false);
  });

  it('disabled cache always misses and never writes files', () => {
    const root = newRoot();
    const cache = createCellCache({ root, disabled: true });
    cache.write(makeKey(), sampleValue());
    expect(cache.lookup(makeKey()).hit).toBe(false);
  });

  it('write is atomic — no lingering .tmp files after success', async () => {
    const root = newRoot();
    const cache = createCellCache({ root });
    const hash = cache.write(makeKey(), sampleValue());
    const shardDir = join(root, hash.slice(0, 2));
    // Read the shard dir and confirm only the final .json lives there.
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(shardDir);
    expect(files).toEqual([hash + '.json']);
  });

  it('corrupt entry returns miss rather than throwing', async () => {
    const root = newRoot();
    const cache = createCellCache({ root });
    const key = makeKey();
    const hash = cache.write(key, sampleValue());
    const shardDir = join(root, hash.slice(0, 2));
    const entryPath = join(shardDir, hash + '.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(entryPath, '{not: valid json', 'utf8');
    const lookup = cache.lookup(key);
    expect(lookup.hit).toBe(false);
  });
});
