import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  appendCell,
  createRun,
  updateManifest,
  type CellResult,
  type Config,
  type ModelId,
} from '../../../shared/src/index.ts';
import { createHttpServer, makeHandlers } from './server.ts';

// Minimal synchronous fetch helper — spins up an http server on port 0 and tears
// it down after the block. Avoids baking a test framework dep; matches existing
// test style (bun:test + node APIs only).
async function withServer<T>(
  registryRoot: string,
  workspaceCwd: string,
  body: (url: string) => Promise<T>,
): Promise<T> {
  const handlers = makeHandlers({ cwd: workspaceCwd, registryRoot });
  const server = createHttpServer({ cwd: workspaceCwd, registryRoot }, handlers, '<html></html>');
  await new Promise<void>((r, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => r());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('failed to bind server');
  const url = `http://127.0.0.1:${addr.port}`;
  try {
    return await body(url);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function minimalConfig(): Config {
  return {
    prompts: { baseline: 'prompts/baseline.md', candidate: 'prompts/candidate.md' },
    dataset: 'data/cases.jsonl',
    models: ['openai/gpt-4o-mini' as ModelId],
    judge: { model: 'openai/gpt-4o' as ModelId, criteria: 'default' },
  };
}

function seedWorkspace(cwd: string): void {
  // `getWorkspace` is not needed for /api/runs routes, but loadWorkspace in
  // makeHandlers is only called lazily per request, so we don't need a real
  // workspace unless the test hits a different route.
  mkdirSync(cwd, { recursive: true });
}

let registryRoot: string;
let cwd: string;
let seededRunId: string;

beforeAll(() => {
  registryRoot = mkdtempSync(join(tmpdir(), 'rubric-serve-test-'));
  cwd = mkdtempSync(join(tmpdir(), 'rubric-serve-cwd-'));
  seedWorkspace(cwd);

  // Seed a completed run so /api/runs returns one manifest.
  const { id } = createRun({
    root: registryRoot,
    config: minimalConfig(),
    prompts: { baseline: 'b', candidate: 'c' },
    datasetText: 'd',
    plannedCells: 2,
  });
  seededRunId = id;
  const cell: CellResult = {
    caseIndex: 0,
    model: 'openai/gpt-4o-mini' as ModelId,
    outputA: 'a',
    outputB: 'b',
    judge: { winner: 'b', reason: 'clearer' },
    latencyMs: 42,
  };
  appendCell(registryRoot, id, cell);
  updateManifest(registryRoot, id, {
    status: 'complete',
    finishedAt: new Date().toISOString(),
    summary: { wins: 1, losses: 0, ties: 0, errors: 0, winRate: 1 },
  });
});

afterAll(() => {
  if (registryRoot) rmSync(registryRoot, { recursive: true, force: true });
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

describe('/api/runs', () => {
  test('GET /api/runs returns the seeded run manifest', async () => {
    await withServer(registryRoot, cwd, async (url) => {
      const res = await fetch(`${url}/api/runs`);
      expect(res.status).toBe(200);
      const body = await res.json() as { runs: Array<{ id: string; status: string }> };
      expect(body.runs.length).toBe(1);
      expect(body.runs[0]!.id).toBe(seededRunId);
      expect(body.runs[0]!.status).toBe('complete');
    });
  });

  test('GET /api/runs?limit=1 caps the list', async () => {
    // Seed a second run so limit has something to slice.
    const { id: second } = createRun({
      root: registryRoot,
      config: minimalConfig(),
      prompts: { baseline: 'b2', candidate: 'c2' },
      datasetText: 'd2',
      plannedCells: 1,
    });
    updateManifest(registryRoot, second, { status: 'complete' });
    await withServer(registryRoot, cwd, async (url) => {
      const res = await fetch(`${url}/api/runs?limit=1`);
      const body = await res.json() as { runs: Array<{ id: string }> };
      expect(body.runs.length).toBe(1);
    });
  });

  test('GET /api/runs/<id> returns manifest + cells', async () => {
    await withServer(registryRoot, cwd, async (url) => {
      const res = await fetch(`${url}/api/runs/${encodeURIComponent(seededRunId)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        manifest: { id: string; status: string; summary?: { winRate: number } };
        cells: Array<{ caseIndex: number; judge: { winner?: string } }>;
      };
      expect(body.manifest.id).toBe(seededRunId);
      expect(body.manifest.summary?.winRate).toBe(1);
      expect(body.cells.length).toBe(1);
      expect(body.cells[0]!.caseIndex).toBe(0);
    });
  });

  test('GET /api/runs/<unknown-id> returns 404', async () => {
    await withServer(registryRoot, cwd, async (url) => {
      const res = await fetch(`${url}/api/runs/does-not-exist`);
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/not found|no manifest/i);
    });
  });

  test('GET /api/runs (empty registry) returns []', async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'rubric-serve-empty-'));
    try {
      await withServer(emptyRoot, cwd, async (url) => {
        const res = await fetch(`${url}/api/runs`);
        expect(res.status).toBe(200);
        const body = await res.json() as { runs: unknown[] };
        expect(body.runs).toEqual([]);
      });
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  test('GET /api/runs/<id>/clusters groups losing cells by judge-reason', async () => {
    // Seed a fresh run with multiple losses so clustering has material.
    const { id } = createRun({
      root: registryRoot,
      config: minimalConfig(),
      prompts: { baseline: 'b', candidate: 'c' },
      datasetText: 'd',
      plannedCells: 4,
    });
    const mk = (i: number, winner: 'a' | 'b', reason: string): CellResult => ({
      caseIndex: i,
      model: 'openai/gpt-4o-mini' as ModelId,
      outputA: '',
      outputB: '',
      judge: { winner, reason },
    });
    appendCell(registryRoot, id, mk(0, 'a', 'Candidate was verbose and rambling'));
    appendCell(registryRoot, id, mk(1, 'a', 'Too verbose, with rambling asides'));
    appendCell(registryRoot, id, mk(2, 'a', 'Hallucinated a URL citation'));
    appendCell(registryRoot, id, mk(3, 'b', 'candidate wins'));
    updateManifest(registryRoot, id, { status: 'complete' });
    await withServer(registryRoot, cwd, async (url) => {
      const res = await fetch(`${url}/api/runs/${encodeURIComponent(id)}/clusters`);
      expect(res.status).toBe(200);
      const body = await res.json() as { clusters: Array<{ count: number; caseIndices: number[]; label: string }> };
      expect(body.clusters.length).toBeGreaterThanOrEqual(2);
      expect(body.clusters[0]!.count).toBe(2);
      expect(body.clusters[0]!.caseIndices.sort()).toEqual([0, 1]);
    });
  });

  test('GET /api/runs/<unknown>/clusters returns 404', async () => {
    await withServer(registryRoot, cwd, async (url) => {
      const res = await fetch(`${url}/api/runs/does-not-exist/clusters`);
      expect(res.status).toBe(404);
    });
  });
});
