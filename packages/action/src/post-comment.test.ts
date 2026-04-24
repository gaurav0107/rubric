import { describe, expect, test } from 'bun:test';
import {
  embedMarker,
  findExistingComment,
  upsertPrComment,
} from './post-comment.ts';

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function stubFetch(responses: Array<{ status?: number; body: unknown; text?: string }>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    let parsedBody: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({
      url,
      method,
      body: parsedBody,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    const r = responses[i++];
    if (!r) throw new Error(`stubFetch: no more responses (call ${i} to ${url})`);
    const status = r.status ?? 200;
    const ok = status >= 200 && status < 300;
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'ERR',
      async text() { return r.text ?? JSON.stringify(r.body); },
      async json() { return r.body; },
    } as unknown as Response;
  };
  return { impl, calls };
}

describe('embedMarker', () => {
  test('prepends the hidden tag when missing', () => {
    const out = embedMarker('hello', 'my-marker');
    expect(out.startsWith('<!-- my-marker -->\n')).toBe(true);
    expect(out.endsWith('hello')).toBe(true);
  });

  test('leaves body untouched when marker already present', () => {
    const already = '<!-- my-marker -->\nhello';
    expect(embedMarker(already, 'my-marker')).toBe(already);
  });
});

describe('findExistingComment', () => {
  test('returns null when no comment matches marker', async () => {
    const { impl, calls } = stubFetch([
      { body: [{ id: 1, body: 'random comment', html_url: 'x' }] },
    ]);
    const hit = await findExistingComment({
      repo: 'o/r',
      prNumber: 42,
      token: 't',
      marker: 'rubric-bot:pr-comment',
      apiUrl: 'https://api.github.com',
      fetchImpl: impl,
    });
    expect(hit).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/repos/o/r/issues/42/comments');
    expect(calls[0]!.headers.Authorization).toBe('Bearer t');
  });

  test('returns the comment with a matching hidden marker', async () => {
    const { impl } = stubFetch([
      {
        body: [
          { id: 1, body: 'unrelated', html_url: 'x' },
          { id: 2, body: '<!-- rubric-bot:pr-comment -->\nhi', html_url: 'y' },
        ],
      },
    ]);
    const hit = await findExistingComment({
      repo: 'o/r',
      prNumber: 42,
      token: 't',
      marker: 'rubric-bot:pr-comment',
      apiUrl: 'https://api.github.com',
      fetchImpl: impl,
    });
    expect(hit?.id).toBe(2);
  });

  test('throws with GitHub error body when list call fails', async () => {
    const { impl } = stubFetch([{ status: 403, body: {}, text: 'Resource not accessible' }]);
    await expect(
      findExistingComment({
        repo: 'o/r',
        prNumber: 42,
        token: 't',
        marker: 'rubric-bot:pr-comment',
        apiUrl: 'https://api.github.com',
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/403/);
  });
});

describe('upsertPrComment', () => {
  test('creates a new comment when no existing marker is found', async () => {
    const { impl, calls } = stubFetch([
      { body: [] },
      { body: { id: 100, body: '<!-- rubric-bot:pr-comment -->\nfresh', html_url: 'URL' } },
    ]);
    const res = await upsertPrComment({
      repo: 'o/r',
      prNumber: 7,
      token: 'tok',
      body: 'fresh',
      fetchImpl: impl,
    });
    expect(res.action).toBe('created');
    expect(res.commentId).toBe(100);
    expect(res.url).toBe('URL');
    expect(calls[1]!.method).toBe('POST');
    const posted = calls[1]!.body as { body: string };
    expect(posted.body).toContain('<!-- rubric-bot:pr-comment -->');
    expect(posted.body).toContain('fresh');
  });

  test('updates the existing comment in-place', async () => {
    const { impl, calls } = stubFetch([
      { body: [{ id: 99, body: '<!-- rubric-bot:pr-comment -->\nold', html_url: 'U1' }] },
      { body: { id: 99, body: '<!-- rubric-bot:pr-comment -->\nnew', html_url: 'U2' } },
    ]);
    const res = await upsertPrComment({
      repo: 'o/r',
      prNumber: 7,
      token: 'tok',
      body: 'new',
      fetchImpl: impl,
    });
    expect(res.action).toBe('updated');
    expect(res.commentId).toBe(99);
    expect(calls[1]!.method).toBe('PATCH');
    expect(calls[1]!.url).toContain('/repos/o/r/issues/comments/99');
    const patched = calls[1]!.body as { body: string };
    expect(patched.body).toContain('new');
  });

  test('honours custom marker for multiple bot variants', async () => {
    const { impl, calls } = stubFetch([
      { body: [{ id: 1, body: '<!-- rubric-bot:pr-comment -->\nold default', html_url: 'x' }] },
      { body: { id: 200, body: 'new', html_url: 'Y' } },
    ]);
    const res = await upsertPrComment({
      repo: 'o/r',
      prNumber: 7,
      token: 'tok',
      body: 'hi',
      marker: 'rubric-bot:nightly',
      fetchImpl: impl,
    });
    expect(res.action).toBe('created'); // default marker doesn't match `nightly`
    expect(calls[1]!.method).toBe('POST');
    const posted = calls[1]!.body as { body: string };
    expect(posted.body).toContain('<!-- rubric-bot:nightly -->');
  });

  test('surfaces GitHub error bodies on failure', async () => {
    const { impl } = stubFetch([
      { body: [] },
      { status: 422, body: {}, text: '{"message":"Validation Failed"}' },
    ]);
    await expect(
      upsertPrComment({ repo: 'o/r', prNumber: 7, token: 'tok', body: 'x', fetchImpl: impl }),
    ).rejects.toThrow(/422.*Validation Failed/);
  });
});
