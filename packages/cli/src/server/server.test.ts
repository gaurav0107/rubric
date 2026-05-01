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
  overridesRoot?: string,
): Promise<T> {
  const serverOpts = overridesRoot
    ? { cwd: workspaceCwd, registryRoot, overridesRoot }
    : { cwd: workspaceCwd, registryRoot };
  const handlers = makeHandlers(serverOpts);
  const server = createHttpServer(serverOpts, handlers, '<html></html>');
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

});

/**
 * Seed a minimal real workspace on disk so /api/overrides can resolve the
 * config, prompts, and dataset. We need actual files here — the override
 * handler re-loads the workspace to derive the contentKey, matching the
 * behavior of `rubric disagree`.
 */
function seedFullWorkspace(root: string): string {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'prompts'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'prompts', 'baseline.md'), 'Baseline: {{input}}', 'utf8');
  writeFileSync(join(root, 'prompts', 'candidate.md'), 'Candidate: {{input}}', 'utf8');
  writeFileSync(
    join(root, 'data', 'cases.jsonl'),
    ['{"input":"one"}', '{"input":"two"}'].join('\n') + '\n',
    'utf8',
  );
  const configPath = join(root, 'rubric.config.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        prompts: { baseline: 'prompts/baseline.md', candidate: 'prompts/candidate.md' },
        dataset: 'data/cases.jsonl',
        models: ['openai/gpt-4o-mini'],
        judge: { model: 'openai/gpt-4o', criteria: 'default' },
      },
      null,
      2,
    ),
    'utf8',
  );
  return configPath;
}

describe('/api/overrides', () => {
  test('POST + GET round-trip: appending an override surfaces it in the active list', async () => {
    const workCwd = mkdtempSync(join(tmpdir(), 'rubric-serve-ovr-cwd-'));
    const ovrRoot = mkdtempSync(join(tmpdir(), 'rubric-serve-ovr-root-'));
    const registry = mkdtempSync(join(tmpdir(), 'rubric-serve-ovr-reg-'));
    seedFullWorkspace(workCwd);
    try {
      await withServer(
        registry,
        workCwd,
        async (url) => {
          // Starts empty.
          const pre = await fetch(`${url}/api/overrides`);
          expect(pre.status).toBe(200);
          const preBody = await pre.json() as { overrides: unknown[] };
          expect(preBody.overrides).toEqual([]);

          // Append one override.
          const post = await fetch(`${url}/api/overrides`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              caseIndex: 0,
              model: 'openai/gpt-4o-mini',
              verdict: 'a',
              reason: 'judge missed the regression',
            }),
          });
          expect(post.status).toBe(200);
          const postBody = await post.json() as { op: string; verdict: string; cellRef: string; contentKey: string };
          expect(postBody.op).toBe('override');
          expect(postBody.verdict).toBe('a');
          expect(postBody.cellRef).toBe('case-0/openai/gpt-4o-mini');
          expect(postBody.contentKey.length).toBe(64);

          // GET surfaces it.
          const after = await fetch(`${url}/api/overrides`);
          const afterBody = await after.json() as { overrides: Array<{ verdict: string; reason?: string; cellRef: string }> };
          expect(afterBody.overrides.length).toBe(1);
          expect(afterBody.overrides[0]!.verdict).toBe('a');
          expect(afterBody.overrides[0]!.reason).toBe('judge missed the regression');
          expect(afterBody.overrides[0]!.cellRef).toBe('case-0/openai/gpt-4o-mini');
        },
        ovrRoot,
      );
    } finally {
      rmSync(workCwd, { recursive: true, force: true });
      rmSync(ovrRoot, { recursive: true, force: true });
      rmSync(registry, { recursive: true, force: true });
    }
  });

  test('POST with undo=true removes the active override (latest-wins)', async () => {
    const workCwd = mkdtempSync(join(tmpdir(), 'rubric-serve-ovr-undo-cwd-'));
    const ovrRoot = mkdtempSync(join(tmpdir(), 'rubric-serve-ovr-undo-root-'));
    const registry = mkdtempSync(join(tmpdir(), 'rubric-serve-ovr-undo-reg-'));
    seedFullWorkspace(workCwd);
    try {
      await withServer(
        registry,
        workCwd,
        async (url) => {
          // Override, then undo.
          await fetch(`${url}/api/overrides`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ caseIndex: 1, model: 'openai/gpt-4o-mini', verdict: 'b' }),
          });
          const undo = await fetch(`${url}/api/overrides`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ caseIndex: 1, model: 'openai/gpt-4o-mini', undo: true }),
          });
          expect(undo.status).toBe(200);
          const undoBody = await undo.json() as { op: string };
          expect(undoBody.op).toBe('undo');

          const after = await fetch(`${url}/api/overrides`);
          const afterBody = await after.json() as { overrides: unknown[] };
          expect(afterBody.overrides).toEqual([]);
        },
        ovrRoot,
      );
    } finally {
      rmSync(workCwd, { recursive: true, force: true });
      rmSync(ovrRoot, { recursive: true, force: true });
      rmSync(registry, { recursive: true, force: true });
    }
  });

  test('POST rejects bad payloads with a 400', async () => {
    const workCwd = mkdtempSync(join(tmpdir(), 'rubric-serve-ovr-bad-cwd-'));
    const ovrRoot = mkdtempSync(join(tmpdir(), 'rubric-serve-ovr-bad-root-'));
    const registry = mkdtempSync(join(tmpdir(), 'rubric-serve-ovr-bad-reg-'));
    seedFullWorkspace(workCwd);
    try {
      await withServer(
        registry,
        workCwd,
        async (url) => {
          // Missing caseIndex.
          const r1 = await fetch(`${url}/api/overrides`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'openai/gpt-4o-mini', verdict: 'a' }),
          });
          expect(r1.status).toBe(400);

          // Bogus verdict.
          const r2 = await fetch(`${url}/api/overrides`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ caseIndex: 0, model: 'openai/gpt-4o-mini', verdict: 'nope' }),
          });
          expect(r2.status).toBe(400);

          // caseIndex out of range (only 2 cases in seed).
          const r3 = await fetch(`${url}/api/overrides`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ caseIndex: 99, model: 'openai/gpt-4o-mini', verdict: 'a' }),
          });
          expect(r3.status).toBe(400);
        },
        ovrRoot,
      );
    } finally {
      rmSync(workCwd, { recursive: true, force: true });
      rmSync(ovrRoot, { recursive: true, force: true });
      rmSync(registry, { recursive: true, force: true });
    }
  });
});
