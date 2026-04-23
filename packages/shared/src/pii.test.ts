import { describe, expect, test } from 'bun:test';
import { detectPii, summarizePiiFindings } from './pii.ts';

describe('detectPii', () => {
  test('empty text returns no findings', () => {
    expect(detectPii('')).toEqual([]);
  });

  test('flags an email address', () => {
    const f = detectPii('contact: jane.doe+ticket@example.co.uk please');
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('email');
    expect(f[0]!.match).toBe('jane.doe+ticket@example.co.uk');
  });

  test('flags an SSN', () => {
    const f = detectPii('dob 1990 ssn 123-45-6789');
    const ssn = f.find((x) => x.kind === 'ssn');
    expect(ssn?.match).toBe('123-45-6789');
  });

  test('flags a Luhn-valid credit card number', () => {
    // 4539 1488 0343 6467 is a standard test CC that passes Luhn.
    const f = detectPii('card 4539 1488 0343 6467 expires soon');
    const cc = f.find((x) => x.kind === 'credit-card');
    expect(cc?.match).toBe('4539 1488 0343 6467');
  });

  test('does not flag Luhn-invalid digit runs as credit cards', () => {
    // 1234 5678 9012 3456 sums to 64 under Luhn — not a valid card.
    const f = detectPii('order 1234 5678 9012 3456 was placed');
    expect(f.find((x) => x.kind === 'credit-card')).toBeUndefined();
  });

  test('flags a phone number', () => {
    const f = detectPii('call +1 (415) 555-0132 after 9am');
    const phone = f.find((x) => x.kind === 'phone');
    expect(phone).toBeDefined();
  });

  test('does not double-count: a CC match suppresses overlapping phone match', () => {
    const f = detectPii('card 4539 1488 0343 6467');
    const phones = f.filter((x) => x.kind === 'phone');
    const ccs = f.filter((x) => x.kind === 'credit-card');
    expect(ccs).toHaveLength(1);
    expect(phones).toHaveLength(0);
  });

  test('flags provider keys', () => {
    const f = detectPii('OPENAI_KEY=sk-abcdefghijklmnopqrstuvwx AND gh_token=ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    const keys = f.filter((x) => x.kind === 'provider-key');
    expect(keys.length).toBeGreaterThanOrEqual(2);
  });

  test('findings are sorted by source index', () => {
    const f = detectPii('Last: secret sk-abcdefghijklmnopqrstuvwx — first: a@b.co');
    const indices = f.map((x) => x.index);
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });
});

describe('summarizePiiFindings', () => {
  test('empty → empty string', () => {
    expect(summarizePiiFindings([])).toBe('');
  });

  test('groups by kind with correct pluralization', () => {
    const line = summarizePiiFindings([
      { kind: 'email', match: '', index: 0 },
      { kind: 'email', match: '', index: 1 },
      { kind: 'phone', match: '', index: 2 },
    ]);
    expect(line).toBe('2 emails, 1 phone');
  });
});
