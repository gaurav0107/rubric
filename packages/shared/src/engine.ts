import { createEvaluators, runEvaluators, type Evaluator } from './evaluators.ts';
import type { Judge } from './mock.ts';
import type { Provider } from './provider.ts';
import { renderPrompt } from './prompt.ts';
import type {
  Case,
  CellResult,
  Config,
  JudgeResult,
  ModelId,
  RunSummary,
  Verdict,
} from './types.ts';

export interface RunEvalOptions {
  config: Config;
  cases: Case[];
  /** Raw prompt templates (already read from disk). */
  prompts: { baseline: string; candidate: string };
  providers: Provider[];
  judge: Judge;
  /** Optional progress hook, called after each cell resolves. */
  onCell?: (cell: CellResult, progress: { done: number; total: number }) => void;
  /** Override config.concurrency. */
  concurrency?: number;
  /** Abort propagation to provider calls. */
  signal?: AbortSignal;
}

export interface RunEvalResult {
  cells: CellResult[];
  summary: RunSummary;
}

class ProviderNotFoundError extends Error {
  constructor(modelId: ModelId) {
    super(`no provider accepted ModelId "${modelId}" — register a provider whose supports() returns true`);
    this.name = 'ProviderNotFoundError';
  }
}

function pickProvider(providers: Provider[], modelId: ModelId): Provider {
  const hit = providers.find((p) => p.supports(modelId));
  if (!hit) throw new ProviderNotFoundError(modelId);
  return hit;
}

interface Cell {
  caseIndex: number;
  /** A-side model. */
  model: ModelId;
  /** B-side model (compare-models only); when omitted both sides run on `model`. */
  modelB?: ModelId;
}

function planCells(cases: Case[], models: ModelId[], mode: 'compare-prompts' | 'compare-models'): Cell[] {
  const cells: Cell[] = [];
  if (mode === 'compare-models') {
    if (models.length < 2) {
      throw new Error(`mode="compare-models" requires at least 2 models, got ${models.length}`);
    }
    const a = models[0] as ModelId;
    const b = models[1] as ModelId;
    for (let i = 0; i < cases.length; i++) cells.push({ caseIndex: i, model: a, modelB: b });
    return cells;
  }
  for (let i = 0; i < cases.length; i++) {
    for (const model of models) cells.push({ caseIndex: i, model });
  }
  return cells;
}

async function runCell(
  cell: Cell,
  cases: Case[],
  prompts: { baseline: string; candidate: string },
  providers: Provider[],
  judge: Judge,
  criteria: string,
  mode: 'compare-prompts' | 'compare-models',
  signal: AbortSignal | undefined,
  evaluators: Evaluator[],
): Promise<CellResult> {
  const c = cases[cell.caseIndex];
  if (!c) throw new Error(`cell references missing case index ${cell.caseIndex}`);

  const started = Date.now();
  const compareModels = mode === 'compare-models' && cell.modelB !== undefined;
  try {
    const promptA = compareModels ? prompts.baseline : prompts.baseline;
    const promptB = compareModels ? prompts.baseline : prompts.candidate;
    const modelA = cell.model;
    const modelB = compareModels ? (cell.modelB as ModelId) : cell.model;
    const providerA = pickProvider(providers, modelA);
    const providerB = pickProvider(providers, modelB);

    const [outA, outB] = await Promise.all([
      providerA.generate({
        modelId: modelA,
        prompt: renderPrompt(promptA, c),
        ...(signal ? { signal } : {}),
      }),
      providerB.generate({
        modelId: modelB,
        prompt: renderPrompt(promptB, c),
        ...(signal ? { signal } : {}),
      }),
    ]);

    let verdict: JudgeResult | { error: string };
    try {
      verdict = await judge.judge({
        caseInput: c.input,
        ...(c.expected !== undefined ? { expected: c.expected } : {}),
        outputA: outA.text,
        outputB: outB.text,
        criteria,
      });
    } catch (err) {
      verdict = { error: err instanceof Error ? err.message : String(err) };
    }

    const result: CellResult = {
      caseIndex: cell.caseIndex,
      model: modelA,
      outputA: outA.text,
      outputB: outB.text,
      judge: verdict,
      latencyMs: Date.now() - started,
    };
    if (compareModels) result.modelB = modelB;
    const costA = outA.costUsd ?? 0;
    const costB = outB.costUsd ?? 0;
    if (costA || costB) result.costUsd = costA + costB;
    if (evaluators.length > 0) {
      const evals = runEvaluators(evaluators, {
        case: c,
        outputA: outA.text,
        outputB: outB.text,
      });
      if (evals.length > 0) result.evaluations = evals;
    }
    return result;
  } catch (err) {
    const result: CellResult = {
      caseIndex: cell.caseIndex,
      model: cell.model,
      outputA: '',
      outputB: '',
      judge: { error: err instanceof Error ? err.message : String(err) },
      latencyMs: Date.now() - started,
    };
    if (compareModels && cell.modelB !== undefined) result.modelB = cell.modelB;
    return result;
  }
}

/**
 * Bounded-parallel worker pool. Runs `fn` against each item with at most
 * `limit` concurrent calls; preserves input order in the returned array.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i] as T;
      results[i] = await fn(item, i);
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function summarize(cells: CellResult[]): RunSummary {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let errors = 0;
  let totalCostUsd = 0;
  let costedCells = 0;
  let totalLatencyMs = 0;
  let latencyCells = 0;
  for (const cell of cells) {
    if ('error' in cell.judge) {
      errors++;
    } else {
      const w: Verdict = cell.judge.winner;
      if (w === 'b') wins++;
      else if (w === 'a') losses++;
      else ties++;
    }
    if (typeof cell.costUsd === 'number') {
      totalCostUsd += cell.costUsd;
      costedCells++;
    }
    if (typeof cell.latencyMs === 'number') {
      totalLatencyMs += cell.latencyMs;
      latencyCells++;
    }
  }
  const decisive = wins + losses;
  const winRate = decisive === 0 ? 0 : wins / decisive;
  const summary: RunSummary = { wins, losses, ties, errors, winRate };
  if (costedCells > 0) {
    summary.totalCostUsd = totalCostUsd;
    summary.costedCells = costedCells;
  }
  if (latencyCells > 0) summary.totalLatencyMs = totalLatencyMs;
  return summary;
}

export async function runEval(opts: RunEvalOptions): Promise<RunEvalResult> {
  const { config, cases, prompts, providers, judge, signal } = opts;
  if (cases.length === 0) {
    return { cells: [], summary: { wins: 0, losses: 0, ties: 0, errors: 0, winRate: 0 } };
  }
  const concurrency = opts.concurrency ?? config.concurrency ?? 4;
  const mode = config.mode ?? 'compare-prompts';
  const criteriaString =
    typeof config.judge.criteria === 'string'
      ? config.judge.criteria
      : 'custom' in config.judge.criteria
        ? config.judge.criteria.custom
        : (() => { throw new Error('engine received a { file } criteria — caller must resolve with resolveCriteria() first'); })();

  const plan = planCells(cases, config.models, mode);
  const evaluators = createEvaluators(config.evaluators);
  let done = 0;
  const cells = await mapWithConcurrency(plan, concurrency, async (cell) => {
    const result = await runCell(cell, cases, prompts, providers, judge, criteriaString, mode, signal, evaluators);
    done++;
    opts.onCell?.(result, { done, total: plan.length });
    return result;
  });

  return { cells, summary: summarize(cells) };
}
