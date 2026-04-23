/**
 * Idempotent PR comment upsert over the GitHub REST API.
 *
 * We identify our own comment by a hidden HTML marker in the body so repeat
 * runs on the same PR update the same comment instead of stacking.
 */

/** Narrowed fetch signature — just the call. Avoids depending on runtime-specific
 * extras like `preconnect` that live on Bun's `typeof fetch`. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface UpsertInput {
  /** `owner/repo`, e.g. `diffprompt/diffprompt`. */
  repo: string;
  prNumber: number;
  /** GITHUB_TOKEN or a PAT with `pull-requests: write` on the target repo. */
  token: string;
  /** The rendered Markdown body (without the marker). */
  body: string;
  /** Hidden marker used to find+replace our own comment. Default: `diffprompt-bot:pr-comment`. */
  marker?: string;
  /** Override the GitHub API base URL (for GHES). Default: `https://api.github.com`. */
  apiUrl?: string;
  /** Injection point for tests. Defaults to global `fetch`. */
  fetchImpl?: FetchLike;
}

export interface UpsertResult {
  action: 'created' | 'updated';
  commentId: number;
  url: string;
}

const DEFAULT_MARKER = 'diffprompt-bot:pr-comment';
const DEFAULT_API_URL = 'https://api.github.com';

function markerTag(marker: string): string {
  return `<!-- ${marker} -->`;
}

/** Embed the marker so future runs can find this comment. */
export function embedMarker(body: string, marker: string = DEFAULT_MARKER): string {
  const tag = markerTag(marker);
  return body.includes(tag) ? body : `${tag}\n${body}`;
}

interface GhComment {
  id: number;
  body?: string;
  html_url: string;
}

export async function findExistingComment(args: {
  repo: string;
  prNumber: number;
  token: string;
  marker: string;
  apiUrl: string;
  fetchImpl: FetchLike;
}): Promise<GhComment | null> {
  const tag = markerTag(args.marker);
  let page = 1;
  // GitHub caps per_page at 100; we page conservatively and stop on first hit.
  // Most PRs have ≤ a few comments, so this usually ends after one request.
  while (true) {
    const url = `${args.apiUrl}/repos/${args.repo}/issues/${args.prNumber}/comments?per_page=100&page=${page}`;
    const res = await args.fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${args.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub GET comments failed: ${res.status} ${res.statusText} — ${text}`);
    }
    const batch = (await res.json()) as GhComment[];
    const hit = batch.find((c) => typeof c.body === 'string' && c.body.includes(tag));
    if (hit) return hit;
    if (batch.length < 100) return null;
    page += 1;
    if (page > 10) return null; // 1000-comment ceiling; good enough for PR threads
  }
}

export async function upsertPrComment(input: UpsertInput): Promise<UpsertResult> {
  const marker = input.marker ?? DEFAULT_MARKER;
  const apiUrl = input.apiUrl ?? DEFAULT_API_URL;
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = embedMarker(input.body, marker);

  const existing = await findExistingComment({
    repo: input.repo,
    prNumber: input.prNumber,
    token: input.token,
    marker,
    apiUrl,
    fetchImpl,
  });

  if (existing) {
    const url = `${apiUrl}/repos/${input.repo}/issues/comments/${existing.id}`;
    const res = await fetchImpl(url, {
      method: 'PATCH',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${input.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub PATCH comment failed: ${res.status} ${res.statusText} — ${text}`);
    }
    const updated = (await res.json()) as GhComment;
    return { action: 'updated', commentId: updated.id, url: updated.html_url };
  }

  const createUrl = `${apiUrl}/repos/${input.repo}/issues/${input.prNumber}/comments`;
  const res = await fetchImpl(createUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${input.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub POST comment failed: ${res.status} ${res.statusText} — ${text}`);
  }
  const created = (await res.json()) as GhComment;
  return { action: 'created', commentId: created.id, url: created.html_url };
}
