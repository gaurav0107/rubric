import type { Case, Feedback } from './types.ts';
import { JsonlParseError } from './jsonl.ts';

/**
 * Per-source import adapters that normalize upstream log formats into
 * Langfuse-shaped `Case[]` (input + metadata.langfuse.{output,feedback?}).
 * Downstream the seed command already knows how to handle that shape —
 * stratified-sample, PII-scan, and split into cases + calibration entries.
 *
 * Each adapter is:
 *   text (JSONL) -> Case[] with metadata.langfuse populated
 *
 * When a line can't be mapped (missing required fields), we throw
 * JsonlParseError with the 1-indexed line number so the CLI can point the
 * user at a specific row.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getNested(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function lastUserMessage(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (isRecord(m) && m.role === 'user' && typeof m.content === 'string' && m.content.length > 0) {
      return m.content;
    }
  }
  return undefined;
}

function firstAssistantMessage(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const m of messages) {
    if (isRecord(m) && m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 0) {
      return m.content;
    }
  }
  return undefined;
}

function firstChoiceContent(choices: unknown): string | undefined {
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!isRecord(first)) return undefined;
  const message = first.message;
  if (isRecord(message) && typeof message.content === 'string') return message.content;
  if (typeof first.text === 'string') return first.text;
  return undefined;
}

function* iterateJsonl(text: string): Generator<{ line: number; obj: Record<string, unknown> }> {
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
    yield { line: i + 1, obj: parsed };
  }
}

function toCase(input: string, output: string, feedback?: Feedback): Case {
  const langfuse: { output: string; feedback?: Feedback } = { output };
  if (feedback) langfuse.feedback = feedback;
  return {
    input,
    metadata: { langfuse },
  };
}

/**
 * OpenAI chat-completion logs. Accepts two common shapes:
 *   1. Fine-tuning JSONL: `{ messages: [{role,content}, ...] }` — last user
 *      message = input, first assistant message = output. No feedback.
 *   2. Request/response pairs: `{ request: { messages: [...] },
 *      response: { choices: [{ message: { content } }] } }`. No feedback.
 *
 * No feedback channel exists in either shape, so calibration.json will be
 * empty — that's the caller's signal to hand-label before running
 * `diffprompt calibrate`.
 */
export function parseOpenAiChatLogs(text: string): Case[] {
  const out: Case[] = [];
  for (const { line, obj } of iterateJsonl(text)) {
    let input: string | undefined;
    let output: string | undefined;

    if (Array.isArray(obj.messages)) {
      input = lastUserMessage(obj.messages);
      output = firstAssistantMessage(obj.messages);
    } else if (isRecord(obj.request)) {
      const reqMessages = getNested(obj, ['request', 'messages']);
      input = lastUserMessage(reqMessages);
      const choices = getNested(obj, ['response', 'choices']);
      output = firstChoiceContent(choices);
    } else if (Array.isArray(obj.choices)) {
      const prompt = obj.prompt;
      if (typeof prompt === 'string') input = prompt;
      else if (Array.isArray(prompt) && typeof prompt[0] === 'string') input = prompt[0];
      output = firstChoiceContent(obj.choices);
    }

    if (!input || !output) {
      throw new JsonlParseError(
        'openai-logs: could not extract input + output (expected { messages: [...] } or { request: {...}, response: {...} })',
        line,
      );
    }
    out.push(toCase(input, output));
  }
  return out;
}

/**
 * Helicone export JSONL. Helicone ships request/response under a few
 * equivalent keys depending on whether you export from the UI vs the API:
 *   - `request.body.messages` + `response.body.choices`
 *   - `request_body.messages` + `response_body.choices`
 *
 * Feedback is `{ rating: boolean }` (true=positive, false=negative) when
 * present on the row itself or under `properties`. We map to polarity.
 */
