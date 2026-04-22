#!/usr/bin/env bun
import { runInit } from './commands/init.ts';

const USAGE = `diffprompt — pairwise prompt evaluation

Usage:
  diffprompt init [--force]   Scaffold diffprompt.config.json, prompts/, data/
  diffprompt run              (not yet implemented)
  diffprompt calibrate        (not yet implemented)
  diffprompt seed             (not yet implemented)

See TODOS.md at the repo root for the v1 launch gate.
`;

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE);
    return cmd ? 0 : 1;
  }

  switch (cmd) {
    case 'init': {
      const force = rest.includes('--force') || rest.includes('-f');
      const result = runInit({ force });
      for (const path of result.written) process.stdout.write(`  wrote   ${path}\n`);
      for (const path of result.skipped) process.stdout.write(`  skipped ${path} (exists; pass --force to overwrite)\n`);
      process.stdout.write(`\nNext: edit prompts/baseline.md and prompts/candidate.md, then run \`diffprompt run\`.\n`);
      return 0;
    }
    case 'run':
    case 'calibrate':
    case 'seed': {
      process.stderr.write(`diffprompt ${cmd}: not yet implemented. See TODOS.md at the repo root.\n`);
      return 1;
    }
    default: {
      process.stderr.write(`diffprompt: unknown command "${cmd}"\n\n${USAGE}`);
      return 2;
    }
  }
}

process.exit(main(process.argv.slice(2)));
