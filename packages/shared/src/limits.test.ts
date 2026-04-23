import { describe, expect, test } from 'bun:test';
import { validateRunInputs } from './limits.ts';
import type { Case } from './types.ts';

const basicCases: Case[] = [{ input: 'hi' }, { input: 'bye' }];

describe('validateRunInputs', () => {
  test('passes cleanly with no limits set', () => {
    const r = validateRunInputs({
      prompts: { baseline: 'short', candidate: 'also short' },
      cases: basicCases,
      limits: {},
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  test('errors on prompt over cap (reports which side)', () => {
    const r = validateRunInputs({
      prompts: { baseline: 'a'.repeat(101), candidate: 'ok' },
      cases: basicCases,
      limits: { maxPromptChars: 100 },
    });
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]!.code).toBe('prompt-too-long');
    expect(r.errors[0]!.message).toMatch(/baseline.*101.*100/);
  });

  test('errors on dataset over cap', () => {
    const r = validateRunInputs({
      prompts: { baseline: 'a', candidate: 'b' },
      cases: [{ input: '1' }, { input: '2' }, { input: '3' }],
      limits: { maxCases: 2 },
    });
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]!.code).toBe('dataset-too-large');
    expect(r.errors[0]!.message).toMatch(/3 cases.*cap of 2/);
  });

  test('emits PII warnings but no errors when scanPii is set', () => {
    const r = validateRunInputs({
      prompts: { baseline: 'a', candidate: 'b' },
      cases: [{ input: 'my SSN is 123-45-6789' }, { input: 'harmless' }],
      limits: { scanPii: true },
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]!.code).toBe('pii-detected');
    expect(r.warnings[0]!.message).toMatch(/case 0 input/);
  });

  test('PII scan also checks case.expected', () => {
    const r = validateRunInputs({
      prompts: { baseline: 'a', candidate: 'b' },
      cases: [{ input: 'ok', expected: 'email: alice@example.com' }],
      limits: { scanPii: true },
    });
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]!.message).toMatch(/case 0 expected/);
  });

  test('accumulates multiple errors and warnings independently', () => {
    const r = validateRunInputs({
      prompts: { baseline: 'a'.repeat(101), candidate: 'b'.repeat(101) },
      cases: [{ input: 'ssn 123-45-6789' }, { input: '2' }, { input: '3' }],
      limits: { maxPromptChars: 100, maxCases: 2, scanPii: true },
    });
    expect(r.errors.length).toBe(3); // both sides too long + too many cases
    expect(r.warnings.length).toBe(1);
  });
});
