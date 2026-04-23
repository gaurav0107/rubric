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

const BASELINE_PROMPT = `You are a customer support agent. Read the ticket and reply concisely.

Ticket: {{input}}
`;

const CANDIDATE_PROMPT = `You are a customer support agent. Read the ticket and reply. In your reply:

- Acknowledge the specific issue (name it, don't just say "sorry to hear that").
- State the concrete next step you're taking or need from the customer.
- Set a clear expectation about timing.

Ticket: {{input}}
`;

// Five representative tickets covering billing, account recovery, bugs, and
// cancellation. Picked for contrast between a vague/dismissive baseline and a
// specific/action-oriented candidate. See examples/support-tickets.jsonl for
// the full 50-row launch dataset.
const EXAMPLE_CASES = [
  {
    input: 'I was charged twice this month. Can you refund the duplicate?',
    metadata: { category: 'billing' },
  },
  {
    input: "Can't log in. Password reset email never arrives. Tried 4 times.",
    metadata: { category: 'account' },
  },
  {
    input: 'Your app crashed three times in a row when I tried to upload a PDF.',
    metadata: { category: 'bug' },
  },
  {
    input: 'I cancelled my subscription yesterday but was charged again today at midnight.',
    metadata: { category: 'refund' },
  },
  {
    input: 'Please help me ASAP this is urgent!!!',
    metadata: { category: 'unclear' },
  },
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
