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

export type Verdict = 'a' | 'b' | 'tie';

export interface JudgeResult {
  winner: Verdict;
  reason: string;
}

export interface CellResult {
  caseIndex: number;
  model: ModelId;
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
}
