import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  renderPrComment,
  type ModelId,
  type RunSummary,
} from '../../../shared/src/index.ts';
import type { JsonPayload } from './run.ts';

export interface CommentOptions {
  /** Absolute or cwd-relative path to a `rubric run --json` payload. */
  fromPath: string;
  /** Optional URL to a hosted HTML report, linked from the comment footer. */
  reportUrl?: string;
  /** Optional title suffix; e.g. "baseline.md vs candidate.md". */
  title?: string;
  cwd?: string;
  write?: (line: string) => void;
}

export interface CommentResult {
  markdown: string;
  exitCode: number;
}

function parseJsonFile(path: string): unknown {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse JSON at ${path}: ${msg}`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateRunPayload(raw: unknown, path: string): JsonPayload {
  if (!isRecord(raw)) throw new Error(`${path}: run payload must be a JSON object`);
  if (raw.version !== 1) {
    throw new Error(`${path}: unsupported run payload version ${JSON.stringify(raw.version)} (expected 1)`);
  }
  if (!isRecord(raw.summary)) throw new Error(`${path}: summary missing`);
  if (!Array.isArray(raw.models)) throw new Error(`${path}: models must be an array`);
  if (!isRecord(raw.judge) || typeof raw.judge.model !== 'string') {
    throw new Error(`${path}: judge.model missing`);
  }
  if (!Array.isArray(raw.cells)) throw new Error(`${path}: cells must be an array`);
  return raw as unknown as JsonPayload;
}

export function runComment(opts: CommentOptions): CommentResult {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const write = opts.write ?? ((line: string) => process.stdout.write(line));

  const fromAbs = resolve(cwd, opts.fromPath);
  const payload = validateRunPayload(parseJsonFile(fromAbs), fromAbs);

  // Reconstruct the cells the renderer expects. The --json payload uses a flat
  // per-cell shape (winner/reason/error); the renderer wants CellResult-shaped
  // values so it can produce the per-model breakdown. We only need judge +
  // model + caseIndex here; outputs aren't rendered in the comment.
  const cells = payload.cells.map((c) => ({
    caseIndex: c.caseIndex,
    model: c.model,
    // Use the carried outputs when the payload supplied them (new format);
    // fall back to empty for older payloads. Empty outputs simply skip regression
    // rendering — old payloads keep rendering the rest of the comment fine.
    outputA: c.outputA ?? '',
    outputB: c.outputB ?? '',
    judge:
      c.error !== undefined
        ? { error: c.error }
        : { winner: c.winner!, reason: c.reason ?? '' },
    ...(c.modelB !== undefined ? { modelB: c.modelB } : {}),
    ...(c.latencyMs !== undefined ? { latencyMs: c.latencyMs } : {}),
    ...(c.costUsd !== undefined ? { costUsd: c.costUsd } : {}),
  }));

  const summary: RunSummary = payload.summary;
  const models: ModelId[] = payload.models;

  // caseInputs keyed by caseIndex — used by the renderer to show case input
  // text in the top-regressions block. Only populated when the JSON payload
  // carried inputText per cell (new format, otherwise skipped).
  const caseInputs = new Map<number, string>();
  for (const c of payload.cells) {
    if (typeof c.inputText === 'string' && !caseInputs.has(c.caseIndex)) {
      caseInputs.set(c.caseIndex, c.inputText);
    }
  }

  const renderInput: Parameters<typeof renderPrComment>[0] = {
    summary,
    cells,
    models,
    judge: { model: payload.judge.model },
  };
  if (opts.reportUrl) renderInput.reportUrl = opts.reportUrl;
  if (opts.title) renderInput.title = opts.title;
  if (payload.metrics && payload.metrics.length > 0) renderInput.metrics = payload.metrics;
  if (payload.gateBreaches && payload.gateBreaches.length > 0) renderInput.gateBreaches = payload.gateBreaches;
  if (caseInputs.size > 0) renderInput.caseInputs = caseInputs;

  const markdown = renderPrComment(renderInput);
  write(markdown);

  return { markdown, exitCode: 0 };
}
