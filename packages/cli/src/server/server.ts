/**
 * Zero-dependency Node HTTP server for `diffprompt serve`. Reuses runEval
 * from packages/shared, so the server is a thin routing layer — all the
 * evaluation logic comes from the same engine the CLI uses.
 *
 * SSE is the streaming transport for `/api/run` so the UI can render the
 * result grid cell-by-cell as they resolve, instead of waiting for the full
 * sweep to finish.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import {
  createGroqProvider,
  createMockJudge,
  createMockProvider,
  createOllamaProvider,
  createOpenAIJudge,
  createOpenAIProvider,
  createOpenRouterProvider,
  createStructuralJudge,
  loadConfig,
  parseCasesJsonl,
  resolveRubric,
  runEval,
  type Case,
  type CellResult,
  type Config,
  type Judge,
  type Provider,
  type Rubric,
} from '../../../shared/src/index.ts';

export interface ServerOptions {
  cwd?: string;
  configPath?: string;
  mock?: boolean;
  port?: number;
  host?: string;
  /** Custom index.html content; falls back to the bundled default when absent. */
  indexHtml?: string;
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
  const cases = parseCasesJsonl(datasetText, { allowLangfuse: false });
  return { configPath: loaded.path, config: loaded.config, prompts, cases, resolved: loaded.resolved, baseDir: loaded.baseDir };
}

function buildProviders(mock: boolean): Provider[] {
  if (mock) return [createMockProvider({ acceptAll: true })];
  return [
    createOpenAIProvider(),
    createGroqProvider(),
    createOpenRouterProvider(),
    createOllamaProvider(),
  ];
}

function buildJudge(mock: boolean, config: Config, providers: Provider[], rubric: string, originalRubric: Rubric): Judge {
  if (mock) return createMockJudge({ verdict: 'tie', reason: 'mock judge' });
  if (originalRubric === 'structural-json') return createStructuralJudge();
  const judgeProvider = providers.find((p) => p.supports(config.judge.model));
  if (!judgeProvider) {
    throw new Error(`no provider accepts judge.model "${config.judge.model}"`);
  }
  return createOpenAIJudge({ provider: judgeProvider, model: config.judge.model, rubric });
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

export interface CalibrationLabel {
  input: string;
  output: string;
  polarity: 'positive' | 'negative';
  reason?: string;
}

export interface Handlers {
  getWorkspace: () => WorkspaceSnapshot;
  savePrompt: (which: 'baseline' | 'candidate', content: string) => void;
  appendCalibrationLabel: (label: CalibrationLabel) => { path: string; entryCount: number };
  runSweep: (opts: { mock: boolean; mode?: 'compare-prompts' | 'compare-models' }) => Promise<{
    iterate: () => AsyncIterable<{ type: 'cell'; cell: CellResult; progress: { done: number; total: number } } | { type: 'done'; cells: CellResult[] }>;
  }>;
}

function calibrationPathFor(ws: WorkspaceSnapshot): string {
  return resolve(dirname(ws.resolved.baseline), '_calibration.json.local');
}

function readCalibrationEntries(path: string): CalibrationLabel[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`existing calibration file is not valid JSON: ${msg}`);
  }
  if (
    typeof parsed !== 'object' || parsed === null
    || !Array.isArray((parsed as Record<string, unknown>).entries)
  ) {
    throw new Error(`calibration file at ${path} must be { "entries": [...] }`);
  }
  return (parsed as { entries: CalibrationLabel[] }).entries;
}

export function makeHandlers(opts: ServerOptions): Handlers {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, 'diffprompt.config.json');

  return {
    getWorkspace: () => loadWorkspace(cwd, configPath),
    savePrompt(which, content) {
      const ws = loadWorkspace(cwd, configPath);
      const target = which === 'baseline' ? ws.resolved.baseline : ws.resolved.candidate;
      writeFileSync(target, content, 'utf8');
    },
    appendCalibrationLabel(label) {
      const ws = loadWorkspace(cwd, configPath);
      const path = calibrationPathFor(ws);
      const existing = readCalibrationEntries(path);
      const entry: CalibrationLabel = {
        input: label.input,
        output: label.output,
        polarity: label.polarity,
      };
      if (label.reason) entry.reason = label.reason;
      existing.push(entry);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ entries: existing }, null, 2) + '\n', 'utf8');
      return { path, entryCount: existing.length };
    },
    async runSweep({ mock, mode }) {
      const ws = loadWorkspace(cwd, configPath);
      const providers = buildProviders(mock);
      const rubricText = resolveRubric(ws.config.judge.rubric, ws.baseDir);
      const judge = buildJudge(mock, ws.config, providers, rubricText, ws.config.judge.rubric);
      const base: Config = {
        ...ws.config,
        judge: { ...ws.config.judge, rubric: { custom: rubricText } },
      };
      const configForRun: Config = mode ? { ...base, mode } : base;

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

      if (method === 'POST' && url === '/api/calibration') {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as Partial<CalibrationLabel>;
        if (typeof parsed.input !== 'string' || typeof parsed.output !== 'string') {
          sendJson(res, 400, { error: 'input and output must be strings' });
          return;
        }
        if (parsed.polarity !== 'positive' && parsed.polarity !== 'negative') {
          sendJson(res, 400, { error: 'polarity must be "positive" or "negative"' });
          return;
        }
        const label: CalibrationLabel = {
          input: parsed.input,
          output: parsed.output,
          polarity: parsed.polarity,
        };
        if (typeof parsed.reason === 'string' && parsed.reason.length > 0) label.reason = parsed.reason;
        const result = handlers.appendCalibrationLabel(label);
        sendJson(res, 200, { ok: true, path: result.path, entryCount: result.entryCount });
        return;
      }

      if (method === 'POST' && url === '/api/run') {
        const body = req.headers['content-length'] && Number(req.headers['content-length']) > 0
          ? await readBody(req)
          : '{}';
        const parsed = JSON.parse(body) as { mock?: boolean; mode?: unknown };
        const mock = parsed.mock === true || opts.mock === true;
        let mode: 'compare-prompts' | 'compare-models' | undefined;
        if (parsed.mode === 'compare-prompts' || parsed.mode === 'compare-models') {
          mode = parsed.mode;
        }
        const sse = openSse(res);
        try {
          const sweepOpts: { mock: boolean; mode?: 'compare-prompts' | 'compare-models' } = { mock };
          if (mode) sweepOpts.mode = mode;
          const { iterate } = await handlers.runSweep(sweepOpts);
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
