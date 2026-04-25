import { describe, expect, it } from 'bun:test';
import {
  checkEvaluatorGates,
  createEvaluator,
  createEvaluators,
  EvaluatorConfigError,
  primaryMetric,
  runEvaluators,
  summarizeEvaluations,
  type EvaluatorResult,
} from './evaluators.ts';
import type { Case } from './types.ts';

const emptyCase: Case = { input: 'x' };

describe('exact-match evaluator', () => {
  it('matches when output deep-equals expected (case-insensitive, trimmed by default)', () => {
    const e = createEvaluator({ type: 'exact-match' });
    const rows = e.evaluate({
      case: { input: 'q', expected: 'Cancel' },
      outputA: '  cancel  ',
      outputB: 'refund',
    });
    expect(rows.find((r) => r.metric === 'exact_match.a')!.value).toBe(1);
    expect(rows.find((r) => r.metric === 'exact_match.b')!.value).toBe(0);
  });

  it('respects caseSensitive', () => {
    const e = createEvaluator({ type: 'exact-match', caseSensitive: true });
    const rows = e.evaluate({ case: { input: 'q', expected: 'Cancel' }, outputA: 'cancel', outputB: 'Cancel' });
    expect(rows.find((r) => r.metric === 'exact_match.a')!.pass).toBe(false);
    expect(rows.find((r) => r.metric === 'exact_match.b')!.pass).toBe(true);
  });

  it('skips when the target field is missing', () => {
    const e = createEvaluator({ type: 'exact-match' });
    const rows = e.evaluate({ case: emptyCase, outputA: 'a', outputB: 'b' });
    expect(rows.every((r) => r.value === 'skip')).toBe(true);
  });

  it('reads metadata.* fields', () => {
    const e = createEvaluator({ type: 'exact-match', field: 'metadata.gold' });
    const rows = e.evaluate({
      case: { input: 'q', metadata: { gold: 'yes' } },
      outputA: 'YES',
      outputB: 'no',
    });
    expect(rows.find((r) => r.metric === 'exact_match.a')!.pass).toBe(true);
    expect(rows.find((r) => r.metric === 'exact_match.b')!.pass).toBe(false);
  });
});

describe('contains evaluator', () => {
  it('flags needle hit on both sides independently', () => {
    const e = createEvaluator({ type: 'contains', needle: 'TOOL_CALL' });
    const rows = e.evaluate({
      case: emptyCase,
      outputA: 'ok calling TOOL_CALL(x)',
      outputB: 'no tool here',
    });
    expect(rows.find((r) => r.metric === 'contains.a')!.pass).toBe(true);
    expect(rows.find((r) => r.metric === 'contains.b')!.pass).toBe(false);
  });

  it('rejects empty needle at construction time', () => {
    expect(() => createEvaluator({ type: 'contains', needle: '' })).toThrow(EvaluatorConfigError);
  });
});

describe('regex evaluator', () => {
  it('tests both outputs independently', () => {
    const e = createEvaluator({ type: 'regex', pattern: '^\\{[^\\n]+\\}$' });
    const rows = e.evaluate({ case: emptyCase, outputA: '{"ok":1}', outputB: 'not json' });
    expect(rows.find((r) => r.metric === 'regex.a')!.pass).toBe(true);
    expect(rows.find((r) => r.metric === 'regex.b')!.pass).toBe(false);
  });

  it('throws on invalid regex', () => {
    expect(() => createEvaluator({ type: 'regex', pattern: '[' })).toThrow(EvaluatorConfigError);
  });
});

describe('length evaluator', () => {
  it('emits raw length and in-band pass when band configured', () => {
    const e = createEvaluator({ type: 'length', min: 5, max: 10 });
    const rows = e.evaluate({ case: emptyCase, outputA: '1234567', outputB: 'too long to fit the band' });
    expect(rows.find((r) => r.metric === 'length.a')!.value).toBe(7);
    expect(rows.find((r) => r.metric === 'length_in_band.a')!.pass).toBe(true);
    expect(rows.find((r) => r.metric === 'length_in_band.b')!.pass).toBe(false);
  });

  it('omits in-band rows when no min/max configured', () => {
    const e = createEvaluator({ type: 'length' });
    const rows = e.evaluate({ case: emptyCase, outputA: 'a', outputB: 'bb' });
    expect(rows.some((r) => r.metric.startsWith('length_in_band'))).toBe(false);
  });

  it('rejects min > max', () => {
    expect(() => createEvaluator({ type: 'length', min: 100, max: 10 })).toThrow(EvaluatorConfigError);
  });
});

describe('json-valid evaluator', () => {
  it('accepts plain and fenced JSON', () => {
    const e = createEvaluator({ type: 'json-valid' });
    const rows = e.evaluate({
      case: emptyCase,
      outputA: '{"x":1}',
      outputB: '```json\n{"y":2}\n```',
    });
    expect(rows.every((r) => r.pass === true)).toBe(true);
  });

  it('rejects non-JSON', () => {
    const e = createEvaluator({ type: 'json-valid' });
    const rows = e.evaluate({ case: emptyCase, outputA: 'hello', outputB: '{' });
    expect(rows.every((r) => r.pass === false)).toBe(true);
  });
});

