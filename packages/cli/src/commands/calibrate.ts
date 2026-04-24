import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createConfiguredProviders,
  createMockProvider,
  createOpenAIGrader,
  loadConfig,
  renderCalibrationHtml,
  resolveRubric,
  runCalibration,
  type CalibrationEntry,
  type CalibrationReport,
  type Grader,
  type GraderPolarity,
  type GraderRequest,
  type Provider,
} from '../../../shared/src/index.ts';

export interface CalibrateOptions {
  configPath?: string;
  cwd?: string;
  /** Path to the calibration JSON sidecar. Default: prompts/_calibration.json.local. */
  labelsPath?: string;
  /** Report path (relative to cwd). Default: calibration.html. */
  reportPath?: string;
  /** When set, also write the CalibrationReport as JSON to this path for `diffprompt comment` to consume. */
  jsonPath?: string;
  mock?: boolean;
  concurrency?: number;
  write?: (line: string) => void;
}

export interface CalibrateResult {
  report: CalibrationReport;
  reportPath: string;
  exitCode: number;
}

function readLabels(path: string): CalibrationEntry[] {
  const text = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse calibration labels at ${path}: ${msg}`);
  }
  if (
    typeof parsed !== 'object' || parsed === null
    || !Array.isArray((parsed as Record<string, unknown>).entries)
  ) {
    throw new Error(`calibration file ${path} must be { "entries": [...] }`);
  }
  const rawEntries = (parsed as { entries: unknown[] }).entries;
  const out: CalibrationEntry[] = [];
  for (let i = 0; i < rawEntries.length; i++) {
    const e = rawEntries[i];
    if (typeof e !== 'object' || e === null) {
      throw new Error(`entry ${i} in ${path} is not an object`);
    }
    const rec = e as Record<string, unknown>;
    if (typeof rec.input !== 'string' || typeof rec.output !== 'string') {
      throw new Error(`entry ${i} in ${path} is missing input/output`);
    }
    if (rec.polarity !== 'positive' && rec.polarity !== 'negative') {
      throw new Error(`entry ${i} in ${path} has invalid polarity ${JSON.stringify(rec.polarity)}`);
    }
    const entry: CalibrationEntry = {
      input: rec.input,
      output: rec.output,
      polarity: rec.polarity as GraderPolarity,
    };
    if (typeof rec.reason === 'string') entry.reason = rec.reason;
    out.push(entry);
  }
  return out;
}

function buildGrader(
  mock: boolean,
  judgeModel: string,
  providers: Provider[],
  rubric: string,
): Grader {
  if (mock) {
    return {
      name: 'mock-grader',
      async grade(req: GraderRequest) {
        // Echoes the human label by treating output ending in "!" as positive
        // for a toy-but-deterministic signal in tests/demos.
        const polarity: GraderPolarity = req.output.endsWith('!') ? 'positive' : 'negative';
        return { polarity, reason: `mock grader (rubric: ${rubric})` };
      },
    };
  }
  const provider = providers.find((p) => p.supports(judgeModel as never));
  if (!provider) {
    throw new Error(`no provider accepts judge.model "${judgeModel}"`);
  }
  return createOpenAIGrader({
    provider,
    model: judgeModel as never,
    rubric,
  });
}

export async function runCalibrate(opts: CalibrateOptions = {}): Promise<CalibrateResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, 'diffprompt.config.json');
  const labelsPath = resolve(cwd, opts.labelsPath ?? 'prompts/_calibration.json.local');
  const reportPath = resolve(cwd, opts.reportPath ?? 'calibration.html');
  const mock = opts.mock ?? false;
  const concurrency = opts.concurrency ?? 4;
  const write = opts.write ?? ((line: string) => process.stdout.write(line));

  const loaded = loadConfig(configPath);
  const entries = readLabels(labelsPath);

  const providers: Provider[] = mock
    ? [createMockProvider({ acceptAll: true })]
    : createConfiguredProviders(loaded.config.providers, loaded.baseDir);
  const rubric = resolveRubric(loaded.config.judge.rubric, loaded.baseDir);
  const grader = buildGrader(mock, loaded.config.judge.model, providers, rubric);

  write(`diffprompt calibrate: ${entries.length} label(s)\n`);
  write(`  labels:   ${labelsPath}\n`);
  write(`  judge:    ${loaded.config.judge.model} (${mock ? 'mock' : 'live'})\n`);

  const report = await runCalibration(entries, grader, rubric, concurrency);

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  write(`\nAgreement: ${pct(report.agreement)} (${report.agreements}/${report.agreements + report.disagreements})\n`);
  write(`  agreements:    ${report.agreements}\n`);
  write(`  disagreements: ${report.disagreements}\n`);
  write(`  errors:        ${report.errors}\n`);

  const html = renderCalibrationHtml(report);
  writeFileSync(reportPath, html, 'utf8');
  write(`\n  report:   ${reportPath}\n`);

  if (opts.jsonPath) {
    const absJson = resolve(cwd, opts.jsonPath);
    writeFileSync(absJson, JSON.stringify(report) + '\n', 'utf8');
    write(`  json:     ${absJson}\n`);
  }

  return {
    report,
    reportPath,
    exitCode: report.errors > 0 ? 1 : 0,
  };
}
