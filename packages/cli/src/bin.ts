#!/usr/bin/env bun
import { runCalibrate } from './commands/calibrate.ts';
import { runComment } from './commands/comment.ts';
import { runInit } from './commands/init.ts';
import { runRun } from './commands/run.ts';
import { formatPiiWarning, runSeed } from './commands/seed.ts';

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
    --json-out <path>               Also write the JSON payload to this file
    --badge-out <path>              Write a status SVG badge (self-hostable in your repo)
    --calibration <path>            Color the badge by calibration agreement (paired with --badge-out)
  diffprompt seed --from-langfuse <in.jsonl> [options]
                                    Convert a Langfuse export into cases + calibration
    --out <path>                    Output cases JSONL (default: data/cases.jsonl)
    --calibration-out <path>        Calibration sidecar (default: prompts/_calibration.json.local)
    --sample <n>                    Stratified-sample to n cases (by feedback polarity)
    --seed <n>                      Sampler RNG seed (default: 1)
  diffprompt calibrate [options]    Measure judge vs. human agreement
    --config <path>                 Config file (default: ./diffprompt.config.json)
    --labels <path>                 Labels JSON (default: prompts/_calibration.json.local)
    --report <path>                 HTML report path (default: calibration.html)
    --json-out <path>               Also write the CalibrationReport JSON to this file
    --mock                          Use deterministic mock grader
    --concurrency <n>               Parallel grader calls (default: 4)
  diffprompt comment --from <run.json> [options]
                                    Render a PR comment from a run JSON payload
    --calibration <path>            Optional CalibrationReport JSON
    --report-url <url>              Link to a hosted HTML report
    --min-agreement <0..1>          Threshold for "weak" calibration banner (default: 0.8)
    --title <text>                  Title suffix (e.g. "baseline.md vs candidate.md")

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
        const jsonPath = parseFlag(rest, '--json-out');
        const badgePath = parseFlag(rest, '--badge-out');
        const calibrationPath = parseFlag(rest, '--calibration');
        const opts: Parameters<typeof runRun>[0] = { mock, allowLangfuse, failOnRegress, json };
        if (configPath) opts.configPath = configPath;
        if (reportPath) opts.reportPath = reportPath;
        if (jsonPath) opts.jsonPath = jsonPath;
        if (badgePath) opts.badgePath = badgePath;
        if (calibrationPath) opts.calibrationPath = calibrationPath;
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
        const sampleRaw = parseFlag(rest, '--sample');
        const seedRaw = parseFlag(rest, '--seed');
        const opts: Parameters<typeof runSeed>[0] = { fromLangfuse, out };
        if (calibrationOut) opts.calibrationOut = calibrationOut;
        if (sampleRaw !== undefined) {
          const n = Number(sampleRaw);
          if (!Number.isFinite(n) || n < 1) throw new Error(`--sample must be a positive number, got "${sampleRaw}"`);
          opts.sample = Math.floor(n);
        }
        if (seedRaw !== undefined) {
          const n = Number(seedRaw);
          if (!Number.isFinite(n)) throw new Error(`--seed must be a finite number, got "${seedRaw}"`);
          opts.seed = Math.floor(n);
        }
        const result = runSeed(opts);
        if (opts.sample !== undefined) {
          process.stdout.write(`  sampled ${result.casesWritten} of ${result.totalIn} (stratified by feedback polarity)\n`);
        }
        process.stdout.write(`  wrote   ${result.outPath} (${result.casesWritten} cases)\n`);
        process.stdout.write(`  wrote   ${result.calibrationPath} (${result.calibrationWritten} labeled)\n`);
        if (result.piiWarnings.length > 0) {
          process.stderr.write(`\n  PII detected in ${result.piiWarnings.length} field(s) — review before publishing:\n`);
          for (const w of result.piiWarnings) process.stderr.write(formatPiiWarning(w) + '\n');
        }
        return 0;
      } catch (err) {
        process.stderr.write(`diffprompt seed: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'comment': {
      try {
        const fromPath = parseFlag(rest, '--from');
        if (!fromPath) throw new Error('comment requires --from <run.json>');
        const calibrationPath = parseFlag(rest, '--calibration');
        const reportUrl = parseFlag(rest, '--report-url');
        const title = parseFlag(rest, '--title');
        const minAgreementRaw = parseFlag(rest, '--min-agreement');
        const opts: Parameters<typeof runComment>[0] = { fromPath };
        if (calibrationPath) opts.calibrationPath = calibrationPath;
        if (reportUrl) opts.reportUrl = reportUrl;
        if (title) opts.title = title;
        if (minAgreementRaw !== undefined) {
          const n = Number(minAgreementRaw);
          if (!Number.isFinite(n) || n < 0 || n > 1) {
            throw new Error(`--min-agreement must be between 0 and 1, got "${minAgreementRaw}"`);
          }
          opts.minAgreement = n;
        }
        const result = runComment(opts);
        return result.exitCode;
      } catch (err) {
        process.stderr.write(`diffprompt comment: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'calibrate': {
      try {
        const configPath = parseFlag(rest, '--config');
        const labelsPath = parseFlag(rest, '--labels');
        const reportPath = parseFlag(rest, '--report');
        const jsonPath = parseFlag(rest, '--json-out');
        const mock = rest.includes('--mock');
        const concurrencyRaw = parseFlag(rest, '--concurrency');
        const opts: Parameters<typeof runCalibrate>[0] = { mock };
        if (configPath) opts.configPath = configPath;
        if (labelsPath) opts.labelsPath = labelsPath;
        if (reportPath) opts.reportPath = reportPath;
        if (jsonPath) opts.jsonPath = jsonPath;
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
