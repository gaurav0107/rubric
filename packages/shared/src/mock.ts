import type { GenerateRequest, GenerateResult, Provider } from './provider.ts';
import { splitModelId } from './provider.ts';
import type { JudgeResult, ModelId, Verdict } from './types.ts';

export interface MockProviderOptions {
  /**
   * Deterministic response generator. Called for every request.
   * Default: returns the prompt echoed back with a variant marker.
   */
  respond?: (req: GenerateRequest) => string;
  /** Synthetic latency to simulate for each call, in ms. */
  latencyMs?: number;
  /** Synthetic USD cost per call. */
  costUsd?: number;
  /** Provider prefix to match (default: "mock"). */
  prefix?: string;
  /**
   * When true, supports() accepts any ModelId regardless of prefix. Intended
   * for `rubric run --mock` / `serve --mock` so users can test against
   * their live config (e.g. openai/*) without rewriting it.
   */
  acceptAll?: boolean;
}

export function createMockProvider(opts: MockProviderOptions = {}): Provider {
  const prefix = opts.prefix ?? 'mock';
  const latencyMs = opts.latencyMs ?? 0;
  const respond = opts.respond ?? ((req) => `[${req.modelId}] ${req.prompt}`);
  const acceptAll = opts.acceptAll === true;

  return {
    name: 'mock',
    supports(modelId: ModelId): boolean {
      if (acceptAll) return true;
      try {
        return splitModelId(modelId).providerPrefix === prefix;
      } catch {
        return false;
      }
    },
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const started = Date.now();
      const text = respond(req);
      const { model } = splitModelId(req.modelId);
      const result: GenerateResult = {
        text,
        latencyMs: latencyMs || Math.max(0, Date.now() - started),
        resolvedModel: model,
      };
      if (opts.costUsd !== undefined) result.costUsd = opts.costUsd;
      return result;
    },
  };
}

export interface JudgeRequest {
  caseInput: string;
  expected?: string;
  outputA: string;
  outputB: string;
  rubric: string;
}

export interface Judge {
  readonly name: string;
  judge(req: JudgeRequest): Promise<JudgeResult>;
}

export interface MockJudgeOptions {
  /** Fixed verdict. Default: 'tie'. */
  verdict?: Verdict | ((req: JudgeRequest) => Verdict);
  /** Fixed reason. Default: a short canned string. */
  reason?: string | ((req: JudgeRequest) => string);
}

export function createMockJudge(opts: MockJudgeOptions = {}): Judge {
  return {
    name: 'mock-judge',
    async judge(req: JudgeRequest): Promise<JudgeResult> {
      const v = opts.verdict;
      const r = opts.reason;
      const winner: Verdict = typeof v === 'function' ? v(req) : (v ?? 'tie');
      const reason = typeof r === 'function' ? r(req) : (r ?? `mock: ${winner}`);
      return { winner, reason };
    },
  };
}
