/**
 * Zero-dependency Node HTTP server for `rubric serve`. Reuses runEval
 * from packages/shared, so the server is a thin routing layer — all the
 * evaluation logic comes from the same engine the CLI uses.
 *
 * SSE is the streaming transport for `/api/run` so the UI can render the
 * result grid cell-by-cell as they resolve, instead of waiting for the full
 * sweep to finish.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import {
  createConfiguredProviders,
  createMockJudge,
  createMockProvider,
  createOpenAIJudge,
  createStructuralJudge,
  defaultRegistryRoot,
  listRuns,
  loadConfig,
  parseCasesJsonl,
  readCells,
  readManifest,
  resolveCriteria,
  runEval,
  type Case,
  type CellResult,
  type Config,
  type Criteria,
  type Judge,
  type Provider,
  type ProviderConfig,
  type RunManifest,
} from '../../../shared/src/index.ts';

export interface ServerOptions {
  cwd?: string;
  configPath?: string;
  mock?: boolean;
  port?: number;
  host?: string;
  /** Custom index.html content; falls back to the bundled default when absent. */
  indexHtml?: string;
  /** Override the registry root used by the `/api/runs` routes. Defaults to `defaultRegistryRoot()` (`~/.rubric/runs`). */
  registryRoot?: string;
}

export interface WorkspaceSnapshot {
  configPath: string;
  config: Config;
  prompts: { baseline: string; candidate: string };
  cases: Case[];
  resolved: { baseline: string; candidate: string; dataset: string };
  baseDir: string;
}

function loadWorkspace(cwd: string, configPath: string): WorkspaceSnapshot {
  const loaded = loadConfig(configPath);
  const prompts = {
    baseline: readFileSync(loaded.resolved.baseline, 'utf8'),
    candidate: readFileSync(loaded.resolved.candidate, 'utf8'),
  };
  const datasetText = readFileSync(loaded.resolved.dataset, 'utf8');
  const cases = parseCasesJsonl(datasetText);
  return { configPath: loaded.path, config: loaded.config, prompts, cases, resolved: loaded.resolved, baseDir: loaded.baseDir };
}

function buildProviders(mock: boolean, userProviders: ProviderConfig[] | undefined, baseDir: string): Provider[] {
  if (mock) return [createMockProvider({ acceptAll: true })];
  return createConfiguredProviders(userProviders, baseDir);
}

function buildJudge(mock: boolean, config: Config, providers: Provider[], criteria: string, originalCriteria: Criteria): Judge {
  if (mock) return createMockJudge({ verdict: 'tie', reason: 'mock judge' });
  if (originalCriteria === 'structural-json') return createStructuralJudge();
  const judgeProvider = providers.find((p) => p.supports(config.judge.model));
  if (!judgeProvider) {
    throw new Error(`no provider accepts judge.model "${config.judge.model}"`);
  }
  return createOpenAIJudge({ provider: judgeProvider, model: config.judge.model, criteria });
}

async function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.end(body);
}

function openSse(res: ServerResponse): { send: (event: string, data: unknown) => void; close: () => void } {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();

  return {
    send(event, data) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      res.end();
    },
  };
}

export interface Handlers {
  getWorkspace: () => WorkspaceSnapshot;
  savePrompt: (which: 'baseline' | 'candidate', content: string) => void;
  runSweep: (opts: { mock: boolean }) => Promise<{
    iterate: () => AsyncIterable<{ type: 'cell'; cell: CellResult; progress: { done: number; total: number } } | { type: 'done'; cells: CellResult[] }>;
  }>;
  /** Enumerate runs from the registry, newest first. Omit cells to keep payload small. */
  listRuns: (opts?: { limit?: number }) => RunManifest[];
  /** Fetch a run's manifest + all cells. 404 when the id is unknown. */
  loadRun: (id: string) => { manifest: RunManifest; cells: CellResult[] };
}

