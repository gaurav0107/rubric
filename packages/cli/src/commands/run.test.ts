import { describe, expect, test } from 'bun:test';
import { buildJsonPayload, decideExitCode } from './run.ts';
import type { CellResult, Config, ModelId, RunSummary } from '../../../shared/src/index.ts';

function sum(p: Partial<RunSummary>): RunSummary {
  return {
    wins: 0,
    losses: 0,
    ties: 0,
    errors: 0,
    winRate: 0,
    ...p,
  };
}

describe('decideExitCode', () => {
  test('clean run returns 0', () => {
    expect(decideExitCode(sum({ wins: 3, ties: 2 }), false)).toBe(0);
    expect(decideExitCode(sum({ wins: 3, ties: 2 }), true)).toBe(0);
  });

  test('errors return 1 when not gated on regress', () => {
    expect(decideExitCode(sum({ wins: 3, errors: 1 }), false)).toBe(1);
  });

  test('loss majority returns 2 only when --fail-on-regress is set', () => {
    expect(decideExitCode(sum({ wins: 1, losses: 3 }), true)).toBe(2);
    expect(decideExitCode(sum({ wins: 1, losses: 3 }), false)).toBe(0);
  });

  test('ties do not trip regress gate', () => {
    expect(decideExitCode(sum({ wins: 1, losses: 1, ties: 5 }), true)).toBe(0);
  });

  test('regression outranks errors when gated', () => {
    // CI intent: if user asked for --fail-on-regress, a losing run with an
    // incidental judge error should surface as REGRESSION (2), not ERROR (1).
    expect(decideExitCode(sum({ wins: 0, losses: 2, errors: 1 }), true)).toBe(2);
  });

  test('equal wins and losses is not a regression', () => {
    expect(decideExitCode(sum({ wins: 2, losses: 2 }), true)).toBe(0);
  });
});

function cfg(models: ModelId[]): Config {
  return {
    prompts: { baseline: 'b', candidate: 'c' },
    dataset: 'd',
    models,
    judge: { model: 'openai/gpt-4o' as ModelId, rubric: 'default' },
  };
}

describe('buildJsonPayload', () => {
  test('serializes cells with verdicts, errors, and cost/latency', () => {
    const cells: CellResult[] = [
      {
        caseIndex: 0,
        model: 'openai/gpt-4o-mini' as ModelId,
        outputA: 'a',
        outputB: 'b',
        judge: { winner: 'b', reason: 'clearer' },
        latencyMs: 120,
        costUsd: 0.0012,
      },
      {
        caseIndex: 1,
        model: 'openai/gpt-4o-mini' as ModelId,
        outputA: '',
        outputB: '',
        judge: { error: 'judge down' },
        latencyMs: 5,
      },
    ];
    const summary: RunSummary = { wins: 1, losses: 0, ties: 0, errors: 1, winRate: 1 };
    const payload = buildJsonPayload({
      config: cfg(['openai/gpt-4o-mini' as ModelId]),
      cells,
      summary,
      exitCode: 1,
    });

    expect(payload.version).toBe(1);
    expect(payload.summary).toEqual(summary);
    expect(payload.exitCode).toBe(1);
    expect(payload.totalCells).toBe(2);
    expect(payload.models).toEqual(['openai/gpt-4o-mini' as ModelId]);
    expect(payload.judge.model).toBe('openai/gpt-4o' as ModelId);

    expect(payload.cells[0]).toEqual({
      caseIndex: 0,
      model: 'openai/gpt-4o-mini' as ModelId,
      latencyMs: 120,
      costUsd: 0.0012,
      winner: 'b',
      reason: 'clearer',
    });
    expect(payload.cells[1]).toEqual({
      caseIndex: 1,
      model: 'openai/gpt-4o-mini' as ModelId,
      latencyMs: 5,
      error: 'judge down',
    });
  });

  test('round-trips through JSON.stringify/parse', () => {
    const payload = buildJsonPayload({
      config: cfg(['openai/gpt-4o' as ModelId]),
      cells: [],
      summary: { wins: 0, losses: 0, ties: 0, errors: 0, winRate: 0 },
      exitCode: 0,
    });
    const roundtrip = JSON.parse(JSON.stringify(payload));
    expect(roundtrip).toEqual(payload);
  });
});
