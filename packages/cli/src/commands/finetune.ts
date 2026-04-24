/**
 * `rubric finetune` — multi-step OpenAI SFT orchestration.
 *
 * Design rule: every subcommand is synchronous w.r.t. the provider API —
 * we make one call, update local state, and exit. The polling loop lives
 * at the shell/agent level (`finetune status <name>` in a loop, or
 * `finetune wait <name>`).
 *
 * Subcommand map:
 *   init                  scaffold finetunes.json
 *   list                  table of every known job + its state
 *   prepare <name>        write SFT JSONL into ./finetunes/<name>/train.jsonl
 *   launch <name>         upload file + create job (talks to OpenAI)
 *   status <name>         refresh state by polling the provider
 *   wait <name>           poll until terminal status or timeout
 *   cancel <name>         cancel a queued/running job
 *   eval <name>           emit a config that points `models` at the trained id
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  createOpenAIFinetuneClient,
  defaultExposeAlias,
  defaultFinetuneRoot,
  findJob,
  isTerminal,
  listStates,
  loadConfig,
  loadFinetuneConfig,
  prepareSftJsonl,
  readState,
  updateState,
  type Config,
  type FinetuneClient,
  type FinetuneJob,
  type FinetuneState,
} from '../../../shared/src/index.ts';

const DEFAULT_FINETUNES_JSON = 'finetunes.json';

export interface FinetuneInitOptions {
  cwd?: string;
  configPath?: string;
  force?: boolean;
  write?: (line: string) => void;
}

const INIT_SCAFFOLD = {
  version: 1,
  jobs: [
    {
      name: 'example',
      base: 'openai/gpt-4o-mini',
      trainData: 'data/cases.jsonl',
      promptTemplate: 'prompts/candidate.md',
      hyper: { nEpochs: 3 },
      note: 'rename me and point at real data, then: rubric finetune prepare example',
    },
  ],
};

export function runFinetuneInit(opts: FinetuneInitOptions = {}): { exitCode: number; path: string } {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const path = opts.configPath ? resolve(cwd, opts.configPath) : resolve(cwd, DEFAULT_FINETUNES_JSON);
  const write = opts.write ?? ((l: string) => process.stdout.write(l));
  if (existsSync(path) && !opts.force) {
    write(`${path} already exists — pass --force to overwrite\n`);
    return { exitCode: 1, path };
  }
  writeFileSync(path, JSON.stringify(INIT_SCAFFOLD, null, 2) + '\n', 'utf8');
  write(`  wrote   ${path}\n`);
  write(`\nNext: edit the example entry, then run \`rubric finetune prepare example\`\n`);
  return { exitCode: 0, path };
}

export interface FinetuneListOptions {
  cwd?: string;
  configPath?: string;
  finetuneRoot?: string;
  write?: (line: string) => void;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s.padEnd(n);
  return s.slice(0, n - 1) + '…';
}

export function runFinetuneList(opts: FinetuneListOptions = {}): { exitCode: number } {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ? resolve(cwd, opts.configPath) : resolve(cwd, DEFAULT_FINETUNES_JSON);
  const finetuneRoot = opts.finetuneRoot ?? defaultFinetuneRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));

  const jobsFromConfig: FinetuneJob[] = existsSync(configPath) ? loadFinetuneConfig(configPath).config.jobs : [];
  const states = listStates(finetuneRoot);
  const byName = new Map<string, FinetuneState>();
  for (const s of states) byName.set(s.name, s);

  const rows: Array<{ name: string; status: string; base: string; trainedModelId: string | undefined; updatedAt: string }> = [];
  for (const job of jobsFromConfig) {
    const s = byName.get(job.name);
    rows.push({
      name: job.name,
      status: s?.status ?? 'pending',
      base: job.base,
      trainedModelId: s?.trainedModelId,
      updatedAt: s?.updatedAt ?? '',
    });
  }
  for (const s of states) {
    if (rows.find((r) => r.name === s.name)) continue;
    rows.push({
      name: s.name,
      status: s.status,
      base: '(not in finetunes.json)',
      trainedModelId: s.trainedModelId,
      updatedAt: s.updatedAt,
    });
  }

  if (rows.length === 0) {
    write(`no finetune jobs — run \`rubric finetune init\` to scaffold\n`);
    return { exitCode: 0 };
  }

  write(`${'name'.padEnd(24)}  ${'status'.padEnd(10)}  ${'base'.padEnd(24)}  trained model\n`);
  for (const r of rows) {
    write(`${truncate(r.name, 24)}  ${r.status.padEnd(10)}  ${truncate(r.base, 24)}  ${r.trainedModelId ?? '—'}\n`);
  }
  return { exitCode: 0 };
}

export interface FinetunePrepareOptions {
  name: string;
  cwd?: string;
  configPath?: string;
  finetuneRoot?: string;
  /** Override the output dir; defaults to <cwd>/finetunes/<name>/. */
  outDir?: string;
  write?: (line: string) => void;
}

