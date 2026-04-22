import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CONFIG_FILE = 'diffprompt.config.json';
const PROMPTS_DIR = 'prompts';
const DATA_DIR = 'data';

const DEFAULT_CONFIG = {
  $schema: 'https://diffprompt.dev/schema/v1.json',
  prompts: {
    baseline: 'prompts/baseline.md',
    candidate: 'prompts/candidate.md',
  },
  dataset: 'data/cases.jsonl',
  models: ['openai/gpt-4o-mini'],
  judge: {
    model: 'openai/gpt-4o',
    rubric: 'default',
  },
  concurrency: 4,
  mode: 'compare-prompts',
};

const BASELINE_PROMPT = `You are a helpful assistant. Answer the user's question concisely.

User: {{input}}
`;

const CANDIDATE_PROMPT = `You are a helpful assistant. Answer the user's question in one sentence, then add a single concrete example.

User: {{input}}
`;

const EXAMPLE_CASES = [
  { input: 'What is the capital of France?', expected: 'Paris' },
  { input: 'Explain TCP handshake briefly.' },
  { input: 'Rewrite "it is what it is" more assertively.' },
];

export interface InitOptions {
  cwd?: string;
  force?: boolean;
}

export interface InitResult {
  written: string[];
  skipped: string[];
}

export function runInit(opts: InitOptions = {}): InitResult {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const force = opts.force ?? false;

  const files: Array<{ path: string; content: string }> = [
    { path: join(cwd, CONFIG_FILE), content: JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n' },
    { path: join(cwd, PROMPTS_DIR, 'baseline.md'), content: BASELINE_PROMPT },
    { path: join(cwd, PROMPTS_DIR, 'candidate.md'), content: CANDIDATE_PROMPT },
    {
      path: join(cwd, DATA_DIR, 'cases.jsonl'),
      content: EXAMPLE_CASES.map((c) => JSON.stringify(c)).join('\n') + '\n',
    },
  ];

  mkdirSync(join(cwd, PROMPTS_DIR), { recursive: true });
  mkdirSync(join(cwd, DATA_DIR), { recursive: true });

  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (existsSync(file.path) && !force) {
      skipped.push(file.path);
      continue;
    }
    writeFileSync(file.path, file.content, 'utf8');
    written.push(file.path);
  }

  return { written, skipped };
}
