export type ModelId = `${string}/${string}`;

export type Criteria =
  | 'default'
  | 'model-comparison'
  /** Deterministic structural judge — parses outputs as JSON and compares to `expected`; no LLM call. */
  | 'structural-json'
  | { custom: string }
  /** Team preset — loaded from a file relative to the config's baseDir. */
  | { file: string };

/**
 * User-declared provider for a corporate LLM gateway or any other
 * OpenAI-chat-completions-compatible endpoint (Azure APIM, internal Kong
 * proxies, self-hosted routers, etc).
 *
 * Routing: models use `<name>/<model>` in the `models` / `judge.model` arrays.
 * The `name` here becomes the prefix — e.g. `corp-proxy/gpt-5.1`.
 *
 * Auth: exactly one of `keyEnv` or `keyFile` must be set. Inline `key` is
 * rejected at config-load time. Keys read from `keyFile` are resolved relative
 * to the config file's directory unless absolute; `~` expands to $HOME.
 *
 * Custom headers (e.g. `x-client-app` for Expedia's proxy) are passed through
 * verbatim on every request.
 */
export interface ProviderConfig {
  /** Becomes the prefix in model ids (`<name>/<model>`). Must be lowercase letters/digits/dashes, 1-32 chars. */
  name: string;
  /** OpenAI-compatible base URL, e.g. `https://gateway.internal/v1`. No trailing slash. */
  baseUrl: string;
  /** Wire format. Only `openai-chat` is supported in v1.1. */
  wireFormat?: 'openai-chat';
  /** Environment variable name holding the bearer token. Mutually exclusive with keyFile. */
  keyEnv?: string;
  /** Path to a gitignored secrets file whose trimmed contents are the bearer token. Mutually exclusive with keyEnv. */
  keyFile?: string;
  /** Additional request headers (e.g. `x-client-app: generative-ai-proxy`). */
  headers?: Record<string, string>;
}

/**
 * Declarative evaluator entry. See `evaluators.ts` for the factory map;
 * duplicated here as a string literal union to keep the types package
 * dependency-free and serializable in config JSON. Keep in sync with
 * `EvaluatorConfig` in evaluators.ts.
 */
/**
 * Every evaluator accepts an optional `failOn: number` threshold.
 * Semantics: candidate (B-side) pass rate for this evaluator's primary metric
 * must be ≥ threshold. A breach causes `rubric run` to exit 2 (same exit code
 * as `--fail-on-regress`). Evaluators without `failOn` are report-only.
 */
export type EvaluatorConfigEntry =
  | { type: 'exact-match'; field?: string; caseSensitive?: boolean; trim?: boolean; failOn?: number }
  | { type: 'contains'; needle: string; caseSensitive?: boolean; failOn?: number }
  | { type: 'regex'; pattern: string; flags?: string; failOn?: number }
  | { type: 'length'; min?: number; max?: number; failOn?: number }
  | { type: 'json-valid'; failOn?: number };

export interface Config {
  prompts: { baseline: string; candidate: string };
  dataset: string;
  models: ModelId[];
  judge: { model: ModelId; criteria: Criteria };
  concurrency?: number;
  /** Reserved for future modes. v2.2 supports only "compare-prompts" (the default). */
  mode?: 'compare-prompts';
  /** User-declared providers; added on top of the four built-ins (openai/groq/openrouter/ollama). */
  providers?: ProviderConfig[];
  /** Additive metrics that run alongside the pairwise judge. Omit or leave empty for today's behavior. */
  evaluators?: EvaluatorConfigEntry[];
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

/**
 * A single evaluator result row. Mirrored from `evaluators.ts`' `EvaluatorResult`
 * so this types module stays dependency-free.
 */
export interface EvaluationRow {
  metric: string;
  side: 'a' | 'b' | 'both';
  value: number | string | boolean;
  pass?: boolean;
  reason?: string;
}

export interface CellResult {
  caseIndex: number;
  /** The model the cell ran on (both A and B sides in compare-prompts mode). */
  model: ModelId;
  outputA: string;
  outputB: string;
  judge: JudgeResult | { error: string };
  costUsd?: number;
  latencyMs?: number;
  /** Additional evaluator metrics; populated when config.evaluators is non-empty. */
  evaluations?: EvaluationRow[];
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
