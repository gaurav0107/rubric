import type { Case } from './types.ts';

/**
 * CSV import adapter. The only seed adapter kept in v2.2 — the other
 * upstream-log importers (Langfuse, Helicone, LangSmith, OpenAI logs,
 * synthetic templates) were cut in the v2.2 wedge. CSV maps cleanly to
 * `rubric watch`'s single-table mental model: one row per case, an
 * `input` column, optional `expected`, and any extra columns land in
 * metadata.
 */

export class CsvParseError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(line !== undefined ? `CSV line ${line}: ${message}` : message);
    this.name = 'CsvParseError';
  }
}

/**
 * RFC-4180-ish CSV row parser. Handles:
 *   - comma-separated fields
 *   - double-quoted fields containing commas, quotes ("" escape), newlines
 *   - CRLF / LF line endings
 *   - trailing newline
 *
 * Not a full-spec parser (no custom delimiters, no BOM stripping beyond
 * leading whitespace) — enough for exports from Google Sheets, Excel,
 * LibreOffice, Notion, and the usual suspects.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  let line = 1;

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === '\n') line += 1;
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (field.length > 0) {
        throw new CsvParseError('unexpected quote inside unquoted field', line);
      }
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      cur.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF: treat \r\n as a single newline.
      if (text[i + 1] === '\n') i += 1;
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      i += 1;
      line += 1;
      continue;
    }
    if (ch === '\n') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      i += 1;
      line += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) {
    throw new CsvParseError('unterminated quoted field', line);
  }

  // Flush the trailing record if the file didn't end with a newline.
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  return rows;
}

/**
 * CSV import adapter. Expects a header row with at minimum an `input` column.
 * Optional columns: `expected` (populates Case.expected), any other columns
 * are stuffed into `metadata` so teams can keep their spreadsheet notes
 * (category, priority, ticket-id, …) without losing them on import.
 *
 * Header matching is case-insensitive and trim-forgiving so "Input" /
 * " input " / "INPUT" all work.
 */
export function parseCsvLogs(text: string): Case[] {
  // Strip leading UTF-8 BOM if present.
  const cleaned = text.startsWith('﻿') ? text.slice(1) : text;
  const rows = parseCsvRows(cleaned).filter((r) => !(r.length === 1 && r[0] === ''));
  if (rows.length === 0) {
    throw new CsvParseError('CSV is empty');
  }
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const inputIdx = header.indexOf('input');
  if (inputIdx === -1) {
    throw new CsvParseError(`CSV header must include an "input" column (got: ${header.join(', ')})`);
  }
  const expectedIdx = header.indexOf('expected');

  const out: Case[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    // Skip blank rows (common when people save from Excel with trailing blanks).
    if (row.every((cell) => cell === '')) continue;

    const input = row[inputIdx] ?? '';
    if (input.trim() === '') {
      throw new CsvParseError('row has empty "input"', r + 1);
    }
    const c: Case = { input };
    if (expectedIdx !== -1) {
      const exp = row[expectedIdx];
      if (exp !== undefined && exp !== '') c.expected = exp;
    }
    const metadata: Record<string, string> = {};
    for (let col = 0; col < header.length; col++) {
      if (col === inputIdx || col === expectedIdx) continue;
      const name = header[col];
      const val = row[col];
      if (!name || val === undefined || val === '') continue;
      metadata[name] = val;
    }
    if (Object.keys(metadata).length > 0) c.metadata = metadata;
    out.push(c);
  }
  return out;
}
