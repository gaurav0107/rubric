/**
 * Shared finetune unit coverage. Provider calls use an injected fetch so no
 * network hits happen.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createOpenAIFinetuneClient,
  createTogetherFinetuneClient,
  defaultExposeAlias,
  findJob,
  isTerminal,
  listStates,
  loadFinetuneConfig,
  mapOpenAIStatus,
  mapTogetherStatus,
  prepareSftJsonl,
  readState,
  splitPromptTemplate,
  updateState,
  validateFinetuneConfig,
} from './index.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'rubric-ft-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('validateFinetuneConfig', () => {
  it('accepts a minimal job', () => {
    const cfg = validateFinetuneConfig({
      version: 1,
      jobs: [{ name: 'foo', base: 'openai/gpt-4o-mini', trainData: 't.jsonl', promptTemplate: 'p.md' }],
    });
    expect(cfg.jobs[0]!.name).toBe('foo');
    expect(cfg.jobs[0]!.hyper).toBeUndefined();
  });

  it('rejects duplicate names', () => {
    expect(() =>
      validateFinetuneConfig({
        version: 1,
        jobs: [
          { name: 'a', base: 'x', trainData: 't.jsonl', promptTemplate: 'p.md' },
          { name: 'a', base: 'x', trainData: 't.jsonl', promptTemplate: 'p.md' },
        ],
      }),
    ).toThrow(/duplicate job name/);
  });

  it('rejects invalid name characters', () => {
    expect(() =>
      validateFinetuneConfig({
        version: 1,
        jobs: [{ name: 'bad name', base: 'x', trainData: 't.jsonl', promptTemplate: 'p.md' }],
      }),
    ).toThrow(/invalid characters/);
  });

  it('rejects missing version', () => {
    expect(() => validateFinetuneConfig({ jobs: [] })).toThrow(/unsupported version/);
  });

  it('validates and coerces hyper numbers', () => {
    const cfg = validateFinetuneConfig({
      version: 1,
      jobs: [{
        name: 'x', base: 'openai/gpt-4o-mini', trainData: 't.jsonl', promptTemplate: 'p.md',
        hyper: { nEpochs: 3.7, batchSize: 2, learningRateMultiplier: 0.5 },
      }],
    });
    expect(cfg.jobs[0]!.hyper).toEqual({ nEpochs: 3, batchSize: 2, learningRateMultiplier: 0.5 });
  });

  it('drops invalid hyper values silently', () => {
    const cfg = validateFinetuneConfig({
      version: 1,
      jobs: [{
        name: 'x', base: 'openai/gpt-4o-mini', trainData: 't.jsonl', promptTemplate: 'p.md',
        hyper: { nEpochs: -1, batchSize: 'two' },
      }],
    });
    expect(cfg.jobs[0]!.hyper).toBeUndefined();
  });
});

describe('loadFinetuneConfig', () => {
  it('resolves relative paths relative to the config file', () => {
    const root = tmp();
    const cfgPath = join(root, 'finetunes.json');
    writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      jobs: [{ name: 'r', base: 'openai/gpt-4o-mini', trainData: 'data/t.jsonl', promptTemplate: 'prompts/c.md' }],
    }), 'utf8');
    const loaded = loadFinetuneConfig(cfgPath);
    expect(loaded.resolved[0]!.trainData).toBe(join(root, 'data/t.jsonl'));
    expect(loaded.resolved[0]!.promptTemplate).toBe(join(root, 'prompts/c.md'));
  });

  it('throws when the file does not exist', () => {
    expect(() => loadFinetuneConfig(join(tmp(), 'missing.json'))).toThrow(/finetune config not found/);
  });
});

describe('findJob + defaultExposeAlias', () => {
  it('looks up by name and falls back to openai/ft:<name>', () => {
    const cfg = validateFinetuneConfig({
      version: 1,
      jobs: [{ name: 'r', base: 'openai/gpt-4o-mini', trainData: 't.jsonl', promptTemplate: 'p.md' }],
    });
    const job = findJob(cfg, 'r');
    expect(defaultExposeAlias(job)).toBe('openai/ft:r');
  });

  it('uses explicit expose when set', () => {
    const cfg = validateFinetuneConfig({
      version: 1,
      jobs: [{ name: 'r', base: 'x', trainData: 't.jsonl', promptTemplate: 'p.md', expose: 'openai/custom-alias' }],
    });
    expect(defaultExposeAlias(findJob(cfg, 'r'))).toBe('openai/custom-alias');
  });

  it('throws with the available list when job is missing', () => {
    const cfg = validateFinetuneConfig({
      version: 1,
      jobs: [{ name: 'a', base: 'x', trainData: 't.jsonl', promptTemplate: 'p.md' }],
    });
    expect(() => findJob(cfg, 'b')).toThrow(/available: a/);
  });
});

describe('splitPromptTemplate', () => {
  it('extracts a system frontmatter block', () => {
    const split = splitPromptTemplate('---\nYou are a classifier.\n---\nClassify: {{input}}');
    expect(split.system).toBe('You are a classifier.');
    expect(split.userTemplate).toBe('Classify: {{input}}');
  });

  it('treats a template without frontmatter as pure user content', () => {
    const split = splitPromptTemplate('Summarize: {{input}}');
    expect(split.system).toBeUndefined();
    expect(split.userTemplate).toBe('Summarize: {{input}}');
  });
});

describe('prepareSftJsonl', () => {
  it('writes one line per (input, expected) case', () => {
    const datasetText = [
      JSON.stringify({ input: 'hi', expected: 'hello' }),
      JSON.stringify({ input: 'bye' }), // no expected — skipped
      JSON.stringify({ input: 'ok', expected: 'sure' }),
    ].join('\n');
    const res = prepareSftJsonl({ datasetText, promptTemplate: 'Say: {{input}}' });
    expect(res.totalCases).toBe(3);
    expect(res.examplesWritten).toBe(2);
    expect(res.skippedNoExpected).toBe(1);
    const lines = res.text.trim().split('\n');
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!) as { messages: Array<{ role: string; content: string }> };
    expect(first.messages.length).toBe(2);
    expect(first.messages[0]!.role).toBe('user');
    expect(first.messages[0]!.content).toBe('Say: hi');
    expect(first.messages[1]!.role).toBe('assistant');
    expect(first.messages[1]!.content).toBe('hello');
  });

  it('prepends a system message when the template has frontmatter', () => {
    const datasetText = JSON.stringify({ input: 'x', expected: 'y' });
    const res = prepareSftJsonl({
      datasetText,
      promptTemplate: '---\nclassifier\n---\nClassify: {{input}}',
    });
    const first = JSON.parse(res.text.trim()) as { messages: Array<{ role: string; content: string }> };
    expect(first.messages.length).toBe(3);
    expect(first.messages[0]!).toEqual({ role: 'system', content: 'classifier' });
  });

  it('returns empty text when there are no usable cases', () => {
    const res = prepareSftJsonl({
      datasetText: JSON.stringify({ input: 'only input' }),
      promptTemplate: '{{input}}',
    });
    expect(res.text).toBe('');
    expect(res.examplesWritten).toBe(0);
  });
});

describe('state file I/O', () => {
  it('round-trips state through updateState', () => {
    const root = tmp();
    updateState(root, 'r', { status: 'prepared', preparedPath: '/tmp/foo.jsonl' });
    const s = readState(root, 'r')!;
    expect(s.status).toBe('prepared');
    expect(s.preparedPath).toBe('/tmp/foo.jsonl');
    expect(s.updatedAt).toBeTruthy();
  });

  it('merges patches onto existing state', () => {
    const root = tmp();
    updateState(root, 'r', { status: 'prepared' });
    updateState(root, 'r', { status: 'uploaded', fileId: 'file-123' });
    const s = readState(root, 'r')!;
    expect(s.status).toBe('uploaded');
    expect(s.fileId).toBe('file-123');
  });

  it('listStates is newest-first and skips missing state.json', async () => {
    const root = tmp();
    updateState(root, 'a', { status: 'pending' });
    await new Promise((r) => setTimeout(r, 10));
    updateState(root, 'b', { status: 'pending' });
    const rows = listStates(root);
    expect(rows.length).toBe(2);
    expect(rows[0]!.name).toBe('b');
  });

  it('isTerminal recognizes end states', () => {
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('queued')).toBe(false);
  });
});

describe('openai adapter', () => {
  it('maps provider status strings', () => {
    expect(mapOpenAIStatus('validating_files')).toBe('queued');
    expect(mapOpenAIStatus('succeeded')).toBe('succeeded');
    expect(mapOpenAIStatus('weird_new_status')).toBe('weird_new_status');
  });

  it('uploads + creates + polls through an injected fetch', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fake: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      const body = init?.body instanceof FormData ? '[formdata]' : (init?.body as string | undefined);
      calls.push({ url, method, ...(body !== undefined ? { body } : {}) });
      if (url.endsWith('/files') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'file-abc' }), { status: 200 });
      }
      if (url.endsWith('/fine_tuning/jobs') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'ftjob-1', status: 'queued' }), { status: 200 });
      }
      if (url.endsWith('/fine_tuning/jobs/ftjob-1') && method === 'GET') {
        return new Response(JSON.stringify({
          id: 'ftjob-1',
          status: 'succeeded',
          fine_tuned_model: 'ft:gpt-4o-mini:acme::abc',
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
    const client = createOpenAIFinetuneClient({ apiKey: 'sk-test', fetchImpl: fake });
    const up = await client.uploadTrainingFile('{}', 'train.jsonl');
    expect(up.id).toBe('file-abc');
    const job = await client.createJob({
      trainingFileId: up.id,
      baseModel: 'gpt-4o-mini',
      hyperparameters: { nEpochs: 3 },
    });
    expect(job.id).toBe('ftjob-1');
    expect(job.status).toBe('queued');
    const poll = await client.getJob(job.id);
    expect(poll.status).toBe('succeeded');
    expect(poll.fineTunedModel).toBe('ft:gpt-4o-mini:acme::abc');
    expect(calls.length).toBe(3);
    expect(calls[1]!.body).toContain('"training_file":"file-abc"');
    expect(calls[1]!.body).toContain('"n_epochs":3');
  });

  it('surfaces provider errors with status codes', async () => {
    const fake: typeof fetch = async () => new Response('boom', { status: 402, statusText: 'Payment Required' });
    const client = createOpenAIFinetuneClient({ apiKey: 'sk-test', fetchImpl: fake });
    await expect(client.createJob({ trainingFileId: 'f', baseModel: 'x' })).rejects.toThrow(/402/);
  });

  it('refuses to construct without an api key', () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => createOpenAIFinetuneClient()).toThrow(/OPENAI_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});

describe('Together.ai finetune client', () => {
  it('maps provider-specific status strings onto the canonical set', () => {
    // Intermediate states collapse so the CLI's isTerminal whitelist doesn't need a Together branch.
    expect(mapTogetherStatus('pending')).toBe('queued');
    expect(mapTogetherStatus('validating')).toBe('queued');
    expect(mapTogetherStatus('uploading')).toBe('running');
    expect(mapTogetherStatus('compressing')).toBe('running');
    expect(mapTogetherStatus('completed')).toBe('succeeded');
    expect(mapTogetherStatus('error')).toBe('failed');
    expect(mapTogetherStatus('user_error')).toBe('failed');
    // Unknown states pass through — we refuse to pretend they're something they're not.
    expect(mapTogetherStatus('futuristic_state')).toBe('futuristic_state');
  });

  it('drives upload → create → poll with an injected fetch', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fake: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? 'GET';
      const body = init?.body instanceof FormData ? '[formdata]' : (init?.body as string | undefined);
      calls.push({ url, method, ...(body !== undefined ? { body } : {}) });
      if (url.endsWith('/files') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'file-xyz' }), { status: 200 });
      }
      if (url.endsWith('/fine-tunes') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'ft-123', status: 'pending' }), { status: 200 });
      }
      if (url.endsWith('/fine-tunes/ft-123') && method === 'GET') {
        return new Response(JSON.stringify({
          id: 'ft-123',
          status: 'completed',
          output_name: 'my-org/llama-3-ft:v1',
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
    const client = createTogetherFinetuneClient({ apiKey: 'tg-test', fetchImpl: fake });
    const up = await client.uploadTrainingFile('{}', 'train.jsonl');
    expect(up.id).toBe('file-xyz');
    const job = await client.createJob({
      trainingFileId: up.id,
      baseModel: 'meta-llama/Llama-3-8B',
      hyperparameters: { nEpochs: 3, batchSize: 4, learningRateMultiplier: 0.00005 },
    });
    expect(job.id).toBe('ft-123');
    expect(job.status).toBe('queued');
    const poll = await client.getJob(job.id);
    expect(poll.status).toBe('succeeded');
    expect(poll.fineTunedModel).toBe('my-org/llama-3-ft:v1');
    expect(calls.length).toBe(3);
    // Together uses flat top-level hyperparameter keys (no `hyperparameters` envelope).
    expect(calls[1]!.body).toContain('"n_epochs":3');
    expect(calls[1]!.body).toContain('"batch_size":4');
    expect(calls[1]!.body).toContain('"learning_rate":0.00005');
    expect(calls[1]!.body).not.toContain('"hyperparameters"');
  });

  it('surfaces provider errors with status codes', async () => {
    const fake: typeof fetch = async () => new Response('bad key', { status: 401, statusText: 'Unauthorized' });
    const client = createTogetherFinetuneClient({ apiKey: 'tg-test', fetchImpl: fake });
    await expect(client.createJob({ trainingFileId: 'f', baseModel: 'x' })).rejects.toThrow(/401/);
  });

  it('cancelJob hits the per-job cancel endpoint', async () => {
    let cancelUrl = '';
    const fake: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/fine-tunes/ft-999/cancel') && init?.method === 'POST') {
        cancelUrl = url;
        return new Response(JSON.stringify({ id: 'ft-999', status: 'cancelled' }), { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    };
    const client = createTogetherFinetuneClient({ apiKey: 'tg-test', fetchImpl: fake });
    const r = await client.cancelJob('ft-999');
    expect(r.status).toBe('cancelled');
    expect(cancelUrl).toContain('/fine-tunes/ft-999/cancel');
  });

  it('refuses to construct without an api key', () => {
    const prev = process.env.TOGETHER_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    try {
      expect(() => createTogetherFinetuneClient()).toThrow(/TOGETHER_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.TOGETHER_API_KEY = prev;
    }
  });
});
