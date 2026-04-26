import { describe, expect, it } from 'bun:test';
import { isSecretHeaderName, redactHeaders, redactSecret } from './redact.ts';

describe('isSecretHeaderName', () => {
  it('matches the standard secret-ish header names', () => {
    expect(isSecretHeaderName('Authorization')).toBe(true);
    expect(isSecretHeaderName('x-api-key')).toBe(true);
    expect(isSecretHeaderName('X-API-Token')).toBe(true);
    expect(isSecretHeaderName('X-Client-Secret')).toBe(true);
    expect(isSecretHeaderName('proxy-authorization')).toBe(true);
  });
  it('leaves unrelated headers alone', () => {
    expect(isSecretHeaderName('content-type')).toBe(false);
    expect(isSecretHeaderName('x-request-id')).toBe(false);
    expect(isSecretHeaderName('user-agent')).toBe(false);
  });
});

describe('redactHeaders', () => {
  it('returns {} for undefined', () => {
    expect(redactHeaders(undefined)).toEqual({});
  });
  it('redacts secrets but preserves harmless headers verbatim', () => {
    const out = redactHeaders({
      Authorization: 'Bearer sk-very-secret-123',
      'content-type': 'application/json',
      'x-api-key': 'ak_live_abc',
      'x-request-id': 'req-42',
    });
    expect(out.Authorization).toBe('***');
    expect(out['x-api-key']).toBe('***');
    expect(out['content-type']).toBe('application/json');
    expect(out['x-request-id']).toBe('req-42');
  });
});

describe('redactSecret', () => {
  it('replaces every occurrence of the literal secret', () => {
    expect(redactSecret('token=sk-123 and sk-123 again', 'sk-123')).toBe('token=*** and *** again');
  });
  it('leaves text untouched when the secret is undefined or too short', () => {
    expect(redactSecret('hello', undefined)).toBe('hello');
    expect(redactSecret('hello', 'ab')).toBe('hello');
  });
});
