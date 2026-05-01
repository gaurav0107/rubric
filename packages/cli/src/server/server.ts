/**
 * Zero-dependency Node HTTP server for `rubric serve`. Reuses runEval
 * from packages/shared, so the server is a thin routing layer — all the
 * evaluation logic comes from the same engine the CLI uses.
 *
 * SSE is the streaming transport for `/api/run` so the UI can render the
 * result grid cell-by-cell as they resolve, instead of waiting for the full
 * sweep to finish.
 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import {
  activeOverrides,
  appendOverride,
  computeContentKey,
  createConfiguredProviders,
  createMockJudge,
  createMockProvider,
  createOpenAIJudge,
  createStructuralJudge,
  defaultOverridesRoot,
  defaultRegistryRoot,
  formatCellRef,
  judgeRubricId,
  listRuns,
  loadConfig,
  parseCasesJsonl,
  presetToRubricText,
  readCells,
  readManifest,
  readOverrideLog,
  renderPrompt,
  resolveCriteria,
  runEval,
  type ActiveOverride,
  type Case,
  type CellResult,
  type Config,
  type Criteria,
  type Judge,
  type ModelId,
  type Provider,
  type ProviderConfig,
  type RunManifest,
  type Verdict,
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
  /** Override the overrides root used by the `/api/overrides` routes. Defaults to `defaultOverridesRoot()` (`~/.rubric/overrides`). */
  overridesRoot?: string;
  /**
   * Absolute path to a newline-delimited file of allowed `provider/model` ids.
   * Surfaced to the UI so the header selectors can be dropdowns, not free-text.
   * Defaults to `<baseDir>/.secrets/available_models` — gitignored by the
   * default `.secrets/` rule, matching how bearer tokens are stored.
   * Empty/missing file → `/api/available-models` returns `{ available: [] }`
   * and the UI falls back to free-text entry. One id per line; lines starting
   * with `#` are comments; blanks ignored.
   */
  availableModelsPath?: string;
}

export interface WorkspaceSnapshot {
  configPath: string;
  config: Config;
  prompts: { baseline: string; candidate: string };
  cases: Case[];
  resolved: { baseline: string; candidate: string; dataset: string };
  baseDir: string;
  /**
   * Judge criteria rendered to plain text. Whatever shape the config holds
   * (`"default"` preset, `{custom}`, `{file}`), the UI sees the prompt text the
   * judge model actually receives. Lets us show + edit the rubric inline
   * without the UI having to understand the config's polymorphic Criteria type.
   */
  judgeCriteriaText: string;
  /** The raw config shape, so the UI can tell "this was a preset, editing will flip it to {custom}" from "already {custom}". */
  judgeCriteriaKind: 'preset' | 'custom' | 'file';
}

