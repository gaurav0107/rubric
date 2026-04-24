import { describe, expect, test } from 'bun:test';
import { embedDriftMarker, upsertDriftIssue } from './drift-issue.ts';

interface Call {
  url: string;
  method: string;
  body: unknown;
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
    calls.push({ url, method, body: parsedBody });
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

describe('embedDriftMarker', () => {
  test('prepends marker when missing', () => {
    const out = embedDriftMarker('hi', 'm');
    expect(out.startsWith('<!-- m -->\n')).toBe(true);
  });
  test('leaves body alone when marker present', () => {
    const already = '<!-- m -->\nhi';
    expect(embedDriftMarker(already, 'm')).toBe(already);
  });
});

describe('upsertDriftIssue', () => {
  test('creates a new issue when none matches the marker', async () => {
    const { impl, calls } = stubFetch([
      { body: { total_count: 0, items: [] } },
      { body: { number: 42, html_url: 'URL', state: 'open', body: '' } },
    ]);
    const res = await upsertDriftIssue({
      repo: 'o/r',
      token: 't',
      title: 'drift: candidate regressed',
      body: 'regression details...',
      labels: ['drift'],
      fetchImpl: impl,
    });
    expect(res.action).toBe('created');
    expect(res.issueNumber).toBe(42);
    expect(calls[0]!.url).toContain('/search/issues');
    expect(calls[1]!.url).toContain('/repos/o/r/issues');
    expect(calls[1]!.method).toBe('POST');
    const posted = calls[1]!.body as { title: string; body: string; labels?: string[] };
    expect(posted.title).toBe('drift: candidate regressed');
    expect(posted.body).toContain('<!-- rubric-bot:drift-issue -->');
    expect(posted.labels).toEqual(['drift']);
  });

  test('patches the existing open issue in-place (no reopen)', async () => {
    const { impl, calls } = stubFetch([
      {
        body: {
          total_count: 1,
          items: [
            { number: 7, html_url: 'U1', state: 'open', body: '<!-- rubric-bot:drift-issue -->\nold' },
          ],
        },
      },
      { body: { number: 7, html_url: 'U1', state: 'open', body: 'new' } },
    ]);
    const res = await upsertDriftIssue({
      repo: 'o/r',
      token: 't',
      title: 'drift',
      body: 'new',
      fetchImpl: impl,
    });
    expect(res.action).toBe('updated');
    expect(res.issueNumber).toBe(7);
    expect(calls[1]!.method).toBe('PATCH');
    const patched = calls[1]!.body as Record<string, unknown>;
    expect(patched.state).toBeUndefined(); // open issue: no reopen
    expect(String(patched.body)).toContain('new');
  });

  test('reopens a closed drift issue when a new regression lands', async () => {
    const { impl, calls } = stubFetch([
      {
        body: {
          total_count: 1,
          items: [
            { number: 9, html_url: 'U', state: 'closed', body: '<!-- rubric-bot:drift-issue -->\nold' },
          ],
        },
      },
      { body: { number: 9, html_url: 'U', state: 'open', body: 'new' } },
    ]);
    const res = await upsertDriftIssue({
      repo: 'o/r',
      token: 't',
      title: 'drift',
      body: 'new regression',
      fetchImpl: impl,
    });
    expect(res.action).toBe('reopened');
    const patched = calls[1]!.body as Record<string, unknown>;
    expect(patched.state).toBe('open');
  });

  test('honours custom marker so projects can run multiple drift datasets', async () => {
    const { impl, calls } = stubFetch([
      { body: { total_count: 0, items: [] } },
      { body: { number: 11, html_url: 'U', state: 'open', body: '' } },
    ]);
    await upsertDriftIssue({
      repo: 'o/r',
      token: 't',
      title: 'drift:mobile',
      body: 'body',
      marker: 'rubric-bot:drift-issue:mobile',
      fetchImpl: impl,
    });
    expect(calls[0]!.url).toContain('drift-issue%3Amobile');
    const posted = calls[1]!.body as { body: string };
    expect(posted.body).toContain('<!-- rubric-bot:drift-issue:mobile -->');
  });

  test('surfaces GitHub error bodies on failure', async () => {
    const { impl } = stubFetch([
      { body: { total_count: 0, items: [] } },
      { status: 422, body: {}, text: '{"message":"unprocessable"}' },
    ]);
    await expect(
      upsertDriftIssue({
        repo: 'o/r',
        token: 't',
        title: 'drift',
        body: 'body',
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/422.*unprocessable/);
  });
});
