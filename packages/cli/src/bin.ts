#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runCalibrate } from './commands/calibrate.ts';
import { runComment } from './commands/comment.ts';
import {
  runFinetuneCancel,
  runFinetuneEval,
  runFinetuneInit,
  runFinetuneLaunch,
  runFinetuneList,
  runFinetunePrepare,
  runFinetuneStatus,
  runFinetuneWait,
} from './commands/finetune.ts';
import { runHistory } from './commands/history.ts';
import { runInit } from './commands/init.ts';
import { runProvidersTest } from './commands/providers.ts';
import { runPull } from './commands/pull.ts';
import { runQuickstart } from './commands/quickstart.ts';
import { runRun } from './commands/run.ts';
import { runRunsDiff, runRunsList, runRunsRerun, runRunsResume, runRunsShow, runRunsStatus, runRunsWait } from './commands/runs.ts';
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

const USAGE = `rubric — pairwise prompt evaluation

Usage:
  rubric quickstart             Zero-config 10-second mock demo (no API keys required)
  rubric init [--force]         Scaffold rubric.config.json, prompts/, data/
    --wizard                        Judge-assisted scaffold (requires --describe)
    --describe <text>               One-sentence description of the task for --wizard
    --mock                          Use the mock judge for --wizard (no tokens spent)
  rubric providers test <name>  Hello-world smoke-test against a configured provider
    --config <path>                 Config file (default: ./rubric.config.json)
    --model <id>                    Override the model (default: inferred from config)
    --prompt <text>                 Override the hello prompt
  rubric serve [options]        Launch the three-pane local UI (prompts | cases | live grid)
    --config <path>                 Config file (default: ./rubric.config.json)
    --port <n>                      HTTP port (default: 5174)
    --host <addr>                   Bind address (default: 127.0.0.1)
    --mock                          Start in mock mode by default (toggleable in UI)
  rubric run [options]          Run an evaluation
    --config <path>                 Config file (default: ./rubric.config.json)
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
    --detach                        Spawn a worker, print the run id, exit (use \`rubric runs wait <id>\`)
  rubric seed <source-flag> <in.jsonl> [options]
                                    Convert an LLM-observability export into cases + calibration
    --from-langfuse <path>          Langfuse JSONL export (input + output + optional feedback)
    --from-helicone <path>          Helicone JSONL export (request.body.messages + response.body.choices)
    --from-langsmith <path>         LangSmith trace JSONL (inputs.{input|messages} + outputs.{output|generations})
    --from-openai-logs <path>       OpenAI chat JSONL (fine-tune shape or request/response pairs)
    --from-synthetic <path>         Synthetic template JSON (literal cases[] or template + variables fan-out)
    --from-csv <path>               CSV with a header row (requires "input" col; optional "expected"; extras → metadata)
    --out <path>                    Output cases JSONL (default: data/cases.jsonl)
    --calibration-out <path>        Calibration sidecar (default: prompts/_calibration.json.local)
    --sample <n>                    Stratified-sample to n cases (by feedback polarity)
    --seed <n>                      Sampler RNG seed (default: 1)
  rubric calibrate [options]    Measure judge vs. human agreement
    --config <path>                 Config file (default: ./rubric.config.json)
    --labels <path>                 Labels JSON (default: prompts/_calibration.json.local)
    --report <path>                 HTML report path (default: calibration.html)
    --json-out <path>               Also write the CalibrationReport JSON to this file
    --mock                          Use deterministic mock grader
    --concurrency <n>               Parallel grader calls (default: 4)
  rubric comment --from <run.json> [options]
                                    Render a PR comment from a run JSON payload
    --calibration <path>            Optional CalibrationReport JSON
    --report-url <url>              Link to a hosted HTML report
    --min-agreement <0..1>          Threshold for "weak" calibration banner (default: 0.8)
    --title <text>                  Title suffix (e.g. "baseline.md vs candidate.md")
  rubric share --out <path> [options]
                                    Export workspace as a self-contained bundle.json
    --config <path>                 Config file (default: ./rubric.config.json)
    --note <text>                   Attach a human-readable note
    --no-calibration                Skip the _calibration.json.local sidecar
  rubric pull <bundle> [options]
                                    Import a bundle.json into the current dir
    --target <dir>                  Target directory (default: .)
    --force                         Overwrite existing files
    --no-calibration                Don't restore the calibration sidecar
  rubric runs <subcommand>      Inspect the local run registry (~/.rubric/runs)
    list [--limit <n>]              Tabulate recent runs (default: last 20)
    show <id>                       Print a run's manifest + summary
    status <id>                     Print "<status>  <done>/<total>"
    diff <a> <b>                    Print summary delta between two runs
    wait <id> [--timeout <ms>]      Block until the run finishes (exit 0 complete, 124 timeout, 1 failed)
    resume <id> [--mock] [--force]  Finish a partial run, skipping cells already in cells.jsonl
    rerun <id> [--mock]             Re-execute a run's config with current prompts/dataset
  rubric history [options]      Compact git-log timeline for the prompt files
    --config <path>                 Config file (default: ./rubric.config.json)
    --file <path>                   Track this path instead of config-declared prompts (repeatable)
    --limit <n>                     Max commits (default: 100)
    --html <path>                   Also write a self-contained HTML report
  rubric finetune <subcommand>  Orchestrate OpenAI SFT jobs (finetunes.json + ~/.rubric/finetunes)
    init [--force]                  Scaffold finetunes.json with one example job
    list                            Table of known jobs + provider status
    prepare <name>                  Write SFT JSONL from cases + prompt template
    launch <name>                   Upload training file + create fine-tune job
    status <name>                   Refresh state from the provider (exits 0 if succeeded)
    wait <name> [--timeout <ms>]    Poll until terminal (exit 0 succeeded, 124 timeout, 1 failed)
    cancel <name>                   Cancel a queued/running job
    eval <name>                     Emit a rubric.config.json wired to the trained model id

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
    process.stdout.write(`rubric ${readCliVersion()}\n`);
    return 0;
  }

  switch (cmd) {
    case 'quickstart': {
      try {
        const result = await runQuickstart();
        return result.exitCode;
      } catch (err) {
        process.stderr.write(`rubric quickstart: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'providers': {
      try {
        const sub = rest[0];
        if (sub !== 'test') {
          throw new Error(`providers: unknown subcommand "${sub ?? ''}" (expected "test")`);
        }
        const target = rest[1];
        if (!target || target.startsWith('--')) {
          throw new Error('providers test requires a provider name or "name/model" id');
        }
        const configPath = parseFlag(rest, '--config');
        const model = parseFlag(rest, '--model');
        const prompt = parseFlag(rest, '--prompt');
        const opts: Parameters<typeof runProvidersTest>[0] = { target };
        if (configPath) opts.configPath = configPath;
        if (model) opts.model = model;
        if (prompt) opts.prompt = prompt;
        const result = await runProvidersTest(opts);
        return result.exitCode;
      } catch (err) {
        process.stderr.write(`rubric providers: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'init': {
      try {
        const force = rest.includes('--force') || rest.includes('-f');
        const wizard = rest.includes('--wizard');
        const describe = parseFlag(rest, '--describe');
        const mock = rest.includes('--mock');
        const initOpts: Parameters<typeof runInit>[0] = { force, wizard, mock };
        if (describe !== undefined) initOpts.describe = describe;
        const result = await runInit(initOpts);
        for (const path of result.written) process.stdout.write(`  wrote   ${path}\n`);
        for (const path of result.skipped) process.stdout.write(`  skipped ${path} (exists; pass --force to overwrite)\n`);
        if (result.autogeneratedCases > 0) {
          process.stdout.write(`\n  ⚠ ${result.autogeneratedCases} autogenerated case(s) — review before trusting the verdict.\n`);
        }
        process.stdout.write(`\nNext: edit prompts/baseline.md and prompts/candidate.md, then run \`rubric run\`.\n`);
        return 0;
      } catch (err) {
        process.stderr.write(`rubric init: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
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
        process.stderr.write(`rubric serve: ${err instanceof Error ? err.message : String(err)}\n`);
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
        const detach = rest.includes('--detach');
        const opts: Parameters<typeof runRun>[0] = { mock, allowLangfuse, failOnRegress, json, detach };
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
        process.stderr.write(`rubric run: ${err instanceof Error ? err.message : String(err)}\n`);
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
          ['--from-csv', 'csv'] as const,
        ];
        const found = sources
          .map(([flag, src]) => ({ flag, src, path: parseFlag(rest, flag) }))
          .filter((x) => x.path !== undefined);
        if (found.length === 0) {
          throw new Error('seed requires one of: --from-langfuse, --from-helicone, --from-langsmith, --from-openai-logs, --from-synthetic, --from-csv');
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
        process.stderr.write(`rubric seed: ${err instanceof Error ? err.message : String(err)}\n`);
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
        process.stderr.write(`rubric comment: ${err instanceof Error ? err.message : String(err)}\n`);
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
        process.stderr.write(`rubric share: ${err instanceof Error ? err.message : String(err)}\n`);
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
        process.stderr.write(`rubric pull: ${err instanceof Error ? err.message : String(err)}\n`);
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
        process.stderr.write(`rubric history: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'runs': {
      try {
        const sub = rest[0];
        if (!sub) {
          throw new Error('runs requires a subcommand: list | show | status | diff | wait | resume | rerun');
        }
        const subArgs = rest.slice(1);
        const registryRoot = parseFlag(subArgs, '--registry-root');
        switch (sub) {
          case 'list': {
            const limitRaw = parseFlag(subArgs, '--limit');
            const opts: Parameters<typeof runRunsList>[0] = {};
            if (registryRoot) opts.registryRoot = registryRoot;
            if (limitRaw !== undefined) {
              const n = Number(limitRaw);
              if (!Number.isFinite(n) || n < 1) throw new Error(`--limit must be a positive number, got "${limitRaw}"`);
              opts.limit = Math.floor(n);
            }
            const r = runRunsList(opts);
            return r.exitCode;
          }
          case 'show': {
            const id = subArgs[0];
            if (!id || id.startsWith('--')) throw new Error('runs show requires a run id');
            const opts: Parameters<typeof runRunsShow>[0] = { id };
            if (registryRoot) opts.registryRoot = registryRoot;
            const r = runRunsShow(opts);
            return r.exitCode;
          }
          case 'status': {
            const id = subArgs[0];
            if (!id || id.startsWith('--')) throw new Error('runs status requires a run id');
            const opts: Parameters<typeof runRunsStatus>[0] = { id };
            if (registryRoot) opts.registryRoot = registryRoot;
            const r = runRunsStatus(opts);
            return r.exitCode;
          }
          case 'diff': {
            const a = subArgs[0];
            const b = subArgs[1];
            if (!a || !b || a.startsWith('--') || b.startsWith('--')) {
              throw new Error('runs diff requires two run ids');
            }
            const opts: Parameters<typeof runRunsDiff>[0] = { a, b };
            if (registryRoot) opts.registryRoot = registryRoot;
            const r = runRunsDiff(opts);
            return r.exitCode;
          }
          case 'wait': {
            const id = subArgs[0];
            if (!id || id.startsWith('--')) throw new Error('runs wait requires a run id');
            const timeoutRaw = parseFlag(subArgs, '--timeout');
            const intervalRaw = parseFlag(subArgs, '--interval');
            const opts: Parameters<typeof runRunsWait>[0] = { id };
            if (registryRoot) opts.registryRoot = registryRoot;
            if (timeoutRaw !== undefined) {
              const n = Number(timeoutRaw);
              if (!Number.isFinite(n) || n < 1) throw new Error(`--timeout must be a positive number of ms, got "${timeoutRaw}"`);
              opts.timeoutMs = Math.floor(n);
            }
            if (intervalRaw !== undefined) {
              const n = Number(intervalRaw);
              if (!Number.isFinite(n) || n < 1) throw new Error(`--interval must be a positive number of ms, got "${intervalRaw}"`);
              opts.intervalMs = Math.floor(n);
            }
            const r = await runRunsWait(opts);
            return r.exitCode;
          }
          case 'resume': {
            const id = subArgs[0];
            if (!id || id.startsWith('--')) throw new Error('runs resume requires a run id');
            const mock = subArgs.includes('--mock');
            const force = subArgs.includes('--force');
            const concurrencyRaw = parseFlag(subArgs, '--concurrency');
            const opts: Parameters<typeof runRunsResume>[0] = { id, mock, force };
            if (registryRoot) opts.registryRoot = registryRoot;
            if (concurrencyRaw !== undefined) {
              const n = Number(concurrencyRaw);
              if (!Number.isFinite(n) || n < 1) throw new Error(`--concurrency must be a positive number, got "${concurrencyRaw}"`);
              opts.concurrency = Math.floor(n);
            }
            const r = await runRunsResume(opts);
            return r.exitCode;
          }
          case 'rerun': {
            const id = subArgs[0];
            if (!id || id.startsWith('--')) throw new Error('runs rerun requires a run id');
            const mock = subArgs.includes('--mock');
            const opts: Parameters<typeof runRunsRerun>[0] = { id, mock };
            if (registryRoot) opts.registryRoot = registryRoot;
            const r = await runRunsRerun(opts);
            return r.exitCode;
          }
          default:
            throw new Error(`runs: unknown subcommand "${sub}" (expected list | show | status | diff | wait | resume | rerun)`);
        }
      } catch (err) {
        process.stderr.write(`rubric runs: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'finetune': {
      try {
        const sub = rest[0];
        if (!sub) {
          throw new Error('finetune requires a subcommand: init | list | prepare | launch | status | wait | cancel | eval');
        }
        const subArgs = rest.slice(1);
        const configPath = parseFlag(subArgs, '--config');
        const finetuneRoot = parseFlag(subArgs, '--finetune-root');
        switch (sub) {
          case 'init': {
            const force = subArgs.includes('--force');
            const opts: Parameters<typeof runFinetuneInit>[0] = { force };
            if (configPath) opts.configPath = configPath;
            const r = runFinetuneInit(opts);
            return r.exitCode;
          }
          case 'list': {
            const opts: Parameters<typeof runFinetuneList>[0] = {};
            if (configPath) opts.configPath = configPath;
            if (finetuneRoot) opts.finetuneRoot = finetuneRoot;
            const r = runFinetuneList(opts);
            return r.exitCode;
          }
          case 'prepare': {
            const name = subArgs[0];
            if (!name || name.startsWith('--')) throw new Error('finetune prepare requires a job name');
            const outDir = parseFlag(subArgs, '--out-dir');
            const opts: Parameters<typeof runFinetunePrepare>[0] = { name };
            if (configPath) opts.configPath = configPath;
            if (finetuneRoot) opts.finetuneRoot = finetuneRoot;
            if (outDir) opts.outDir = outDir;
            const r = runFinetunePrepare(opts);
            return r.exitCode;
          }
          case 'launch': {
            const name = subArgs[0];
            if (!name || name.startsWith('--')) throw new Error('finetune launch requires a job name');
            const apiKey = parseFlag(subArgs, '--api-key');
            const opts: Parameters<typeof runFinetuneLaunch>[0] = { name };
            if (configPath) opts.configPath = configPath;
            if (finetuneRoot) opts.finetuneRoot = finetuneRoot;
            if (apiKey) opts.apiKey = apiKey;
            const r = await runFinetuneLaunch(opts);
            return r.exitCode;
          }
          case 'status': {
            const name = subArgs[0];
            if (!name || name.startsWith('--')) throw new Error('finetune status requires a job name');
            const apiKey = parseFlag(subArgs, '--api-key');
            const opts: Parameters<typeof runFinetuneStatus>[0] = { name };
            if (finetuneRoot) opts.finetuneRoot = finetuneRoot;
            if (apiKey) opts.apiKey = apiKey;
            const r = await runFinetuneStatus(opts);
            return r.exitCode;
          }
          case 'wait': {
            const name = subArgs[0];
            if (!name || name.startsWith('--')) throw new Error('finetune wait requires a job name');
            const timeoutRaw = parseFlag(subArgs, '--timeout');
            const intervalRaw = parseFlag(subArgs, '--interval');
            const apiKey = parseFlag(subArgs, '--api-key');
            const opts: Parameters<typeof runFinetuneWait>[0] = { name };
            if (finetuneRoot) opts.finetuneRoot = finetuneRoot;
            if (apiKey) opts.apiKey = apiKey;
            if (timeoutRaw !== undefined) {
              const n = Number(timeoutRaw);
              if (!Number.isFinite(n) || n < 1) throw new Error(`--timeout must be a positive number of ms, got "${timeoutRaw}"`);
              opts.timeoutMs = Math.floor(n);
            }
            if (intervalRaw !== undefined) {
              const n = Number(intervalRaw);
              if (!Number.isFinite(n) || n < 1) throw new Error(`--interval must be a positive number of ms, got "${intervalRaw}"`);
              opts.intervalMs = Math.floor(n);
            }
            const r = await runFinetuneWait(opts);
            return r.exitCode;
          }
          case 'cancel': {
            const name = subArgs[0];
            if (!name || name.startsWith('--')) throw new Error('finetune cancel requires a job name');
            const apiKey = parseFlag(subArgs, '--api-key');
            const opts: Parameters<typeof runFinetuneCancel>[0] = { name };
            if (finetuneRoot) opts.finetuneRoot = finetuneRoot;
            if (apiKey) opts.apiKey = apiKey;
            const r = await runFinetuneCancel(opts);
            return r.exitCode;
          }
          case 'eval': {
            const name = subArgs[0];
            if (!name || name.startsWith('--')) throw new Error('finetune eval requires a job name');
            const rubricConfigPath = parseFlag(subArgs, '--rubric-config');
            const outPath = parseFlag(subArgs, '--out');
            const opts: Parameters<typeof runFinetuneEval>[0] = { name };
            if (configPath) opts.configPath = configPath;
            if (finetuneRoot) opts.finetuneRoot = finetuneRoot;
            if (rubricConfigPath) opts.rubricConfigPath = rubricConfigPath;
            if (outPath) opts.outPath = outPath;
            const r = runFinetuneEval(opts);
            return r.exitCode;
          }
          default:
            throw new Error(`finetune: unknown subcommand "${sub}" (expected init | list | prepare | launch | status | wait | cancel | eval)`);
        }
      } catch (err) {
        process.stderr.write(`rubric finetune: ${err instanceof Error ? err.message : String(err)}\n`);
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
        process.stderr.write(`rubric calibrate: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    default: {
      process.stderr.write(`rubric: unknown command "${cmd}"\n\n${USAGE}`);
      return 2;
    }
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code));
