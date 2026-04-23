/**
 * Deterministic stratified sampler. Given a list of items and a key function,
 * `stratifiedSample` returns a subset of size `total` that spreads picks
 * across buckets as evenly as possible — so if 80% of a Langfuse export is
 * `feedback: null`, we don't end up with a calibration set that's 80%
 * unlabeled.
 *
 * Determinism comes from an injectable seeded RNG (`mulberry32`). Same seed
 * + same input → same output, which matters for CI reproducibility.
 */

export type RngFn = () => number;

/**
 * mulberry32 — a 32-bit seeded PRNG. Good enough for sampling, not
 * cryptographic. Source: https://stackoverflow.com/a/47593316
 */
export function mulberry32(seed: number): RngFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle using the provided RNG. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: RngFn): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i]!;
    const b = arr[j]!;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

export interface StratifyOptions<T> {
  /** Extracts the stratification key for an item (e.g. feedback polarity). */
  keyFn: (item: T) => string;
  /** Target sample size. If >= items.length, the full list is returned shuffled. */
  total: number;
  /** Seeded RNG. Defaults to `mulberry32(1)` for deterministic tests. */
  rng?: RngFn;
}

/**
 * Group items by `keyFn`, shuffle each bucket, then round-robin across
 * buckets (in key-sorted order for determinism) taking one item at a time
 * until `total` items are selected or every bucket is exhausted.
 */
export function stratifiedSample<T>(items: readonly T[], opts: StratifyOptions<T>): T[] {
  const rng = opts.rng ?? mulberry32(1);
  if (opts.total <= 0 || items.length === 0) return [];
  if (opts.total >= items.length) return shuffle(items, rng);

  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const k = opts.keyFn(item);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(item);
    else buckets.set(k, [item]);
  }

  // Sort keys so two runs with the same seed + same input produce byte-identical output.
  const keys = [...buckets.keys()].sort();
  const shuffled = new Map<string, T[]>();
  for (const k of keys) shuffled.set(k, shuffle(buckets.get(k)!, rng));

  const out: T[] = [];
  const cursors = new Map<string, number>(keys.map((k) => [k, 0]));
  while (out.length < opts.total) {
    let tookAny = false;
    for (const k of keys) {
      if (out.length >= opts.total) break;
      const bucket = shuffled.get(k)!;
      const cur = cursors.get(k)!;
      if (cur < bucket.length) {
        out.push(bucket[cur]!);
        cursors.set(k, cur + 1);
        tookAny = true;
      }
    }
    if (!tookAny) break; // every bucket exhausted
  }
  return out;
}