export function parseHeliconeLogs(text: string): Case[] {
  const out: Case[] = [];
  for (const { line, obj } of iterateJsonl(text)) {
    const reqMessages = getNested(obj, ['request', 'body', 'messages'])
      ?? getNested(obj, ['request_body', 'messages']);
    const respChoices = getNested(obj, ['response', 'body', 'choices'])
      ?? getNested(obj, ['response_body', 'choices']);

    const input = lastUserMessage(reqMessages);
    const output = firstChoiceContent(respChoices);
    if (!input || !output) {
      throw new JsonlParseError(
        'helicone: could not extract input + output (expected request.body.messages + response.body.choices or request_body/response_body)',
        line,
      );
    }

    let feedback: Feedback | undefined;
    const fb = obj.feedback ?? getNested(obj, ['properties', 'feedback']);
    if (isRecord(fb) && typeof fb.rating === 'boolean') {
      feedback = { polarity: fb.rating ? 'positive' : 'negative' };
      if (typeof fb.reason === 'string') feedback.reason = fb.reason;
    }

    out.push(toCase(input, output, feedback));
  }
  return out;
}

/**
 * LangSmith trace export. Schema is permissive — inputs can be either
 * `{ input: string }`, `{ messages: [...] }`, or `{ question: string }`;
 * outputs can be `{ output: string }`, `{ generations: [{ text }] }`, or
 * `{ choices: [...] }`. Feedback lives in `feedback: [{ key, score }]` —
 * score >= 0.5 maps to positive, < 0.5 to negative; first feedback wins.
 */
export function parseLangSmithLogs(text: string): Case[] {
  const out: Case[] = [];
  for (const { line, obj } of iterateJsonl(text)) {
    const inputs = obj.inputs;
    const outputs = obj.outputs;

    let input: string | undefined;
    if (isRecord(inputs)) {
      if (typeof inputs.input === 'string') input = inputs.input;
      else if (typeof inputs.question === 'string') input = inputs.question;
      else input = lastUserMessage(inputs.messages);
    }

    let output: string | undefined;
    if (isRecord(outputs)) {
      if (typeof outputs.output === 'string') output = outputs.output;
      else if (Array.isArray(outputs.generations) && outputs.generations.length > 0) {
        const gen = outputs.generations[0];
        if (isRecord(gen) && typeof gen.text === 'string') output = gen.text;
      } else output = firstChoiceContent(outputs.choices);
    }

    if (!input || !output) {
      throw new JsonlParseError(
        'langsmith: could not extract input + output (expected inputs.{input|question|messages} + outputs.{output|generations|choices})',
        line,
      );
    }

    let feedback: Feedback | undefined;
    if (Array.isArray(obj.feedback) && obj.feedback.length > 0) {
      for (const f of obj.feedback) {
        if (!isRecord(f) || typeof f.score !== 'number') continue;
        feedback = { polarity: f.score >= 0.5 ? 'positive' : 'negative' };
        if (typeof f.comment === 'string') feedback.reason = f.comment;
        break;
      }
    }

    out.push(toCase(input, output, feedback));
  }
  return out;
}

export class SyntheticTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyntheticTemplateError';
  }
}

interface SyntheticTemplate {
  input: string;
  expected?: string;
  metadata?: Record<string, unknown>;
}

function isCase(v: unknown): v is Case {
  if (!isRecord(v)) return false;
  if (typeof v.input !== 'string') return false;
  if (v.expected !== undefined && typeof v.expected !== 'string') return false;
  if (v.metadata !== undefined && !isRecord(v.metadata)) return false;
  return true;
}

function validateTemplate(v: unknown): SyntheticTemplate {
  if (!isRecord(v)) throw new SyntheticTemplateError('template must be an object');
  if (typeof v.input !== 'string') throw new SyntheticTemplateError('template.input must be a string');
  if (v.expected !== undefined && typeof v.expected !== 'string') {
    throw new SyntheticTemplateError('template.expected must be a string when set');
  }
  if (v.metadata !== undefined && !isRecord(v.metadata)) {
    throw new SyntheticTemplateError('template.metadata must be an object when set');
  }
  const t: SyntheticTemplate = { input: v.input };
  if (typeof v.expected === 'string') t.expected = v.expected;
  if (isRecord(v.metadata)) t.metadata = v.metadata;
  return t;
}

