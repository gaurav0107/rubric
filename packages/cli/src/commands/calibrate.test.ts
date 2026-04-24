import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCalibrate } from './calibrate.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'rubric-calibrate-'));
}

function writeConfig(dir: string): string {
  const path = join(dir, 'rubric.config.json');
  writeFileSync(
    path,
    JSON.stringify({
      prompts: { baseline: 'prompts/baseline.md', candidate: 'prompts/candidate.md' },
      dataset: 'data/cases.jsonl',
      models: ['mock/m1'],
      judge: { model: 'mock/judge', rubric: 'default' },
    }),
  );
  return path;
}

function writeLabels(dir: string, entries: unknown[]): string {
  const path = join(dir, 'prompts', '_calibration.json.local');
  mkdirSync(join(dir, 'prompts'), { recursive: true });
  writeFileSync(path, JSON.stringify({ entries }, null, 2));
  return path;
}

describe('runCalibrate', () => {
  test('--mock: scores agreement and writes HTML report', async () => {
    const dir = scratch();
    try {
      writeConfig(dir);
      // mock grader returns positive if output ends with "!"
      writeLabels(dir, [
        { input: 'q1', output: 'yes!', polarity: 'positive' },
        { input: 'q2', output: 'nope', polarity: 'negative' },
        { input: 'q3', output: 'no!', polarity: 'negative' }, // disagreement
      ]);

      const lines: string[] = [];
      const result = await runCalibrate({
        cwd: dir,
        mock: true,
        write: (s) => lines.push(s),
      });

      expect(result.report.total).toBe(3);
      expect(result.report.agreements).toBe(2);
      expect(result.report.disagreements).toBe(1);
      expect(result.report.errors).toBe(0);
      expect(result.exitCode).toBe(0);

      const html = readFileSync(result.reportPath, 'utf8');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('rubric calibration');

      const stdout = lines.join('');
      expect(stdout).toMatch(/Agreement:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects labels missing input/output', async () => {
    const dir = scratch();
    try {
      writeConfig(dir);
      writeLabels(dir, [{ input: 'q1', polarity: 'positive' }]);

      await expect(
        runCalibrate({ cwd: dir, mock: true, write: () => {} }),
      ).rejects.toThrow(/missing input\/output/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects invalid polarity', async () => {
    const dir = scratch();
    try {
      writeConfig(dir);
      writeLabels(dir, [{ input: 'q', output: 'a', polarity: 'maybe' }]);

      await expect(
        runCalibrate({ cwd: dir, mock: true, write: () => {} }),
      ).rejects.toThrow(/invalid polarity/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
