/**
 * Phase 3 coverage: --detach (via injected spawner), runs wait, runs resume.
 *
 * These tests fixture up a minimal rubric workspace on disk so we can drive
 * `runRun` / `runRunsResume` end-to-end in mock mode without any network.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLock,
  appendCell,
  createRun,
  readCells,
  readManifest,
  updateManifest,
  waitForRun,
  type CellResult,
  type Config,
  type ModelId,
} from '../../../shared/src/index.ts';
import { runRun } from './run.ts';
import { runRunsResume, runRunsWait } from './runs.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'rubric-phase3-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function fixtureWorkspace(): { root: string; registryRoot: string; configPath: string; config: Config } {
  const root = tmp();
  mkdirSync(join(root, 'prompts'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'runs'), { recursive: true });

  writeFileSync(join(root, 'prompts/baseline.md'), 'baseline: {{input}}\n', 'utf8');
  writeFileSync(join(root, 'prompts/candidate.md'), 'candidate: {{input}}\n', 'utf8');
  const cases = [
    { input: 'hello' },
    { input: 'world' },
    { input: 'foo' },
  ];
  writeFileSync(
    join(root, 'data/cases.jsonl'),
    cases.map((c) => JSON.stringify(c)).join('\n') + '\n',
    'utf8',
  );

  const config: Config = {
    prompts: { baseline: 'prompts/baseline.md', candidate: 'prompts/candidate.md' },
    dataset: 'data/cases.jsonl',
    models: ['mock/tiny' as ModelId],
    judge: { model: 'mock/judge' as ModelId, criteria: 'default' },
  };
  const configPath = join(root, 'rubric.config.json');
  writeFileSync(configPath, JSON.stringify(config), 'utf8');
  return { root, registryRoot: join(root, 'runs'), configPath, config };
}

function makeCell(caseIndex: number, model: ModelId): CellResult {
  return {
    caseIndex,
    model,
    outputA: 'a',
    outputB: 'b',
    judge: { winner: 'b', reason: 'pre-filled' },
    latencyMs: 10,
  };
}

describe('rubric run --detach', () => {
  it('creates a run, invokes spawnWorker, and returns immediately', async () => {
    const fx = fixtureWorkspace();
    let spawned: { id: string; root: string } | null = null;
    const spawnWorker = (id: string, root: string): number => {
      spawned = { id, root };
      return 12345;
    };

    const out: string[] = [];
    const result = await runRun({
      configPath: fx.configPath,
      cwd: fx.root,
      mock: true,
      registryRoot: fx.registryRoot,
      detach: true,
      spawnWorker,
      write: (l) => out.push(l),
    });

    expect(result.detached).toBe(true);
    expect(result.workerPid).toBe(12345);
    expect(result.exitCode).toBe(0);
    expect(result.runId).toBeTruthy();
    expect(spawned).not.toBeNull();
    expect(spawned!.id).toBe(result.runId!);
    expect(spawned!.root).toBe(fx.registryRoot);

    // The run should exist on disk with status 'running' (the worker would
    // flip it when it picks up the job — we didn't actually spawn one).
    const m = readManifest(fx.registryRoot, result.runId!);
    expect(m.status).toBe('running');
    expect(m.configPath).toBe(fx.configPath);
    expect(m.plannedCells).toBe(3);

    const text = out.join('');
    expect(text).toContain('detached: worker pid 12345');
    expect(text).toContain(`rubric runs wait ${result.runId}`);
  });

  it('refuses --detach when --skip-registry is set (nowhere to write the run)', async () => {
    const fx = fixtureWorkspace();
    await expect(
      runRun({
        configPath: fx.configPath,
        cwd: fx.root,
        mock: true,
        skipRegistry: true,
        detach: true,
        spawnWorker: () => 1,
        write: () => {},
      }),
    ).rejects.toThrow(/--detach requires a registry-backed run/);
  });
});

describe('runs wait', () => {
  it('returns immediately for a terminal status', async () => {
    const fx = fixtureWorkspace();
    const { id } = createRun({
      root: fx.registryRoot,
      config: fx.config,
      configPath: fx.configPath,
      prompts: { baseline: 'x', candidate: 'y' },
      datasetText: '',
    });
    updateManifest(fx.registryRoot, id, { status: 'complete', finishedAt: '2026-04-24T00:00:00Z' });
    const lines: string[] = [];
    const r = await runRunsWait({ id, registryRoot: fx.registryRoot, write: (l) => lines.push(l) });
    expect(r.exitCode).toBe(0);
    expect(r.status).toBe('complete');
    expect(lines[0]!.trim()).toBe('complete');
  });

  it('exits 124 on timeout when the run stays running', async () => {
    const fx = fixtureWorkspace();
    const { id } = createRun({
      root: fx.registryRoot,
      config: fx.config,
      configPath: fx.configPath,
      prompts: { baseline: 'x', candidate: 'y' },
      datasetText: '',
    });
    updateManifest(fx.registryRoot, id, { status: 'running' });
    const r = await runRunsWait({
      id,
      registryRoot: fx.registryRoot,
      intervalMs: 10,
      timeoutMs: 40,
      write: () => {},
    });
    expect(r.exitCode).toBe(124);
    expect(r.status).toBe('running');
  });

  it('exits 1 on failed', async () => {
    const fx = fixtureWorkspace();
    const { id } = createRun({
      root: fx.registryRoot,
      config: fx.config,
      configPath: fx.configPath,
      prompts: { baseline: 'x', candidate: 'y' },
      datasetText: '',
    });
    updateManifest(fx.registryRoot, id, { status: 'failed', finishedAt: '2026-04-24T00:00:00Z' });
    const r = await runRunsWait({ id, registryRoot: fx.registryRoot, write: () => {} });
    expect(r.exitCode).toBe(1);
    expect(r.status).toBe('failed');
  });
});

describe('runs resume', () => {
  it('runs only the cells missing from cells.jsonl', async () => {
    const fx = fixtureWorkspace();
    const model = 'mock/tiny' as ModelId;
    const { id } = createRun({
      root: fx.registryRoot,
      config: fx.config,
      configPath: fx.configPath,
      prompts: { baseline: 'baseline: {{input}}\n', candidate: 'candidate: {{input}}\n' },
      datasetText: readFileSync(join(fx.root, 'data/cases.jsonl'), 'utf8'),
      plannedCells: 3,
    });
    // Pre-fill cells 0 and 1 as if a crashed worker had gotten that far.
    appendCell(fx.registryRoot, id, makeCell(0, model));
    appendCell(fx.registryRoot, id, makeCell(1, model));
    updateManifest(fx.registryRoot, id, { status: 'running' });

    const lines: string[] = [];
    const r = await runRunsResume({
      id,
      registryRoot: fx.registryRoot,
      mock: true,
      write: (l) => lines.push(l),
    });

    expect(r.exitCode).toBe(0);
    expect(r.newCells).toBe(1);
    expect(r.totalCells).toBe(3);

    const finalCells = readCells(fx.registryRoot, id);
    expect(finalCells.length).toBe(3);
    // Pre-filled cells preserved unchanged.
    expect((finalCells[0]!.judge as { reason: string }).reason).toBe('pre-filled');
    expect((finalCells[1]!.judge as { reason: string }).reason).toBe('pre-filled');
    // The new cell came from the mock judge.
    expect((finalCells[2]!.judge as { reason: string }).reason).toBe('mock judge');

    const m = readManifest(fx.registryRoot, id);
    expect(m.status).toBe('complete');
    expect(m.finishedAt).toBeTruthy();
    expect(m.summary).toBeTruthy();
    expect(m.summary!.ties).toBe(1); // mock judge returns tie for new cell
    expect(m.summary!.wins).toBe(2); // pre-filled b-winners
  });

  it('finalizes an already-complete run without running anything', async () => {
    const fx = fixtureWorkspace();
    const model = 'mock/tiny' as ModelId;
    const { id } = createRun({
      root: fx.registryRoot,
      config: fx.config,
      configPath: fx.configPath,
      prompts: { baseline: 'baseline: {{input}}\n', candidate: 'candidate: {{input}}\n' },
      datasetText: readFileSync(join(fx.root, 'data/cases.jsonl'), 'utf8'),
      plannedCells: 3,
    });
    appendCell(fx.registryRoot, id, makeCell(0, model));
    appendCell(fx.registryRoot, id, makeCell(1, model));
    appendCell(fx.registryRoot, id, makeCell(2, model));

    const r = await runRunsResume({ id, registryRoot: fx.registryRoot, mock: true, write: () => {} });
    expect(r.exitCode).toBe(0);
    expect(r.newCells).toBe(0);
    expect(r.totalCells).toBe(3);
    const m = readManifest(fx.registryRoot, id);
    expect(m.status).toBe('complete');
  });

  it('refuses to resume when a live worker holds the lock', async () => {
    const fx = fixtureWorkspace();
    const { id } = createRun({
      root: fx.registryRoot,
      config: fx.config,
      configPath: fx.configPath,
      prompts: { baseline: 'x', candidate: 'y' },
      datasetText: readFileSync(join(fx.root, 'data/cases.jsonl'), 'utf8'),
      plannedCells: 3,
    });
    // Hold the lock under the current pid.
    const held = acquireLock(fx.registryRoot, id);
    expect(held.acquired).toBe(true);

    const lines: string[] = [];
    const r = await runRunsResume({
      id,
      registryRoot: fx.registryRoot,
      mock: true,
      write: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(1);
    expect(lines.join('')).toContain(`is locked by pid ${process.pid}`);
  });
});

describe('waitForRun (shared)', () => {
  it('invokes onTick and flips when status changes mid-wait', async () => {
    const fx = fixtureWorkspace();
    const { id } = createRun({
      root: fx.registryRoot,
      config: fx.config,
      configPath: fx.configPath,
      prompts: { baseline: 'x', candidate: 'y' },
      datasetText: '',
    });
    updateManifest(fx.registryRoot, id, { status: 'running' });
    // Flip it after a small delay from a different event-loop tick.
    const flipAt = setTimeout(() => {
      updateManifest(fx.registryRoot, id, { status: 'complete', finishedAt: '2026-04-24T00:00:00Z' });
    }, 30);
    let ticks = 0;
    const m = await waitForRun(fx.registryRoot, id, {
      intervalMs: 10,
      timeoutMs: 500,
      onTick: () => { ticks++; },
    });
    clearTimeout(flipAt);
    expect(m.status).toBe('complete');
    expect(ticks).toBeGreaterThan(0);
  });
});
