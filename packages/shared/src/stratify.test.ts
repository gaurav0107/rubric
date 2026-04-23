import { describe, expect, test } from 'bun:test';
import { mulberry32, shuffle, stratifiedSample } from './stratify.ts';

describe('mulberry32', () => {
  test('same seed → identical stream', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  test('different seeds → divergent stream', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  test('values are in [0, 1)', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('shuffle', () => {
  test('preserves all elements', () => {
    const rng = mulberry32(7);
    const out = shuffle([1, 2, 3, 4, 5], rng);
    expect(out.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test('same seed → identical shuffle', () => {
    const a = shuffle([1, 2, 3, 4, 5], mulberry32(7));
    const b = shuffle([1, 2, 3, 4, 5], mulberry32(7));
    expect(a).toEqual(b);
  });
});

describe('stratifiedSample', () => {
  interface Row { id: number; polarity: 'positive' | 'negative' | 'none' }

  function row(id: number, polarity: Row['polarity']): Row {
    return { id, polarity };
  }

  const dataset: Row[] = [
    ...Array.from({ length: 80 }, (_, i) => row(i, 'none')),
    ...Array.from({ length: 15 }, (_, i) => row(100 + i, 'positive')),
    ...Array.from({ length: 5 }, (_, i) => row(200 + i, 'negative')),
  ];

  test('empty input → empty output', () => {
    expect(stratifiedSample([], { keyFn: () => 'x', total: 10 })).toEqual([]);
  });

  test('total <= 0 → empty output', () => {
    expect(stratifiedSample(dataset, { keyFn: (r) => r.polarity, total: 0 })).toEqual([]);
  });

  test('total >= items.length → returns all items (shuffled)', () => {
    const out = stratifiedSample(dataset, {
      keyFn: (r) => r.polarity,
      total: dataset.length * 2,
    });
    expect(out).toHaveLength(dataset.length);
    expect(out.map((r) => r.id).sort((a, b) => a - b)).toEqual(dataset.map((r) => r.id).sort((a, b) => a - b));
  });

  test('round-robin spreads picks across strata', () => {
    const out = stratifiedSample(dataset, {
      keyFn: (r) => r.polarity,
      total: 9,
      rng: mulberry32(1),
    });
    expect(out).toHaveLength(9);
    const counts = new Map<string, number>();
    for (const r of out) counts.set(r.polarity, (counts.get(r.polarity) ?? 0) + 1);
    // Three buckets → 9/3 = 3 each when all buckets have ≥3 items.
    expect(counts.get('none')).toBe(3);
    expect(counts.get('positive')).toBe(3);
    expect(counts.get('negative')).toBe(3);
  });

  test('small bucket exhausts gracefully; larger buckets fill the gap', () => {
    // Only 5 negatives exist — asking for 20 total should give us 5 negatives
    // and the remaining 15 split across the other two buckets.
    const out = stratifiedSample(dataset, {
      keyFn: (r) => r.polarity,
      total: 20,
      rng: mulberry32(2),
    });
    expect(out).toHaveLength(20);
    const counts = new Map<string, number>();
    for (const r of out) counts.set(r.polarity, (counts.get(r.polarity) ?? 0) + 1);
    expect(counts.get('negative')).toBe(5);
    expect((counts.get('none') ?? 0) + (counts.get('positive') ?? 0)).toBe(15);
  });

  test('deterministic under same seed', () => {
    const a = stratifiedSample(dataset, { keyFn: (r) => r.polarity, total: 10, rng: mulberry32(3) });
    const b = stratifiedSample(dataset, { keyFn: (r) => r.polarity, total: 10, rng: mulberry32(3) });
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
  });
});
