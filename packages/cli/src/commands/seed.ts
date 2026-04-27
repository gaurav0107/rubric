import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  detectPii,
  parseCsvLogs,
  summarizePiiFindings,
  type Case,
  type PiiFinding,
} from '../../../shared/src/index.ts';

/**
 * `rubric seed --from-csv <file>` — the v2.2 wedge's only seed adapter.
 *
 * CSV in, cases.jsonl out. The other upstream-log importers (Langfuse,
 * Helicone, LangSmith, OpenAI logs, synthetic templates) and the
 * stratified sampler were cut in the v2.2 migration: teams who need
 * those shapes can preprocess upstream of rubric.
 */

export interface SeedOptions {
  /** Path to the source CSV. */
  fromPath: string;
  out: string;
  cwd?: string;
}

export interface PiiWarning {
  caseIndex: number;
  field: 'input' | 'expected';
  findings: PiiFinding[];
}

export interface SeedResult {
  casesWritten: number;
  outPath: string;
  /** Non-empty when the imported dataset contains likely PII. */
  piiWarnings: PiiWarning[];
}

function collectPii(c: Case, caseIndex: number): PiiWarning[] {
  const warnings: PiiWarning[] = [];
  const inputFindings = detectPii(c.input);
  if (inputFindings.length > 0) warnings.push({ caseIndex, field: 'input', findings: inputFindings });
  if (typeof c.expected === 'string') {
    const expectedFindings = detectPii(c.expected);
    if (expectedFindings.length > 0) warnings.push({ caseIndex, field: 'expected', findings: expectedFindings });
  }
  return warnings;
}

export function runSeed(opts: SeedOptions): SeedResult {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const inputPath = resolve(cwd, opts.fromPath);
  const outPath = resolve(cwd, opts.out);

  const text = readFileSync(inputPath, 'utf8');
  const cases = parseCsvLogs(text);

  mkdirSync(dirname(outPath), { recursive: true });

  const caseLines: string[] = [];
  const piiWarnings: PiiWarning[] = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    caseLines.push(JSON.stringify(c));
    for (const w of collectPii(c, i)) piiWarnings.push(w);
  }

  writeFileSync(outPath, caseLines.join('\n') + (caseLines.length > 0 ? '\n' : ''), 'utf8');

  return {
    casesWritten: caseLines.length,
    outPath,
    piiWarnings,
  };
}

/** Human-readable one-liner per warning, suitable for stderr. */
export function formatPiiWarning(w: PiiWarning): string {
  return `  ⚠ case ${w.caseIndex} ${w.field}: ${summarizePiiFindings(w.findings)}`;
}