export function makeHandlers(opts: ServerOptions = {}): Handlers {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, 'rubric.config.json');
  const registryRoot = opts.registryRoot ?? defaultRegistryRoot();

  return {
    getWorkspace: () => loadWorkspace(cwd, configPath),
    listRuns(listOpts) {
      const runs = listRuns(registryRoot);
      const limit = listOpts?.limit;
      if (limit !== undefined && limit > 0) return runs.slice(0, limit);
      return runs;
    },
    loadRun(id) {
      const manifest = readManifest(registryRoot, id);
      const cells = readCells(registryRoot, id);
      return { manifest, cells };
    },
    savePrompt(which, content) {
      const ws = loadWorkspace(cwd, configPath);
      const target = which === 'baseline' ? ws.resolved.baseline : ws.resolved.candidate;
      writeFileSync(target, content, 'utf8');
    },
    async runSweep({ mock }) {
      const ws = loadWorkspace(cwd, configPath);
      const providers = buildProviders(mock, ws.config.providers, ws.baseDir);
      const criteriaText = resolveCriteria(ws.config.judge.criteria, ws.baseDir);
      const judge = buildJudge(mock, ws.config, providers, criteriaText, ws.config.judge.criteria);
      const configForRun: Config = {
        ...ws.config,
        judge: { ...ws.config.judge, criteria: { custom: criteriaText } },
      };

      let pushCell: ((c: CellResult, p: { done: number; total: number }) => void) | null = null;
      const queue: Array<{ type: 'cell'; cell: CellResult; progress: { done: number; total: number } }> = [];
      let finalCells: CellResult[] | null = null;
      let resolveNext: (() => void) | null = null;

      const runPromise = runEval({
        config: configForRun,
        cases: ws.cases,
        prompts: ws.prompts,
        providers,
        judge,
        onCell: (cell, progress) => {
          queue.push({ type: 'cell', cell, progress });
          if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r();
          }
        },
      }).then((result) => {
        finalCells = result.cells;
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r();
        }
      });

      return {
        iterate(): AsyncIterable<{ type: 'cell'; cell: CellResult; progress: { done: number; total: number } } | { type: 'done'; cells: CellResult[] }> {
          return {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  while (queue.length === 0 && finalCells === null) {
                    await new Promise<void>((r) => { resolveNext = r; });
                  }
                  if (queue.length > 0) {
                    return { value: queue.shift()!, done: false as const };
                  }
                  await runPromise; // ensure any throw propagates
                  return { value: { type: 'done' as const, cells: finalCells! }, done: false as const };
                },
              };
            },
          };
        },
      };
    },
  };
}

export function createHttpServer(opts: ServerOptions, handlers: Handlers, indexHtml: string) {
  return createServer(async (req, res) => {
    try {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';

      if (method === 'GET' && (url === '/' || url === '/index.html')) {
        sendText(res, 200, indexHtml, 'text/html; charset=utf-8');
        return;
      }

      if (method === 'GET' && url === '/api/workspace') {
        const ws = handlers.getWorkspace();
        sendJson(res, 200, {
          configPath: ws.configPath,
          config: ws.config,
          prompts: ws.prompts,
          cases: ws.cases,
        });
        return;
      }

      // Run registry — browse history, reload a run, diff two runs client-side.
      if (method === 'GET' && url.startsWith('/api/runs')) {
        // /api/runs                     → list
        // /api/runs?limit=20             → list, capped
        // /api/runs/<id>                 → manifest + cells for one run
        const qIdx = url.indexOf('?');
        const pathPart = qIdx === -1 ? url : url.slice(0, qIdx);
        const query = qIdx === -1 ? '' : url.slice(qIdx + 1);
        const segments = pathPart.split('/').filter(Boolean); // ['api','runs', <id?>]
        if (segments.length === 2) {
          const limitRaw = new URLSearchParams(query).get('limit');
          const limit = limitRaw !== null ? Math.max(0, Number(limitRaw)) : undefined;
          try {
            const runs = handlers.listRuns(limit !== undefined ? { limit } : undefined);
            sendJson(res, 200, { runs });
          } catch (err) {
            sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        if (segments.length === 3) {
          const id = decodeURIComponent(segments[2]!);
          try {
            const { manifest, cells } = handlers.loadRun(id);
            sendJson(res, 200, { manifest, cells });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const notFound = /not found|ENOENT|no manifest/i.test(msg);
            sendJson(res, notFound ? 404 : 500, { error: msg });
          }
          return;
        }
        sendJson(res, 404, { error: `no route for ${method} ${url}` });
        return;
      }

      if (method === 'PATCH' && url === '/api/prompts') {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as { which?: string; content?: string };
        if (parsed.which !== 'baseline' && parsed.which !== 'candidate') {
          sendJson(res, 400, { error: 'which must be "baseline" or "candidate"' });
          return;
        }
        if (typeof parsed.content !== 'string') {
          sendJson(res, 400, { error: 'content must be a string' });
          return;
        }
        handlers.savePrompt(parsed.which, parsed.content);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && url === '/api/run') {
        const body = req.headers['content-length'] && Number(req.headers['content-length']) > 0
          ? await readBody(req)
          : '{}';
        const parsed = JSON.parse(body) as { mock?: boolean };
        const mock = parsed.mock === true || opts.mock === true;
        const sse = openSse(res);
        try {
          const { iterate } = await handlers.runSweep({ mock });
          for await (const evt of iterate()) {
            sse.send(evt.type, evt);
            if (evt.type === 'done') break;
          }
        } catch (err) {
          sse.send('error', { message: err instanceof Error ? err.message : String(err) });
        } finally {
          sse.close();
        }
        return;
      }

      sendJson(res, 404, { error: `no route for ${method} ${url}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) sendJson(res, 500, { error: msg });
      else res.end();
    }
  });
}
