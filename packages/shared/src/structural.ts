/**
 * Deterministic pairwise judge for structured outputs — JSON blobs, tool-call
 * payloads, or anything the model is supposed to emit as machine-readable.
 * Skips the LLM round-trip entirely, so it's cheap, reproducible, and useful
 * when the prompt engineering problem is really "does the model return valid
 * JSON in the expected shape?"
 *
 * Scoring rules, in order:
 *   1. Parse A and B as JSON. On parse failure, that side is non-compliant.
 *   2. If `expected` is set and parses as JSON, the side that deep-equals
 *      `expected` wins. Both matching → tie. Neither matching → tie (fall
 *      through to rule 3 for the parse-compliance tiebreak).
 *   3. If only one side parsed, that side wins.
 *   4. Otherwise, tie.
 */
import type { Judge, JudgeRequest } from './mock.ts';
import type { JudgeResult } from './types.ts';

export type StructuralJudgeMode = 'json';

export interface StructuralJudgeOptions {
  /** Reserved for future non-JSON formats. Today: always 'json'. */
  mode?: StructuralJudgeMode;
}

function tryParse(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    // Common LLM habit: wrap JSON in a ```json fence. Be forgiving.
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
    if (fence && fence[1]) {
      try {
        return { ok: true, value: JSON.parse(fence[1]) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    const first = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    const firstArr = trimmed.indexOf('[');
    const lastArr = trimmed.lastIndexOf(']');
    const objSlice = first !== -1 && lastBrace > first ? trimmed.slice(first, lastBrace + 1) : null;
    const arrSlice = firstArr !== -1 && lastArr > firstArr ? trimmed.slice(firstArr, lastArr + 1) : null;
    for (const candidate of [objSlice, arrSlice]) {
      if (!candidate) continue;
      try {
        return { ok: true, value: JSON.parse(candidate) };
      } catch {
        // try next
      }
    }
    return { ok: false, error: 'no parseable JSON found' };
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>).sort();
    const bKeys = Object.keys(b as Record<string, unknown>).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) if (aKeys[i] !== bKeys[i]) return false;
    for (const k of aKeys) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}

export function structuralVerdict(req: JudgeRequest): JudgeResult {
  const a = tryParse(req.outputA);
  const b = tryParse(req.outputB);

  if (req.expected !== undefined) {
    const exp = tryParse(req.expected);
    if (exp.ok) {
      const aMatch = a.ok && deepEqual(a.value, exp.value);
      const bMatch = b.ok && deepEqual(b.value, exp.value);
      if (aMatch && !bMatch) return { winner: 'a', reason: 'A deep-equals expected; B does not.' };
      if (bMatch && !aMatch) return { winner: 'b', reason: 'B deep-equals expected; A does not.' };
      if (aMatch && bMatch) return { winner: 'tie', reason: 'Both outputs deep-equal expected.' };
      // Neither matches — fall through to parse-compliance tiebreak.
    }
  }

  if (a.ok && !b.ok) return { winner: 'a', reason: `A parsed as JSON; B did not (${b.error}).` };
  if (b.ok && !a.ok) return { winner: 'b', reason: `B parsed as JSON; A did not (${a.error}).` };
  return { winner: 'tie', reason: 'Both outputs are equivalent under the structural rubric.' };
}

export function createStructuralJudge(_opts: StructuralJudgeOptions = {}): Judge {
  return {
    name: 'structural-judge',
    async judge(req: JudgeRequest): Promise<JudgeResult> {
      return structuralVerdict(req);
    },
  };
}
