/**
 * Coach — turns the judge from a referee into a teacher.
 *
 * After a sweep completes, the coach takes the losses and ties, the current
 * candidate prompt, and the judge's per-cell reasons, and asks an LLM: "given
 * these specific losses, what single-sentence edit would most likely flip
 * future cases toward the candidate?"
 *
 * Returns a short summary + up to 5 concrete suggestions. Each suggestion has
 * an `edit` field — a block of prompt text the user can append (or mentally
 * merge) into their candidate.md. Pure functions here; the caller wires the
 * Provider + LLM roundtrip.
 *
 * Design choices:
 *   • Losses are the signal. Wins get ignored; they're already working.
 *     Ties go in second because they're "almost-losses" that one small edit
 *     could flip.
 *   • Outputs are truncated to keep the coach prompt bounded — the loser's
 *     long output rarely matters more than the judge's compressed reason.
 *   • JSON output with tolerant parsing. Models sometimes wrap JSON in
 *     markdown fences or preamble; we strip those before parsing.
 *   • Capped at 5 suggestions. A list longer than that is not a coach,
 *     it's a firehose.
 */
import type { CellResult, Verdict } from './types.ts';

export interface CoachSuggestion {
  /** Short label the UI uses as the suggestion row's headline. */
  title: string;
  /** Why this change might help — grounded in the specific losses. */
  rationale: string;
  /** A block of prompt text to merge into candidate.md. */
  edit: string;
}

export interface CoachReport {
  /** One-sentence synthesis of what the losing cells have in common. */
  summary: string;
  suggestions: CoachSuggestion[];
}

export interface BuildCoachPromptInput {
  baselinePrompt: string;
  candidatePrompt: string;
  /** Pre-selected cells (losses preferred, then ties). See selectCoachableCells. */
  cells: CellResult[];
  /** caseIndex → input text, for context on *what the user was asking*. */
  caseInputs: Map<number, string>;
}

/** How many chars of any single output to keep in the coach prompt. Keeps a
 *  10-cell coach call comfortably under ~20KB of input tokens. */
const OUTPUT_CAP = 400;

function clip(text: string, cap = OUTPUT_CAP): string {
  if (text.length <= cap) return text;
  return text.slice(0, cap) + ' […truncated]';
}

function verdictOf(cell: CellResult): Verdict | 'error' {
  const j = cell.judge;
  if ('error' in j) return 'error';
  return j.winner;
}

function reasonOf(cell: CellResult): string {
  const j = cell.judge;
  if ('error' in j) return j.error;
  return j.reason ?? '';
}

/**
 * Rank + select which cells the coach should see. Losses are the substance;
 * ties are secondary. Within each group, sort by judge-reason length so the
 * richest feedback comes first. The coach call is bounded in size, so we cap
 * how many cells we ship up.
 */
export function selectCoachableCells(cells: CellResult[], cap: number): CellResult[] {
  const losses: CellResult[] = [];
  const ties: CellResult[] = [];
  for (const c of cells) {
    const v = verdictOf(c);
    if (v === 'a') losses.push(c);
    else if (v === 'tie') ties.push(c);
    // wins and errors: not coachable signal; skipped.
  }
  const byReasonLen = (x: CellResult, y: CellResult) => reasonOf(y).length - reasonOf(x).length;
  losses.sort(byReasonLen);
  ties.sort(byReasonLen);
  return [...losses, ...ties].slice(0, cap);
}

export function buildCoachSystemPrompt(): string {
  return [
    'You are a prompt-engineering coach.',
    'A user is iterating on a CANDIDATE prompt to beat a BASELINE on a dataset of cases.',
    'A judge model scored each case; some cases went against the candidate.',
    'Your job: look at the losing cases, spot the pattern, and suggest concrete edits to the CANDIDATE prompt (never the baseline).',
    '',
    'Rules:',
    '- Every suggestion must be specific — tied to an observed failure, not generic advice.',
    '- The `edit` field is a block of prompt text the user will paste into their candidate.md. Write it as prompt text, not as commentary.',
    '- Prefer edits that are short, concrete, and high-leverage. One sentence is often better than a paragraph.',
    '- Return at most 5 suggestions. Fewer is better when the pattern is narrow.',
    '',
    'Respond with ONLY a single JSON object on one line, no prose, no code fences:',
    '{"summary":"one sentence","suggestions":[{"title":"short label","rationale":"why, grounded in the observed losses","edit":"prompt text to add"}]}',
  ].join('\n');
}

export function buildCoachUserPrompt(input: BuildCoachPromptInput): string {
  const lines: string[] = [];
  lines.push('=== BASELINE PROMPT (the thing to beat) ===');
  lines.push(clip(input.baselinePrompt, 1200));
  lines.push('');
  lines.push('=== CANDIDATE PROMPT (the thing to improve) ===');
  lines.push(clip(input.candidatePrompt, 1200));
  lines.push('');
  lines.push('=== CASES TO LEARN FROM ===');
  if (input.cells.length === 0) {
    lines.push('(none — no losing or tied cases in this run)');
  } else {
    input.cells.forEach((cell, i) => {
      const v = verdictOf(cell);
      const verdictLabel = v === 'a' ? 'BASELINE won' : v === 'tie' ? 'tie' : 'error';
      const input_ = input.caseInputs.get(cell.caseIndex) ?? '(input missing)';
      lines.push(`--- case ${i + 1} (index ${cell.caseIndex}, ${verdictLabel}) ---`);
      lines.push(`Input:       ${clip(input_, 400)}`);
      lines.push(`Baseline (A): ${clip(cell.outputA)}`);
      lines.push(`Candidate (B): ${clip(cell.outputB)}`);
      lines.push(`Judge said:  ${clip(reasonOf(cell), 500)}`);
      lines.push('');
    });
  }
  lines.push('Return the JSON object now.');
  return lines.join('\n');
}

/**
 * Strip common wrappers (markdown code fences, prose before/after) and parse
 * the JSON body. Extracted + used synchronously on the server after an LLM
 * generate() call.
 */
export function parseCoachResponse(raw: string): CoachReport {
  const body = extractJsonBody(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new Error(`coach returned unparseable JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('coach response must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const rawSuggestions = obj.suggestions;
  if (!Array.isArray(rawSuggestions)) {
    throw new Error('coach response is missing a "suggestions" array');
  }
  const suggestions: CoachSuggestion[] = [];
  for (const s of rawSuggestions) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    if (typeof o.title !== 'string' || o.title.trim().length === 0) continue;
    if (typeof o.rationale !== 'string' || o.rationale.trim().length === 0) continue;
    if (typeof o.edit !== 'string' || o.edit.trim().length === 0) continue;
    suggestions.push({ title: o.title, rationale: o.rationale, edit: o.edit });
  }
  return { summary, suggestions: suggestions.slice(0, 5) };
}

/**
 * Find the first `{ ... }` balanced pair in raw model output. Models wrap
 * JSON in markdown fences, add a preamble, or append sign-offs; we pull just
 * the object. Handles nested braces via a depth counter.
 */
function extractJsonBody(raw: string): string {
  const firstBrace = raw.indexOf('{');
  if (firstBrace === -1) return raw.trim();
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < raw.length; i++) {
    const ch = raw[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(firstBrace, i + 1);
    }
  }
  return raw.slice(firstBrace).trim();
}
