import { describe, expect, test } from 'bun:test';
import { runEval } from './engine.ts';
import { createMockJudge, createMockProvider } from './mock.ts';
import type { Case, Config, ModelId } from './types.ts';

const prompts = { baseline: 'A: {{input}}', candidate: 'B: {{input}}' };

function makeConfig(models: ModelId[], concurrency = 2): Config {
  return {
    prompts: { baseline: 'ignored', candidate: 'ignored' },
    dataset: 'ignored',
    models,
    judge: { model: 'mock/judge' as ModelId, criteria: 'default' },
    concurrency,
  };
}

describe('runEval', () => {
  test('runs every (case x model) cell and summarizes', async () => {
    const cases: Case[] = [{ input: 'one' }, { input: 'two' }];
    const config = makeConfig(['mock/m1', 'mock/m2'] as ModelId[]);
    const provider = createMockProvider();
    const judge = createMockJudge({ verdict: 'b', reason: 'candidate wins' });

    const { cells, summary } = await runEval({
      config,
      cases,
      prompts,
      providers: [provider],
      judge,
    });

    expect(cells.length).toBe(4);
    expect(summary).toMatchObject({ wins: 4, losses: 0, ties: 0, errors: 0, winRate: 1 });
    for (const cell of cells) {
      expect(cell.outputA.startsWith('[')).toBe(true);
      expect(cell.outputB.startsWith('[')).toBe(true);
      expect('winner' in cell.judge ? cell.judge.winner : null).toBe('b');
    }
  });

  test('records per-cell errors when provider fails', async () => {
    const cases: Case[] = [{ input: 'one' }];
    const config = makeConfig(['mock/m1'] as ModelId[]);
    const throwing = createMockProvider({
      respond: () => {
        throw new Error('boom');
      },
    });
    const judge = createMockJudge();

    const { cells, summary } = await runEval({
      config,
      cases,
      prompts,
      providers: [throwing],
      judge,
    });

    expect(cells.length).toBe(1);
    const cell = cells[0]!;
    expect('error' in cell.judge).toBe(true);
    if ('error' in cell.judge) expect(cell.judge.error).toBe('boom');
    expect(summary.errors).toBe(1);
  });

  test('records judge errors without losing outputs', async () => {
    const cases: Case[] = [{ input: 'one' }];
    const config = makeConfig(['mock/m1'] as ModelId[]);
    const provider = createMockProvider();
    const badJudge = {
      name: 'bad',
      async judge() {
        throw new Error('judge down');
      },
    };

    const { cells, summary } = await runEval({
      config,
      cases,
      prompts,
      providers: [provider],
      judge: badJudge,
    });

    const cell = cells[0]!;
    expect(cell.outputA.length).toBeGreaterThan(0);
    expect(cell.outputB.length).toBeGreaterThan(0);
    expect('error' in cell.judge && cell.judge.error).toBe('judge down');
    expect(summary.errors).toBe(1);
  });

  test('throws ProviderNotFoundError-flavored error when no provider supports a model', async () => {
    const cases: Case[] = [{ input: 'one' }];
    const config = makeConfig(['anthropic/claude' as ModelId]);
    const provider = createMockProvider(); // only handles mock/*
    const judge = createMockJudge();

    const { cells } = await runEval({
      config,
      cases,
      prompts,
      providers: [provider],
      judge,
    });

    const cell = cells[0]!;
    expect('error' in cell.judge).toBe(true);
    if ('error' in cell.judge) expect(cell.judge.error).toMatch(/no provider accepted/);
  });

  test('mock provider with acceptAll runs any ModelId (enables --mock with live config)', async () => {
    const cases: Case[] = [{ input: 'one' }];
    const config = makeConfig(['openai/gpt-4o-mini' as ModelId, 'anthropic/claude' as ModelId]);
    const provider = createMockProvider({ acceptAll: true });
    const judge = createMockJudge({ verdict: 'b' });

    const { cells, summary } = await runEval({
      config,
      cases,
      prompts,
      providers: [provider],
      judge,
    });
    expect(cells.length).toBe(2);
    expect(summary.errors).toBe(0);
    expect(summary.wins).toBe(2);
  });

  test('onCell callback receives progress counts', async () => {
    const cases: Case[] = [{ input: 'one' }, { input: 'two' }];
    const config = makeConfig(['mock/m1'] as ModelId[]);
    const provider = createMockProvider();
    const judge = createMockJudge();

    const progress: Array<{ done: number; total: number }> = [];
    await runEval({
      config,
      cases,
      prompts,
      providers: [provider],
      judge,
      onCell: (_cell, p) => progress.push(p),
    });
    expect(progress.length).toBe(2);
    expect(progress[progress.length - 1]).toEqual({ done: 2, total: 2 });
  });

  test('compare-models pairs models[0] vs models[1] per case', async () => {
    const cases: Case[] = [{ input: 'one' }, { input: 'two' }];
    const config: Config = {
      ...makeConfig(['mock/m1', 'mock/m2'] as ModelId[]),
      mode: 'compare-models',
    };
    const provider = createMockProvider();
    const judge = createMockJudge({ verdict: 'a', reason: 'A wins' });

    const { cells, summary } = await runEval({
      config,
      cases,
      prompts,
      providers: [provider],
      judge,
    });

    expect(cells.length).toBe(2);
    for (const cell of cells) {
      expect(cell.model).toBe('mock/m1' as ModelId);
      expect(cell.modelB).toBe('mock/m2' as ModelId);
      // outputA starts with "[mock/m1" and outputB with "[mock/m2"
      expect(cell.outputA.startsWith('[mock/m1')).toBe(true);
      expect(cell.outputB.startsWith('[mock/m2')).toBe(true);
    }
    expect(summary.losses).toBe(2);
  });

  test('compare-models rejects single-model configs', async () => {
    const cases: Case[] = [{ input: 'one' }];
    const config: Config = { ...makeConfig(['mock/m1'] as ModelId[]), mode: 'compare-models' };
    const provider = createMockProvider();
    const judge = createMockJudge();
    await expect(
      runEval({ config, cases, prompts, providers: [provider], judge }),
    ).rejects.toThrow(/at least 2 models/);
  });

  test('summarizes total cost + latency when cells report them', async () => {
    const cases: Case[] = [{ input: '1' }, { input: '2' }];
    const config = makeConfig(['mock/m1'] as ModelId[]);
    const provider = createMockProvider({ costUsd: 0.012, latencyMs: 50 });
    const judge = createMockJudge();

    const { cells, summary } = await runEval({
      config,
      cases,
      prompts,
      providers: [provider],
      judge,
    });

    expect(cells.length).toBe(2);
    for (const c of cells) {
      // 0.012 per side × 2 sides
      expect(c.costUsd).toBeCloseTo(0.024, 6);
    }
    expect(summary.totalCostUsd).toBeCloseTo(0.048, 6);
    expect(summary.costedCells).toBe(2);
    expect(summary.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  test('omits totalCostUsd when no cell has a cost', async () => {
    const cases: Case[] = [{ input: '1' }];
    const config = makeConfig(['mock/m1'] as ModelId[]);
    const provider = createMockProvider();
    const judge = createMockJudge();

    const { summary } = await runEval({
      config,
      cases,
      prompts,
      providers: [provider],
      judge,
    });
    expect(summary.totalCostUsd).toBeUndefined();
    expect(summary.costedCells).toBeUndefined();
  });

  test('mixes wins/losses/ties in summary', async () => {
    const cases: Case[] = [{ input: '1' }, { input: '2' }, { input: '3' }, { input: '4' }];
    const config = makeConfig(['mock/m1'] as ModelId[]);
    const provider = createMockProvider();
    const judge = createMockJudge({
      verdict: (req) => {
        if (req.caseInput === '1') return 'b';
        if (req.caseInput === '2') return 'a';
        return 'tie';
      },
    });

    const { summary } = await runEval({
      config,
      cases,
      prompts,
      providers: [provider],
      judge,
    });
    expect(summary).toMatchObject({ wins: 1, losses: 1, ties: 2, errors: 0, winRate: 0.5 });
  });
});
