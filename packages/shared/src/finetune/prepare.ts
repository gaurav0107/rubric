/**
 * Translate rubric case data into the OpenAI chat SFT JSONL shape.
 *
 * OpenAI expects one JSON object per line with a `messages` array. For SFT
 * we need (user, assistant) pairs at minimum; an optional system prompt is
 * extracted from the first `---` block in the prompt template by convention.
 *
 *   {"messages":[
 *     {"role":"system","content":"You classify refunds..."},
 *     {"role":"user","content":"order 12345: requesting refund..."},
 *     {"role":"assistant","content":"approve"}
 *   ]}
 *
 * Cases without an `expected` field are skipped (can't train without a
 * target) but counted so the user sees the drop in the summary.
 */
import type { Case } from '../types.ts';
import { parseCasesJsonl } from '../jsonl.ts';
import { renderPrompt } from '../prompt.ts';

export interface PrepareInput {
  /** Contents of the dataset JSONL (already read from disk). */
  datasetText: string;
  /** Raw prompt template; templated per-case for the `user` message. */
  promptTemplate: string;
  /** When allowLangfuse is true, parseCasesJsonl tolerates langfuse-shaped lines. */
  allowLangfuse?: boolean;
}

export interface PrepareResult {
  /** Ready-to-upload OpenAI SFT JSONL (newline-terminated). */
  text: string;
  /** Count of usable (input + expected) examples written. */
  examplesWritten: number;
  /** Total cases found in the dataset before filtering. */
  totalCases: number;
  /** Cases skipped because they lacked an `expected` field. */
  skippedNoExpected: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Split the prompt template into (system, userTemplate). Convention: if the
 * template starts with a `---` block it's treated as the system prompt; the
 * rest becomes the user-visible template. Keeps this aligned with how rubric
 * renders prompts for the live judge.
 */
export function splitPromptTemplate(template: string): { system: string | undefined; userTemplate: string } {
  const trimmed = template.trimStart();
  if (!trimmed.startsWith('---')) {
    return { system: undefined, userTemplate: template };
  }
  const after = trimmed.slice(3);
  const closeIdx = after.indexOf('\n---');
  if (closeIdx === -1) return { system: undefined, userTemplate: template };
  const system = after.slice(0, closeIdx).trim();
  const rest = after.slice(closeIdx + 4).replace(/^\n/, '');
  return { system: system.length > 0 ? system : undefined, userTemplate: rest };
}

export function buildMessages(c: Case, template: string): ChatMessage[] | null {
  if (c.expected === undefined) return null;
  const { system, userTemplate } = splitPromptTemplate(template);
  const messages: ChatMessage[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: renderPrompt(userTemplate, c) });
  messages.push({ role: 'assistant', content: c.expected });
  return messages;
}

export function prepareSftJsonl(input: PrepareInput): PrepareResult {
  const cases = parseCasesJsonl(input.datasetText, { allowLangfuse: input.allowLangfuse ?? false });
  let examplesWritten = 0;
  let skipped = 0;
  const lines: string[] = [];
  for (const c of cases) {
    const messages = buildMessages(c, input.promptTemplate);
    if (!messages) { skipped++; continue; }
    lines.push(JSON.stringify({ messages }));
    examplesWritten++;
  }
  return {
    text: lines.length > 0 ? lines.join('\n') + '\n' : '',
    examplesWritten,
    totalCases: cases.length,
    skippedNoExpected: skipped,
  };
}
