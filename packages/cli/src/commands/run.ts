import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createMockJudge,
  createMockProvider,
  createOpenAIProvider,
  loadConfig,
  parseCasesJsonl,
  runEval,
  type Judge,
  type Provider,
  type RunSummary,
} from '../../../shared/src/index.ts';

export interface RunOptions {
  configPath?: string;
  cwd?: string;
  mock?: boolean;
  concurrency?: number;
  allowLangfuse?: boolean;
  /** Stream of output lines; defaults to process.stdout. */
  write?: (line: string) => void;
}

export interface RunResult {
  total: number;
  summary: RunSummary;
  exitCode: number;
}

const DEFAULT_CONFIG = 'diffprompt.config.json';

function buildProviders(mock: boolean): Provider[] {
  if (mock) return [createMockProvider()];
  return [createOpenAIProvider()];
}

function buildJudge(mock: boolean): Judge {
  if (mock) return createMockJudge({ verdict: 'tie', reason: 'mock judge' });
  throw new Error(
    'live judge is not yet implemented. Re-run with --mock, or wait for the next commit that wires up the real judge.',
  );
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export async function runRun(opts: RunOptions = {}): Promise<RunResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, DEFAULT_CONFIG);
  const mock = opts.mock ?? false;
  const write = opts.write ?? ((line: string) => process.stdout.write(line));

  const loaded = loadConfig(configPath);
  const prompts = {
    baseline: readFileSync(loaded.resolved.baseline, 'utf8'),
    candidate: readFileSync(loaded.resolved.candidate, 'utf8'),
  };
  const datasetText = readFileSync(loaded.resolved.dataset, 'utf8');
  const cases = parseCasesJsonl(datasetText, { allowLangfuse: opts.allowLangfuse ?? false });

  write(`diffprompt: ${cases.length} case(s) x ${loaded.config.models.length} model(s) = ${cases.length * loaded.config.models.length} cell(s)\n`);
  write(`  config:   ${loaded.path}\n`);
  write(`  mode:     ${mock ? 'mock' : 'live'}\n`);

  const providers = buildProviders(mock);
  const judge = buildJudge(mock);

  const onCell = (_cell: unknown, p: { done: number; total: number }) => {
    write(`  [${p.done}/${p.total}]\n`);
  };

  const runOpts: Parameters<typeof runEval>[0] = {
    config: loaded.config,
    cases,
    prompts,
    providers,
    judge,
    onCell,
  };
  if (opts.concurrency !== undefined) runOpts.concurrency = opts.concurrency;

  const { cells, summary } = await runEval(runOpts);

  write(`\nSummary:\n`);
  write(`  wins:    ${summary.wins}\n`);
  write(`  losses:  ${summary.losses}\n`);
  write(`  ties:    ${summary.ties}\n`);
  write(`  errors:  ${summary.errors}\n`);
  write(`  winRate: ${fmtPct(summary.winRate)} (of decisive ${summary.wins + summary.losses})\n`);

  return {
    total: cells.length,
    summary,
    exitCode: summary.errors > 0 ? 1 : 0,
  };
}
