import { describe, expect, test } from 'bun:test';
import {
  buildCoachSystemPrompt,
  buildCoachUserPrompt,
  parseCoachResponse,
  selectCoachableCells,
  type CoachSuggestion,
} from './coach.ts';
import type { CellResult, ModelId } from './types.ts';

const model = 'mock/m1' as ModelId;

function loss(caseIndex: number, reason: string, a = 'A output', b = 'B output'): CellResult {
  return {
    caseIndex,
    model,
    outputA: a,
    outputB: b,
    judge: { winner: 'a', reason },
  };
}

function win(caseIndex: number, reason = 'candidate wins'): CellResult {
  return {
    caseIndex,
    model,
    outputA: 'a',
    outputB: 'b',
    judge: { winner: 'b', reason },
  };
}

function tie(caseIndex: number, reason = 'equal'): CellResult {
  return {
    caseIndex,
    model,
    outputA: 'a',
    outputB: 'b',
    judge: { winner: 'tie', reason },
  };
}

function erroredCell(caseIndex: number): CellResult {
  return {
    caseIndex,
    model,
    outputA: '',
    outputB: '',
    judge: { error: 'timeout' },
  };
}

describe('selectCoachableCells', () => {
  test('prefers losses, then ties, ignores wins and errors', () => {
    const cells = [
      win(0),
      erroredCell(1),
      loss(2, 'short reason'),
      loss(3, 'this is a much longer reason with specific detail about what went wrong'),
      tie(4, 'equal'),
      loss(5, 'mid-length reason'),
    ];
    const picked = selectCoachableCells(cells, 10);
    const idxs = picked.map((c) => c.caseIndex);
    // Losses first, sorted by reason length (long → short so the coach sees
    // substance-rich cells first).
    expect(idxs.slice(0, 3)).toEqual([3, 5, 2]);
    // Tie follows after all losses exhausted.
    expect(idxs[3]).toBe(4);
    // Errors and wins never appear.
    expect(idxs).not.toContain(0);
    expect(idxs).not.toContain(1);
  });

  test('respects the cap', () => {
    const cells = Array.from({ length: 20 }, (_, i) => loss(i, 'r'));
    expect(selectCoachableCells(cells, 5)).toHaveLength(5);
  });

  test('returns [] when there is nothing actionable', () => {
    expect(selectCoachableCells([win(0), win(1)], 5)).toEqual([]);
  });
});

describe('buildCoachUserPrompt', () => {
  test('includes case inputs, both outputs, and the judge reason', () => {
    const cells = [loss(0, 'candidate was too verbose', 'short answer', 'a long answer with extra padding')];
    const prompt = buildCoachUserPrompt({
      baselinePrompt: 'Be concise.',
      candidatePrompt: 'Explain in detail.',
      cells,
      caseInputs: new Map([[0, 'what is 2+2?']]),
    });
    expect(prompt).toContain('Be concise.');
    expect(prompt).toContain('Explain in detail.');
    expect(prompt).toContain('what is 2+2?');
    expect(prompt).toContain('short answer');
    expect(prompt).toContain('a long answer with extra padding');
    expect(prompt).toContain('candidate was too verbose');
  });

  test('truncates very long outputs so the prompt stays bounded', () => {
    const huge = 'x'.repeat(5000);
    const cells = [loss(0, 'r', huge, huge)];
    const prompt = buildCoachUserPrompt({
      baselinePrompt: 'b',
      candidatePrompt: 'c',
      cells,
      caseInputs: new Map(),
    });
    // Neither full copy should survive.
    const occurrences = prompt.match(/x{2000}/g) || [];
    expect(occurrences.length).toBe(0);
    expect(prompt).toContain('[…');
  });
});

describe('buildCoachSystemPrompt', () => {
  test('instructs the model to produce strict JSON and emphasize the candidate', () => {
    const sys = buildCoachSystemPrompt();
    // It must tell the model to return parseable JSON so parseCoachResponse succeeds.
    expect(sys).toContain('JSON');
    // It should describe what the coach is optimizing for — the candidate prompt.
    expect(sys.toLowerCase()).toContain('candidate');
    expect(sys.toLowerCase()).toContain('suggestion');
  });
});

describe('parseCoachResponse', () => {
  test('parses a clean JSON response', () => {
    const raw = JSON.stringify({
      summary: 'candidate hallucinates facts when uncertain',
      suggestions: [
        {
          title: 'Add anti-hallucination directive',
          rationale: '2 of 3 losses involved fabricated features.',
          edit: 'If you are not certain, say "I don\'t know."',
        },
      ],
    });
    const parsed = parseCoachResponse(raw);
    expect(parsed.summary).toContain('hallucinates');
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.suggestions[0]!.title).toContain('anti-hallucination');
  });

  test('strips leading and trailing prose around the JSON body', () => {
    const raw = 'Here is my analysis:\n```json\n' + JSON.stringify({
      summary: 'x',
      suggestions: [{ title: 't', rationale: 'r', edit: 'e' }],
    }) + '\n```\nLet me know if you need more.';
    const parsed = parseCoachResponse(raw);
    expect(parsed.summary).toBe('x');
    expect(parsed.suggestions).toHaveLength(1);
  });

  test('throws a structured error on unparseable input', () => {
    expect(() => parseCoachResponse('not json at all')).toThrow(/coach/i);
  });

  test('throws when the shape is not a suggestions array', () => {
    expect(() => parseCoachResponse(JSON.stringify({ summary: 'x' }))).toThrow(/suggestions/i);
  });

  test('filters out suggestions missing required fields', () => {
    const raw = JSON.stringify({
      summary: 'ok',
      suggestions: [
        { title: 'keep this', rationale: 'r', edit: 'e' },
        { title: 'missing edit', rationale: 'r' },
        { rationale: 'no title' },
      ],
    });
    const parsed = parseCoachResponse(raw);
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.suggestions[0]!.title).toBe('keep this');
  });

  test('caps to 5 suggestions so the UI stays scannable', () => {
    const manySuggestions: CoachSuggestion[] = Array.from({ length: 10 }, (_, i) => ({
      title: 't' + i,
      rationale: 'r',
      edit: 'e',
    }));
    const raw = JSON.stringify({ summary: 's', suggestions: manySuggestions });
    const parsed = parseCoachResponse(raw);
    expect(parsed.suggestions.length).toBeLessThanOrEqual(5);
  });
});