function loadWorkspace(cwd: string, configPath: string): WorkspaceSnapshot {
  const loaded = loadConfig(configPath);
  const prompts = {
    baseline: readFileSync(loaded.resolved.baseline, 'utf8'),
    candidate: readFileSync(loaded.resolved.candidate, 'utf8'),
  };
  const datasetText = readFileSync(loaded.resolved.dataset, 'utf8');
  const cases = parseCasesJsonl(datasetText);
  // resolveCriteria() returns the preset *name* ("default", "model-comparison")
  // when the config is a preset string; expand those to the actual rubric body
  // the judge receives so the UI shows what's actually prompted.
  const judgeCriteriaRaw = resolveCriteria(loaded.config.judge.criteria, loaded.baseDir);
  const judgeCriteriaText = presetToRubricText(judgeCriteriaRaw);
  let judgeCriteriaKind: 'preset' | 'custom' | 'file';
  if (typeof loaded.config.judge.criteria === 'string') judgeCriteriaKind = 'preset';
  else if ('custom' in loaded.config.judge.criteria) judgeCriteriaKind = 'custom';
  else judgeCriteriaKind = 'file';
  return {
    configPath: loaded.path,
    config: loaded.config,
    prompts,
    cases,
    resolved: loaded.resolved,
    baseDir: loaded.baseDir,
    judgeCriteriaText,
    judgeCriteriaKind,
  };
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

export interface OverrideSubmission {
  caseIndex: number;
  /** A-side model (matches CellResult.model). */
  model: ModelId;
  /** B-side model. Omit in compare-prompts mode; required when modelB !== model on the cell. */
  modelB?: ModelId;
  verdict?: Verdict;
  reason?: string;
  undo?: boolean;
}

export interface OverrideSubmissionResult {
  cellRef: string;
  contentKey: string;
  op: 'override' | 'undo';
  verdict?: Verdict;
  ts: string;
}

/** Payload shape returned by GET /api/overrides and used by the UI to paint ✎ markers. */
export interface ActiveOverrideWire {
  contentKey: string;
  cellRef: string;
  verdict: Verdict;
  ts: string;
  reason?: string;
  runId?: string;
}

/**
 * Live-editable subset of `rubric.config.json`. Only these three fields can be
 * mutated from the UI — everything else (providers, dataset path, evaluators)
 * requires editing the file on disk. This is a deliberate safety boundary:
 * users can iterate on model choice + judge rubric in seconds, but can't
 * accidentally nuke their provider block through the browser.
 */
export interface ConfigPatch {
  /** Replaces `models[]` wholesale. Must parse as `provider/model` strings. */
  models?: ModelId[];
  /** Replaces `judge.model`. */
  judgeModel?: ModelId;
  /** Replaces `judge.criteria` with `{ custom: text }`. Pass "" to reset to `"default"`. */
  judgeCriteriaCustom?: string;
}

export interface Handlers {
  getWorkspace: () => WorkspaceSnapshot;
  savePrompt: (which: 'baseline' | 'candidate', content: string) => void;
  /** Mutate the narrow live-editable subset of the config and persist to disk. */
  saveConfig: (patch: ConfigPatch) => void;
  runSweep: (opts: { mock: boolean }) => Promise<{
    iterate: () => AsyncIterable<{ type: 'cell'; cell: CellResult; progress: { done: number; total: number } } | { type: 'done'; cells: CellResult[] }>;
  }>;
  /** Enumerate runs from the registry, newest first. Omit cells to keep payload small. */
  listRuns: (opts?: { limit?: number }) => RunManifest[];
  /** Fetch a run's manifest + all cells. 404 when the id is unknown. */
  loadRun: (id: string) => { manifest: RunManifest; cells: CellResult[] };
  /** Append an override/undo record to the project's override log. */
  submitOverride: (input: OverrideSubmission) => OverrideSubmissionResult;
  /** List currently-active overrides (latest-wins collapse) for this project. */
  listOverrides: () => ActiveOverrideWire[];
  /** Read the newline-delimited allowed-models file. Missing/empty returns []. */
  listAvailableModels: () => string[];
}

export function makeHandlers(opts: ServerOptions = {}): Handlers {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, 'rubric.config.json');
  const registryRoot = opts.registryRoot ?? defaultRegistryRoot();
  const overridesRoot = opts.overridesRoot ?? defaultOverridesRoot();
  // Default lives under the workspace dir so it rides `.secrets/` gitignore
  // without any extra config. Users can override for shared team files.
  const availableModelsPath = opts.availableModelsPath ?? resolve(cwd, '.secrets', 'available_models');

  function toWire(a: ActiveOverride): ActiveOverrideWire {
    const out: ActiveOverrideWire = {
      contentKey: a.contentKey,
      cellRef: a.cellRef,
      verdict: a.verdict,
      ts: a.ts,
    };
    if (a.reason !== undefined) out.reason = a.reason;
    if (a.runId !== undefined) out.runId = a.runId;
    return out;
  }

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
    saveConfig(patch) {
      // Read the raw JSON (not the parsed+validated Config) so we only touch
      // the keys in the patch — every other field (providers, dataset, mode,
      // evaluators, comments-as-spacing) round-trips byte-for-byte.
      const raw = readFileSync(configPath, 'utf8');
      const obj = JSON.parse(raw) as Record<string, unknown>;

      if (patch.models !== undefined) {
        if (!Array.isArray(patch.models) || patch.models.length === 0) {
          throw new Error('models[] must be a non-empty array');
        }
        for (const m of patch.models) {
          if (typeof m !== 'string' || !m.includes('/')) {
            throw new Error(`model "${m}" must be a "provider/model" string`);
          }
        }
        obj.models = patch.models;
      }

      const judge = (obj.judge && typeof obj.judge === 'object')
        ? obj.judge as Record<string, unknown>
        : {};
      if (patch.judgeModel !== undefined) {
        if (typeof patch.judgeModel !== 'string' || !patch.judgeModel.includes('/')) {
          throw new Error(`judge.model "${patch.judgeModel}" must be a "provider/model" string`);
        }
        judge.model = patch.judgeModel;
        obj.judge = judge;
      }
      if (patch.judgeCriteriaCustom !== undefined) {
        // Empty string → reset to the "default" preset so the UI has an
        // explicit "restore default" lever. Non-empty → store as {custom} and
        // leave file:{...} shapes behind (editing lifts the rubric inline).
        if (patch.judgeCriteriaCustom.length === 0) {
          judge.criteria = 'default';
        } else {
          judge.criteria = { custom: patch.judgeCriteriaCustom };
        }
        obj.judge = judge;
      }

      // Preserve trailing newline, match 2-space indent used by `rubric init`.
      const serialized = JSON.stringify(obj, null, 2) + (raw.endsWith('\n') ? '\n' : '');
      // Re-validate by feeding through loadConfig — fail loudly and DO NOT
      // overwrite the file if the patch would produce an invalid config.
      // We write to a temp buffer first, run a structural parse against a
      // throwaway load to catch validation errors, then commit.
      const tmp = `${configPath}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tmp, serialized, 'utf8');
      try {
        loadConfig(tmp); // throws on invalid shape
      } catch (err) {
        try { unlinkSync(tmp); } catch { /* best-effort */ }
        throw err;
      }
      // All good — atomic-ish replace. (Not truly atomic on Windows, but Node
      // has no portable atomic rename; the fail-fast validation above is the
      // real safety net.)
      writeFileSync(configPath, serialized, 'utf8');
      try { unlinkSync(tmp); } catch { /* best-effort */ }
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
    submitOverride(input) {
      // Same contentKey derivation as `rubric disagree` — the two writers must
      // produce byte-identical keys or overrides log through the CLI are invisible
      // in the UI and vice-versa.
      const ws = loadWorkspace(cwd, configPath);
      if (input.caseIndex < 0 || input.caseIndex >= ws.cases.length) {
        throw new Error(`caseIndex ${input.caseIndex} out of range (dataset has ${ws.cases.length} cases)`);
      }
      const theCase = ws.cases[input.caseIndex]!;
      const compareModels = ws.config.mode === 'compare-models';
      const modelA = input.model;
      const modelB = input.modelB ?? modelA;
      const promptA = renderPrompt(ws.prompts.baseline, theCase);
      const promptB = compareModels ? promptA : renderPrompt(ws.prompts.candidate, theCase);
      const criteriaText = resolveCriteria(ws.config.judge.criteria, ws.baseDir);
      const rubricId = judgeRubricId(criteriaText);
      const contentKey = computeContentKey({
        promptA,
        promptB,
        inputText: theCase.input,
        modelA,
        modelB,
        judgeModelId: ws.config.judge.model,
        judgeRubricId: rubricId,
      });
      const cellRef = formatCellRef(input.caseIndex, modelA);

      if (input.undo === true) {
        const record = appendOverride(ws.configPath, { op: 'undo', cellRef, contentKey }, overridesRoot);
        return { cellRef, contentKey, op: 'undo', ts: record.ts };
      }

      if (input.verdict === undefined) {
        throw new Error('verdict is required unless undo=true');
      }
      const appendInput: Parameters<typeof appendOverride>[1] = {
        op: 'override',
        cellRef,
        contentKey,
        verdict: input.verdict,
      };
      if (input.reason !== undefined && input.reason.length > 0) appendInput.reason = input.reason;
      const record = appendOverride(ws.configPath, appendInput, overridesRoot);
      return { cellRef, contentKey, op: 'override', verdict: input.verdict, ts: record.ts };
    },
    listOverrides() {
      const records = readOverrideLog(configPath, overridesRoot);
      const actives = activeOverrides(records);
      return Array.from(actives.values()).map(toWire);
    },
    listAvailableModels() {
      let raw: string;
      try {
        raw = readFileSync(availableModelsPath, 'utf8');
      } catch {
        // Missing file is the expected state for a fresh workspace — the UI
        // treats [] as "no curated list, fall back to free-text entry". Not
        // an error worth logging.
        return [];
      }
      const seen = new Set<string>();
      const out: string[] = [];
      for (const line of raw.split('\n')) {
        const s = line.trim();
        if (s.length === 0 || s.startsWith('#')) continue;
        // Only accept provider/model shape; silently drop malformed lines so a
        // stray typo doesn't nuke the whole picker.
        if (!s.includes('/')) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      return out;
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
          judgeCriteriaText: ws.judgeCriteriaText,
          judgeCriteriaKind: ws.judgeCriteriaKind,
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

      // Overrides — read or write the append-only log. The same contentKey
      // algebra drives both the CLI (`rubric disagree`) and the UI, so overrides
      // entered through either surface round-trip.
      if (method === 'GET' && url === '/api/overrides') {
        try {
          const overrides = handlers.listOverrides();
          sendJson(res, 200, { overrides });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (method === 'GET' && url === '/api/available-models') {
        try {
          const available = handlers.listAvailableModels();
          sendJson(res, 200, { available });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      if (method === 'POST' && url === '/api/overrides') {
        const body = await readBody(req);
        let parsed: Partial<{
          caseIndex: number;
          model: string;
          modelB: string;
          verdict: string;
          reason: string;
          undo: boolean;
        }>;
        try {
          parsed = JSON.parse(body);
        } catch {
          sendJson(res, 400, { error: 'body must be JSON' });
          return;
        }
        if (typeof parsed.caseIndex !== 'number' || !Number.isInteger(parsed.caseIndex) || parsed.caseIndex < 0) {
          sendJson(res, 400, { error: 'caseIndex must be a non-negative integer' });
          return;
        }
        if (typeof parsed.model !== 'string' || !parsed.model.includes('/')) {
          sendJson(res, 400, { error: 'model must be a "provider/model" string' });
          return;
        }
        const undo = parsed.undo === true;
        let verdict: Verdict | undefined;
        if (!undo) {
          if (parsed.verdict !== 'a' && parsed.verdict !== 'b' && parsed.verdict !== 'tie') {
            sendJson(res, 400, { error: 'verdict must be "a" | "b" | "tie" (or pass undo=true)' });
            return;
          }
          verdict = parsed.verdict;
        }
        const submission: OverrideSubmission = {
          caseIndex: parsed.caseIndex,
          model: parsed.model as ModelId,
        };
        if (typeof parsed.modelB === 'string' && parsed.modelB.length > 0) submission.modelB = parsed.modelB as ModelId;
        if (verdict !== undefined) submission.verdict = verdict;
        if (typeof parsed.reason === 'string' && parsed.reason.length > 0) submission.reason = parsed.reason;
        if (undo) submission.undo = true;
        try {
          const result = handlers.submitOverride(submission);
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
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

      if (method === 'PATCH' && url === '/api/config') {
        const body = await readBody(req);
        let parsed: Partial<{
          models: unknown;
          judgeModel: unknown;
          judgeCriteriaCustom: unknown;
        }>;
        try {
          parsed = JSON.parse(body);
        } catch {
          sendJson(res, 400, { error: 'body must be JSON' });
          return;
        }
        const patch: ConfigPatch = {};
        if (parsed.models !== undefined) {
          if (!Array.isArray(parsed.models)) {
            sendJson(res, 400, { error: 'models must be an array of strings' });
            return;
          }
          patch.models = parsed.models as ModelId[];
        }
        if (parsed.judgeModel !== undefined) {
          if (typeof parsed.judgeModel !== 'string') {
            sendJson(res, 400, { error: 'judgeModel must be a string' });
            return;
          }
          patch.judgeModel = parsed.judgeModel as ModelId;
        }
        if (parsed.judgeCriteriaCustom !== undefined) {
          if (typeof parsed.judgeCriteriaCustom !== 'string') {
            sendJson(res, 400, { error: 'judgeCriteriaCustom must be a string' });
            return;
          }
          patch.judgeCriteriaCustom = parsed.judgeCriteriaCustom;
        }
        try {
          handlers.saveConfig(patch);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
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
