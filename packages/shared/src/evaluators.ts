/**
 * Evaluator catalog — additive metrics that run alongside the pairwise judge.
 *
 * Shape: every evaluator receives both outputs (`a`, `b`) plus the case, and
 * emits zero or more `EvaluatorResult` rows. Evaluators are pure per-cell;
 * they do not share state across cells. They are mock-safe and network-free
 * unless a future evaluator opts in to calling a Provider.
 *
 * Composition: config declares `evaluators: EvaluatorConfig[]`; the engine
 * runs all of them per cell and accumulates their results into
 * `CellResult.evaluations`. The existing pairwise judge remains mandatory —
 * evaluators are additive, not a replacement.
 *
 * Naming convention: evaluator results use dotted metric ids with a trailing
 * `.a` / `.b` side suffix, so the downstream report can render a per-side
 * column. Example: `exact_match.a`, `exact_match.b`, `length.a`, `length.b`.
 */
import type { Case } from './types.ts';

export type EvaluatorConfig =
  | { type: 'exact-match'; field?: 'expected' | string; caseSensitive?: boolean; trim?: boolean }
  | { type: 'contains'; needle: string; caseSensitive?: boolean }
  | { type: 'regex'; pattern: string; flags?: string }
  | { type: 'length'; min?: number; max?: number }
  | { type: 'json-valid' };

export interface EvaluatorContext {
  case: Case;
  outputA: string;
  outputB: string;
}

export interface EvaluatorResult {
  metric: string;
  /** `a`, `b`, or `both` (scalar metrics that don't depend on side). */
  side: 'a' | 'b' | 'both';
  value: number | string | boolean;
  pass?: boolean;
  reason?: string;
}

export interface Evaluator {
  readonly name: string;
  evaluate(ctx: EvaluatorContext): EvaluatorResult[];
}

export class EvaluatorConfigError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'EvaluatorConfigError';
  }
}

function expectedOf(c: Case, field: string): string | undefined {
  if (field === 'expected') return c.expected;
  // Dotted metadata path (e.g. "metadata.gold") — minimal support for
  // one-level nesting via Case.metadata.
  if (field.startsWith('metadata.')) {
    const key = field.slice('metadata.'.length);
    const v = c.metadata?.[key];
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v === undefined || v === null) return undefined;
    return JSON.stringify(v);
  }
  return undefined;
}

function normalize(s: string, caseSensitive: boolean, trim: boolean): string {
  let out = s;
  if (trim) out = out.trim();
  if (!caseSensitive) out = out.toLowerCase();
  return out;
}

export function createExactMatchEvaluator(
  cfg: Extract<EvaluatorConfig, { type: 'exact-match' }>,
): Evaluator {
  const field = cfg.field ?? 'expected';
  const cs = cfg.caseSensitive ?? false;
  const trim = cfg.trim ?? true;
  return {
    name: `exact-match(${field})`,
    evaluate(ctx: EvaluatorContext): EvaluatorResult[] {
      const target = expectedOf(ctx.case, field);
      if (target === undefined) {
        return [
          { metric: 'exact_match.a', side: 'a', value: 'skip', reason: `no ${field} on case` },
          { metric: 'exact_match.b', side: 'b', value: 'skip', reason: `no ${field} on case` },
        ];
      }
      const want = normalize(target, cs, trim);
      const a = normalize(ctx.outputA, cs, trim);
      const b = normalize(ctx.outputB, cs, trim);
      const aHit = a === want;
      const bHit = b === want;
      return [
        { metric: 'exact_match.a', side: 'a', value: aHit ? 1 : 0, pass: aHit },
        { metric: 'exact_match.b', side: 'b', value: bHit ? 1 : 0, pass: bHit },
      ];
    },
  };
}