export function runFinetunePrepare(opts: FinetunePrepareOptions): { exitCode: number; outPath: string; examplesWritten: number } {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ? resolve(cwd, opts.configPath) : resolve(cwd, DEFAULT_FINETUNES_JSON);
  const finetuneRoot = opts.finetuneRoot ?? defaultFinetuneRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));

  const loaded = loadFinetuneConfig(configPath);
  const job = findJob(loaded.config, opts.name);
  const resolvedPaths = loaded.resolved.find((r) => r.name === job.name)!;

  const datasetText = readFileSync(resolvedPaths.trainData, 'utf8');
  const promptTemplate = readFileSync(resolvedPaths.promptTemplate, 'utf8');
  const prepared = prepareSftJsonl({ datasetText, promptTemplate });

  if (prepared.examplesWritten === 0) {
    write(`no usable examples found in ${resolvedPaths.trainData} (${prepared.totalCases} cases, ${prepared.skippedNoExpected} without expected)\n`);
    return { exitCode: 1, outPath: '', examplesWritten: 0 };
  }

  const outDir = opts.outDir
    ? (isAbsolute(opts.outDir) ? opts.outDir : resolve(cwd, opts.outDir))
    : resolve(cwd, 'finetunes', job.name);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'train.jsonl');
  writeFileSync(outPath, prepared.text, 'utf8');

  updateState(finetuneRoot, job.name, {
    status: 'prepared',
    preparedPath: outPath,
  });

  write(`  wrote   ${outPath} (${prepared.examplesWritten} examples, ${prepared.skippedNoExpected} skipped without expected)\n`);
  write(`\nNext: \`rubric finetune launch ${job.name}\`\n`);
  return { exitCode: 0, outPath, examplesWritten: prepared.examplesWritten };
}

export interface FinetuneLaunchOptions {
  name: string;
  cwd?: string;
  configPath?: string;
  finetuneRoot?: string;
  /** Injectable API client; defaults to live OpenAI. */
  client?: FinetuneClient;
  /** Override the API key (test seam). */
  apiKey?: string;
  write?: (line: string) => void;
}

