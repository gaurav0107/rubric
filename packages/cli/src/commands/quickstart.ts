import {
  createMockJudge,
  createMockProvider,
  runEval,
  type Case,
  type Config,
} from '../../../shared/src/index.ts';

export interface QuickstartOptions {
  write?: (line: string) => void;
}

export interface QuickstartResult {
  exitCode: number;
}

const QUICKSTART_CASES: Case[] = [
  { input: 'Refund my last order — it was charged twice.', metadata: { category: 'billing' } },
  { input: "Can't log in. Password reset email never arrives.", metadata: { category: 'account' } },
  { input: 'Your app crashed three times in a row on PDF upload.', metadata: { category: 'bug' } },
  { input: 'I cancelled yesterday but was charged again today.', metadata: { category: 'refund' } },
  { input: 'Please help me ASAP this is urgent!!!', metadata: { category: 'unclear' } },
];

const QUICKSTART_BASELINE = 'You are a support agent. Reply concisely to the ticket.\n\nTicket: {{input}}\n';
const QUICKSTART_CANDIDATE = [
  'You are a support agent. Reply to the ticket with:',
  '- A specific acknowledgement of the issue.',
  '- The concrete next step you are taking or need from the customer.',
  '- A clear timing expectation.',
  '',
  'Ticket: {{input}}',
  '',
].join('\n');

const QUICKSTART_CONFIG: Config = {
  prompts: { baseline: 'baseline.md', candidate: 'candidate.md' },
  dataset: 'cases.jsonl',
  models: ['mock/demo'],
  judge: { model: 'mock/judge', rubric: 'default' },
  concurrency: 4,
  mode: 'compare-prompts',
};

export async function runQuickstart(opts: QuickstartOptions = {}): Promise<QuickstartResult> {
  const write = opts.write ?? ((line: string) => process.stdout.write(line));

  write(`rubric quickstart — zero-config mock demo\n`);
  write(`  5 cases × 1 model = 5 cells (mock provider + mock judge)\n\n`);

  // Deterministic mock: candidate "wins" on billing/account/bug/refund,
  // ties on the unclear ticket. Surfaces a realistic grid in 1 second, no
  // tokens spent, no API keys required.
  const judge = createMockJudge({
    verdict: (req) => (req.caseInput.toLowerCase().includes('urgent') ? 'tie' : 'b'),
    reason: (req) => (req.caseInput.toLowerCase().includes('urgent')
      ? 'both outputs fail to extract the actual problem'
      : 'candidate acknowledges the specific issue + names a next step'),
  });
  const providers = [createMockProvider({ acceptAll: true, latencyMs: 20 })];

  const { cells, summary } = await runEval({
    config: QUICKSTART_CONFIG,
    cases: QUICKSTART_CASES,
    prompts: { baseline: QUICKSTART_BASELINE, candidate: QUICKSTART_CANDIDATE },
    providers,
    judge,
    onCell: (_cell, p) => write(`  [${p.done}/${p.total}]\n`),
  });

  write(`\nSummary:\n`);
  write(`  wins:    ${summary.wins}\n`);
  write(`  losses:  ${summary.losses}\n`);
  write(`  ties:    ${summary.ties}\n`);
  write(`  errors:  ${summary.errors}\n`);
  write(`  winRate: ${(summary.winRate * 100).toFixed(1)}% (of decisive ${summary.wins + summary.losses})\n`);

  write(`\nSample verdicts:\n`);
  for (const cell of cells.slice(0, 3)) {
    const verdict = 'error' in cell.judge ? `error: ${cell.judge.error}` : `${cell.judge.winner.toUpperCase()} — ${cell.judge.reason}`;
    const input = QUICKSTART_CASES[cell.caseIndex]?.input ?? '';
    write(`  • ${input}\n      → ${verdict}\n`);
  }

  write(`\nNext:\n`);
  write(`  rubric init                    # scaffold a real workspace\n`);
  write(`  rubric init --wizard --describe "your task here"\n`);
  write(`  rubric serve --mock            # live three-pane UI\n`);
  write(`  rubric run                     # spend real tokens\n`);

  return { exitCode: 0 };
}
