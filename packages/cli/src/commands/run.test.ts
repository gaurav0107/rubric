import { describe, expect, test } from 'bun:test';
import { buildCompactLine, buildJsonPayload, decideExitCode, writeProviderDiagnostics } from './run.ts';
import type { CellResult, Config, EvaluatorGateBreach, ModelId, ProviderConfig, RunSummary } from '../../../shared/src/index.ts';

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

function cfg(models: ModelId[]): Config {
  return {
    prompts: { baseline: 'b', candidate: 'c' },
    dataset: 'd',
    models,
    judge: { model: 'openai/gpt-4o' as ModelId, criteria: 'default' },
  };
}

describe('buildJsonPayload', () => {
  test('serializes cells with verdicts, errors, and cost/latency', () => {
    const cells: CellResult[] = [
      {
        caseIndex: 0,
        model: 'openai/gpt-4o-mini' as ModelId,
        outputA: 'a',
        outputB: 'b',
        judge: { winner: 'b', reason: 'clearer' },
        latencyMs: 120,
        costUsd: 0.0012,
      },
      {
        caseIndex: 1,
        model: 'openai/gpt-4o-mini' as ModelId,
        outputA: '',
        outputB: '',
        judge: { error: 'judge down' },
        latencyMs: 5,
      },
    ];
    const summary: RunSummary = { wins: 1, losses: 0, ties: 0, errors: 1, winRate: 1 };
    const payload = buildJsonPayload({
      config: cfg(['openai/gpt-4o-mini' as ModelId]),
      cells,
      summary,
      exitCode: 1,
    });

    expect(payload.version).toBe(1);
    expect(payload.summary).toEqual(summary);
    expect(payload.exitCode).toBe(1);
    expect(payload.totalCells).toBe(2);
    expect(payload.models).toEqual(['openai/gpt-4o-mini' as ModelId]);
    expect(payload.judge.model).toBe('openai/gpt-4o' as ModelId);

    expect(payload.cells[0]).toEqual({
      caseIndex: 0,
      model: 'openai/gpt-4o-mini' as ModelId,
      latencyMs: 120,
      costUsd: 0.0012,
      winner: 'b',
      reason: 'clearer',
    });
    expect(payload.cells[1]).toEqual({
      caseIndex: 1,
      model: 'openai/gpt-4o-mini' as ModelId,
      latencyMs: 5,
      error: 'judge down',
    });
  });

  test('round-trips through JSON.stringify/parse', () => {
    const payload = buildJsonPayload({
      config: cfg(['openai/gpt-4o' as ModelId]),
      cells: [],
      summary: { wins: 0, losses: 0, ties: 0, errors: 0, winRate: 0 },
      exitCode: 0,
    });
    const roundtrip = JSON.parse(JSON.stringify(payload));
    expect(roundtrip).toEqual(payload);
  });
});

describe('buildCompactLine', () => {
  test('emits exit + summary counts + winRate on a stable one-liner', () => {
    const line = buildCompactLine({
      summary: { wins: 3, losses: 1, ties: 0, errors: 0, winRate: 0.75 },
      exitCode: 0,
    });
    expect(line).toBe('exit=0 wins=3 losses=1 ties=0 errors=0 winRate=0.7500');
  });

  test('includes run id and cost/time when captured', () => {
    const line = buildCompactLine({
      runId: 'r-abc',
      summary: {
        wins: 2, losses: 1, ties: 1, errors: 0, winRate: 2 / 3,
        totalCostUsd: 0.012345, totalLatencyMs: 1234.4,
      },
      exitCode: 0,
    });
    expect(line).toContain('run=r-abc');
    expect(line).toContain('costUsd=0.012345');
    expect(line).toContain('latencyMs=1234');
    expect(line.startsWith('exit=0 run=r-abc')).toBe(true);
  });

  test('appends one gate entry per breach', () => {
    const gateBreaches: EvaluatorGateBreach[] = [
      { type: 'exact-match', metric: 'exact_match.b', threshold: 0.9, actual: 0.333, sample: 3 },
      { type: 'json-valid', metric: 'json_valid.b', threshold: 1, actual: 0.5, sample: 2 },
    ];
    const line = buildCompactLine({
      summary: { wins: 0, losses: 2, ties: 0, errors: 0, winRate: 0 },
      exitCode: 2,
      gateBreaches,
    });
    expect(line).toContain('gate=exact_match.b:0.3330<0.9');
    expect(line).toContain('gate=json_valid.b:0.5000<1');
  });

  test('single-line, no newlines embedded', () => {
    const line = buildCompactLine({
      summary: { wins: 1, losses: 0, ties: 0, errors: 0, winRate: 1 },
      exitCode: 0,
    });
    expect(line).not.toContain('\n');
  });
});

describe('writeProviderDiagnostics', () => {
  test('redacts Authorization / x-api-key / token headers', () => {
    const lines: string[] = [];
    const provider: ProviderConfig = {
      name: 'corp',
      wire: 'openai-chat',
      baseUrl: 'https://gateway.internal/v1',
      models: ['corp/acme-7b' as ModelId],
      keyEnv: 'CORP_TOKEN',
      headers: {
        Authorization: 'Bearer supersecret-do-not-leak',
        'x-api-key': 'ak_live_shouldbehidden',
        'x-request-id': 'req-42',
        'content-type': 'application/json',
      },
    };
    writeProviderDiagnostics((l) => lines.push(l), [provider]);
    const text = lines.join('');
    expect(text).toContain('corp/');
    expect(text).toContain('https://gateway.internal/v1');
    expect(text).toContain('env CORP_TOKEN');
    expect(text).toContain('req-42');
    expect(text).toContain('application/json');
    // The actual bearer token and api key must NEVER appear in the output.
    expect(text).not.toContain('supersecret-do-not-leak');
    expect(text).not.toContain('ak_live_shouldbehidden');
    expect(text).toContain('***');
  });

  test('prints a friendly line when no user providers are declared', () => {
    const lines: string[] = [];
    writeProviderDiagnostics((l) => lines.push(l), undefined);
    const text = lines.join('');
    expect(text).toContain('built-ins');
    expect(text).toContain('no user-declared providers');
  });

  test('keyFile path shows but the file contents never do', () => {
    const lines: string[] = [];
    writeProviderDiagnostics((l) => lines.push(l), [{
      name: 'local',
      wire: 'openai-chat',
      baseUrl: 'http://localhost:11434',
      models: ['local/llama' as ModelId],
      keyFile: '~/.rubric/local-key',
    }]);
    const text = lines.join('');
    expect(text).toContain('file ~/.rubric/local-key');
    // Sanity: since there are no headers, the output should say (none).
    expect(text).toContain('(none)');
  });
});
