#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runComment } from './commands/comment.ts';
import { runInit } from './commands/init.ts';
import { resolveBannerOnce } from './commands/migration-banner.ts';
import { runProvidersTest } from './commands/providers.ts';
import { runQuickstart } from './commands/quickstart.ts';
import { runRun } from './commands/run.ts';
import { runRunsDiff, runRunsList, runRunsRerun, runRunsShow, runRunsStatus } from './commands/runs.ts';
import type { RunLimits } from '../../shared/src/index.ts';
import { formatPiiWarning, runSeed } from './commands/seed.ts';
import { runServe } from './commands/serve.ts';
import { runWatch } from './commands/watch.ts';
import { parseVerdictFlag, runDisagree } from './commands/disagree.ts';

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
  rubric watch [options]        Watch prompt files; re-eval on save with a persistent judge-call cache
    --config <path>                 Config file (default: ./rubric.config.json)
    --mock                          Use deterministic mock provider + judge (no tokens)
    --concurrency <n>               Override config.concurrency (default: 4)
    --no-cache                      Disable the cell cache (every iteration re-evals)
    --once                          Run one iteration against the current files and exit
    --debounce-ms <n>               Quiet-time before re-evaluating after a save (default: 500)
  rubric disagree <cell-ref>    Override the judge on one cell in your latest run
    --verdict A|B|tie               Your verdict (required unless --undo)
    --reason "..."                  One-line reason (informational; feeds passive calibration)
    --run <id>                      Pin to an explicit run id (default: newest matching run)
    --undo                          Append an undo record — cancels the most recent override for this cell
    --config <path>                 Config file (default: ./rubric.config.json)
  rubric run [options]          Run an evaluation
    --config <path>                 Config file (default: ./rubric.config.json)
    --mock                          Use deterministic mock provider + judge
    --concurrency <n>               Override config.concurrency
    --report <path>                 Write a self-contained HTML report
    --fail-on-regress               Exit 2 when candidate loses more cells than it wins
    --format <mode>                 Output format: human (default) | json | compact
    --json                          Alias for --format json (machine-readable JSON on stdout)
    --json-out <path>               Also write the JSON payload to this file
    --cost-csv <path>               Write per-cell cost/latency CSV for spreadsheet analysis
    --max-prompt-chars <n>          Fail if baseline/candidate exceed n characters
    --max-cases <n>                 Fail if the dataset has more than n cases
    --scan-pii                      Warn when case input/expected looks like PII (non-fatal)
    --verbose                       Print provider diagnostics (base URLs, key sources, redacted headers) before running
  rubric seed --from-csv <in.csv> [options]
                                    Convert a CSV export into cases.jsonl
    --from-csv <path>               CSV with a header row (requires "input" col; optional "expected"; extras → metadata)
    --out <path>                    Output cases JSONL (default: data/cases.jsonl)
  rubric comment --from <run.json> [options]
                                    Render a PR comment from a run JSON payload
    --report-url <url>              Link to a hosted HTML report
    --title <text>                  Title suffix (e.g. "baseline.md vs candidate.md")
  rubric runs <subcommand>      Inspect the local run registry (~/.rubric/runs)
    list [--limit <n>]              Tabulate recent runs (default: last 20)
    show <id>                       Print a run's manifest + summary
    status <id>                     Print "<status>  <done>/<total>"
    diff <a> <b>                    Print summary delta between two runs
    rerun <id> [--mock]             Re-execute a run's config with current prompts/dataset
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

  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`rubric ${readCliVersion()}\n`);
    return 0;
  }

  // One-time post-upgrade banner. Fires on the first invocation after bumping
  // across a major/minor boundary (v2.1 → v2.2); clears itself after printing.
  const banner = resolveBannerOnce(readCliVersion());
  if (banner) process.stderr.write(`${banner}\n`);

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
        const registryRoot = parseFlag(rest, '--registry-root');
        const mock = rest.includes('--mock');
        const opts: Parameters<typeof runServe>[0] = { mock };
        if (configPath) opts.configPath = configPath;
        if (host) opts.host = host;
        if (registryRoot) opts.registryRoot = registryRoot;
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
    case 'watch': {
      try {
        const configPath = parseFlag(rest, '--config');
        const mock = rest.includes('--mock');
        const noCache = rest.includes('--no-cache');
        const once = rest.includes('--once');
        const concurrencyRaw = parseFlag(rest, '--concurrency');
        const debounceRaw = parseFlag(rest, '--debounce-ms');
        const cacheRoot = parseFlag(rest, '--cache-root');
        const registryRoot = parseFlag(rest, '--registry-root');
        const opts: Parameters<typeof runWatch>[0] = { mock, noCache, once };
        if (configPath) opts.configPath = configPath;
        if (cacheRoot) opts.cacheRoot = cacheRoot;
        if (registryRoot) opts.registryRoot = registryRoot;
        if (concurrencyRaw !== undefined) {
          const n = Number(concurrencyRaw);
          if (!Number.isFinite(n) || n < 1) throw new Error(`--concurrency must be a positive number, got "${concurrencyRaw}"`);
          opts.concurrency = Math.floor(n);
        }
        if (debounceRaw !== undefined) {
          const n = Number(debounceRaw);
          if (!Number.isFinite(n) || n < 0) throw new Error(`--debounce-ms must be >= 0, got "${debounceRaw}"`);
          opts.debounceMs = Math.floor(n);
        }
        const result = await runWatch(opts);
        return result.exitCode;
      } catch (err) {
        process.stderr.write(`rubric watch: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'disagree': {
      try {
        // First positional that isn't a flag is the cell-ref.
        // We don't want to treat a `--verdict B` value as the cell-ref, so
        // filter known value-taking flags before picking the positional.
        const cellRef = rest.find((a, i) => {
          if (a.startsWith('--')) return false;
          const prev = rest[i - 1];
          return prev !== '--verdict' && prev !== '--reason' && prev !== '--run' && prev !== '--config';
        });
        if (!cellRef) {
          throw new Error('missing cell-ref; usage: rubric disagree <case-N/provider/model> --verdict A|B|tie --reason "..."');
        }
        const verdictRaw = parseFlag(rest, '--verdict');
        const reason = parseFlag(rest, '--reason');
        const runIdFlag = parseFlag(rest, '--run');
        const configPath = parseFlag(rest, '--config');
        const undo = rest.includes('--undo');
        const opts: Parameters<typeof runDisagree>[0] = { cellRef, undo };
        if (verdictRaw !== undefined) opts.verdict = parseVerdictFlag(verdictRaw);
        if (reason !== undefined) opts.reason = reason;
        if (runIdFlag !== undefined) opts.runId = runIdFlag;
        if (configPath !== undefined) opts.configPath = configPath;
        const result = await runDisagree(opts);
        return result.exitCode;
      } catch (err) {
        process.stderr.write(`rubric disagree: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'run': {
      try {
        const configPath = parseFlag(rest, '--config');
        const mock = rest.includes('--mock');
        const concurrencyRaw = parseFlag(rest, '--concurrency');
        const reportPath = parseFlag(rest, '--report');
        const failOnRegress = rest.includes('--fail-on-regress');
        const json = rest.includes('--json');
        const formatRaw = parseFlag(rest, '--format');
        if (formatRaw !== undefined && !['human', 'json', 'compact'].includes(formatRaw)) {
          throw new Error(`--format must be one of: human, json, compact (got "${formatRaw}")`);
        }
        const format = formatRaw as 'human' | 'json' | 'compact' | undefined;
        const jsonPath = parseFlag(rest, '--json-out');
        const costCsvPath = parseFlag(rest, '--cost-csv');
        const maxPromptCharsRaw = parseFlag(rest, '--max-prompt-chars');
        const maxCasesRaw = parseFlag(rest, '--max-cases');
        const scanPii = rest.includes('--scan-pii');
        const verbose = rest.includes('--verbose');
        const opts: Parameters<typeof runRun>[0] = { mock, failOnRegress, json, verbose };
        if (format !== undefined) opts.format = format;
        if (configPath) opts.configPath = configPath;
        if (reportPath) opts.reportPath = reportPath;
        if (jsonPath) opts.jsonPath = jsonPath;
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
        const fromPath = parseFlag(rest, '--from-csv');
        if (fromPath === undefined) {
          throw new Error('seed requires --from-csv <path> (other adapters were removed in v2.2)');
        }
        const out = parseFlag(rest, '--out') ?? 'data/cases.jsonl';
        const result = runSeed({ fromPath, out });
        process.stdout.write(`  wrote   ${result.outPath} (${result.casesWritten} cases)\n`);
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
        const reportUrl = parseFlag(rest, '--report-url');
        const title = parseFlag(rest, '--title');
        const opts: Parameters<typeof runComment>[0] = { fromPath };
        if (reportUrl) opts.reportUrl = reportUrl;
        if (title) opts.title = title;
        const result = runComment(opts);
        return result.exitCode;
      } catch (err) {
        process.stderr.write(`rubric comment: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'share': {
      process.stderr.write(`rubric share: removed in v2.2 — see CHANGELOG.\n`);
      return 2;
    }
    case 'pull': {
      process.stderr.write(`rubric pull: removed in v2.2 — see CHANGELOG.\n`);
      return 2;
    }
    case 'history': {
      process.stderr.write(`rubric history: removed in v2.2 — use \`git log -p prompts/\` for prompt-file timelines.\n`);
      return 2;
    }
    case 'runs': {
      try {
        const sub = rest[0];
        if (!sub) {
          throw new Error('runs requires a subcommand: list | show | status | diff | rerun');
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
          case 'wait':
          case 'resume': {
            process.stderr.write(`rubric runs ${sub}: removed in v2.2 — see CHANGELOG.\n`);
            return 2;
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
            throw new Error(`runs: unknown subcommand "${sub}" (expected list | show | status | diff | rerun)`);
        }
      } catch (err) {
        process.stderr.write(`rubric runs: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
      }
    }
    case 'finetune': {
      // Removed in v2.2. Deletion is intentional — reinstate only on two
      // independent external asks. Code preserved in git history.
      process.stderr.write(`rubric finetune: removed in v2.2 — see CHANGELOG. Use \`rubric watch\` + \`rubric disagree\` for the iteration loop.\n`);
      return 2;
    }
    case 'calibrate': {
      process.stderr.write(`rubric calibrate: removed in v2.2 — the override log (\`rubric disagree\`) is the calibration corpus now. See CHANGELOG.\n`);
      return 2;
    }
    default: {
      process.stderr.write(`rubric: unknown command "${cmd}"\n\n${USAGE}`);
      return 2;
    }
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code));
