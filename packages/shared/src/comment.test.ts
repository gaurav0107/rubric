import { describe, expect, test } from 'bun:test';
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
  test('pass status line and judge section always render', () => {
    const md = renderPrComment({
      summary: sum({ wins: 3, losses: 1, ties: 0, winRate: 0.75 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
    });
    expect(md).toContain('**PASS**');
    expect(md).toContain('### Judge:');
    expect(md).toContain('rubric disagree');
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

  test('renders evaluator metrics table when metrics are provided', () => {
    const md = renderPrComment({
      summary: sum({ wins: 3, losses: 1, winRate: 0.75 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
      metrics: [
        { metric: 'exact_match.a', side: 'a', count: 5, passCount: 2, passRate: 0.4 },
        { metric: 'exact_match.b', side: 'b', count: 5, passCount: 4, passRate: 0.8 },
      ],
    });
    expect(md).toContain('<details><summary>Evaluator metrics</summary>');
    expect(md).toContain('`exact_match.a`');
    expect(md).toContain('`exact_match.b`');
    expect(md).toContain('40.0%');
    expect(md).toContain('80.0%');
  });

  test('emits gate-breach callout when failOn thresholds tripped', () => {
    const md = renderPrComment({
      summary: sum({ wins: 3, losses: 1, winRate: 0.75 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
      metrics: [
        { metric: 'exact_match.b', side: 'b', count: 5, passCount: 2, passRate: 0.4 },
      ],
      gateBreaches: [
        { type: 'exact-match', metric: 'exact_match.b', threshold: 0.9, actual: 0.4, sample: 5 },
      ],
    });
    expect(md).toContain('Gate breached');
    expect(md).toContain('`exact_match.b`');
    expect(md).toContain('40.0%');
    expect(md).toContain('< 90.0%');
  });

  test('omits evaluator section when metrics are empty', () => {
    const md = renderPrComment({
      summary: sum({ wins: 3, losses: 1, winRate: 0.75 }),
      models: ['openai/gpt-4o-mini' as ModelId],
      judge: JUDGE,
    });
    expect(md).not.toContain('Evaluator metrics');
    expect(md).not.toContain('Gate breached');
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

  describe('top regressions block', () => {
    const model = 'openai/gpt-4o-mini' as ModelId;
    function lossCell(idx: number, reason: string, outA = 'baseline output', outB = 'candidate output'): CellResult {
      return {
        caseIndex: idx,
        model,
        outputA: outA,
        outputB: outB,
        judge: { winner: 'a', reason },
      };
    }

    test('renders the block when there is at least one loss', () => {
      const cells = [lossCell(0, 'candidate hallucinated a fact')];
      const md = renderPrComment({
        summary: sum({ wins: 0, losses: 1, winRate: 0 }),
        cells,
        models: [model],
        judge: JUDGE,
        caseInputs: new Map([[0, 'summarize the product launch']]),
      });
      expect(md).toContain('<details><summary>Top regressions (1 of 1 losses)</summary>');
      expect(md).toContain('case-0');
      expect(md).toContain('summarize the product launch');
      expect(md).toContain('candidate hallucinated a fact');
      expect(md).toContain('A (baseline, won)');
      expect(md).toContain('B (candidate, lost)');
    });

    test('ranks by reason length then caseIndex and caps at 3', () => {
      const cells = [
        lossCell(0, 'short'),
        lossCell(1, 'this reason is considerably more detailed than the others'),
        lossCell(2, 'medium length reason here'),
        lossCell(3, 'another reason of moderate length about why baseline won'),
        lossCell(4, 'tiny'),
      ];
      const md = renderPrComment({
        summary: sum({ wins: 0, losses: 5, winRate: 0 }),
        cells,
        models: [model],
        judge: JUDGE,
      });
      expect(md).toContain('Top regressions (3 of 5 losses)');
      // Longest reasons (case-1, case-3, case-2 in that order) should render; case-0 + case-4 should not.
      expect(md).toContain('case-1');
      expect(md).toContain('case-3');
      expect(md).toContain('case-2');
      expect(md).not.toContain('case-0');
      expect(md).not.toContain('case-4');
    });

    test('is silent when there are no losses', () => {
      const cells: CellResult[] = [
        {
          caseIndex: 0,
          model,
          outputA: 'a',
          outputB: 'b',
          judge: { winner: 'b', reason: 'candidate wins' },
        },
      ];
      const md = renderPrComment({
        summary: sum({ wins: 1, losses: 0, winRate: 1 }),
        cells,
        models: [model],
        judge: JUDGE,
      });
      expect(md).not.toContain('Top regressions');
    });

    test('skips outputs table when outputA/outputB are empty (legacy payload compat)', () => {
      // Simulates the old comment.ts path where outputs were zeroed out.
      const cells: CellResult[] = [
        {
          caseIndex: 0,
          model,
          outputA: '',
          outputB: '',
          judge: { winner: 'a', reason: 'candidate missed the main point' },
        },
      ];
      const md = renderPrComment({
        summary: sum({ wins: 0, losses: 1, winRate: 0 }),
        cells,
        models: [model],
        judge: JUDGE,
      });
      expect(md).toContain('case-0');
      expect(md).toContain('candidate missed the main point');
      // No side-by-side outputs table in legacy mode — just input + reason.
      expect(md).not.toContain('A (baseline, won)');
    });

    test('truncates long reasons and outputs with an ellipsis', () => {
      const longReason = 'r'.repeat(500);
      const longOutput = 'x'.repeat(500);
      const cells = [lossCell(0, longReason, longOutput, 'short')];
      const md = renderPrComment({
        summary: sum({ wins: 0, losses: 1, winRate: 0 }),
        cells,
        models: [model],
        judge: JUDGE,
      });
      // Body should contain the cap prefix but not the full 500 chars on one line.
      expect(md).toContain('…');
      expect(md).not.toContain('r'.repeat(500));
      expect(md).not.toContain('x'.repeat(500));
    });
  });
});
