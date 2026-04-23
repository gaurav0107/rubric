import { describe, expect, test } from 'bun:test';
import { decideExitCode } from './run.ts';
import type { RunSummary } from '../../../shared/src/index.ts';

function sum(p: Partial<RunSummary>): RunSummary {
  return {
    wins: 0,
    losses: 0,
    ties: 0,
    errors: 0,
    winRate: 0,
    ...p,
  };
}

describe('decideExitCode', () => {
  test('clean run returns 0', () => {
    expect(decideExitCode(sum({ wins: 3, ties: 2 }), false)).toBe(0);
    expect(decideExitCode(sum({ wins: 3, ties: 2 }), true)).toBe(0);
  });

  test('errors return 1 when not gated on regress', () => {
    expect(decideExitCode(sum({ wins: 3, errors: 1 }), false)).toBe(1);
  });

  test('loss majority returns 2 only when --fail-on-regress is set', () => {
    expect(decideExitCode(sum({ wins: 1, losses: 3 }), true)).toBe(2);
    expect(decideExitCode(sum({ wins: 1, losses: 3 }), false)).toBe(0);
  });

  test('ties do not trip regress gate', () => {
    expect(decideExitCode(sum({ wins: 1, losses: 1, ties: 5 }), true)).toBe(0);
  });

  test('regression outranks errors when gated', () => {
    // CI intent: if user asked for --fail-on-regress, a losing run with an
    // incidental judge error should surface as REGRESSION (2), not ERROR (1).
    expect(decideExitCode(sum({ wins: 0, losses: 2, errors: 1 }), true)).toBe(2);
  });

  test('equal wins and losses is not a regression', () => {
    expect(decideExitCode(sum({ wins: 2, losses: 2 }), true)).toBe(0);
  });
});
