#!/usr/bin/env bun
import { runCalibrate } from './commands/calibrate.ts';
import { runInit } from './commands/init.ts';
import { runRun } from './commands/run.ts';
import { runSeed } from './commands/seed.ts';

const USAGE = `diffprompt — pairwise prompt evaluation

Usage:
  diffprompt init [--force]         Scaffold diffprompt.config.json, prompts/, data/
  diffprompt run [options]          Run an evaluation
    --config <path>                 Config file (default: ./diffprompt.config.json)
    --mock                          Use deterministic mock provider + judge
    --concurrency <n>               Override config.concurrency
    --allow-langfuse                Accept Langfuse-style JSONL exports
    --report <path>                 Write a self-contained HTML report
    --fail-on-regress               Exit 2 when candidate loses more cells than it wins
    --json                          Emit machine-readable JSON on stdout (human logs → stderr)
  diffprompt seed --from-langfuse <in.jsonl> [--out data/cases.jsonl]
                                    Convert a Langfuse export into cases + calibration
  diffprompt calibrate [options]    Measure judge vs. human agreement
    --config <path>                 Config file (default: ./diffprompt.config.json)
    --labels <path>                 Labels JSON (default: prompts/_calibration.json.local)
    --report <path>                 HTML report path (default: calibration.html)
    --mock                          Use deterministic mock grader
    --concurrency <n>               Parallel grader calls (default: 4)

See TODOS.md at the repo root for the v1 launch gate.
`;

function parseFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined) throw new Error(`flag ${name} requires a value`);
  return v;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE);
    return cmd ? 0 : 1;
  }

  switch (cmd) {
    case 'init': {
      const force = rest.includes('--force') || rest.includes('-f');
      const result = runInit({ force });
      for (const path of result.written) process.stdout.write(`  wrote   ${path}\n`);
      for (const path of result.skipped) process.stdout.write(`  skipped ${path} (exists; pass --force to overwrite)\n`);
      process.stdout.write(`\nNext: edit prompts/baseline.md and prompts/candidate.md, then run \`diffprompt run\`.\n`);
      return 0;
    }
    case 'run': {
      try {
        const configPath = parseFlag(rest, '--config');
        const mock = rest.includes('--mock');
        const concurrencyRaw = parseFlag(rest, '--concurrency');
        const allowLangfuse = rest.includes('--allow-langfuse');
        const reportPath = parseFlag(rest, '--report');
        const failOnRegress = rest.includes('--fail-on-regress');
        const json = rest.includes('--json');
        const opts: Parameters<typeof runRun>[0] = { mock, allowLangfuse, failOnRegress, json };
        if (configPath) opts.configPath = configPath;
        if (reportPath) opts.reportPath = reportPath;
        if (concurrencyRaw !== undefined) {
          const n = Number(concurrencyRaw);
          if (!Number.isFinite(n) || n < 1) throw new Error(`--concurrency must be a positive number, got "${concurrencyRaw}"`);
          opts.concurrency = Math.floor(n);
        }
        const result = await runRun(opts);
        return result.exitCode;
      } catch (err) {
        process.stderr.write(`diffprompt run: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'seed': {
      try {
        const fromLangfuse = parseFlag(rest, '--from-langfuse');
        if (!fromLangfuse) throw new Error('seed requires --from-langfuse <path>');
        const out = parseFlag(rest, '--out') ?? 'data/cases.jsonl';
        const calibrationOut = parseFlag(rest, '--calibration-out');
        const opts: Parameters<typeof runSeed>[0] = { fromLangfuse, out };
        if (calibrationOut) opts.calibrationOut = calibrationOut;
        const result = runSeed(opts);
        process.stdout.write(`  wrote   ${result.outPath} (${result.casesWritten} cases)\n`);
        process.stdout.write(`  wrote   ${result.calibrationPath} (${result.calibrationWritten} labeled)\n`);
        return 0;
      } catch (err) {
        process.stderr.write(`diffprompt seed: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'calibrate': {
      try {
        const configPath = parseFlag(rest, '--config');
        const labelsPath = parseFlag(rest, '--labels');
        const reportPath = parseFlag(rest, '--report');
        const mock = rest.includes('--mock');
        const concurrencyRaw = parseFlag(rest, '--concurrency');
        const opts: Parameters<typeof runCalibrate>[0] = { mock };
        if (configPath) opts.configPath = configPath;
        if (labelsPath) opts.labelsPath = labelsPath;
        if (reportPath) opts.reportPath = reportPath;
        if (concurrencyRaw !== undefined) {
          const n = Number(concurrencyRaw);
          if (!Number.isFinite(n) || n < 1) throw new Error(`--concurrency must be a positive number, got "${concurrencyRaw}"`);
          opts.concurrency = Math.floor(n);
        }
        const result = await runCalibrate(opts);
        return result.exitCode;
      } catch (err) {
        process.stderr.write(`diffprompt calibrate: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    default: {
      process.stderr.write(`diffprompt: unknown command "${cmd}"\n\n${USAGE}`);
      return 2;
    }
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code));
