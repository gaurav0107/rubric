import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './bin.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'rubric-action-'));
}

function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe('action bin', () => {
  test('rejects missing --body', async () => {
    const code = await main([]);
    expect(code).toBe(2);
  });

  test('complains when GITHUB_TOKEN is absent', async () => {
    const dir = scratch();
    try {
      const bodyPath = join(dir, 'body.md');
      writeFileSync(bodyPath, 'hi');
      await expect(
        withEnv({ GITHUB_TOKEN: '', GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_PATH: '/nope' }, () =>
          main(['--body', bodyPath]),
        ),
      ).rejects.toThrow(/GITHUB_TOKEN/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('complains when the event payload has no PR number', async () => {
    const dir = scratch();
    try {
      const bodyPath = join(dir, 'body.md');
      const eventPath = join(dir, 'event.json');
      writeFileSync(bodyPath, 'hi');
      writeFileSync(eventPath, JSON.stringify({ action: 'push' }));
      await expect(
        withEnv(
          { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_PATH: eventPath },
          () => main(['--body', bodyPath]),
        ),
      ).rejects.toThrow(/PR number/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
