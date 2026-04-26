/**
 * Failure clustering — group "losing" cells by a normalized judge-reason.
 *
 * The goal: when you stare at a run with 200 cells, you want to see the
 * three or four *themes* that caused regressions — "too verbose",
 * "wrong tone", "hallucinated a URL" — not the raw reason for each
 * individual cell. We do this with a deliberately simple bag-of-keywords
 * approach rather than an embedding model because:
 *
 *   1. The serve UI runs locally with no provider keys guaranteed.
 *   2. Run payloads ship over the wire; clustering has to be cheap
 *      enough to compute on a hot path.
 *   3. Judge reasons are short, English, and written by the same judge
 *      model — normalization + Jaccard similarity bins them well enough.
 *
 * Algorithm:
 *   1. Normalize each reason: lowercase, strip punctuation, drop stopwords,
 *      keep the set of remaining tokens (deduped).
 *   2. Greedy clustering: for each losing cell, attach it to the first
 *      cluster whose token-set overlaps enough (Jaccard ≥ `minOverlap`).
 *      If no cluster matches, start a new one seeded with the current
 *      cell's token set.
 *   3. Cluster label = top-k tokens by term frequency across the cluster.
 *
 * We don't claim this competes with embedding-based clustering. It's the
 * smallest thing that gives useful "why are we losing" structure.
 */
import type { CellResult, RunSummary } from './types.ts';

export interface FailureCluster {
  /** Short label derived from the most common tokens in the cluster. */
  label: string;
  /** How many losing cells landed in this cluster. */
  count: number;
  /** Case indices for the cells in this cluster (newest-first, stable). */
  caseIndices: number[];
  /** A representative reason — the longest reason in the cluster, capped. */
  sampleReason: string;
  /** Token set that seeded the cluster (for diagnostics). */
  tokens: string[];
}

export interface ClusterFailuresInput {
  cells: CellResult[];
  summary?: RunSummary;
  /**
   * Which side is "losing". Defaults to `'b'` (candidate) — rubric's convention
   * is that the candidate is the new thing under test. Pass `'a'` if you want
   * to cluster baseline losses instead.
   */
  losingSide?: 'a' | 'b';
  /** Minimum Jaccard overlap to merge into an existing cluster. Default 0.3. */
  minOverlap?: number;
  /** Max clusters to return. Default 10. */
  maxClusters?: number;
  /** How many top tokens to use for the cluster label. Default 3. */
  labelTokens?: number;
}

// Lifted from common English stopword lists — we strip "the/a/of" noise so
// Jaccard actually reflects content overlap. This is small on purpose: every
// token beyond stopwords carries signal, and we want to keep judge-specific
// vocabulary like "hallucinated" / "verbose" / "tone" intact.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it',
  'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'will', 'with', 'are', 'was',
  'because', 'than', 'so', 'if', 'not', 'no', 'yes', 'do', 'does', 'did', 'response', 'responses',
  'answer', 'answers', 'model', 'output', 'outputs', 'better', 'worse', 'both', 'while', 'which',
  'more', 'less', 'very', 'also', 'however', 'though', 'although', 'while', 'their', 'they',
  'them', 'it’s',
]);

/** Tokenize a reason into a deduped set of content-bearing lowercase words. */
export function tokenizeReason(reason: string): string[] {
  const lowered = reason.toLowerCase();
  // Letters, digits, and hyphens stay; everything else is a split.
  const raw = lowered.split(/[^a-z0-9\-]+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of raw) {
    if (tok.length < 3) continue;        // drop "a", "to", etc. beyond stopwords
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

interface ScratchCluster {
  tokens: Set<string>;
  tokenCounts: Map<string, number>;
  caseIndices: number[];
  reasons: string[];
}

/**
 * A cell is "losing" for the candidate (side=b) if the judge picked `a`, and
 * vice versa. Judge errors are also counted as losses for the candidate side
 * because rubric treats a broken judge verdict as a regression.
 */
function isLoss(cell: CellResult, losingSide: 'a' | 'b'): boolean {
  if ('error' in cell.judge) return losingSide === 'b';
  const winningForLoser = losingSide === 'b' ? 'a' : 'b';
  return cell.judge.winner === winningForLoser;
}

function lossReason(cell: CellResult): string {
  if ('error' in cell.judge) return `judge error: ${cell.judge.error}`;
  return cell.judge.reason;
}

export function clusterFailures(input: ClusterFailuresInput): FailureCluster[] {
  const losingSide = input.losingSide ?? 'b';
  const minOverlap = input.minOverlap ?? 0.3;
  const maxClusters = input.maxClusters ?? 10;
  const labelTokens = input.labelTokens ?? 3;

  const clusters: ScratchCluster[] = [];
  for (const cell of input.cells) {
    if (!isLoss(cell, losingSide)) continue;
    const reason = lossReason(cell);
    const tokens = tokenizeReason(reason);
    if (tokens.length === 0) continue;
    const tokenSet = new Set(tokens);

    let best: { idx: number; score: number } | null = null;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i]!;
      const score = jaccard(tokenSet, c.tokens);
      if (score >= minOverlap && (best === null || score > best.score)) {
        best = { idx: i, score };
      }
    }
    if (best) {
      const c = clusters[best.idx]!;
      c.caseIndices.push(cell.caseIndex);
      c.reasons.push(reason);
      for (const t of tokens) {
        c.tokens.add(t);
        c.tokenCounts.set(t, (c.tokenCounts.get(t) ?? 0) + 1);
      }
    } else {
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t, 1);
      clusters.push({ tokens: tokenSet, tokenCounts: counts, caseIndices: [cell.caseIndex], reasons: [reason] });
    }
  }

  // Rank clusters by size desc, then by longest-sample-reason as tiebreaker
  // so the most informative-looking cluster wins ties.
  clusters.sort((x, y) => {
    if (y.caseIndices.length !== x.caseIndices.length) return y.caseIndices.length - x.caseIndices.length;
    const xl = x.reasons.reduce((m, r) => Math.max(m, r.length), 0);
    const yl = y.reasons.reduce((m, r) => Math.max(m, r.length), 0);
    return yl - xl;
  });

  const out: FailureCluster[] = [];
  for (const c of clusters.slice(0, maxClusters)) {
    const topTokens = Array.from(c.tokenCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, labelTokens)
      .map(([t]) => t);
    const sample = c.reasons.reduce((best, r) => (r.length > best.length ? r : best), '');
    out.push({
      label: topTokens.join(' · ') || '(unlabeled)',
      count: c.caseIndices.length,
      caseIndices: c.caseIndices,
      sampleReason: sample.length > 240 ? sample.slice(0, 239) + '…' : sample,
      tokens: Array.from(c.tokens),
    });
  }
  return out;
}
