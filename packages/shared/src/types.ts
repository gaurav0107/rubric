export type ModelId = `${string}/${string}`;

export type Rubric =
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

export interface Config {
  prompts: { baseline: string; candidate: string };
  dataset: string;
  models: ModelId[];
  judge: { model: ModelId; rubric: Rubric };
  concurrency?: number;
  mode?: 'compare-prompts' | 'compare-models';
  /** User-declared providers; added on top of the four built-ins (openai/groq/openrouter/ollama). */
  providers?: ProviderConfig[];
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
