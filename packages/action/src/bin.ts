#!/usr/bin/env node
/**
 * Tiny CLI invoked by action.yml as the last step: takes a path to the
 * already-rendered PR comment markdown and upserts it via the GitHub REST API.
 *
 * The heavy lifting (run → calibrate → comment) is handled upstream by the
 * `diffprompt` CLI; this binary only cares about posting the result.
 */
import { readFileSync } from 'node:fs';
import { upsertPrComment } from './post-comment.ts';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

function readEventPrNumber(eventPath: string): number {
  const raw = readFileSync(eventPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`failed to parse GITHUB_EVENT_PATH (${eventPath}): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`GITHUB_EVENT_PATH did not contain a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  // `pull_request` events expose `pull_request.number`; `issue_comment` on a PR
  // exposes `issue.number` and `issue.pull_request` (only PRs carry the latter).
  const pr = obj.pull_request;
  if (typeof pr === 'object' && pr !== null && typeof (pr as Record<string, unknown>).number === 'number') {
    return (pr as Record<string, unknown>).number as number;
  }
  const issue = obj.issue;
  if (
    typeof issue === 'object' && issue !== null
    && typeof (issue as Record<string, unknown>).number === 'number'
    && (issue as Record<string, unknown>).pull_request !== undefined
  ) {
    return (issue as Record<string, unknown>).number as number;
  }
  throw new Error(`could not find a PR number in GITHUB_EVENT_PATH — is this workflow running on pull_request?`);
}

export async function main(argv: string[]): Promise<number> {
  const i = argv.indexOf('--body');
  if (i === -1) {
    process.stderr.write('diffprompt-action: missing --body <path>\n');
    return 2;
  }
  const bodyPath = argv[i + 1];
  if (!bodyPath) {
    process.stderr.write('diffprompt-action: --body requires a path\n');
    return 2;
  }

  const token = requireEnv('GITHUB_TOKEN');
  const repo = requireEnv('GITHUB_REPOSITORY');
  const eventPath = requireEnv('GITHUB_EVENT_PATH');
  const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
  const marker = process.env.DIFFPROMPT_COMMENT_MARKER || 'diffprompt-bot:pr-comment';
  const prNumber = readEventPrNumber(eventPath);

  const body = readFileSync(bodyPath, 'utf8');
  const upsertArgs: Parameters<typeof upsertPrComment>[0] = {
    repo,
    prNumber,
    token,
    body,
    marker,
    apiUrl,
  };
  const result = await upsertPrComment(upsertArgs);
  process.stdout.write(`diffprompt-action: ${result.action} comment ${result.commentId} — ${result.url}\n`);
  return 0;
}

// Only run main() when invoked as a script, not when imported by tests.
const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;
if (invokedAsScript) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`diffprompt-action: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