export function createContainsEvaluator(
  cfg: Extract<EvaluatorConfig, { type: 'contains' }>,
): Evaluator {
  if (typeof cfg.needle !== 'string' || cfg.needle.length === 0) {
    throw new EvaluatorConfigError('contains.needle must be a non-empty string');
  }
  const cs = cfg.caseSensitive ?? false;
  const needle = cs ? cfg.needle : cfg.needle.toLowerCase();
  return {
    name: `contains(${cfg.needle})`,
    evaluate(ctx: EvaluatorContext): EvaluatorResult[] {
      const a = cs ? ctx.outputA : ctx.outputA.toLowerCase();
      const b = cs ? ctx.outputB : ctx.outputB.toLowerCase();
      const aHit = a.includes(needle);
      const bHit = b.includes(needle);
      return [
        { metric: 'contains.a', side: 'a', value: aHit ? 1 : 0, pass: aHit },
        { metric: 'contains.b', side: 'b', value: bHit ? 1 : 0, pass: bHit },
      ];
    },
  };
}

export function createRegexEvaluator(
  cfg: Extract<EvaluatorConfig, { type: 'regex' }>,
): Evaluator {
  let re: RegExp;
  try {
    re = new RegExp(cfg.pattern, cfg.flags ?? '');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new EvaluatorConfigError(`regex.pattern invalid: ${msg}`);
  }
  return {
    name: `regex(${cfg.pattern})`,
    evaluate(ctx: EvaluatorContext): EvaluatorResult[] {
      // Reset lastIndex for global regexes so repeated .test() calls are
      // independent.
      const a = new RegExp(re.source, re.flags).test(ctx.outputA);
      const b = new RegExp(re.source, re.flags).test(ctx.outputB);
      return [
        { metric: 'regex.a', side: 'a', value: a ? 1 : 0, pass: a },
        { metric: 'regex.b', side: 'b', value: b ? 1 : 0, pass: b },
      ];
    },
  };
}

export function createLengthEvaluator(
  cfg: Extract<EvaluatorConfig, { type: 'length' }>,
): Evaluator {
  const min = cfg.min;
  const max = cfg.max;
  if (min !== undefined && (typeof min !== 'number' || min < 0)) {
    throw new EvaluatorConfigError('length.min must be a non-negative number');
  }
  if (max !== undefined && (typeof max !== 'number' || max < 0)) {
    throw new EvaluatorConfigError('length.max must be a non-negative number');
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new EvaluatorConfigError(`length.min (${min}) > length.max (${max})`);
  }
  const hasBand = min !== undefined || max !== undefined;
  return {
    name: `length(${min ?? '-'},${max ?? '-'})`,
    evaluate(ctx: EvaluatorContext): EvaluatorResult[] {
      const la = ctx.outputA.length;
      const lb = ctx.outputB.length;
      const inBand = (n: number): boolean => {
        if (min !== undefined && n < min) return false;
        if (max !== undefined && n > max) return false;
        return true;
      };
      const out: EvaluatorResult[] = [
        { metric: 'length.a', side: 'a', value: la },
        { metric: 'length.b', side: 'b', value: lb },
      ];
      if (hasBand) {
        out.push({ metric: 'length_in_band.a', side: 'a', value: inBand(la) ? 1 : 0, pass: inBand(la) });
        out.push({ metric: 'length_in_band.b', side: 'b', value: inBand(lb) ? 1 : 0, pass: inBand(lb) });
      }
      return out;
    },
  };
}