function validateVariables(v: unknown): Record<string, string[]> {
  if (v === undefined) return {};
  if (!isRecord(v)) throw new SyntheticTemplateError('variables must be an object');
  const out: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(v)) {
    if (!Array.isArray(values) || values.length === 0) {
      throw new SyntheticTemplateError(`variables["${name}"] must be a non-empty array of strings`);
    }
    const strs: string[] = [];
    for (const val of values) {
      if (typeof val !== 'string') {
        throw new SyntheticTemplateError(`variables["${name}"] must contain only strings`);
      }
      strs.push(val);
    }
    out[name] = strs;
  }
  return out;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

function substitute(tpl: string, values: Record<string, string>, path: string): string {
  return tpl.replace(PLACEHOLDER_RE, (_, name: string) => {
    if (!(name in values)) {
      throw new SyntheticTemplateError(`${path}: placeholder {{${name}}} has no matching variable`);
    }
    return values[name]!;
  });
}

function cartesian(vars: Record<string, string[]>): Record<string, string>[] {
  const names = Object.keys(vars);
  if (names.length === 0) return [{}];
  let combos: Record<string, string>[] = [{}];
  for (const name of names) {
    const values = vars[name]!;
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const v of values) next.push({ ...combo, [name]: v });
    }
    combos = next;
  }
  return combos;
}

/**
 * Synthetic dataset bootstrapping. The template file is a single JSON object
 * (not JSONL) in one of two shapes:
 *
 *   1. Literal cases — good for hand-curated starter datasets:
 *        { "cases": [{ "input": "...", "expected": "..." }, ...] }
 *      or just a top-level array: [{ "input": "..." }, ...]
 *
 *   2. Template + variables — cartesian fan-out, good for combinatorial
 *      coverage without hand-writing every row:
 *        {
 *          "template": { "input": "summarize {{topic}} as a {{style}}" },
 *          "variables": { "topic": ["cats","dogs"], "style": ["haiku","ode"] }
 *        }
 *      Emits `topic.length * style.length` cases with placeholders replaced.
 *      Placeholders use `{{name}}`; unreferenced variables are fine but
 *      unknown placeholder names throw.
 *
 * No LLM call — deterministic, repeatable. No feedback channel either, so
 * calibration.json will be empty — hand-label before running `calibrate`.
 */
export function parseSyntheticTemplate(text: string): Case[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SyntheticTemplateError(`invalid JSON: ${msg}`);
  }

  if (Array.isArray(doc)) {
    return doc.map((v, i) => {
      if (!isCase(v)) throw new SyntheticTemplateError(`cases[${i}] must be { input, expected?, metadata? }`);
      return v;
    });
  }

  if (!isRecord(doc)) {
    throw new SyntheticTemplateError('template must be a JSON object or array of cases');
  }

  if (Array.isArray(doc.cases)) {
    return doc.cases.map((v, i) => {
      if (!isCase(v)) throw new SyntheticTemplateError(`cases[${i}] must be { input, expected?, metadata? }`);
      return v;
    });
  }

  if (doc.template !== undefined) {
    const tpl = validateTemplate(doc.template);
    const vars = validateVariables(doc.variables);
    const combos = cartesian(vars);
    const out: Case[] = [];
    for (const combo of combos) {
      const c: Case = { input: substitute(tpl.input, combo, 'template.input') };
      if (tpl.expected !== undefined) {
        c.expected = substitute(tpl.expected, combo, 'template.expected');
      }
      if (tpl.metadata !== undefined) c.metadata = tpl.metadata;
      out.push(c);
    }
    return out;
  }

  throw new SyntheticTemplateError(
    'synthetic template needs either "cases": [...], a top-level array, or "template" + optional "variables"',
  );
}
