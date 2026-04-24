import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  detectPii,
  mulberry32,
  parseCasesJsonl,
  parseCsvLogs,
  parseHeliconeLogs,
  parseLangSmithLogs,
  parseOpenAiChatLogs,
  parseSyntheticTemplate,
  stratifiedSample,
  summarizePiiFindings,
  type Case,
  type PiiFinding,
} from '../../../shared/src/index.ts';

export type SeedSource = 'langfuse' | 'helicone' | 'langsmith' | 'openai-logs' | 'synthetic' | 'csv';

export interface SeedOptions {
  /** Path to the source export. For source='synthetic', path to a template JSON. */
  fromPath: string;
  /** Upstream log format. Each source maps to a `metadata.langfuse`-shaped Case. */
  source: SeedSource;
  out: string;
  cwd?: string;
  /** Sidecar path for calibration labels. Defaults to prompts/_calibration.json.local relative to out's dir. */
  calibrationOut?: string;
  /**
   * If set, stratified-sample the import down to this many cases.
   * Strata = feedback polarity (positive / negative / none).
   */
  sample?: number;
  /** Seed for the stratified sampler. Default 1 for deterministic output. */
  seed?: number;
}

export interface PiiWarning {
  caseIndex: number;
  field: 'input' | 'output';
  findings: PiiFinding[];
}

export interface SeedResult {
  casesWritten: number;
  calibrationWritten: number;
  outPath: string;
  calibrationPath: string;
  /** Non-empty when the (post-sample) dataset contains likely PII. */
  piiWarnings: PiiWarning[];
  /** Total pre-sample case count; useful when stderr chatter says "sampled X of Y". */
  totalIn: number;
}

interface CalibrationEntry {
  input: string;
  output: string;
  polarity: 'positive' | 'negative';
  reason?: string;
}

interface LangfuseExtras {
  output?: string;
  feedback?: { polarity: 'positive' | 'negative'; reason?: string };
}

function langfuseOf(c: Case): LangfuseExtras | undefined {
  const m = c.metadata;
  if (!m || typeof m !== 'object') return undefined;
  const lf = (m as Record<string, unknown>).langfuse;
  return (lf as LangfuseExtras | undefined) ?? undefined;
}

function polarityKey(c: Case): string {
  const lf = langfuseOf(c);
  return lf?.feedback?.polarity ?? 'none';
}

function collectPii(c: Case, caseIndex: number): PiiWarning[] {
  const warnings: PiiWarning[] = [];
  const inputFindings = detectPii(c.input);
  if (inputFindings.length > 0) warnings.push({ caseIndex, field: 'input', findings: inputFindings });
  const output = langfuseOf(c)?.output;
  if (output) {
    const outputFindings = detectPii(output);
    if (outputFindings.length > 0) warnings.push({ caseIndex, field: 'output', findings: outputFindings });
  }
  return warnings;
}

function parseBySource(text: string, source: SeedSource): Case[] {
  switch (source) {
    case 'langfuse':
      return parseCasesJsonl(text, { allowLangfuse: true });
    case 'helicone':
      return parseHeliconeLogs(text);
    case 'langsmith':
      return parseLangSmithLogs(text);
    case 'openai-logs':
      return parseOpenAiChatLogs(text);
    case 'synthetic':
      return parseSyntheticTemplate(text);
    case 'csv':
      return parseCsvLogs(text);
  }
}

export function runSeed(opts: SeedOptions): SeedResult {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const inputPath = resolve(cwd, opts.fromPath);
  const outPath = resolve(cwd, opts.out);

  const text = readFileSync(inputPath, 'utf8');
  const parsed = parseBySource(text, opts.source);
  const totalIn = parsed.length;

  const cases = opts.sample !== undefined
    ? stratifiedSample(parsed, {
        keyFn: polarityKey,
        total: opts.sample,
        rng: mulberry32(opts.seed ?? 1),
      })
    : parsed;

  mkdirSync(dirname(outPath), { recursive: true });

  const caseLines: string[] = [];
  const calibration: CalibrationEntry[] = [];
  const piiWarnings: PiiWarning[] = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    const { metadata, ...rest } = c;
    const langfuse = langfuseOf(c);

    // Strip langfuse extras; keep user-set metadata only.
    const cleaned: Record<string, unknown> = { ...rest };
    if (metadata && typeof metadata === 'object') {
      const rest2 = { ...(metadata as Record<string, unknown>) };
      delete rest2.langfuse;
      if (Object.keys(rest2).length > 0) cleaned.metadata = rest2;
    }
    caseLines.push(JSON.stringify(cleaned));

    if (langfuse?.output && langfuse.feedback) {
      const entry: CalibrationEntry = {
        input: c.input,
        output: langfuse.output,
        polarity: langfuse.feedback.polarity,
      };
      if (langfuse.feedback.reason) entry.reason = langfuse.feedback.reason;
      calibration.push(entry);
    }

    for (const w of collectPii(c, i)) piiWarnings.push(w);
  }

  writeFileSync(outPath, caseLines.join('\n') + (caseLines.length > 0 ? '\n' : ''), 'utf8');

  const calibrationPath = opts.calibrationOut
    ? resolve(cwd, opts.calibrationOut)
    : resolve(dirname(outPath), '..', 'prompts', '_calibration.json.local');
  mkdirSync(dirname(calibrationPath), { recursive: true });
  writeFileSync(calibrationPath, JSON.stringify({ entries: calibration }, null, 2) + '\n', 'utf8');

  return {
    casesWritten: caseLines.length,
    calibrationWritten: calibration.length,
    outPath,
    calibrationPath,
    piiWarnings,
    totalIn,
  };
}

/** Human-readable one-liner per warning, suitable for stderr. */
export function formatPiiWarning(w: PiiWarning): string {
  return `  ⚠ case ${w.caseIndex} ${w.field}: ${summarizePiiFindings(w.findings)}`;
}
