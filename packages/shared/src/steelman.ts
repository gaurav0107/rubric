import type { Provider } from './provider.ts';
import type { ModelId } from './types.ts';

export class SteelmanParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = 'SteelmanParseError';
  }
}

/** A failing case to anchor the revision around. */
export interface SteelmanFailingCase {
  input: string;
  expected?: string;
  /** Side that lost or was judged worse — used to name what the prompt failed to produce. */
  failedOutput: string;
  /** The better side's output, if known. */
  betterOutput?: string;
  /** Optional judge reason from the verdict. */
  judgeReason?: string;
}

export interface SteelmanRequest {
  /** The prompt text to strengthen. */
  prompt: string;
  /** Optional failing cases to anchor the revision. When empty, revises against the prompt alone. */
  failingCases?: SteelmanFailingCase[];
  /** Free-form guidance from the user (e.g. "keep it under 200 words"). */
  guidance?: string;
}

export interface SteelmanResult {
  /** The rewritten prompt, full text. */
  revised: string;
  /** One-paragraph explanation of what changed and why. */
  rationale: string;
}

const SYSTEM_PROMPT = `You are a prompt-engineering critic. Given a prompt and (optionally) failing examples, produce a strengthened revision of the prompt and a short rationale.

Rules:
- Preserve the prompt's original intent and domain — do not change the task it performs.
- Strengthen specificity, constraints, format guidance, and disambiguation.
- Keep the revision self-contained: do not reference the failing cases inside the prompt body.
- Do not append examples unless the original prompt already included an Examples section.
- Keep roughly the same length unless guidance explicitly asks otherwise.

Respond with ONLY a single JSON object on one line, no prose, no code fences:
{"revised":"<full rewritten prompt>","rationale":"<1-3 sentence explanation>"}`;

function buildUserPrompt(req: SteelmanRequest): string {
  const parts: string[] = [];
  parts.push(`Prompt to strengthen:\n${req.prompt}`);

  const failing = req.failingCases ?? [];
  if (failing.length > 0) {
    const lines: string[] = ['Failing examples (anchor the revision around these):'];
    for (let i = 0; i < failing.length; i++) {
      const c = failing[i]!;
      lines.push(`\n[${i + 1}] Input:\n${c.input}`);
      if (c.expected !== undefined) lines.push(`Expected:\n${c.expected}`);
      lines.push(`Failed output (what the current prompt produced):\n${c.failedOutput}`);
      if (c.betterOutput !== undefined) lines.push(`Better output (what we want more of):\n${c.betterOutput}`);
      if (c.judgeReason !== undefined) lines.push(`Judge reason:\n${c.judgeReason}`);
    }
    parts.push(lines.join('\n'));
  }

  if (req.guidance !== undefined && req.guidance.trim().length > 0) {
    parts.push(`Additional guidance from the user:\n${req.guidance.trim()}`);
  }

  return parts.join('\n\n---\n\n');
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new SteelmanParseError('steelman response did not contain a JSON object', raw);
  }
  try {
    return JSON.parse(trimmed.slice(first, last + 1));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SteelmanParseError(`steelman response contained malformed JSON (${msg})`, raw);
  }
}

export function parseSteelmanResponse(raw: string): SteelmanResult {
  const parsed = extractJson(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SteelmanParseError('steelman response JSON must be an object', raw);
  }
  const rec = parsed as Record<string, unknown>;
  const revised = rec.revised;
  const rationale = rec.rationale;
  if (typeof revised !== 'string' || revised.trim().length === 0) {
    throw new SteelmanParseError('steelman response missing "revised" string', raw);
  }
  if (typeof rationale !== 'string') {
    throw new SteelmanParseError('steelman response missing "rationale" string', raw);
  }
  return { revised, rationale };
}

export interface RunSteelmanOptions extends SteelmanRequest {
  provider: Provider;
  model: ModelId;
  temperature?: number;
}

/**
 * Ask an LLM to produce a strengthened version of a prompt. Small, focused,
 * and cacheable — intended to back both the "Steelman my prompt" button (no
 * failing cases) and the "Why failed?" micro-steelman drawer (a single
 * failing cell).
 */
export async function runSteelman(opts: RunSteelmanOptions): Promise<SteelmanResult> {
  const userRequest: SteelmanRequest = { prompt: opts.prompt };
  if (opts.failingCases !== undefined) userRequest.failingCases = opts.failingCases;
  if (opts.guidance !== undefined) userRequest.guidance = opts.guidance;

  const res = await opts.provider.generate({
    modelId: opts.model,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(userRequest),
    temperature: opts.temperature ?? 0.2,
  });
  return parseSteelmanResponse(res.text);
}
