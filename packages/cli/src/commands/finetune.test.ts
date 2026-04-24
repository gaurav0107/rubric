/**
 * CLI-level coverage for `rubric finetune …`.
 *
 * We inject a fake FinetuneClient so these tests never hit OpenAI, and we
 * fixture a tmp workspace so prepare/eval can touch real files.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CreateJobOpts, FinetuneClient } from '../../../shared/src/index.ts';
import { readState, updateState } from '../../../shared/src/index.ts';
import {
  runFinetuneCancel,
  runFinetuneEval,
  runFinetuneInit,
  runFinetuneLaunch,
  runFinetuneList,
  runFinetunePrepare,
  runFinetuneStatus,
} from './finetune.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'rubric-ft-cli-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function fixtureWorkspace(): { root: string; ftRoot: string; configPath: string; rubricConfigPath: string } {
  const root = tmp();
  const ftRoot = join(root, 'ft-registry');
  mkdirSync(ftRoot, { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'prompts'), { recursive: true });

  const cases = [
    { input: 'hi', expected: 'hello' },
    { input: 'bye', expected: 'goodbye' },
    { input: 'no expected here' },
  ];
  writeFileSync(
    join(root, 'data/cases.jsonl'),
    cases.map((c) => JSON.stringify(c)).join('\n') + '\n',
    'utf8',
  );
  writeFileSync(
    join(root, 'prompts/candidate.md'),
    '---\nYou are a greeter.\n---\nSay: {{input}}\n',
    'utf8',
  );
  writeFileSync(
    join(root, 'prompts/baseline.md'),
    'Baseline: {{input}}\n',
    'utf8',
  );

  const configPath = join(root, 'finetunes.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      version: 1,
      jobs: [
        {
          name: 'greeter',
          base: 'openai/gpt-4o-mini',
          trainData: 'data/cases.jsonl',
          promptTemplate: 'prompts/candidate.md',
          hyper: { nEpochs: 3 },
        },
      ],
    }),
    'utf8',
  );

  const rubricConfigPath = join(root, 'rubric.config.json');
  writeFileSync(
    rubricConfigPath,
    JSON.stringify({
      prompts: { baseline: 'prompts/baseline.md', candidate: 'prompts/candidate.md' },
      dataset: 'data/cases.jsonl',
      models: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
      judge: { model: 'mock/judge', criteria: 'default' },
    }),
    'utf8',
  );
  return { root, ftRoot, configPath, rubricConfigPath };
}

/** Programmable fake client. Defaults to a happy path. */
interface FakeHandle {
  client: FinetuneClient;
  calls: { upload: number; create: number; get: number; cancel: number };
  lastCreate: CreateJobOpts | null;
}

function fakeClient(overrides: Partial<FinetuneClient> = {}): FakeHandle {
  const handle: FakeHandle = {
    calls: { upload: 0, create: 0, get: 0, cancel: 0 },
    lastCreate: null,
    client: undefined as unknown as FinetuneClient,
  };
  handle.client = {
    uploadTrainingFile: overrides.uploadTrainingFile ?? (async () => {
      handle.calls.upload++;
      return { id: 'file-abc' };
    }),
    createJob: overrides.createJob ?? (async (o) => {
      handle.calls.create++;
      handle.lastCreate = o;
      return { id: 'ftjob-1', status: 'queued' };
    }),
    getJob: overrides.getJob ?? (async () => {
      handle.calls.get++;
      return { id: 'ftjob-1', status: 'succeeded', fineTunedModel: 'ft:gpt-4o-mini:acme::abc' };
    }),
    cancelJob: overrides.cancelJob ?? (async () => {
      handle.calls.cancel++;
      return { id: 'ftjob-1', status: 'cancelled' };
    }),
  };
  return handle;
}

describe('runFinetuneInit', () => {
  it('scaffolds a finetunes.json and refuses to clobber', () => {
    const root = tmp();
    const lines: string[] = [];
    const a = runFinetuneInit({ cwd: root, write: (l) => lines.push(l) });
    expect(a.exitCode).toBe(0);
    expect(existsSync(a.path)).toBe(true);
    const b = runFinetuneInit({ cwd: root, write: () => {} });
    expect(b.exitCode).toBe(1);
    const c = runFinetuneInit({ cwd: root, force: true, write: () => {} });
    expect(c.exitCode).toBe(0);
  });
});

