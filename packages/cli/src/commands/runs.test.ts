import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRun,
  updateManifest,
  type Config,
} from '../../../shared/src/index.ts';
import { runRunsDiff, runRunsList, runRunsShow, runRunsStatus } from './runs.ts';

function makeConfig(): Config {
  return {
    prompts: { baseline: 'p/a.md', candidate: 'p/b.md' },
    dataset: 'data/cases.jsonl',
    models: ['openai/gpt-4o'],
    judge: { model: 'openai/gpt-4o', criteria: 'default' },
  };
}

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'rubric-runs-cli-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('runs list', () => {
  it('prints a header and one row per run', () => {
    const root = tmp();
    createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'a', candidate: 'b' }, datasetText: '',
    });
    const lines: string[] = [];
    const r = runRunsList({ registryRoot: root, write: (l) => lines.push(l) });
    expect(r.exitCode).toBe(0);
    const header = lines[0] ?? '';
    expect(header).toContain('id');
    expect(header).toContain('status');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('handles empty registry gracefully', () => {
    const root = tmp();
    const lines: string[] = [];
    const r = runRunsList({ registryRoot: root, write: (l) => lines.push(l) });
    expect(r.exitCode).toBe(0);
    expect(lines[0] ?? '').toContain('no runs');
  });
});

describe('runs show', () => {
  it('renders manifest fields and summary', () => {
    const root = tmp();
    const { id } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'a', candidate: 'b' }, datasetText: '',
      note: 'my-run',
    });
    updateManifest(root, id, {
      status: 'complete',
      finishedAt: '2026-04-24T01:00:00Z',
      summary: { wins: 5, losses: 1, ties: 0, errors: 0, winRate: 5 / 6 },
    });
    const lines: string[] = [];
    runRunsShow({ id, registryRoot: root, write: (l) => lines.push(l) });
    const out = lines.join('');
    expect(out).toContain(id);
    expect(out).toContain('complete');
    expect(out).toContain('my-run');
    expect(out).toContain('wins:    5');
    expect(out).toMatch(/winRate: 83\.3%/);
  });
});

describe('runs status', () => {
  it('prints status and done/total', () => {
    const root = tmp();
    const { id } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'a', candidate: 'b' }, datasetText: '',
      plannedCells: 10,
    });
    updateManifest(root, id, { status: 'running' });
    const lines: string[] = [];
    const r = runRunsStatus({ id, registryRoot: root, write: (l) => lines.push(l) });
    expect(r.status).toBe('running');
    expect(lines[0]!.trim()).toBe('running  0/10');
  });
});

describe('runs diff', () => {
  it('prints a delta table when both runs have summaries', () => {
    const root = tmp();
    const { id: a } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'a', candidate: 'b' }, datasetText: '',
    });
    const { id: b } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'a', candidate: 'b' }, datasetText: '',
    });
    updateManifest(root, a, { summary: { wins: 3, losses: 2, ties: 1, errors: 0, winRate: 3 / 5 } });
    updateManifest(root, b, { summary: { wins: 5, losses: 1, ties: 0, errors: 0, winRate: 5 / 6 } });
    const lines: string[] = [];
    runRunsDiff({ a, b, registryRoot: root, write: (l) => lines.push(l) });
    const out = lines.join('');
    expect(out).toContain('wins');
    expect(out).toContain('+2');
    expect(out).toContain('losses');
  });
});
