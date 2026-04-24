import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLock,
  appendCell,
  appendLog,
  createRun,
  deleteRun,
  generateRunId,
  listRuns,
  readCells,
  readManifest,
  releaseLock,
  statCellsFile,
  toSummaryRow,
  updateManifest,
  runPaths,
} from './registry.ts';
import type { CellResult, Config } from './../types.ts';

function makeConfig(): Config {
  return {
    prompts: { baseline: 'p/a.md', candidate: 'p/b.md' },
    dataset: 'data/cases.jsonl',
    models: ['openai/gpt-4o'],
    judge: { model: 'openai/gpt-4o', criteria: 'default' },
  };
}

function makeCell(i: number): CellResult {
  return {
    caseIndex: i,
    model: 'openai/gpt-4o',
    outputA: 'a',
    outputB: 'b',
    judge: { winner: 'b', reason: 'ok' },
    latencyMs: 100 + i,
  };
}

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'rubric-registry-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

describe('run registry', () => {
  it('createRun writes manifest + empty cells + log', () => {
    const root = tmp();
    const { id, paths, manifest } = createRun({
      root,
      config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '{"input":"x"}\n',
      plannedCells: 3,
      note: 'test',
    });
    expect(id.startsWith('r-')).toBe(true);
    expect(existsSync(paths.manifest)).toBe(true);
    expect(readFileSync(paths.cells, 'utf8')).toBe('');
    expect(manifest.status).toBe('pending');
    expect(manifest.plannedCells).toBe(3);
    expect(manifest.note).toBe('test');
    expect(manifest.configHash.length).toBe(64);
    expect(manifest.datasetHash.length).toBe(64);
    expect(manifest.promptsHash.baseline.length).toBe(64);
  });

  it('round-trips cells via appendCell + readCells', () => {
    const root = tmp();
    const { id } = createRun({
      root,
      config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    appendCell(root, id, makeCell(0));
    appendCell(root, id, makeCell(1));
    appendCell(root, id, makeCell(2));
    const cells = readCells(root, id);
    expect(cells.length).toBe(3);
    expect(cells[0]!.caseIndex).toBe(0);
    expect(cells[2]!.caseIndex).toBe(2);
  });

  it('tolerates a malformed trailing line in cells.jsonl', () => {
    const root = tmp();
    const { id, paths } = createRun({
      root,
      config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    appendCell(root, id, makeCell(0));
    // Simulate mid-write garbage tail.
    writeFileSync(paths.cells, readFileSync(paths.cells, 'utf8') + '{not-json', 'utf8');
    const cells = readCells(root, id);
    expect(cells.length).toBe(1);
  });

  it('updateManifest is a shallow merge', () => {
    const root = tmp();
    const { id } = createRun({
      root,
      config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    updateManifest(root, id, { status: 'complete', finishedAt: '2026-04-24T00:00:00Z' });
    const m = readManifest(root, id);
    expect(m.status).toBe('complete');
    expect(m.finishedAt).toBe('2026-04-24T00:00:00Z');
    // Unchanged fields preserved.
    expect(m.models[0]).toBe('openai/gpt-4o');
  });

  it('listRuns returns newest-first', async () => {
    const root = tmp();
    const { id: first } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    // Separate the timestamps so we can assert order.
    await new Promise((r) => setTimeout(r, 10));
    const { id: second } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    const rows = listRuns(root);
    expect(rows.length).toBe(2);
    expect(rows[0]!.id).toBe(second);
    expect(rows[1]!.id).toBe(first);
  });

  it('deleteRun removes the entire run dir', () => {
    const root = tmp();
    const { id, paths } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    deleteRun(root, id);
    expect(existsSync(paths.dir)).toBe(false);
  });

  it('toSummaryRow projects only the interesting fields', () => {
    const root = tmp();
    const { id } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    updateManifest(root, id, {
      status: 'complete',
      summary: { wins: 4, losses: 2, ties: 1, errors: 0, winRate: 4 / 6 },
    });
    const m = readManifest(root, id);
    const row = toSummaryRow(m);
    expect(row.status).toBe('complete');
    expect(row.wins).toBe(4);
    expect(row.winRate).toBeCloseTo(4 / 6, 5);
  });
});

describe('lock', () => {
  it('releases cleanly and is reacquirable', () => {
    const root = tmp();
    const { id } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    const first = acquireLock(root, id);
    expect(first.acquired).toBe(true);
    releaseLock(root, id);
    const second = acquireLock(root, id);
    expect(second.acquired).toBe(true);
  });

  it('detects a live-process lock holder and refuses re-acquire', () => {
    const root = tmp();
    const { id } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    const a = acquireLock(root, id);
    expect(a.acquired).toBe(true);
    // Second attempt sees our still-live pid and refuses.
    const b = acquireLock(root, id);
    expect(b.acquired).toBe(false);
    expect(b.previousPid).toBe(process.pid);
    releaseLock(root, id);
  });

  it('takes over a stale lock whose pid is dead', () => {
    const root = tmp();
    const { id } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    // Write a lock file with a pid that's almost certainly dead.
    const paths = runPaths(root, id);
    writeFileSync(paths.lock, `999999999\n2020-01-01T00:00:00Z\n`, 'utf8');
    const result = acquireLock(root, id);
    expect(result.acquired).toBe(true);
  });
});

describe('log + stat helpers', () => {
  it('appendLog appends newline-terminated lines', () => {
    const root = tmp();
    const { id, paths } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    appendLog(root, id, 'first');
    appendLog(root, id, 'second\n');
    const raw = readFileSync(paths.log, 'utf8');
    expect(raw).toBe('first\nsecond\n');
  });

  it('statCellsFile counts lines and bytes', () => {
    const root = tmp();
    const { id } = createRun({
      root, config: makeConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: '',
    });
    appendCell(root, id, makeCell(0));
    appendCell(root, id, makeCell(1));
    const { lines, bytes } = statCellsFile(root, id);
    expect(lines).toBe(2);
    expect(bytes).toBeGreaterThan(0);
  });
});

describe('id generation', () => {
  it('generates sortable ids', () => {
    const a = generateRunId(new Date(1e12));
    const b = generateRunId(new Date(1e12 + 1000));
    expect(a < b).toBe(true);
    expect(a.startsWith('r-')).toBe(true);
  });
});
