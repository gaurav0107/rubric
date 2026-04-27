import { resolve } from 'node:path';
import {
  createConfiguredProviders,
  loadConfig,
  redactHeaders,
  splitModelId,
  type Provider,
  type ProviderConfig,
} from '../../../shared/src/index.ts';

export interface ProvidersTestOptions {
  /** Provider name or full `name/model` id. If `name`, picks a model from config. */
  target: string;
  configPath?: string;
  cwd?: string;
  /** Override the hello prompt (default: short sentence). */
  prompt?: string;
  /** Override the model if only a provider name was given (otherwise inferred from config). */
  model?: string;
  write?: (line: string) => void;
}

export interface ProvidersTestResult {
  provider: string;
  model: string;
  text: string;
  latencyMs: number;
  exitCode: number;
}

const DEFAULT_PROMPT = 'Reply in one short sentence: what is 2 + 2?';

function pickModelForProvider(
  name: string,
  cfgModels: string[],
  judgeModel: string,
  userProviders: ProviderConfig[] | undefined,
  override?: string,
): string {
  if (override) {
    const { providerPrefix, model } = splitModelId(override as never);
    if (providerPrefix !== name) {
      throw new Error(`--model "${override}" does not belong to provider "${name}"`);
    }
    return model;
  }
  // Look for any configured model with this prefix.
  const candidates = [...cfgModels, judgeModel].filter((m) => m.startsWith(`${name}/`));
  if (candidates.length > 0) {
    return splitModelId(candidates[0]! as never).model;
  }
  // Fall back to a sane default if none configured — the hello-world call
  // should still go through for a newly-declared provider.
  void userProviders; // reserved for future heuristics (e.g. per-provider default model hints)
  throw new Error(
    `no model configured for provider "${name}" — pass --model <id> or add "${name}/<model>" to config.models`,
  );
}

export async function runProvidersTest(opts: ProvidersTestOptions): Promise<ProvidersTestResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, 'rubric.config.json');
  const write = opts.write ?? ((line: string) => process.stdout.write(line));
  const promptText = opts.prompt ?? DEFAULT_PROMPT;

  const loaded = loadConfig(configPath);
  for (const w of loaded.warnings) write(`  ⚠ config: ${w}\n`);
  const userProviders = loaded.config.providers;

  // Resolve the requested target: either `name` or `name/model`.
  let providerName: string;
  let model: string;
  if (opts.target.includes('/')) {
    const split = splitModelId(opts.target as never);
    providerName = split.providerPrefix;
    model = split.model;
  } else {
    providerName = opts.target;
    model = pickModelForProvider(
      providerName,
      loaded.config.models,
      loaded.config.judge.model,
      userProviders,
      opts.model,
    );
  }

  const allProviders = createConfiguredProviders(userProviders, loaded.baseDir);
  const provider: Provider | undefined = allProviders.find((p) => p.name === providerName)
    ?? allProviders.find((p) => p.supports(`${providerName}/${model}` as never));
  if (!provider) {
    const declaredNames = (userProviders ?? []).map((p) => p.name);
    throw new Error(
      `no provider named "${providerName}" — built-ins: openai, groq, openrouter, ollama${
        declaredNames.length > 0 ? `; declared: ${declaredNames.join(', ')}` : ''
      }`,
    );
  }

  const userCfg = (userProviders ?? []).find((p) => p.name === providerName);
  write(`rubric providers test\n`);
  write(`  provider: ${providerName}\n`);
  write(`  model:    ${model}\n`);
  if (userCfg) {
    write(`  baseUrl:  ${userCfg.baseUrl}\n`);
    write(`  auth:     ${userCfg.keyEnv ? `env ${userCfg.keyEnv}` : `file ${userCfg.keyFile}`}\n`);
    const redacted = redactHeaders(userCfg.headers);
    if (Object.keys(redacted).length > 0) {
      write(`  headers:  ${JSON.stringify(redacted)}\n`);
    }
  }
  write(`  prompt:   ${JSON.stringify(promptText)}\n\n`);

  const started = Date.now();
  try {
    const result = await provider.generate({
      modelId: `${providerName}/${model}` as never,
      prompt: promptText,
    });
    const elapsed = Date.now() - started;
    write(`  response (${elapsed}ms):\n`);
    write(`    ${result.text.split('\n').join('\n    ')}\n`);
    return { provider: providerName, model, text: result.text, latencyMs: elapsed, exitCode: 0 };
  } catch (err) {
    const elapsed = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    write(`  FAILED after ${elapsed}ms:\n    ${msg}\n`);
    return { provider: providerName, model, text: '', latencyMs: elapsed, exitCode: 1 };
  }
}
