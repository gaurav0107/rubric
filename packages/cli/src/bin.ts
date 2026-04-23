#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runCalibrate } from './commands/calibrate.ts';
import { runComment } from './commands/comment.ts';
import { runHistory } from './commands/history.ts';
import { runInit } from './commands/init.ts';
import { runPull } from './commands/pull.ts';
import { runRun } from './commands/run.ts';
import type { RunLimits } from '../../shared/src/index.ts';
import { formatPiiWarning, runSeed } from './commands/seed.ts';
import { runServe } from './commands/serve.ts';
import { runShare } from './commands/share.ts';

function readCliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(here, '..', 'package.json');
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    return typeof raw.version === 'string' ? raw.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const USAGE = `diffprompt — pairwise prompt evaluation

Usage:
  diffprompt init [--force]         Scaffold diffprompt.config.json, prompts/, data/
  diffprompt serve [options]        Launch the three-pane local UI (prompts | cases | live grid)
    --config <path>                 Config file (default: ./diffprompt.config.json)
    --port <n>                      HTTP port (default: 5174)
    --host <addr>                   Bind address (default: 127.0.0.1)
    --mock                          Start in mock mode by default (toggleable in UI)
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
    --cost-csv <path>               Write per-cell cost/latency CSV for spreadsheet analysis
    --max-prompt-chars <n>          Fail if baseline/candidate exceed n characters
    --max-cases <n>                 Fail if the dataset has more than n cases
    --scan-pii                      Warn when case input/expected looks like PII (non-fatal)
  diffprompt seed <source-flag> <in.jsonl> [options]
                                    Convert an LLM-observability export into cases + calibration
    --from-langfuse <path>          Langfuse JSONL export (input + output + optional feedback)
    --from-helicone <path>          Helicone JSONL export (request.body.messages + response.body.choices)
    --from-langsmith <path>         LangSmith trace JSONL (inputs.{input|messages} + outputs.{output|generations})
    --from-openai-logs <path>       OpenAI chat JSONL (fine-tune shape or request/response pairs)
    --from-synthetic <path>         Synthetic template JSON (literal cases[] or template + variables fan-out)
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
  diffprompt share --out <path> [options]
                                    Export workspace as a self-contained bundle.json
    --config <path>                 Config file (default: ./diffprompt.config.json)
    --note <text>                   Attach a human-readable note
    --no-calibration                Skip the _calibration.json.local sidecar
  diffprompt pull <bundle> [options]
                                    Import a bundle.json into the current dir
    --target <dir>                  Target directory (default: .)
    --force                         Overwrite existing files
    --no-calibration                Don't restore the calibration sidecar
  diffprompt history [options]      Compact git-log timeline for the prompt files
    --config <path>                 Config file (default: ./diffprompt.config.json)
    --file <path>                   Track this path instead of config-declared prompts (repeatable)
    --limit <n>                     Max commits (default: 100)
    --html <path>                   Also write a self-contained HTML report

See TODOS.md at the repo root for the v1 launch gate.
`;

function parseFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined) throw new Error(`flag ${name} requires a value`);
  return v;
}

