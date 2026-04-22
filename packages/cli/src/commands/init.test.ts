import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from './init.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'diffprompt-init-'));
}

describe('runInit', () => {
  test('writes config, prompts, and dataset into an empty directory', () => {
    const dir = scratch();
    try {
      const result = runInit({ cwd: dir });

      expect(result.skipped).toEqual([]);
      expect(result.written.map((p) => p.replace(dir + '/', ''))).toEqual([
        'diffprompt.config.json',
        'prompts/baseline.md',
        'prompts/candidate.md',
        'data/cases.jsonl',
      ]);

      const config = JSON.parse(readFileSync(join(dir, 'diffprompt.config.json'), 'utf8'));
      expect(config.prompts.baseline).toBe('prompts/baseline.md');
      expect(config.dataset).toBe('data/cases.jsonl');
      expect(config.mode).toBe('compare-prompts');

      const lines = readFileSync(join(dir, 'data/cases.jsonl'), 'utf8').trim().split('\n');
      expect(lines.length).toBe(3);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(typeof parsed.input).toBe('string');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips existing files by default and overwrites with --force', () => {
    const dir = scratch();
    try {
      runInit({ cwd: dir });
      const first = runInit({ cwd: dir });
      expect(first.written).toEqual([]);
      expect(first.skipped.length).toBe(4);

      const second = runInit({ cwd: dir, force: true });
      expect(second.written.length).toBe(4);
      expect(second.skipped).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
