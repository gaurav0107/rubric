import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSeed } from './seed.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'rubric-seed-'));
}

const LANGFUSE = [
  JSON.stringify({ input: 'What is 2+2?', output: '4', feedback: 'positive' }),
  JSON.stringify({ input: 'Capital of France?', output: 'Lyon', feedback: { polarity: 'negative', reason: 'wrong city' } }),
  JSON.stringify({ input: 'Unlabeled', output: 'something' }),
].join('\n');

describe('runSeed', () => {
  test('writes cases.jsonl and _calibration.json.local', () => {
    const dir = scratch();
    try {
      const inPath = join(dir, 'lf.jsonl');
      writeFileSync(inPath, LANGFUSE);

      const result = runSeed({
        fromPath: inPath,
        source: 'langfuse',
        out: 'data/cases.jsonl',
        cwd: dir,
      });

      expect(result.casesWritten).toBe(3);
      expect(result.calibrationWritten).toBe(2);

      const casesText = readFileSync(join(dir, 'data/cases.jsonl'), 'utf8');
      const caseLines = casesText.trim().split('\n').map((l) => JSON.parse(l));
      expect(caseLines).toEqual([
        { input: 'What is 2+2?' },
        { input: 'Capital of France?' },
        { input: 'Unlabeled' },
      ]);

      const calibration = JSON.parse(readFileSync(result.calibrationPath, 'utf8'));
      expect(calibration.entries).toEqual([
        { input: 'What is 2+2?', output: '4', polarity: 'positive' },
        { input: 'Capital of France?', output: 'Lyon', polarity: 'negative', reason: 'wrong city' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('preserves non-langfuse metadata', () => {
    const dir = scratch();
    try {
      const inPath = join(dir, 'lf.jsonl');
      writeFileSync(
        inPath,
        JSON.stringify({ input: 'x', output: 'y', feedback: 'positive', metadata: { tag: 'foo' } }),
      );

      const result = runSeed({
        fromPath: inPath,
        source: 'langfuse',
        out: 'data/cases.jsonl',
        cwd: dir,
      });

      const line = JSON.parse(readFileSync(result.outPath, 'utf8').trim());
      expect(line).toEqual({ input: 'x', metadata: { tag: 'foo' } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
