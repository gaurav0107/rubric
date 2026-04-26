/**
 * Together.ai fine-tune adapter.
 *
 * Same `FinetuneClient` interface the CLI expects; routes through Together's
 * fine-tune API (https://docs.together.ai/reference/post_fine-tunes) instead
 * of OpenAI's. Fetch-based, no SDK dependency, matches the OpenAI adapter's
 * shape so `rubric finetune` subcommands don't need per-provider branches.
 *
 * Status mapping: Together emits a larger state set than OpenAI — we collapse
 * the intermediate states ("pending", "queued", "compressing", "uploading")
 * down to "queued"/"running" so the CLI's `isTerminal` logic and the shared
 * state file schema don't need provider-specific cases.
 */

import type { CreateJobOpts, FinetuneClient } from './openai.ts';

export interface TogetherFinetuneOptions {
  apiKey?: string;
  baseURL?: string;
  fetchImpl?: typeof fetch;
}

export class TogetherFinetuneError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'TogetherFinetuneError';
  }
}

/**
 * Map Together.ai's fine-tune job `status` string onto rubric's canonical
 * set. We keep the known states narrow so `isTerminal` in the CLI doesn't
 * grow a provider-specific whitelist. Anything unrecognized passes through
 * untouched — the CLI prints the raw string, which is more honest than
 * pretending it's one of the known states.
 */
export function mapTogetherStatus(s: string): string {
  switch (s) {
    case 'pending':
    case 'queued':
    case 'validating':
      return 'queued';
    case 'running':
    case 'compressing':
    case 'uploading':
      return 'running';
    case 'completed':
      return 'succeeded';
    case 'error':
    case 'user_error':
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return s;
  }
}

export function createTogetherFinetuneClient(opts: TogetherFinetuneOptions = {}): FinetuneClient {
  const apiKey = opts.apiKey ?? (typeof process !== 'undefined' ? process.env?.TOGETHER_API_KEY : undefined);
  if (!apiKey) {
    throw new TogetherFinetuneError('TOGETHER_API_KEY is not set — Together.ai fine-tune operations require a key');
  }
  const baseURL = opts.baseURL ?? 'https://api.together.xyz/v1';
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
      throw new TogetherFinetuneError(
        `Together ${init.method ?? 'GET'} ${path} failed: ${resp.status} ${resp.statusText}${body ? ` — ${body}` : ''}`,
        resp.status,
      );
    }
    return resp.json() as Promise<T>;
  }

  return {
    async uploadTrainingFile(content: string, filename: string): Promise<{ id: string }> {
      // Together's upload endpoint is multipart with `file` + `purpose` fields,
      // same as OpenAI's `/files` — convenient for us.
      const form = new FormData();
      form.append('purpose', 'fine-tune');
      form.append('file', new Blob([content], { type: 'application/jsonl' }), filename);
      const res = await call<{ id: string }>('/files', { method: 'POST', body: form });
      return { id: res.id };
    },

    async createJob(o: CreateJobOpts): Promise<{ id: string; status: string }> {
      // Together uses `training_file` + `model` (same as OpenAI) and accepts
      // `n_epochs` / `batch_size` / `learning_rate` at the top level (no
      // `hyperparameters` envelope). We flatten accordingly.
      const body: Record<string, unknown> = {
        training_file: o.trainingFileId,
        model: o.baseModel,
      };
      if (o.validationFileId) body.validation_file = o.validationFileId;
      if (o.suffix) body.suffix = o.suffix;
      if (o.hyperparameters) {
        if (o.hyperparameters.nEpochs !== undefined) body.n_epochs = o.hyperparameters.nEpochs;
        if (o.hyperparameters.batchSize !== undefined) body.batch_size = o.hyperparameters.batchSize;
        // Together parameterizes learning rate directly rather than as a
        // multiplier on the base schedule; pass the value through under the
        // provider's name.
        if (o.hyperparameters.learningRateMultiplier !== undefined) {
          body.learning_rate = o.hyperparameters.learningRateMultiplier;
        }
      }
      const res = await call<{ id: string; status: string }>('/fine-tunes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { id: res.id, status: mapTogetherStatus(res.status) };
    },

    async getJob(jobId: string): Promise<{ id: string; status: string; fineTunedModel?: string; error?: string }> {
      const res = await call<{
        id: string;
        status: string;
        output_name?: string | null;
        model_output_name?: string | null;
        error?: string | { message: string } | null;
      }>(`/fine-tunes/${jobId}`, { method: 'GET' });
      const out: { id: string; status: string; fineTunedModel?: string; error?: string } = {
        id: res.id,
        status: mapTogetherStatus(res.status),
      };
      // Together reports the trained model id as `output_name` (current API)
      // or `model_output_name` (older deployments) — accept either.
      const trained = res.output_name ?? res.model_output_name ?? undefined;
      if (trained) out.fineTunedModel = trained;
      if (res.error) {
        out.error = typeof res.error === 'string' ? res.error : res.error.message;
      }
      return out;
    },

    async cancelJob(jobId: string): Promise<{ id: string; status: string }> {
      const res = await call<{ id: string; status: string }>(
        `/fine-tunes/${jobId}/cancel`,
        { method: 'POST' },
      );
      return { id: res.id, status: mapTogetherStatus(res.status) };
    },
  };
}
