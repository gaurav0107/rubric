import { describe, expect, test } from 'bun:test';
import {
  renderCalibrationHtml,
  runCalibration,
  type CalibrationEntry,
} from './calibrate.ts';
import type { Grader, GraderPolarity, GraderRequest } from './grader.ts';

function fixedGrader(polarity: GraderPolarity, reason = 'fixed'): Grader {
  return {
    name: 'fixed',
    async grade(_req: GraderRequest) {
      return { polarity, reason };
    },
  };
}

function mirrorGrader(): Grader {
  // Treats output ending in "!" as positive — deterministic test signal.
  return {
    name: 'mirror',
    async grade(req: GraderRequest) {
      const polarity: GraderPolarity = req.output.endsWith('!') ? 'positive' : 'negative';
      return { polarity, reason: 'mirror' };
    },
  };
}

describe('runCalibration', () => {
  test('reports perfect agreement when grader matches every label', async () => {
    const entries: CalibrationEntry[] = [
      { input: 'q1', output: 'hi!', polarity: 'positive' },
      { input: 'q2', output: 'bye', polarity: 'negative' },
    ];
    const report = await runCalibration(entries, mirrorGrader(), 'default');
    expect(report.total).toBe(2);
    expect(report.agreements).toBe(2);
    expect(report.disagreements).toBe(0);
    expect(report.errors).toBe(0);
    expect(report.agreement).toBe(1);
    expect(report.matrix).toEqual({
      humanPositiveJudgePositive: 1,
      humanPositiveJudgeNegative: 0,
      humanNegativeJudgePositive: 0,
      humanNegativeJudgeNegative: 1,
    });
  });

  test('records disagreements in confusion matrix', async () => {
    const entries: CalibrationEntry[] = [
      { input: 'q1', output: 'hi', polarity: 'positive' }, // grader -> negative (no !)
      { input: 'q2', output: 'ok!', polarity: 'negative' }, // grader -> positive
    ];
    const report = await runCalibration(entries, mirrorGrader(), 'default');
    expect(report.agreements).toBe(0);
    expect(report.disagreements).toBe(2);
    expect(report.agreement).toBe(0);
    expect(report.matrix).toEqual({
      humanPositiveJudgePositive: 0,
      humanPositiveJudgeNegative: 1,
      humanNegativeJudgePositive: 1,
      humanNegativeJudgeNegative: 0,
    });
  });

  test('captures grader errors without crashing', async () => {
    const entries: CalibrationEntry[] = [
      { input: 'q1', output: 'x', polarity: 'positive' },
      { input: 'q2', output: 'y', polarity: 'negative' },
    ];
    const badGrader: Grader = {
      name: 'bad',
      async grade() {
        throw new Error('grader down');
      },
    };
    const report = await runCalibration(entries, badGrader, 'default', 2);
    expect(report.errors).toBe(2);
    expect(report.agreements).toBe(0);
    expect(report.disagreements).toBe(0);
    expect(report.agreement).toBe(0);
    expect(report.results[0]?.error).toBe('grader down');
    expect(report.results[0]?.judgePolarity).toBeNull();
  });

  test('handles empty entry list', async () => {
    const report = await runCalibration([], fixedGrader('positive'), 'default');
    expect(report.total).toBe(0);
    expect(report.agreement).toBe(0);
    expect(report.results).toEqual([]);
  });
});

describe('renderCalibrationHtml', () => {
  test('produces a self-contained HTML document', async () => {
    const entries: CalibrationEntry[] = [
      { input: 'q1', output: 'hi!', polarity: 'positive' },
      { input: 'q2', output: 'bye', polarity: 'negative' },
    ];
    const report = await runCalibration(entries, mirrorGrader(), 'default');
    const html = renderCalibrationHtml(report, new Date('2026-01-01T00:00:00Z'));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('rubric calibration');
    expect(html).toContain('100.0%');
    expect(html).toContain('2026-01-01T00:00:00.000Z');
  });

  test('escapes HTML in entry text', async () => {
    const entries: CalibrationEntry[] = [
      { input: '<script>x</script>', output: '&amp;', polarity: 'positive' },
    ];
    const report = await runCalibration(entries, fixedGrader('positive'), 'default');
    const html = renderCalibrationHtml(report);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