describe('runFinetuneList', () => {
  it('tabulates config jobs merged with local state', () => {
    const fx = fixtureWorkspace();
    updateState(fx.ftRoot, 'greeter', { status: 'succeeded', trainedModelId: 'ft:gpt-4o-mini:acme::abc' });
    const lines: string[] = [];
    const r = runFinetuneList({
      cwd: fx.root,
      configPath: fx.configPath,
      finetuneRoot: fx.ftRoot,
      write: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(0);
    const text = lines.join('');
    expect(text).toContain('greeter');
    expect(text).toContain('succeeded');
    expect(text).toContain('ft:gpt-4o-mini:acme::abc');
  });

  it('shows a friendly message when no jobs exist', () => {
    const root = tmp();
    const lines: string[] = [];
    const r = runFinetuneList({ cwd: root, finetuneRoot: join(root, 'ft'), write: (l) => lines.push(l) });
    expect(r.exitCode).toBe(0);
    expect(lines.join('')).toContain('no finetune jobs');
  });
});

describe('runFinetunePrepare', () => {
  it('writes SFT JSONL and flips state to prepared', () => {
    const fx = fixtureWorkspace();
    const lines: string[] = [];
    const r = runFinetunePrepare({
      name: 'greeter',
      cwd: fx.root,
      configPath: fx.configPath,
      finetuneRoot: fx.ftRoot,
      write: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(0);
    expect(r.examplesWritten).toBe(2); // third case missing expected
    const text = readFileSync(r.outPath, 'utf8');
    const first = JSON.parse(text.trim().split('\n')[0]!) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(first.messages[0]).toEqual({ role: 'system', content: 'You are a greeter.' });
    expect(first.messages[1]!.role).toBe('user');
    expect(first.messages[1]!.content).toContain('Say: hi');
    expect(first.messages[2]).toEqual({ role: 'assistant', content: 'hello' });

    const state = readState(fx.ftRoot, 'greeter')!;
    expect(state.status).toBe('prepared');
    expect(state.preparedPath).toBe(r.outPath);
  });

  it('exits 1 when no usable examples', () => {
    const fx = fixtureWorkspace();
    writeFileSync(
      join(fx.root, 'data/cases.jsonl'),
      JSON.stringify({ input: 'only input, no expected' }) + '\n',
      'utf8',
    );
    const lines: string[] = [];
    const r = runFinetunePrepare({
      name: 'greeter',
      cwd: fx.root,
      configPath: fx.configPath,
      finetuneRoot: fx.ftRoot,
      write: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(1);
    expect(lines.join('')).toContain('no usable examples');
  });
});

describe('runFinetuneLaunch', () => {
  it('uploads, creates job, and advances state', async () => {
    const fx = fixtureWorkspace();
    runFinetunePrepare({ name: 'greeter', cwd: fx.root, configPath: fx.configPath, finetuneRoot: fx.ftRoot, write: () => {} });
    const { client, calls } = fakeClient();
    const r = await runFinetuneLaunch({
      name: 'greeter',
      cwd: fx.root,
      configPath: fx.configPath,
      finetuneRoot: fx.ftRoot,
      client,
      write: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(r.jobId).toBe('ftjob-1');
    expect(calls.upload).toBe(1);
    expect(calls.create).toBe(1);

    const state = readState(fx.ftRoot, 'greeter')!;
    expect(state.status).toBe('queued');
    expect(state.fileId).toBe('file-abc');
    expect(state.jobId).toBe('ftjob-1');
  });

  it('strips the provider prefix before calling createJob', async () => {
    const fx = fixtureWorkspace();
    runFinetunePrepare({ name: 'greeter', cwd: fx.root, configPath: fx.configPath, finetuneRoot: fx.ftRoot, write: () => {} });
    let seenBaseModel = '';
    let seenSuffix: string | undefined;
    let seenHyper: unknown;
    const client: FinetuneClient = {
      uploadTrainingFile: async () => ({ id: 'file-abc' }),
      createJob: async (o) => {
        seenBaseModel = o.baseModel;
        seenSuffix = o.suffix;
        seenHyper = o.hyperparameters;
        return { id: 'ftjob-1', status: 'queued' };
      },
      getJob: async () => ({ id: 'ftjob-1', status: 'queued' }),
      cancelJob: async () => ({ id: 'ftjob-1', status: 'cancelled' }),
    };
    await runFinetuneLaunch({
      name: 'greeter',
      cwd: fx.root,
      configPath: fx.configPath,
      finetuneRoot: fx.ftRoot,
      client,
      write: () => {},
    });
    expect(seenBaseModel).toBe('gpt-4o-mini');
    expect(seenSuffix).toBe('greeter');
    expect(seenHyper).toEqual({ nEpochs: 3 });
  });

  it('refuses to launch when unprepared', async () => {
    const fx = fixtureWorkspace();
    const { client } = fakeClient();
    const lines: string[] = [];
    const r = await runFinetuneLaunch({
      name: 'greeter',
      cwd: fx.root,
      configPath: fx.configPath,
      finetuneRoot: fx.ftRoot,
      client,
      write: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(1);
    expect(lines.join('')).toContain('not been prepared');
  });

  it('refuses to re-launch when jobId already set', async () => {
    const fx = fixtureWorkspace();
    runFinetunePrepare({ name: 'greeter', cwd: fx.root, configPath: fx.configPath, finetuneRoot: fx.ftRoot, write: () => {} });
    updateState(fx.ftRoot, 'greeter', { status: 'queued', jobId: 'ftjob-existing' });
    const { client } = fakeClient();
    const lines: string[] = [];
    const r = await runFinetuneLaunch({
      name: 'greeter',
      cwd: fx.root,
      configPath: fx.configPath,
      finetuneRoot: fx.ftRoot,
      client,
      write: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(1);
    expect(r.jobId).toBe('ftjob-existing');
    expect(lines.join('')).toContain('already has a provider job id');
  });
});

describe('runFinetuneStatus', () => {
  it('hits the provider when non-terminal and updates state on success', async () => {
    const fx = fixtureWorkspace();
    updateState(fx.ftRoot, 'greeter', { status: 'running', jobId: 'ftjob-1', preparedPath: '/x.jsonl' });
    const { client, calls } = fakeClient();
    const r = await runFinetuneStatus({
      name: 'greeter',
      finetuneRoot: fx.ftRoot,
      client,
      write: () => {},
    });
    expect(calls.get).toBe(1);
    expect(r.status).toBe('succeeded');
    expect(r.exitCode).toBe(0);
    const s = readState(fx.ftRoot, 'greeter')!;
    expect(s.trainedModelId).toBe('ft:gpt-4o-mini:acme::abc');
  });

  it('short-circuits when state is already terminal', async () => {
    const fx = fixtureWorkspace();
    updateState(fx.ftRoot, 'greeter', { status: 'succeeded', jobId: 'ftjob-1', trainedModelId: 'ft:done' });
    const { client, calls } = fakeClient();
    const r = await runFinetuneStatus({
      name: 'greeter',
      finetuneRoot: fx.ftRoot,
      client,
      write: () => {},
    });
    expect(calls.get).toBe(0);
    expect(r.status).toBe('succeeded');
  });

  it('returns exit 1 when no state exists', async () => {
    const fx = fixtureWorkspace();
    const r = await runFinetuneStatus({
      name: 'nope',
      finetuneRoot: fx.ftRoot,
      client: fakeClient().client,
      write: () => {},
    });
    expect(r.exitCode).toBe(1);
  });
});

describe('runFinetuneCancel', () => {
  it('cancels a queued job and flips state', async () => {
    const fx = fixtureWorkspace();
    updateState(fx.ftRoot, 'greeter', { status: 'queued', jobId: 'ftjob-1' });
    const { client, calls } = fakeClient();
    const r = await runFinetuneCancel({
      name: 'greeter',
      finetuneRoot: fx.ftRoot,
      client,
      write: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(calls.cancel).toBe(1);
    expect(readState(fx.ftRoot, 'greeter')!.status).toBe('cancelled');
  });

  it('no-ops on terminal state without hitting the provider', async () => {
    const fx = fixtureWorkspace();
    updateState(fx.ftRoot, 'greeter', { status: 'succeeded', jobId: 'ftjob-1', trainedModelId: 'ft:done' });
    const { client, calls } = fakeClient();
    const r = await runFinetuneCancel({
      name: 'greeter',
      finetuneRoot: fx.ftRoot,
      client,
      write: () => {},
    });
    expect(r.exitCode).toBe(0);
    expect(calls.cancel).toBe(0);
  });
});

describe('runFinetuneEval', () => {
  it('emits a rubric.config.json with the trained model id as the first entry', () => {
    const fx = fixtureWorkspace();
    updateState(fx.ftRoot, 'greeter', {
      status: 'succeeded',
      jobId: 'ftjob-1',
      trainedModelId: 'ft:gpt-4o-mini:acme::abc',
    });
    const lines: string[] = [];
    const r = runFinetuneEval({
      name: 'greeter',
      cwd: fx.root,
      configPath: fx.configPath,
      rubricConfigPath: fx.rubricConfigPath,
      finetuneRoot: fx.ftRoot,
      write: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(0);
    const emitted = JSON.parse(readFileSync(r.outPath, 'utf8')) as {
      models: string[];
      judge: { model: string };
    };
    expect(emitted.models[0]).toBe('openai/ft:gpt-4o-mini:acme::abc');
    expect(emitted.models[1]).toBe('openai/gpt-4o');
    expect(emitted.judge.model).toBe('mock/judge');
    const text = lines.join('');
    expect(text).toContain('openai/ft:greeter');
    expect(text).toContain('openai/ft:gpt-4o-mini:acme::abc');
  });

  it('refuses when the job has not succeeded', () => {
    const fx = fixtureWorkspace();
    updateState(fx.ftRoot, 'greeter', { status: 'running', jobId: 'ftjob-1' });
    const lines: string[] = [];
    const r = runFinetuneEval({
      name: 'greeter',
      cwd: fx.root,
      configPath: fx.configPath,
      rubricConfigPath: fx.rubricConfigPath,
      finetuneRoot: fx.ftRoot,
      write: (l) => lines.push(l),
    });
    expect(r.exitCode).toBe(1);
    expect(lines.join('')).toContain('has not succeeded yet');
  });
});
