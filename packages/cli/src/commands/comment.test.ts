import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runComment } from './comment.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'rubric-comment-'));
}

const VALID_RUN = {
  version: 1,
  summary: { wins: 3, losses: 1, ties: 0, errors: 0, winRate: 0.75 },
  exitCode: 0,
  models: ['openai/gpt-4o-mini'],
  judge: { model: 'openai/gpt-4o' },
  totalCells: 4,
  cells: [
    { caseIndex: 0, model: 'openai/gpt-4o-mini', latencyMs: 100, winner: 'b', reason: 'ok' },
    { caseIndex: 1, model: 'openai/gpt-4o-mini', latencyMs: 100, winner: 'b', reason: 'ok' },
    { caseIndex: 2, model: 'openai/gpt-4o-mini', latencyMs: 100, winner: 'b', reason: 'ok' },
    { caseIndex: 3, model: 'openai/gpt-4o-mini', latencyMs: 100, winner: 'a', reason: 'nope' },
  ],
};

describe('runComment', () => {
  test('renders a PR comment from run.json alone', () => {
    const dir = scratch();
    try {
      const runPath = join(dir, 'run.json');
      writeFileSync(runPath, JSON.stringify(VALID_RUN));

      const lines: string[] = [];
      const result = runComment({
        fromPath: runPath,
        write: (s) => lines.push(s),
      });
      expect(result.exitCode).toBe(0);
      const md = lines.join('');
      expect(md).toContain('**PASS**');
      expect(md).toContain('### Judge:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('includes report URL and title when provided', () => {
    const dir = scratch();
    try {
      const runPath = join(dir, 'run.json');
      writeFileSync(runPath, JSON.stringify(VALID_RUN));

      const lines: string[] = [];
      const result = runComment({
        fromPath: runPath,
        reportUrl: 'https://example.com/r/xyz',
        title: 'baseline.md vs candidate.md',
        write: (s) => lines.push(s),
      });
      expect(result.exitCode).toBe(0);
      const md = lines.join('');
      expect(md).toContain('[Full report](https://example.com/r/xyz)');
      expect(md).toContain('baseline.md vs candidate.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects run payloads with unknown version', () => {
    const dir = scratch();
    try {
      const runPath = join(dir, 'run.json');
      writeFileSync(runPath, JSON.stringify({ ...VALID_RUN, version: 99 }));
      expect(() => runComment({ fromPath: runPath, write: () => {} })).toThrow(
        /unsupported run payload version/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects invalid JSON', () => {
    const dir = scratch();
    try {
      const runPath = join(dir, 'run.json');
      writeFileSync(runPath, '{not json');
      expect(() => runComment({ fromPath: runPath, write: () => {} })).toThrow(
        /failed to parse JSON/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