function stripProviderPrefix(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

export async function runFinetuneLaunch(opts: FinetuneLaunchOptions): Promise<{ exitCode: number; jobId?: string }> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ? resolve(cwd, opts.configPath) : resolve(cwd, DEFAULT_FINETUNES_JSON);
  const finetuneRoot = opts.finetuneRoot ?? defaultFinetuneRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));

  const loaded = loadFinetuneConfig(configPath);
  const job = findJob(loaded.config, opts.name);
  const state = readState(finetuneRoot, job.name);
  if (!state || !state.preparedPath) {
    write(`job "${job.name}" has not been prepared yet — run \`rubric finetune prepare ${job.name}\`\n`);
    return { exitCode: 1 };
  }
  if (!existsSync(state.preparedPath)) {
    write(`prepared file missing at ${state.preparedPath} — re-run prepare\n`);
    return { exitCode: 1 };
  }
  if (state.jobId) {
    write(`job "${job.name}" already has a provider job id (${state.jobId}) — use \`rubric finetune status ${job.name}\`\n`);
    return { exitCode: 1, jobId: state.jobId };
  }

  const client = opts.client ?? createOpenAIFinetuneClient(opts.apiKey ? { apiKey: opts.apiKey } : {});
  const content = readFileSync(state.preparedPath, 'utf8');
  write(`  uploading ${state.preparedPath}…\n`);
  const up = await client.uploadTrainingFile(content, `${job.name}.jsonl`);
  updateState(finetuneRoot, job.name, { status: 'uploaded', fileId: up.id });
  write(`  uploaded  ${up.id}\n`);

  const createOpts: Parameters<FinetuneClient['createJob']>[0] = {
    trainingFileId: up.id,
    baseModel: stripProviderPrefix(job.base),
    suffix: job.name,
  };
  if (job.hyper) createOpts.hyperparameters = job.hyper;
  write(`  creating fine-tune job (base: ${createOpts.baseModel})…\n`);
  const created = await client.createJob(createOpts);
  updateState(finetuneRoot, job.name, { status: created.status === 'queued' ? 'queued' : 'running', jobId: created.id });
  write(`  job id    ${created.id} (status: ${created.status})\n`);
  write(`\nNext: \`rubric finetune status ${job.name}\` (or poll with \`rubric finetune wait ${job.name}\`)\n`);
  return { exitCode: 0, jobId: created.id };
}

export interface FinetuneStatusOptions {
  name: string;
  cwd?: string;
  finetuneRoot?: string;
  client?: FinetuneClient;
  apiKey?: string;
  write?: (line: string) => void;
}

export async function runFinetuneStatus(opts: FinetuneStatusOptions): Promise<{ exitCode: number; status: string }> {
  const finetuneRoot = opts.finetuneRoot ?? defaultFinetuneRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));
  const state = readState(finetuneRoot, opts.name);
  if (!state) {
    write(`no state for "${opts.name}" — run \`rubric finetune prepare ${opts.name}\` first\n`);
    return { exitCode: 1, status: 'unknown' };
  }
  if (!state.jobId) {
    write(`${state.status}  (no provider job yet — prepared: ${state.preparedPath ?? 'no'})\n`);
    return { exitCode: 0, status: state.status };
  }
  if (isTerminal(state.status)) {
    // No need to hit the provider — cache says it's done.
    write(`${state.status}  ${state.trainedModelId ?? ''}\n`);
    return { exitCode: state.status === 'succeeded' ? 0 : 1, status: state.status };
  }
  const client = opts.client ?? createOpenAIFinetuneClient(opts.apiKey ? { apiKey: opts.apiKey } : {});
  const job = await client.getJob(state.jobId);
  const patch: Partial<FinetuneState> = { status: job.status as FinetuneState['status'] };
  if (job.fineTunedModel) patch.trainedModelId = job.fineTunedModel;
  if (job.error) patch.error = job.error;
  const updated = updateState(finetuneRoot, opts.name, patch);
  write(`${updated.status}  ${updated.trainedModelId ?? ''}${updated.error ? `  (error: ${updated.error})` : ''}\n`);
  return { exitCode: updated.status === 'succeeded' ? 0 : updated.status === 'failed' ? 1 : 0, status: updated.status };
}

export interface FinetuneWaitOptions {
  name: string;
  cwd?: string;
  finetuneRoot?: string;
  client?: FinetuneClient;
  apiKey?: string;
  intervalMs?: number;
  timeoutMs?: number;
  write?: (line: string) => void;
}

