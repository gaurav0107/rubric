import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseCasesJsonl } from '../../../shared/src/index.ts';

export interface SeedOptions {
  fromLangfuse: string;
  out: string;
  cwd?: string;
  /** Sidecar path for calibration labels. Defaults to prompts/_calibration.json.local relative to out's dir. */
  calibrationOut?: string;
}

export interface SeedResult {
  casesWritten: number;
  calibrationWritten: number;
  outPath: string;
  calibrationPath: string;
}

interface CalibrationEntry {
  input: string;
  output: string;
  polarity: 'positive' | 'negative';
  reason?: string;
}

export function runSeed(opts: SeedOptions): SeedResult {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const inputPath = resolve(cwd, opts.fromLangfuse);
  const outPath = resolve(cwd, opts.out);

  const text = readFileSync(inputPath, 'utf8');
  const cases = parseCasesJsonl(text, { allowLangfuse: true });

  mkdirSync(dirname(outPath), { recursive: true });

  const caseLines: string[] = [];
  const calibration: CalibrationEntry[] = [];

  for (const c of cases) {
    const { metadata, ...rest } = c;
    const langfuse = metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>).langfuse as { output?: string; feedback?: { polarity: 'positive' | 'negative'; reason?: string } } | undefined
      : undefined;

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
  };
}
