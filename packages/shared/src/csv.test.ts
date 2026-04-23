import { describe, expect, test } from 'bun:test';
import { renderCostCsv } from './csv.ts';
import type { CellResult, ModelId, RunSummary } from './types.ts';

function baseCell(overrides: Partial<CellResult> = {}): CellResult {
  return {
    caseIndex: 0,
    model: 'mock/m1' as ModelId,
    outputA: 'a',
    outputB: 'b',
    judge: { winner: 'b', reason: 'candidate wins' },
    ...overrides,
  };
}

const baseSummary: RunSummary = { wins: 0, losses: 0, ties: 0, errors: 0, winRate: 0 };

describe('renderCostCsv', () => {
  test('writes header + per-cell rows + totals footer', () => {
    const cells: CellResult[] = [
      baseCell({ caseIndex: 0, latencyMs: 120, costUsd: 0.0015 }),
      baseCell({
        caseIndex: 1,
        model: 'mock/m2' as ModelId,
        judge: { winner: 'tie', reason: 'equal' },
        latencyMs: 80,
        costUsd: 0.001,
      }),
    ];
    const summary: RunSummary = {
      wins: 1,
      losses: 0,
      ties: 1,
      errors: 0,
      winRate: 1,
      totalCostUsd: 0.0025,
      totalLatencyMs: 200,
      costedCells: 2,
    };
    const csv = renderCostCsv({ cells, summary });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('caseIndex,model,modelB,verdict,reason,error,latencyMs,costUsd');
    expect(lines[1]).toBe('0,mock/m1,,b,candidate wins,,120,0.0015');
    expect(lines[2]).toBe('1,mock/m2,,tie,equal,,80,0.001');
    expect(lines[3]).toBe('TOTAL,,,,wins=1 losses=0 ties=1 errors=0,,200,0.0025');
  });

  test('quotes commas and embedded quotes per RFC 4180', () => {
    const cells: CellResult[] = [
      baseCell({ judge: { winner: 'b', reason: 'needs, more "polish"' } }),
    ];
    const csv = renderCostCsv({ cells, summary: baseSummary });
    const lines = csv.trim().split('\n');
    expect(lines[1]).toContain('"needs, more ""polish"""');
  });

  test('renders compare-models rows with modelB', () => {
    const cells: CellResult[] = [
      baseCell({
        model: 'mock/m1' as ModelId,
        modelB: 'mock/m2' as ModelId,
      }),
    ];
    const csv = renderCostCsv({ cells, summary: baseSummary });
    const lines = csv.trim().split('\n');
    expect(lines[1]).toBe('0,mock/m1,mock/m2,b,candidate wins,,,');
  });

  test('surfaces errors in the error column and leaves verdict blank', () => {
    const cells: CellResult[] = [
      baseCell({ judge: { error: 'provider timeout' } }),
    ];
    const csv = renderCostCsv({ cells, summary: { ...baseSummary, errors: 1 } });
    const lines = csv.trim().split('\n');
    expect(lines[1]).toBe('0,mock/m1,,,,provider timeout,,');
  });

  test('omits cost/latency in total row when summary has no totals', () => {
    const cells: CellResult[] = [baseCell()];
    const csv = renderCostCsv({ cells, summary: baseSummary });
    const last = csv.trim().split('\n').pop()!;
    expect(last).toBe('TOTAL,,,,wins=0 losses=0 ties=0 errors=0,,,');
  });
});
