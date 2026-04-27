import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from './init.ts';
import { runWatch } from './watch.ts';

const cleanup: string[] = [];

function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'rubric-watch-'));
  cleanup.push(d);
  return d;
}

afterEach(() => {
  while (cleanup.length > 0) {
    const d = cleanup.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

async function setupProject(): Promise<{ dir: string; registryRoot: string; cacheRoot: string }> {
  const dir = scratch();
  const registryRoot = scratch();
  const cacheRoot = scratch();
  await runInit({ cwd: dir });
  return { dir, registryRoot, cacheRoot };
}

describe('runWatch (once mode)', () => {
  test('completes one iteration in mock mode and writes a registry run', async () => {
    const { dir, registryRoot, cacheRoot } = await setupProject();
    const lines: string[] = [];
    const write = (s: string) => { lines.push(s); };

    const result = await runWatch({
      cwd: dir,
      configPath: join(dir, 'rubric.config.json'),
      mock: true,
      once: true,
      registryRoot,
      cacheRoot,
      write,
    });

    expect(result.exitCode).toBe(0);
    expect(result.iterations).toBe(1);
    expect(result.runId).toMatch(/^r-/);

    const manifest = JSON.parse(readFileSync(join(registryRoot, result.runId, 'manifest.json'), 'utf8'));
    expect(manifest.status).toBe('complete');
    expect(manifest.note).toBe('watch session');

    const cells = readFileSync(join(registryRoot, result.runId, 'cells.jsonl'), 'utf8').trim().split('\n');
    expect(cells.length).toBeGreaterThan(0);
    for (const raw of cells) {
      const cell = JSON.parse(raw);
      expect(typeof cell.caseIndex).toBe('number');
      expect('judge' in cell).toBe(true);
    }

    const joined = lines.join('');
    expect(joined).toContain('iteration 1');
    expect(joined).toContain('winRate');
  });

  test('warm cache: second --once iteration is all hits, zero misses', async () => {
    const { dir, registryRoot, cacheRoot } = await setupProject();

    const firstReports: Array<{ hits: number; misses: number }> = [];
    await runWatch({
      cwd: dir,
      configPath: join(dir, 'rubric.config.json'),
      mock: true,
      once: true,
      registryRoot,
      cacheRoot,
      write: () => {},
      onIteration: (r) => firstReports.push({ hits: r.cacheHits, misses: r.cacheMisses }),
    });

    expect(firstReports.length).toBe(1);
    expect(firstReports[0]!.hits).toBe(0);
    expect(firstReports[0]!.misses).toBeGreaterThan(0);
    const totalCells = firstReports[0]!.misses;

    // Second session — same files, same cache root → every cell should hit.
    const secondRegistry = scratch();
    const secondReports: Array<{ hits: number; misses: number }> = [];
    await runWatch({
      cwd: dir,
      configPath: join(dir, 'rubric.config.json'),
      mock: true,
      once: true,
      registryRoot: secondRegistry,
      cacheRoot,
      write: () => {},
      onIteration: (r) => secondReports.push({ hits: r.cacheHits, misses: r.cacheMisses }),
    });

    expect(secondReports.length).toBe(1);
    expect(secondReports[0]!.misses).toBe(0);
    expect(secondReports[0]!.hits).toBe(totalCells);
  });

  test('editing the candidate prompt invalidates its cell cache entries', async () => {
    const { dir, registryRoot, cacheRoot } = await setupProject();
    const candidatePath = join(dir, 'prompts/candidate.md');

    const firstReports: Array<{ hits: number; misses: number }> = [];
    await runWatch({
      cwd: dir, configPath: join(dir, 'rubric.config.json'),
      mock: true, once: true,
      registryRoot, cacheRoot,
      write: () => {},
      onIteration: (r) => firstReports.push({ hits: r.cacheHits, misses: r.cacheMisses }),
    });
    const cellCount = firstReports[0]!.misses;
    expect(cellCount).toBeGreaterThan(0);

    // Mutate candidate prompt; baseline unchanged.
    const original = readFileSync(candidatePath, 'utf8');
    writeFileSync(candidatePath, original + '\n\n// edited for test', 'utf8');

    const secondRegistry = scratch();
    const secondReports: Array<{ hits: number; misses: number }> = [];
    await runWatch({
      cwd: dir, configPath: join(dir, 'rubric.config.json'),
      mock: true, once: true,
      registryRoot: secondRegistry, cacheRoot,
      write: () => {},
      onIteration: (r) => secondReports.push({ hits: r.cacheHits, misses: r.cacheMisses }),
    });

    // The candidate prompt participates in every cell's key, so all cells miss.
    expect(secondReports[0]!.hits).toBe(0);
    expect(secondReports[0]!.misses).toBe(cellCount);
  });

  test('--no-cache always misses even after an initial pass', async () => {
    const { dir, registryRoot, cacheRoot } = await setupProject();

    await runWatch({
      cwd: dir, configPath: join(dir, 'rubric.config.json'),
      mock: true, once: true,
      registryRoot, cacheRoot,
      write: () => {},
    });

    const secondRegistry = scratch();
    const reports: Array<{ hits: number; misses: number }> = [];
    await runWatch({
      cwd: dir, configPath: join(dir, 'rubric.config.json'),
      mock: true, once: true, noCache: true,
      registryRoot: secondRegistry, cacheRoot,
      write: () => {},
      onIteration: (r) => reports.push({ hits: r.cacheHits, misses: r.cacheMisses }),
    });

    expect(reports[0]!.hits).toBe(0);
    expect(reports[0]!.misses).toBeGreaterThan(0);
  });

  test('rejects configs that still declare the removed compare-models mode', async () => {
    const { dir, registryRoot, cacheRoot } = await setupProject();
    const configPath = join(dir, 'rubric.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.mode = 'compare-models';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    await expect(
      runWatch({
        cwd: dir, configPath,
        mock: true, once: true,
        registryRoot, cacheRoot,
        write: () => {},
      }),
    ).rejects.toThrow(/compare-models.*removed/i);
  });
});