describe('runEvaluators', () => {
  it('catches evaluator errors and emits an error row', () => {
    const broken = {
      name: 'broken',
      evaluate(): EvaluatorResult[] {
        throw new Error('boom');
      },
    };
    const rows = runEvaluators([broken], { case: emptyCase, outputA: '', outputB: '' });
    expect(rows.length).toBe(1);
    expect(rows[0]!.value).toBe('error');
    expect(rows[0]!.reason).toBe('boom');
  });

  it('returns an empty array when no evaluators registered', () => {
    expect(runEvaluators([], { case: emptyCase, outputA: 'a', outputB: 'b' })).toEqual([]);
  });

  it('is null-safe on createEvaluators(undefined)', () => {
    expect(createEvaluators(undefined)).toEqual([]);
    expect(createEvaluators([])).toEqual([]);
  });
});

describe('summarizeEvaluations', () => {
  it('aggregates pass rates across cells', () => {
    const cells = [
      { evaluations: [{ metric: 'exact_match.a', side: 'a', value: 1, pass: true } as EvaluatorResult] },
      { evaluations: [{ metric: 'exact_match.a', side: 'a', value: 0, pass: false } as EvaluatorResult] },
      { evaluations: [{ metric: 'exact_match.a', side: 'a', value: 1, pass: true } as EvaluatorResult] },
    ];
    const { metrics } = summarizeEvaluations(cells);
    const em = metrics.find((m) => m.metric === 'exact_match.a')!;
    expect(em.passRate).toBeCloseTo(2 / 3, 5);
    expect(em.mean).toBeCloseTo(2 / 3, 5);
  });

  it('separates skip and error counts from numeric aggregation', () => {
    const cells = [
      { evaluations: [{ metric: 'a', side: 'a', value: 'skip' } as EvaluatorResult] },
      { evaluations: [{ metric: 'a', side: 'a', value: 'error' } as EvaluatorResult] },
      { evaluations: [{ metric: 'a', side: 'a', value: 1, pass: true } as EvaluatorResult] },
    ];
    const { skipCount, errorCount, metrics } = summarizeEvaluations(cells);
    expect(skipCount).toBe(1);
    expect(errorCount).toBe(1);
    expect(metrics[0]!.count).toBe(1);
  });
});

describe('primaryMetric', () => {
  it('maps every evaluator type to its B-side pass metric', () => {
    expect(primaryMetric('exact-match')).toBe('exact_match.b');
    expect(primaryMetric('contains')).toBe('contains.b');
    expect(primaryMetric('regex')).toBe('regex.b');
    expect(primaryMetric('length')).toBe('length_in_band.b');
    expect(primaryMetric('json-valid')).toBe('json_valid.b');
  });
});

describe('checkEvaluatorGates', () => {
  it('flags a breach when candidate pass rate falls below failOn', () => {
    const cells = [
      { evaluations: [{ metric: 'exact_match.b', side: 'b', value: 1, pass: true } as EvaluatorResult] },
      { evaluations: [{ metric: 'exact_match.b', side: 'b', value: 0, pass: false } as EvaluatorResult] },
      { evaluations: [{ metric: 'exact_match.b', side: 'b', value: 0, pass: false } as EvaluatorResult] },
    ];
    const summary = summarizeEvaluations(cells);
    const breaches = checkEvaluatorGates([{ type: 'exact-match', failOn: 0.9 }], summary);
    expect(breaches.length).toBe(1);
    expect(breaches[0]!.metric).toBe('exact_match.b');
    expect(breaches[0]!.actual).toBeCloseTo(1 / 3, 5);
    expect(breaches[0]!.threshold).toBe(0.9);
    expect(breaches[0]!.sample).toBe(3);
  });

  it('does not breach when pass rate meets the threshold exactly', () => {
    const cells = [
      { evaluations: [{ metric: 'contains.b', side: 'b', value: 1, pass: true } as EvaluatorResult] },
      { evaluations: [{ metric: 'contains.b', side: 'b', value: 1, pass: true } as EvaluatorResult] },
    ];
    const summary = summarizeEvaluations(cells);
    expect(checkEvaluatorGates([{ type: 'contains', needle: 'x', failOn: 1 }], summary)).toEqual([]);
  });

  it('ignores entries without failOn', () => {
    const cells = [
      { evaluations: [{ metric: 'json_valid.b', side: 'b', value: 0, pass: false } as EvaluatorResult] },
    ];
    const summary = summarizeEvaluations(cells);
    expect(checkEvaluatorGates([{ type: 'json-valid' }], summary)).toEqual([]);
  });

  it('does not breach when the metric has no contributing rows', () => {
    const summary = summarizeEvaluations([]);
    expect(checkEvaluatorGates([{ type: 'exact-match', failOn: 0.5 }], summary)).toEqual([]);
  });
});
