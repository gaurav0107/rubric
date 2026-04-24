/**
 * OpenAI fine-tune adapter.
 *
 * We keep this layer deliberately thin and interface-driven so tests can
 * inject a fake without mocking fetch or the OpenAI SDK. The CLI calls
 * methods on `FinetuneClient` — a real instance talks to api.openai.com,
 * a test instance records calls and returns canned responses.
 *
 * We intentionally stick to fetch so the shared package stays dependency-
 * symmetric with the provider layer (no openai SDK import).
 */

export interface FinetuneClient {
  uploadTrainingFile(content: string, filename: string): Promise<{ id: string }>;
  createJob(opts: CreateJobOpts): Promise<{ id: string; status: string }>;
  getJob(jobId: string): Promise<{ id: string; status: string; fineTunedModel?: string; error?: string }>;
  cancelJob(jobId: string): Promise<{ id: string; status: string }>;
}

export interface CreateJobOpts {
  trainingFileId: string;
  validationFileId?: string;
  baseModel: string;
  hyperparameters?: {
    nEpochs?: number;
    batchSize?: number;
    learningRateMultiplier?: number;
  };
  /** Optional suffix that shows up in the trained model id. */
  suffix?: string;
}

export interface OpenAIFinetuneOptions {
  apiKey?: string;
  baseURL?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export class OpenAIFinetuneError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'OpenAIFinetuneError';
  }
}

/**
 * Normalize OpenAI's fine-tune job status strings to our canonical set.
 * The provider occasionally ships new statuses; we map the known ones and
 * pass others through so downstream code can decide what to do.
 */
export function mapOpenAIStatus(s: string): string {
  switch (s) {
    case 'validating_files': return 'queued';
    case 'queued': return 'queued';
    case 'running': return 'running';
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return s;
  }
}

export function createOpenAIFinetuneClient(opts: OpenAIFinetuneOptions = {}): FinetuneClient {
  const apiKey = opts.apiKey ?? (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : undefined);
  if (!apiKey) {
    throw new OpenAIFinetuneError('OPENAI_API_KEY is not set — fine-tune operations require a key');
  }
  const baseURL = opts.baseURL ?? 'https://api.openai.com/v1';
  const f: typeof fetch = opts.fetchImpl ?? fetch;

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const resp = await f(`${baseURL}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new OpenAIFinetuneError(
        `OpenAI ${init.method ?? 'GET'} ${path} failed: ${resp.status} ${resp.statusText}${body ? ` — ${body}` : ''}`,
        resp.status,
      );
    }
    return resp.json() as Promise<T>;
  }

  return {
    async uploadTrainingFile(content: string, filename: string): Promise<{ id: string }> {
      const form = new FormData();
      form.append('purpose', 'fine-tune');
      form.append('file', new Blob([content], { type: 'application/jsonl' }), filename);
      const res = await call<{ id: string }>('/files', { method: 'POST', body: form });
      return { id: res.id };
    },

    async createJob(o: CreateJobOpts): Promise<{ id: string; status: string }> {
      const body: Record<string, unknown> = {
        training_file: o.trainingFileId,
        model: o.baseModel,
      };
      if (o.validationFileId) body.validation_file = o.validationFileId;
      if (o.suffix) body.suffix = o.suffix;
      if (o.hyperparameters) {
        const h: Record<string, unknown> = {};
        if (o.hyperparameters.nEpochs !== undefined) h.n_epochs = o.hyperparameters.nEpochs;
        if (o.hyperparameters.batchSize !== undefined) h.batch_size = o.hyperparameters.batchSize;
        if (o.hyperparameters.learningRateMultiplier !== undefined) h.learning_rate_multiplier = o.hyperparameters.learningRateMultiplier;
        if (Object.keys(h).length > 0) body.hyperparameters = h;
      }
      const res = await call<{ id: string; status: string }>('/fine_tuning/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { id: res.id, status: mapOpenAIStatus(res.status) };
    },

    async getJob(jobId: string): Promise<{ id: string; status: string; fineTunedModel?: string; error?: string }> {
      const res = await call<{
        id: string;
        status: string;
        fine_tuned_model?: string | null;
        error?: { message: string } | null;
      }>(`/fine_tuning/jobs/${jobId}`, { method: 'GET' });
      const out: { id: string; status: string; fineTunedModel?: string; error?: string } = {
        id: res.id,
        status: mapOpenAIStatus(res.status),
      };
      if (res.fine_tuned_model) out.fineTunedModel = res.fine_tuned_model;
      if (res.error?.message) out.error = res.error.message;
      return out;
    },

    async cancelJob(jobId: string): Promise<{ id: string; status: string }> {
      const res = await call<{ id: string; status: string }>(
        `/fine_tuning/jobs/${jobId}/cancel`,
        { method: 'POST' },
      );
      return { id: res.id, status: mapOpenAIStatus(res.status) };
    },
  };
}
