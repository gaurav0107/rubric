import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSeed } from './seed.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'rubric-seed-'));
}

const CSV = [
  'input,expected,category',
  '"What is 2+2?",4,math',
  '"Capital of France?",Paris,geo',
  '"Lonely case",,',
].join('\n');

describe('runSeed --from-csv', () => {
  test('writes cases.jsonl with input/expected + extras as metadata', () => {
    const dir = scratch();
    try {
      const inPath = join(dir, 'cases.csv');
      writeFileSync(inPath, CSV);

      const result = runSeed({
        fromPath: inPath,
        out: 'data/cases.jsonl',
        cwd: dir,
      });

      expect(result.casesWritten).toBe(3);

      const casesText = readFileSync(join(dir, 'data/cases.jsonl'), 'utf8');
      const caseLines = casesText.trim().split('\n').map((l) => JSON.parse(l));
      expect(caseLines).toEqual([
        { input: 'What is 2+2?', expected: '4', metadata: { category: 'math' } },
        { input: 'Capital of France?', expected: 'Paris', metadata: { category: 'geo' } },
        { input: 'Lonely case' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('flags PII findings without blocking import', () => {
    const dir = scratch();
    try {
      const inPath = join(dir, 'cases.csv');
      writeFileSync(inPath, [
        'input,expected',
        '"Email me at jane.doe@example.com","ok"',
      ].join('\n'));

      const result = runSeed({
        fromPath: inPath,
        out: 'data/cases.jsonl',
        cwd: dir,
      });

      expect(result.casesWritten).toBe(1);
      expect(result.piiWarnings.length).toBeGreaterThan(0);
      expect(result.piiWarnings[0]!.field).toBe('input');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
