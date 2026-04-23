import type { Case, Feedback, FeedbackPolarity, LangfuseLine } from './types.ts';

export class JsonlParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
    this.name = 'JsonlParseError';
  }
}

export interface ParseOptions {
  /** If true, accept Langfuse-style lines with `output` + optional `feedback`. */
  allowLangfuse?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseFeedback(raw: unknown, line: number): Feedback | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'positive' || raw === 'negative') return { polarity: raw };
  if (!isRecord(raw)) {
    throw new JsonlParseError('feedback must be "positive" | "negative" or an object', line);
  }
  const polarity = raw.polarity;
  if (polarity !== 'positive' && polarity !== 'negative') {
    throw new JsonlParseError('feedback.polarity must be "positive" or "negative"', line);
  }
  const reason = raw.reason;
  if (reason !== undefined && typeof reason !== 'string') {
    throw new JsonlParseError('feedback.reason must be a string when present', line);
  }
  const out: Feedback = { polarity: polarity as FeedbackPolarity };
  if (typeof reason === 'string') out.reason = reason;
  return out;
}

function parseCaseObject(obj: Record<string, unknown>, line: number, opts: ParseOptions): Case {
  if (typeof obj.input !== 'string' || obj.input.length === 0) {
    throw new JsonlParseError('`input` is required and must be a non-empty string', line);
  }
  if (obj.expected !== undefined && typeof obj.expected !== 'string') {
    throw new JsonlParseError('`expected` must be a string when present', line);
  }
  if (obj.metadata !== undefined && !isRecord(obj.metadata)) {
    throw new JsonlParseError('`metadata` must be an object when present', line);
  }

  const hasLangfuseFields = 'output' in obj || 'feedback' in obj;
  if (hasLangfuseFields && !opts.allowLangfuse) {
    throw new JsonlParseError(
      'line has Langfuse-style fields (`output`/`feedback`); pass { allowLangfuse: true } to accept',
      line,
    );
  }

  const out: Case = { input: obj.input };
  if (typeof obj.expected === 'string') out.expected = obj.expected;

  const metadata: Record<string, unknown> = isRecord(obj.metadata) ? { ...obj.metadata } : {};

  if (opts.allowLangfuse && hasLangfuseFields) {
    if (typeof obj.output !== 'string') {
      throw new JsonlParseError('Langfuse line: `output` must be a string', line);
    }
    const parsedFeedback = parseFeedback(obj.feedback, line);
    const langfuse: Partial<LangfuseLine> = { output: obj.output };
    if (parsedFeedback !== undefined) langfuse.feedback = parsedFeedback;
    metadata.langfuse = langfuse;
  }

  if (Object.keys(metadata).length > 0) out.metadata = metadata;
  return out;
}

export function parseCasesJsonl(text: string, opts: ParseOptions = {}): Case[] {
  const cases: Case[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('//')) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new JsonlParseError(`invalid JSON (${msg})`, i + 1);
    }
    if (!isRecord(parsed)) {
      throw new JsonlParseError('each line must be a JSON object', i + 1);
    }
    cases.push(parseCaseObject(parsed, i + 1, opts));
  }

  return cases;
}
