import type { Case } from './types.ts';

export class JsonlParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
    this.name = 'JsonlParseError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseCaseObject(obj: Record<string, unknown>, line: number): Case {
  if (typeof obj.input !== 'string' || obj.input.length === 0) {
    throw new JsonlParseError('`input` is required and must be a non-empty string', line);
  }
  if (obj.expected !== undefined && typeof obj.expected !== 'string') {
    throw new JsonlParseError('`expected` must be a string when present', line);
  }
  if (obj.metadata !== undefined && !isRecord(obj.metadata)) {
    throw new JsonlParseError('`metadata` must be an object when present', line);
  }

  const out: Case = { input: obj.input };
  if (typeof obj.expected === 'string') out.expected = obj.expected;
  if (isRecord(obj.metadata) && Object.keys(obj.metadata).length > 0) {
    out.metadata = { ...obj.metadata };
  }
  return out;
}

export function parseCasesJsonl(text: string): Case[] {
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
    cases.push(parseCaseObject(parsed, i + 1));
  }

  return cases;
}
