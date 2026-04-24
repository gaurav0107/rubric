import { describe, expect, test } from 'bun:test';
import type { CalibrationReport } from './calibrate.ts';
import { classifyVerdict, renderPrComment } from './comment.ts';
import type { CellResult, ModelId, RunSummary } from './types.ts';

function sum(p: Partial<RunSummary>): RunSummary {
  return { wins: 0, losses: 0, ties: 0, errors: 0, winRate: 0, ...p };
}

const JUDGE: { model: ModelId } = { model: 'openai/gpt-4o' as ModelId };

describe('classifyVerdict', () => {
  test('pass when wins > losses', () => {
    expect(classifyVerdict(sum({ wins: 3, losses: 1 }))).toBe('pass');
  });
  test('regress when losses > wins', () => {
    expect(classifyVerdict(sum({ wins: 1, losses: 3 }))).toBe('regress');
  });
  test('tie when equal wins and losses', () => {
    expect(classifyVerdict(sum({ wins: 2, losses: 2 }))).toBe('tie');
  });
  test('tie when no decisive outcomes and no errors', () => {
    expect(classifyVerdict(sum({ ties: 5 }))).toBe('tie');
  });
  test('error when no decisive outcomes and any error', () => {
    expect(classifyVerdict(sum({ errors: 2 }))).toBe('error');
  });
});

describe('renderPrComment', () => {
  test('unverified banner when no calibration is provided', () => {
    const md = renderPrComment({
      summary: sum({ wins: 3, losses: 1, ties: 0, winRate: 0.75 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
    });
    expect(md).toContain('**PASS**');
    expect(md).toContain('calibration: **unverified**');
    expect(md).toContain('rubric calibrate');
    expect(md).not.toContain('Agreement:');
  });

  test('calibrated banner includes agreement %', () => {
    const calibration: CalibrationReport = {
      total: 20,
      agreements: 18,
      disagreements: 2,
      errors: 0,
      agreement: 0.9,
      matrix: {
        humanPositiveJudgePositive: 10,
        humanPositiveJudgeNegative: 1,
        humanNegativeJudgePositive: 1,
        humanNegativeJudgeNegative: 8,
      },
      results: [],
    };
    const md = renderPrComment({
      summary: sum({ wins: 3, losses: 1, winRate: 0.75 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
      calibration,
    });
    expect(md).toContain('calibration: **calibrated**');
    expect(md).toContain('Agreement: **90.0%**');
    expect(md).toContain('(18 / 20 decisive, 0 errors)');
    expect(md).not.toContain('below the');
  });

  test('flags calibrated-but-weak when agreement is under threshold', () => {
    const calibration: CalibrationReport = {
      total: 20,
      agreements: 14,
      disagreements: 6,
      errors: 0,
      agreement: 0.7,
      matrix: {
        humanPositiveJudgePositive: 7,
        humanPositiveJudgeNegative: 3,
        humanNegativeJudgePositive: 3,
        humanNegativeJudgeNegative: 7,
      },
      results: [],
    };
    const md = renderPrComment({
      summary: sum({ wins: 3, losses: 1, winRate: 0.75 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
      calibration,
    });
    expect(md).toContain('calibration: **weak**');
    expect(md).toContain('below the 80.0% threshold');
  });

  test('respects custom minAgreement', () => {
    const calibration: CalibrationReport = {
      total: 20,
      agreements: 19,
      disagreements: 1,
      errors: 0,
      agreement: 0.95,
      matrix: {
        humanPositiveJudgePositive: 10,
        humanPositiveJudgeNegative: 0,
        humanNegativeJudgePositive: 1,
        humanNegativeJudgeNegative: 9,
      },
      results: [],
    };
    // Agreement 95% but threshold is 97% -> weak.
    const md = renderPrComment({
      summary: sum({ wins: 3, losses: 1 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
      calibration,
      minAgreement: 0.97,
    });
    expect(md).toContain('calibration: **weak**');
    expect(md).toContain('below the 97.0% threshold');
  });

  test('regression status line when candidate loses', () => {
    const md = renderPrComment({
      summary: sum({ wins: 1, losses: 3, winRate: 0.25 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
    });
    expect(md).toContain('**REGRESSION**');
    expect(md).toContain('loses 3 > wins 1');
  });

  test('error status line when every decisive cell failed', () => {
    const md = renderPrComment({
      summary: sum({ errors: 2 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
    });
    expect(md).toContain('**ERROR**');
  });

  test('per-model breakdown appears only with multiple models', () => {
    const cells: CellResult[] = [
      {
        caseIndex: 0,
        model: 'openai/gpt-4o-mini' as ModelId,
        outputA: 'a',
        outputB: 'b',
        judge: { winner: 'b', reason: '' },
      },
      {
        caseIndex: 0,
        model: 'openai/gpt-4o' as ModelId,
        outputA: 'a',
        outputB: 'b',
        judge: { winner: 'a', reason: '' },
      },
    ];
    const md = renderPrComment({
      summary: sum({ wins: 1, losses: 1, winRate: 0.5 }),
      cells,
      models: ['openai/gpt-4o-mini' as ModelId, 'openai/gpt-4o' as ModelId],
      judge: JUDGE,
    });
    expect(md).toContain('<details><summary>Per-model breakdown</summary>');
    expect(md).toContain('`openai/gpt-4o-mini`');
    expect(md).toContain('`openai/gpt-4o`');
  });

  test('omits per-model breakdown for single-model runs', () => {
    const cells: CellResult[] = [
      {
        caseIndex: 0,
        model: 'openai/gpt-4o-mini' as ModelId,
        outputA: 'a',
        outputB: 'b',
        judge: { winner: 'b', reason: '' },
      },
    ];
    const md = renderPrComment({
      summary: sum({ wins: 1, winRate: 1 }),
      cells,
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
    });
    expect(md).not.toContain('Per-model breakdown');
  });

  test('includes report URL when provided', () => {
    const md = renderPrComment({
      summary: sum({ wins: 3 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
      reportUrl: 'https://example.com/r/abc',
    });
    expect(md).toContain('[Full report](https://example.com/r/abc)');
  });

  test('includes title when provided', () => {
    const md = renderPrComment({
      title: 'baseline.md vs candidate.md',
      summary: sum({ wins: 1 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
    });
    expect(md.startsWith('# rubric — baseline.md vs candidate.md')).toBe(true);
  });

  test('renders cost line when summary has totalCostUsd', () => {
    const md = renderPrComment({
      summary: sum({ wins: 2, losses: 1, winRate: 0.667, totalCostUsd: 0.1234, costedCells: 3 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
    });
    expect(md).toContain('Cost: **$0.12** across 3 cells');
    expect(md).toContain('avg $0.04/cell');
  });

  test('omits cost line when summary has no totalCostUsd', () => {
    const md = renderPrComment({
      summary: sum({ wins: 2, losses: 1, winRate: 0.667 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
    });
    expect(md).not.toContain('Cost:');
  });

  test('output is valid-looking Markdown ending in newline', () => {
    const md = renderPrComment({
      summary: sum({ wins: 1, winRate: 1 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
    });
    expect(md.endsWith('\n')).toBe(true);
    expect(md).toContain('| wins | losses | ties | errors | win rate |');
  });
});
