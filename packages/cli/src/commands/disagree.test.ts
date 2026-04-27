import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from './init.ts';
import { runWatch } from './watch.ts';
import { runDisagree } from './disagree.ts';
import {
  loadActiveOverrides,
  readOverrideLog,
} from '../../../shared/src/index.ts';

const cleanup: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'rubric-disagree-'));
  cleanup.push(d);
  return d;
}
afterEach(() => {
  while (cleanup.length > 0) {
    const d = cleanup.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

async function setupRunWithWatch(): Promise<{
  dir: string; configPath: string; registryRoot: string;
  cacheRoot: string; overridesRoot: string; runId: string; cellRef: string;
}> {
  const dir = scratch();
  const registryRoot = scratch();
  const cacheRoot = scratch();
  const overridesRoot = scratch();
  await runInit({ cwd: dir });
  const configPath = join(dir, 'rubric.config.json');

  const result = await runWatch({
    cwd: dir, configPath,
    mock: true, once: true,
    registryRoot, cacheRoot, overridesRoot,
    write: () => {},
  });

  // Pull the first cell from the run to build a cell-ref.
  const cells = readFileSync(join(registryRoot, result.runId, 'cells.jsonl'), 'utf8').trim().split('\n');
  const first = JSON.parse(cells[0]!);
  const cellRef = `case-${first.caseIndex}/${first.model}`;

  return { dir, configPath, registryRoot, cacheRoot, overridesRoot, runId: result.runId, cellRef };
}

describe('runDisagree', () => {
  test('appends an override record for the latest run in this project', async () => {
    const s = await setupRunWithWatch();
    const result = await runDisagree({
      cellRef: s.cellRef,
      verdict: 'a',
      reason: 'mock judge was wrong',
      configPath: s.configPath,
      cwd: s.dir,
      registryRoot: s.registryRoot,
      overridesRoot: s.overridesRoot,
      write: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(result.op).toBe('override');
    expect(result.runId).toBe(s.runId);

    const records = readOverrideLog(s.configPath, s.overridesRoot);
    expect(records.length).toBe(1);
    expect(records[0]!.verdict).toBe('a');
    expect(records[0]!.reason).toBe('mock judge was wrong');
    expect(records[0]!.cellRef).toBe(s.cellRef);
  });

  test('the written contentKey matches what watch will look up next iteration', async () => {
    const s = await setupRunWithWatch();
    await runDisagree({
      cellRef: s.cellRef, verdict: 'a',
      configPath: s.configPath, cwd: s.dir,
      registryRoot: s.registryRoot, overridesRoot: s.overridesRoot,
      write: () => {},
    });
    const actives = loadActiveOverrides(s.configPath, s.overridesRoot);
    expect(actives.size).toBe(1);

    // Re-run watch; it should surface the override in its report.
    const secondRegistry = scratch();
    let sawOverride = 0;
    await runWatch({
      cwd: s.dir, configPath: s.configPath,
      mock: true, once: true,
      registryRoot: secondRegistry, cacheRoot: s.cacheRoot, overridesRoot: s.overridesRoot,
      write: () => {},
      onIteration: (r) => { sawOverride = r.overridesApplied; },
    });
    expect(sawOverride).toBe(1);
  });

  test('--undo appends an undo record and nullifies the active override', async () => {
    const s = await setupRunWithWatch();
    await runDisagree({
      cellRef: s.cellRef, verdict: 'a',
      configPath: s.configPath, cwd: s.dir,
      registryRoot: s.registryRoot, overridesRoot: s.overridesRoot,
      write: () => {},
    });
    expect(loadActiveOverrides(s.configPath, s.overridesRoot).size).toBe(1);

    await runDisagree({
      cellRef: s.cellRef, undo: true,
      configPath: s.configPath, cwd: s.dir,
      registryRoot: s.registryRoot, overridesRoot: s.overridesRoot,
      write: () => {},
    });
    expect(loadActiveOverrides(s.configPath, s.overridesRoot).size).toBe(0);

    // Both records still in the raw log — the audit trail is preserved.
    const records = readOverrideLog(s.configPath, s.overridesRoot);
    expect(records.length).toBe(2);
    expect(records[0]!.op).toBe('override');
    expect(records[1]!.op).toBe('undo');
  });

  test('errors when the cell ref points to a case out of range', async () => {
    const s = await setupRunWithWatch();
    await expect(
      runDisagree({
        cellRef: 'case-9999/openai/gpt-4o', verdict: 'b',
        configPath: s.configPath, cwd: s.dir,
        registryRoot: s.registryRoot, overridesRoot: s.overridesRoot,
        write: () => {},
      }),
    ).rejects.toThrow(/out of range/);
  });

  test('errors when the cell ref names a model that was not in the run', async () => {
    const s = await setupRunWithWatch();
    await expect(
      runDisagree({
        cellRef: 'case-0/openai/non-existent-model', verdict: 'b',
        configPath: s.configPath, cwd: s.dir,
        registryRoot: s.registryRoot, overridesRoot: s.overridesRoot,
        write: () => {},
      }),
    ).rejects.toThrow(/not found in run/);
  });

  test('errors when no run exists and --run is not supplied', async () => {
    const dir = scratch();
    const registryRoot = scratch();
    const overridesRoot = scratch();
    await runInit({ cwd: dir });
    const configPath = join(dir, 'rubric.config.json');
    await expect(
      runDisagree({
        cellRef: 'case-0/openai/gpt-4o', verdict: 'b',
        configPath, cwd: dir, registryRoot, overridesRoot,
        write: () => {},
      }),
    ).rejects.toThrow(/no runs found/);
  });

  test('requires --verdict unless --undo', async () => {
    const s = await setupRunWithWatch();
    await expect(
      runDisagree({
        cellRef: s.cellRef,
        configPath: s.configPath, cwd: s.dir,
        registryRoot: s.registryRoot, overridesRoot: s.overridesRoot,
        write: () => {},
      }),
    ).rejects.toThrow(/--verdict/);
  });

  test('--run <id> pins the override to a specific run', async () => {
    const s = await setupRunWithWatch();

    // Create a second run against the same project.
    const secondRegistry = scratch();
    const second = await runWatch({
      cwd: s.dir, configPath: s.configPath,
      mock: true, once: true,
      registryRoot: secondRegistry, cacheRoot: s.cacheRoot, overridesRoot: s.overridesRoot,
      write: () => {},
    });

    const result = await runDisagree({
      cellRef: s.cellRef, verdict: 'b', runId: second.runId,
      configPath: s.configPath, cwd: s.dir,
      registryRoot: secondRegistry, overridesRoot: s.overridesRoot,
      write: () => {},
    });
    expect(result.runId).toBe(second.runId);
  });
});
