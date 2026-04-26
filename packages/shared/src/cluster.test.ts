import { describe, expect, it } from 'bun:test';
import { clusterFailures, tokenizeReason } from './cluster.ts';
import type { CellResult, ModelId } from './types.ts';

const model = 'openai/gpt-4o-mini' as ModelId;
function cell(i: number, winner: 'a' | 'b' | 'tie', reason: string): CellResult {
  return {
    caseIndex: i,
    model,
    outputA: '',
    outputB: '',
    judge: { winner, reason },
  };
}

describe('tokenizeReason', () => {
  it('strips punctuation and stopwords', () => {
    const toks = tokenizeReason('The response was VERBOSE, and too long!');
    expect(toks).toContain('verbose');
    expect(toks).toContain('long');
    expect(toks).not.toContain('the');
    expect(toks).not.toContain('and');
  });

  it('dedupes repeated tokens', () => {
    const toks = tokenizeReason('verbose verbose verbose tone');
    expect(toks.filter((t) => t === 'verbose').length).toBe(1);
  });

  it('drops tokens shorter than 3 chars', () => {
    expect(tokenizeReason('ai ml hi big')).toEqual(['big']);
  });
});

describe('clusterFailures', () => {
  it('groups similar reasons and returns clusters size-desc', () => {
    const cells: CellResult[] = [
      cell(0, 'a', 'Candidate was too verbose and rambling'),
      cell(1, 'a', 'Too verbose, with rambling asides'),
      cell(2, 'a', 'Verbose response — rambling paragraphs'),
      cell(3, 'a', 'Hallucinated a fake URL'),
      cell(4, 'a', 'Made up a URL citation'),
      cell(5, 'b', 'Candidate wins decisively'), // not a loss for B
    ];
    const clusters = clusterFailures({ cells });
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    expect(clusters[0]!.count).toBe(3);
    // The 3-cluster should contain the verbose/rambling cases
    expect(clusters[0]!.caseIndices.sort()).toEqual([0, 1, 2]);
    expect(clusters[0]!.label.toLowerCase()).toMatch(/verbose|rambling/);
    // The "b wins" cell (5) is not counted as a loss for B
    const allIndices = clusters.flatMap((c) => c.caseIndices);
    expect(allIndices).not.toContain(5);
  });

  it('treats judge errors as candidate losses', () => {
    const cells: CellResult[] = [
      { caseIndex: 0, model, outputA: '', outputB: '', judge: { error: 'timeout hitting provider' } },
      { caseIndex: 1, model, outputA: '', outputB: '', judge: { error: 'timeout calling provider' } },
    ];
    const clusters = clusterFailures({ cells });
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.count).toBe(2);
    expect(clusters[0]!.label.toLowerCase()).toMatch(/timeout|provider/);
  });

  it('respects losingSide=a to cluster baseline regressions', () => {
    const cells: CellResult[] = [
      cell(0, 'b', 'Baseline omits specificity detail'),
      cell(1, 'b', 'Baseline lacks specificity detail'),
      cell(2, 'b', 'Baseline missing specificity'),
      cell(3, 'a', 'Candidate is fine'),
    ];
    const clusters = clusterFailures({ cells, losingSide: 'a' });
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.caseIndices.sort()).toEqual([0, 1, 2]);
  });

  it('returns an empty list when there are no losses', () => {
    const cells: CellResult[] = [
      cell(0, 'b', 'candidate wins'),
      cell(1, 'tie', 'tie'),
    ];
    expect(clusterFailures({ cells })).toEqual([]);
  });

  it('caps at maxClusters', () => {
    // Give each cell a single unique content token so nothing merges.
    const vocab = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    const cells: CellResult[] = vocab.map((w, i) => cell(i, 'a', `${w} regression observed`));
    const clusters = clusterFailures({ cells, maxClusters: 2 });
    expect(clusters.length).toBe(2);
  });

  it('caps sampleReason at 240 characters', () => {
    const long = 'this reason is way too long '.repeat(40);
    const clusters = clusterFailures({ cells: [cell(0, 'a', long)] });
    expect(clusters[0]!.sampleReason.length).toBeLessThanOrEqual(240);
    expect(clusters[0]!.sampleReason.endsWith('…')).toBe(true);
  });
});