export async function runFinetuneWait(opts: FinetuneWaitOptions): Promise<{ exitCode: number; status: string }> {
  const interval = opts.intervalMs ?? 15000;
  const deadline = opts.timeoutMs !== undefined ? Date.now() + opts.timeoutMs : Infinity;
  while (true) {
    const baseOpts: FinetuneStatusOptions = { name: opts.name, write: () => {} };
    if (opts.cwd) baseOpts.cwd = opts.cwd;
    if (opts.finetuneRoot) baseOpts.finetuneRoot = opts.finetuneRoot;
    if (opts.client) baseOpts.client = opts.client;
    if (opts.apiKey) baseOpts.apiKey = opts.apiKey;
    const r = await runFinetuneStatus(baseOpts);
    if (isTerminal(r.status as FinetuneState['status'])) {
      opts.write?.(`${r.status}\n`);
      return { exitCode: r.exitCode, status: r.status };
    }
    if (Date.now() >= deadline) {
      opts.write?.(`${r.status}\n`);
      return { exitCode: 124, status: r.status };
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export interface FinetuneCancelOptions {
  name: string;
  cwd?: string;
  finetuneRoot?: string;
  client?: FinetuneClient;
  apiKey?: string;
  write?: (line: string) => void;
}

export async function runFinetuneCancel(opts: FinetuneCancelOptions): Promise<{ exitCode: number }> {
  const finetuneRoot = opts.finetuneRoot ?? defaultFinetuneRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));
  const state = readState(finetuneRoot, opts.name);
  if (!state || !state.jobId) {
    write(`no active job for "${opts.name}"\n`);
    return { exitCode: 1 };
  }
  if (isTerminal(state.status)) {
    write(`"${opts.name}" is already ${state.status} — nothing to cancel\n`);
    return { exitCode: 0 };
  }
  const client = opts.client ?? createOpenAIFinetuneClient(opts.apiKey ? { apiKey: opts.apiKey } : {});
  const res = await client.cancelJob(state.jobId);
  updateState(finetuneRoot, opts.name, { status: 'cancelled' });
  write(`cancelled ${res.id}\n`);
  return { exitCode: 0 };
}

export interface FinetuneEvalOptions {
  name: string;
  cwd?: string;
  configPath?: string;
  rubricConfigPath?: string;
  finetuneRoot?: string;
  /** Where to write the derived eval config; defaults to <cwd>/finetunes/<name>/rubric.config.json. */
  outPath?: string;
  write?: (line: string) => void;
}

/**
 * Emit a derived `rubric.config.json` that swaps the candidate model to the
 * trained fine-tune id. We don't invoke `rubric run` ourselves — callers
 * chain this with their own `rubric run --config <path>` so the emitted
 * config sits under version control and can be diffed.
 */
export function runFinetuneEval(opts: FinetuneEvalOptions): { exitCode: number; outPath: string } {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ? resolve(cwd, opts.configPath) : resolve(cwd, DEFAULT_FINETUNES_JSON);
  const rubricConfigPath = opts.rubricConfigPath
    ? resolve(cwd, opts.rubricConfigPath)
    : resolve(cwd, 'rubric.config.json');
  const finetuneRoot = opts.finetuneRoot ?? defaultFinetuneRoot();
  const write = opts.write ?? ((l: string) => process.stdout.write(l));

  const ftLoaded = loadFinetuneConfig(configPath);
  const job = findJob(ftLoaded.config, opts.name);
  const state = readState(finetuneRoot, opts.name);
  if (!state || state.status !== 'succeeded' || !state.trainedModelId) {
    write(`"${opts.name}" has not succeeded yet (status: ${state?.status ?? 'unknown'}) — run \`rubric finetune wait ${opts.name}\`\n`);
    return { exitCode: 1, outPath: '' };
  }

  const loadedRubric = loadConfig(rubricConfigPath);
  // The trained model lives under OpenAI's API with an id like
  //   ft:gpt-4o-mini:acme::abc
  // Our built-in openai/ provider passes the model string through unchanged,
  // so `openai/ft:...` just works. No extra provider entry needed.
  const exposedModelId = `openai/${state.trainedModelId}`;
  const nextConfig: Config = {
    ...loadedRubric.config,
    models: [exposedModelId, ...loadedRubric.config.models.slice(1)],
  };

  const outPath = opts.outPath
    ? (isAbsolute(opts.outPath) ? opts.outPath : resolve(cwd, opts.outPath))
    : resolve(cwd, 'finetunes', job.name, 'rubric.config.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(nextConfig, null, 2) + '\n', 'utf8');
  write(`  wrote   ${outPath}\n`);
  write(`  models  ${nextConfig.models.join(', ')}\n`);
  write(`  alias   ${defaultExposeAlias(job)} → ${exposedModelId}\n`);
  write(`\nNext: \`rubric run --config ${outPath}\`\n`);
  return { exitCode: 0, outPath };
}