function tryParseJson(raw: string): boolean {
  const trimmed = raw.trim();
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    // Accept code-fenced JSON — mirrors structural-json judge leniency.
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
    if (fence && fence[1]) {
      try {
        JSON.parse(fence[1]);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function createJsonValidEvaluator(): Evaluator {
  return {
    name: 'json-valid',
    evaluate(ctx: EvaluatorContext): EvaluatorResult[] {
      const a = tryParseJson(ctx.outputA);
      const b = tryParseJson(ctx.outputB);
      return [
        { metric: 'json_valid.a', side: 'a', value: a ? 1 : 0, pass: a },
        { metric: 'json_valid.b', side: 'b', value: b ? 1 : 0, pass: b },
      ];
    },
  };
}

export function createEvaluator(cfg: EvaluatorConfig): Evaluator {
  switch (cfg.type) {
    case 'exact-match': return createExactMatchEvaluator(cfg);
    case 'contains': return createContainsEvaluator(cfg);
    case 'regex': return createRegexEvaluator(cfg);
    case 'length': return createLengthEvaluator(cfg);
    case 'json-valid': return createJsonValidEvaluator();
    default: {
      const _exhaustive: never = cfg;
      throw new EvaluatorConfigError(`unknown evaluator type ${JSON.stringify((_exhaustive as { type: string }).type)}`);
    }
  }
}

export function createEvaluators(cfgs: EvaluatorConfig[] | undefined): Evaluator[] {
  if (!cfgs || cfgs.length === 0) return [];
  return cfgs.map((c) => createEvaluator(c));
}

/**
 * Run every evaluator against a cell. Evaluator errors are caught per-evaluator
 * and surfaced as a single result row with `value: 'error'` — a thrown
 * evaluator never takes down the run.
 */
export function runEvaluators(
  evaluators: Evaluator[],
  ctx: EvaluatorContext,
): EvaluatorResult[] {
  if (evaluators.length === 0) return [];
  const out: EvaluatorResult[] = [];
  for (const e of evaluators) {
    try {
      for (const r of e.evaluate(ctx)) out.push(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.push({
        metric: `${e.name}.error`,
        side: 'both',
        value: 'error',
        pass: false,
        reason: msg,
      });
    }
  }
  return out;
}

export interface MetricSummary {
  metric: string;
  /** Side this metric belongs to, if uniform across rows. */
  side: 'a' | 'b' | 'both' | 'mixed';
  /** Count of contributing non-skip rows. */
  count: number;
  /** Pass count when results expose a `pass` flag. */
  passCount: number;
  /** Arithmetic mean when results are numeric. */
  mean?: number;
  /** Pass rate = passCount / count (only meaningful when rows set `pass`). */
  passRate?: number;
}

/**
 * Aggregate per-cell evaluator results into a metric-level summary. Skip rows
 * (value === 'skip') and error rows (value === 'error') are excluded from
 * numeric aggregation but counted separately via the returned `skipCount` /
 * `errorCount` totals on the bundle.
 */
export function summarizeEvaluations(cells: { evaluations?: EvaluatorResult[] }[]): {
  metrics: MetricSummary[];
  skipCount: number;
  errorCount: number;
} {
  const bySlot = new Map<string, { side: 'a' | 'b' | 'both' | 'mixed'; rows: EvaluatorResult[] }>();
  let skipCount = 0;
  let errorCount = 0;
  for (const cell of cells) {
    for (const r of cell.evaluations ?? []) {
      if (r.value === 'skip') { skipCount++; continue; }
      if (r.value === 'error') { errorCount++; continue; }
      const slot = bySlot.get(r.metric);
      if (!slot) {
        bySlot.set(r.metric, { side: r.side, rows: [r] });
      } else {
        if (slot.side !== r.side && slot.side !== 'mixed') slot.side = 'mixed';
        slot.rows.push(r);
      }
    }
  }

  const metrics: MetricSummary[] = [];
  for (const [metric, { side, rows }] of bySlot) {
    const numeric = rows.filter((r) => typeof r.value === 'number').map((r) => r.value as number);
    const withPass = rows.filter((r) => typeof r.pass === 'boolean');
    const summary: MetricSummary = {
      metric,
      side,
      count: rows.length,
      passCount: withPass.filter((r) => r.pass).length,
    };
    if (numeric.length > 0) summary.mean = numeric.reduce((a, b) => a + b, 0) / numeric.length;
    if (withPass.length > 0) summary.passRate = summary.passCount / withPass.length;
    metrics.push(summary);
  }
  metrics.sort((a, b) => a.metric.localeCompare(b.metric));
  return { metrics, skipCount, errorCount };
}
