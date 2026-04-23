export type ModelId = `${string}/${string}`;

export type Rubric = 'default' | 'model-comparison' | { custom: string };

export interface Config {
  prompts: { baseline: string; candidate: string };
  dataset: string;
  models: ModelId[];
  judge: { model: ModelId; rubric: Rubric };
  concurrency?: number;
  mode?: 'compare-prompts' | 'compare-models';
}

export interface Case {
  input: string;
  expected?: string;
  metadata?: Record<string, unknown>;
}

export type FeedbackPolarity = 'positive' | 'negative';

export interface Feedback {
  polarity: FeedbackPolarity;
  reason?: string;
}

export interface LangfuseLine {
  input: string;
  output: string;
  feedback?: Feedback | FeedbackPolarity;
  metadata?: Record<string, unknown>;
}

export type Verdict = 'a' | 'b' | 'tie';

export interface JudgeResult {
  winner: Verdict;
  reason: string;
}

export interface CellResult {
  caseIndex: number;
  /** Primary model. In compare-prompts this is the only model in the cell; in compare-models this is the A-side model. */
  model: ModelId;
  /** Present only when mode=compare-models: the B-side model. */
  modelB?: ModelId;
  outputA: string;
  outputB: string;
  judge: JudgeResult | { error: string };
  costUsd?: number;
  latencyMs?: number;
}

export interface RunSummary {
  wins: number;
  losses: number;
  ties: number;
  errors: number;
  winRate: number;
  /** Sum of per-cell costUsd (both sides), when any cell reported a cost. Omitted if every cell was cost-less (e.g. mock run). */
  totalCostUsd?: number;
  /** Sum of per-cell latencyMs, when any cell reported a latency. */
  totalLatencyMs?: number;
  /** Number of cells that contributed to totalCostUsd (i.e. had a defined costUsd). */
  costedCells?: number;
}