function parseFlagRepeatable(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== name) continue;
    const v = args[i + 1];
    if (v === undefined) throw new Error(`flag ${name} requires a value`);
    out.push(v);
  }
  return out;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE);
    return cmd ? 0 : 1;
  }

  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`diffprompt ${readCliVersion()}\n`);
    return 0;
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
    case 'serve': {
      try {
        const configPath = parseFlag(rest, '--config');
        const portRaw = parseFlag(rest, '--port');
        const host = parseFlag(rest, '--host');
        const mock = rest.includes('--mock');
        const opts: Parameters<typeof runServe>[0] = { mock };
        if (configPath) opts.configPath = configPath;
        if (host) opts.host = host;
        if (portRaw !== undefined) {
          const n = Number(portRaw);
          if (!Number.isFinite(n) || n < 1 || n > 65535) {
            throw new Error(`--port must be 1-65535, got "${portRaw}"`);
          }
          opts.port = Math.floor(n);
        }
        await runServe(opts);
        return 0;
      } catch (err) {
        process.stderr.write(`diffprompt serve: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
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
        const costCsvPath = parseFlag(rest, '--cost-csv');
        const maxPromptCharsRaw = parseFlag(rest, '--max-prompt-chars');
        const maxCasesRaw = parseFlag(rest, '--max-cases');
        const scanPii = rest.includes('--scan-pii');
        const opts: Parameters<typeof runRun>[0] = { mock, allowLangfuse, failOnRegress, json };
        if (configPath) opts.configPath = configPath;
        if (reportPath) opts.reportPath = reportPath;
        if (jsonPath) opts.jsonPath = jsonPath;
        if (badgePath) opts.badgePath = badgePath;
        if (calibrationPath) opts.calibrationPath = calibrationPath;
        if (costCsvPath) opts.costCsvPath = costCsvPath;
        const limits: RunLimits = {};
        if (maxPromptCharsRaw !== undefined) {
          const n = Number(maxPromptCharsRaw);
          if (!Number.isFinite(n) || n < 1) throw new Error(`--max-prompt-chars must be a positive number, got "${maxPromptCharsRaw}"`);
          limits.maxPromptChars = Math.floor(n);
        }
        if (maxCasesRaw !== undefined) {
          const n = Number(maxCasesRaw);
          if (!Number.isFinite(n) || n < 1) throw new Error(`--max-cases must be a positive number, got "${maxCasesRaw}"`);
          limits.maxCases = Math.floor(n);
        }
        if (scanPii) limits.scanPii = true;
        if (Object.keys(limits).length > 0) opts.limits = limits;
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
        const sources = [
          ['--from-langfuse', 'langfuse'] as const,
          ['--from-helicone', 'helicone'] as const,
          ['--from-langsmith', 'langsmith'] as const,
          ['--from-openai-logs', 'openai-logs'] as const,
          ['--from-synthetic', 'synthetic'] as const,
        ];
        const found = sources
          .map(([flag, src]) => ({ flag, src, path: parseFlag(rest, flag) }))
          .filter((x) => x.path !== undefined);
        if (found.length === 0) {
          throw new Error('seed requires one of: --from-langfuse, --from-helicone, --from-langsmith, --from-openai-logs, --from-synthetic');
        }
        if (found.length > 1) {
          throw new Error(`seed: pick exactly one source (got ${found.map((f) => f.flag).join(', ')})`);
        }
        const pick = found[0]!;
        const fromPath = pick.path!;
        const source = pick.src;
        const out = parseFlag(rest, '--out') ?? 'data/cases.jsonl';
        const calibrationOut = parseFlag(rest, '--calibration-out');
        const sampleRaw = parseFlag(rest, '--sample');
        const seedRaw = parseFlag(rest, '--seed');
        const opts: Parameters<typeof runSeed>[0] = { fromPath, source, out };
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
    case 'share': {
      try {
        const configPath = parseFlag(rest, '--config');
        const out = parseFlag(rest, '--out');
        if (!out) throw new Error('share requires --out <path>');
        const note = parseFlag(rest, '--note');
        const noCalibration = rest.includes('--no-calibration');
        const opts: Parameters<typeof runShare>[0] = { out, noCalibration };
        if (configPath) opts.configPath = configPath;
        if (note) opts.note = note;
        const result = runShare(opts);
        process.stdout.write(`  wrote   ${result.bundlePath} (${result.bytes} bytes, ${result.included.cases} cases`);
        if (result.included.calibration) {
          process.stdout.write(`, ${result.included.calibrationEntries} calibration entries`);
        }
        process.stdout.write(`)\n`);
        return 0;
      } catch (err) {
        process.stderr.write(`diffprompt share: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'pull': {
      try {
        const valueFlags = new Set(['--target', '--from']);
        let positional: string | undefined;
        for (let i = 0; i < rest.length; i++) {
          const a = rest[i];
          if (a === undefined) continue;
          if (a.startsWith('--')) continue;
          const prev = rest[i - 1];
          if (prev !== undefined && valueFlags.has(prev)) continue;
          positional = a;
          break;
        }
        const bundlePath = positional ?? parseFlag(rest, '--from');
        if (!bundlePath) throw new Error('pull requires a bundle path (positional) or --from <path>');
        const target = parseFlag(rest, '--target');
        const force = rest.includes('--force');
        const noCalibration = rest.includes('--no-calibration');
        const opts: Parameters<typeof runPull>[0] = { bundlePath, force, noCalibration };
        if (target) opts.target = target;
        const result = runPull(opts);
        for (const p of result.written) process.stdout.write(`  wrote   ${p}\n`);
        for (const p of result.skipped) process.stdout.write(`  skipped ${p} (exists; pass --force to overwrite)\n`);
        if (result.calibrationEntries > 0) {
          process.stdout.write(`\n  ${result.calibrationEntries} calibration entries restored\n`);
        }
        if (result.note) process.stdout.write(`\n  note: ${result.note}\n`);
        return 0;
      } catch (err) {
        process.stderr.write(`diffprompt pull: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'history': {
      try {
        const configPath = parseFlag(rest, '--config');
        const files = parseFlagRepeatable(rest, '--file');
        const htmlPath = parseFlag(rest, '--html');
        const limitRaw = parseFlag(rest, '--limit');
        const opts: Parameters<typeof runHistory>[0] = {};
        if (configPath) opts.configPath = configPath;
        if (files.length > 0) opts.files = files;
        if (htmlPath) opts.htmlPath = htmlPath;
        if (limitRaw !== undefined) {
          const n = Number(limitRaw);
          if (!Number.isFinite(n) || n < 1) throw new Error(`--limit must be a positive number, got "${limitRaw}"`);
          opts.limit = Math.floor(n);
        }
        runHistory(opts);
        return 0;
      } catch (err) {
        process.stderr.write(`diffprompt history: ${err instanceof Error ? err.message : String(err)}\n`);
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
