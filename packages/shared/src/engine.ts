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
  model: ModelId;
}

function planCells(cases: Case[], models: ModelId[]): Cell[] {
  const cells: Cell[] = [];
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
  rubric: string,
  signal: AbortSignal | undefined,
): Promise<CellResult> {
  const c = cases[cell.caseIndex];
  if (!c) throw new Error(`cell references missing case index ${cell.caseIndex}`);

  const started = Date.now();
  try {
    const provider = pickProvider(providers, cell.model);
    const [outA, outB] = await Promise.all([
      provider.generate({
        modelId: cell.model,
        prompt: renderPrompt(prompts.baseline, c),
        ...(signal ? { signal } : {}),
      }),
      provider.generate({
        modelId: cell.model,
        prompt: renderPrompt(prompts.candidate, c),
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
        rubric,
      });
    } catch (err) {
      verdict = { error: err instanceof Error ? err.message : String(err) };
    }

    const result: CellResult = {
      caseIndex: cell.caseIndex,
      model: cell.model,
      outputA: outA.text,
      outputB: outB.text,
      judge: verdict,
      latencyMs: Date.now() - started,
    };
    const costA = outA.costUsd ?? 0;
    const costB = outB.costUsd ?? 0;
    if (costA || costB) result.costUsd = costA + costB;
    return result;
  } catch (err) {
    return {
      caseIndex: cell.caseIndex,
      model: cell.model,
      outputA: '',
      outputB: '',
      judge: { error: err instanceof Error ? err.message : String(err) },
      latencyMs: Date.now() - started,
    };
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
  for (const cell of cells) {
    if ('error' in cell.judge) {
      errors++;
      continue;
    }
    const w: Verdict = cell.judge.winner;
    if (w === 'b') wins++;
    else if (w === 'a') losses++;
    else ties++;
  }
  const decisive = wins + losses;
  const winRate = decisive === 0 ? 0 : wins / decisive;
  return { wins, losses, ties, errors, winRate };
}

export async function runEval(opts: RunEvalOptions): Promise<RunEvalResult> {
  const { config, cases, prompts, providers, judge, signal } = opts;
  if (cases.length === 0) {
    return { cells: [], summary: { wins: 0, losses: 0, ties: 0, errors: 0, winRate: 0 } };
  }
  const concurrency = opts.concurrency ?? config.concurrency ?? 4;
  const rubricString =
    typeof config.judge.rubric === 'string' ? config.judge.rubric : config.judge.rubric.custom;

  const plan = planCells(cases, config.models);
  let done = 0;
  const cells = await mapWithConcurrency(plan, concurrency, async (cell) => {
    const result = await runCell(cell, cases, prompts, providers, judge, rubricString, signal);
    done++;
    opts.onCell?.(result, { done, total: plan.length });
    return result;
  });

  return { cells, summary: summarize(cells) };
}
