import type { Provider } from './provider.ts';
import type { ModelId } from './types.ts';

export type GraderPolarity = 'positive' | 'negative';

export interface GraderRequest {
  input: string;
  output: string;
  criteria: string;
}

export interface GraderResult {
  polarity: GraderPolarity;
  reason: string;
}

export interface Grader {
  readonly name: string;
  grade(req: GraderRequest): Promise<GraderResult>;
}

export class GraderParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = 'GraderParseError';
  }
}

const DEFAULT_GRADER_RUBRIC = `Grade a single model output against its input. \
Answer "positive" if the output correctly and helpfully addresses the input, \
"negative" otherwise. Be decisive — small style preferences are still positive.`;

function graderSystem(criteria: string): string {
  const body = criteria === 'default' ? DEFAULT_GRADER_RUBRIC : criteria;
  return [
    'You are a rigorous single-output grader.',
    body,
    'Respond with ONLY a single JSON object on one line, no prose:',
    '{"polarity":"positive"|"negative","reason":"short explanation"}',
  ].join('\n\n');
}

function graderUser(req: GraderRequest): string {
  return `Input:\n${req.input}\n\n---\n\nOutput:\n${req.output}`;
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new GraderParseError('grader response did not contain a JSON object', raw);
  }
  try {
    return JSON.parse(trimmed.slice(first, last + 1));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GraderParseError(`grader response contained malformed JSON (${msg})`, raw);
  }
}

export function parseGraderResponse(raw: string): GraderResult {
  const parsed = extractJson(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GraderParseError('grader response JSON must be an object', raw);
  }
  const rec = parsed as Record<string, unknown>;
  const polarity = rec.polarity;
  if (polarity !== 'positive' && polarity !== 'negative') {
    throw new GraderParseError(`grader returned invalid polarity ${JSON.stringify(polarity)}`, raw);
  }
  const reason = typeof rec.reason === 'string' ? rec.reason : '';
  return { polarity, reason };
}

export interface OpenAIGraderOptions {
  provider: Provider;
  model: ModelId;
  criteria: string;
  temperature?: number;
}

export function createOpenAIGrader(opts: OpenAIGraderOptions): Grader {
  return {
    name: 'openai-grader',
    async grade(req: GraderRequest): Promise<GraderResult> {
      const res = await opts.provider.generate({
        modelId: opts.model,
        system: graderSystem(opts.criteria),
        prompt: graderUser(req),
        temperature: opts.temperature ?? 0,
      });
      return parseGraderResponse(res.text);
    },
  };
}
