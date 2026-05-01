import type { Judge, JudgeRequest } from './mock.ts';
import type { Provider } from './provider.ts';
import type { JudgeResult, ModelId, Verdict } from './types.ts';

export class JudgeParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = 'JudgeParseError';
  }
}

export const DEFAULT_RUBRIC = `Compare two candidate outputs (A and B) for the same input. \
Choose the one that is more correct, concise, and directly answers the input. \
If they are materially equivalent, return "tie". Be decisive — only return \
"tie" when the outputs are genuinely interchangeable.`;

export const MODEL_COMPARISON_RUBRIC = `Compare two candidate outputs (A and B) produced \
by different models for the same prompt. Pick the output that would be more useful \
to a technical user: correct, specific, free of padding. If neither dominates, \
return "tie".`;

/**
 * Resolve a preset identifier or arbitrary criteria text into the exact rubric
 * body the judge will see. Exposed so the serve UI can show users the same
 * text the judge reads, not just the preset name.
 */
export function presetToRubricText(criteria: string): string {
  if (criteria === 'default') return DEFAULT_RUBRIC;
  if (criteria === 'model-comparison') return MODEL_COMPARISON_RUBRIC;
  return criteria;
}

function systemPrompt(criteria: string): string {
  const body = presetToRubricText(criteria);

  return [
    'You are a rigorous pairwise output grader.',
    body,
    'Respond with ONLY a single JSON object on one line, no prose, no code fences:',
    '{"winner":"a"|"b"|"tie","reason":"short explanation"}',
  ].join('\n\n');
}

function userPrompt(req: JudgeRequest): string {
  const parts = [`Input:\n${req.caseInput}`];
  if (req.expected !== undefined) parts.push(`Expected (may be partial):\n${req.expected}`);
  parts.push(`Output A:\n${req.outputA}`);
  parts.push(`Output B:\n${req.outputB}`);
  return parts.join('\n\n---\n\n');
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Try direct parse first.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to bracket extraction.
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new JudgeParseError('judge response did not contain a JSON object', raw);
  }
  const slice = trimmed.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new JudgeParseError(`judge response contained malformed JSON (${msg})`, raw);
  }
}

export function parseJudgeResponse(raw: string): JudgeResult {
  const parsed = extractJson(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new JudgeParseError('judge response JSON must be an object', raw);
  }
  const rec = parsed as Record<string, unknown>;
  const winner = rec.winner;
  if (winner !== 'a' && winner !== 'b' && winner !== 'tie') {
    throw new JudgeParseError(`judge returned invalid winner ${JSON.stringify(winner)}`, raw);
  }
  const reason = typeof rec.reason === 'string' ? rec.reason : '';
  return { winner: winner as Verdict, reason };
}

export interface OpenAIJudgeOptions {
  provider: Provider;
  model: ModelId;
  /** The rubric string. Short tokens are replaced with canned rubrics. */
  criteria: string;
  temperature?: number;
}

export function createOpenAIJudge(opts: OpenAIJudgeOptions): Judge {
  return {
    name: 'openai-judge',
    async judge(req: JudgeRequest): Promise<JudgeResult> {
      const res = await opts.provider.generate({
        modelId: opts.model,
        system: systemPrompt(opts.criteria),
        prompt: userPrompt(req),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : { temperature: 0 }),
      });
      return parseJudgeResponse(res.text);
    },
  };
}
