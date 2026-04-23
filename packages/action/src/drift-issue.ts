/**
 * Upsert a GitHub issue used to surface drift-detection regressions.
 *
 * Drift detection is framed as best-effort — the scheduled workflow runs
 * `diffprompt run --fail-on-regress` against a frozen baseline dataset and,
 * when it regresses, opens (or updates) a single issue per `marker`. Reusing
 * the same marker across scheduled runs keeps the tracker to one row per
 * repo per drift type, so the backlog never fills up with duplicates.
 */

import type { FetchLike } from './post-comment.ts';

export interface UpsertDriftIssueInput {
  repo: string;
  token: string;
  /** Rendered Markdown body (without the marker). */
  body: string;
  /** Issue title. The first run's title sticks; updates only patch the body. */
  title: string;
  /** Hidden marker the body carries so we find the same issue next run. */
  marker?: string;
  /** Labels applied when creating. Ignored on update. */
  labels?: string[];
  apiUrl?: string;
  fetchImpl?: FetchLike;
}

export interface UpsertDriftIssueResult {
  action: 'created' | 'updated' | 'reopened';
  issueNumber: number;
  url: string;
}

const DEFAULT_MARKER = 'diffprompt-bot:drift-issue';
const DEFAULT_API_URL = 'https://api.github.com';

function markerTag(marker: string): string {
  return `<!-- ${marker} -->`;
}

export function embedDriftMarker(body: string, marker: string = DEFAULT_MARKER): string {
  const tag = markerTag(marker);
  return body.includes(tag) ? body : `${tag}\n${body}`;
}

interface GhIssueSearchHit {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  body?: string;
}

interface GhSearchResponse {
  total_count: number;
  items: GhIssueSearchHit[];
}

async function findExistingDriftIssue(args: {
  repo: string;
  token: string;
  marker: string;
  apiUrl: string;
  fetchImpl: FetchLike;
}): Promise<GhIssueSearchHit | null> {
  // We use the search API (typed `q`) so we hit open+closed together and can
  // reopen a prior drift issue instead of filing a duplicate. The marker is
  // embedded in the body, which Code Search indexes.
  const q = encodeURIComponent(`repo:${args.repo} is:issue in:body "${markerTag(args.marker)}"`);
  const url = `${args.apiUrl}/search/issues?q=${q}&per_page=100&sort=created&order=desc`;
  const res = await args.fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${args.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub search issues failed: ${res.status} ${res.statusText} — ${text}`);
  }
  const payload = (await res.json()) as GhSearchResponse;
  const tag = markerTag(args.marker);
  const hit = payload.items.find((it) => typeof it.body === 'string' && it.body.includes(tag));
  return hit ?? null;
}

export async function upsertDriftIssue(input: UpsertDriftIssueInput): Promise<UpsertDriftIssueResult> {
  const marker = input.marker ?? DEFAULT_MARKER;
  const apiUrl = input.apiUrl ?? DEFAULT_API_URL;
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = embedDriftMarker(input.body, marker);

  const existing = await findExistingDriftIssue({
    repo: input.repo,
    token: input.token,
    marker,
    apiUrl,
    fetchImpl,
  });

  if (existing) {
    const url = `${apiUrl}/repos/${input.repo}/issues/${existing.number}`;
    const patchBody: Record<string, unknown> = { body };
    // Reopen a closed drift issue so the new regression is visible.
    if (existing.state === 'closed') patchBody.state = 'open';
    const res = await fetchImpl(url, {
      method: 'PATCH',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${input.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patchBody),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub PATCH issue failed: ${res.status} ${res.statusText} — ${text}`);
    }
    const updated = (await res.json()) as GhIssueSearchHit;
    return {
      action: existing.state === 'closed' ? 'reopened' : 'updated',
      issueNumber: updated.number,
      url: updated.html_url,
    };
  }

  const createUrl = `${apiUrl}/repos/${input.repo}/issues`;
  const createBody: Record<string, unknown> = { title: input.title, body };
  if (input.labels && input.labels.length > 0) createBody.labels = input.labels;
  const res = await fetchImpl(createUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${input.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createBody),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub POST issue failed: ${res.status} ${res.statusText} — ${text}`);
  }
  const created = (await res.json()) as GhIssueSearchHit;
  return { action: 'created', issueNumber: created.number, url: created.html_url };
}
