import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHistory, renderHistoryHtml, runHistory } from './history.ts';

function initRepo(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
}

function commit(dir: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

function scaffold(dir: string): void {
  mkdirSync(join(dir, 'prompts'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(
    join(dir, 'rubric.config.json'),
    JSON.stringify({
      prompts: { baseline: 'prompts/a.md', candidate: 'prompts/b.md' },
      dataset: 'data/cases.jsonl',
      models: ['openai/gpt-4o-mini'],
      judge: { model: 'openai/gpt-4o', criteria: 'default' },
    }),
  );
  writeFileSync(join(dir, 'prompts/a.md'), 'baseline v1\n');
  writeFileSync(join(dir, 'prompts/b.md'), 'candidate v1\n');
  writeFileSync(join(dir, 'data/cases.jsonl'), '{"input":"x"}\n');
}

describe('loadHistory', () => {
  test('returns entries for commits that touched the tracked prompt files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dp-history-'));
    try {
      initRepo(dir);
      scaffold(dir);
      commit(dir, 'initial');

      writeFileSync(join(dir, 'prompts/a.md'), 'baseline v2\n');
      commit(dir, 'tune baseline wording');

      writeFileSync(join(dir, 'prompts/b.md'), 'candidate v2\n');
      commit(dir, 'bump candidate');

      // An unrelated commit that should NOT show up.
      writeFileSync(join(dir, 'data/cases.jsonl'), '{"input":"y"}\n');
      commit(dir, 'unrelated dataset edit');

      const result = loadHistory({ cwd: dir });
      expect(result.entries.length).toBe(3);
      expect(result.entries[0]?.subject).toBe('bump candidate');
      expect(result.entries[1]?.subject).toBe('tune baseline wording');
      expect(result.entries[2]?.subject).toBe('initial');
      expect(result.tracked).toEqual(['prompts/a.md', 'prompts/b.md']);
      expect(result.entries[1]?.additions).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--file overrides the config-declared prompts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dp-history-'));
    try {
      initRepo(dir);
      scaffold(dir);
      commit(dir, 'initial');
      writeFileSync(join(dir, 'data/cases.jsonl'), '{"input":"y"}\n');
      commit(dir, 'tweak cases');

      const result = loadHistory({ cwd: dir, files: ['data/cases.jsonl'] });
      expect(result.tracked).toEqual(['data/cases.jsonl']);
      expect(result.entries.length).toBe(2);
      expect(result.entries[0]?.subject).toBe('tweak cases');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws a clear error outside a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dp-nogit-'));
    try {
      scaffold(dir);
      expect(() => loadHistory({ cwd: dir })).toThrow(/git/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runHistory', () => {
  test('prints the tracked files and a row per commit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dp-history-'));
    const lines: string[] = [];
    try {
      initRepo(dir);
      scaffold(dir);
      commit(dir, 'only commit');

      runHistory({ cwd: dir, write: (line) => lines.push(line) });
      const joined = lines.join('');
      expect(joined).toContain('only commit');
      expect(joined).toContain('prompts/a.md');
      expect(joined).toContain('prompts/b.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--html writes a self-contained HTML report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dp-history-'));
    try {
      initRepo(dir);
      scaffold(dir);
      commit(dir, 'only commit');
      const out = join(dir, 'hist.html');
      const result = runHistory({ cwd: dir, htmlPath: out, write: () => {} });
      const html = renderHistoryHtml(result);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('only commit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
