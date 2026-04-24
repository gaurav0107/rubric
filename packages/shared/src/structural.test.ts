import { describe, expect, test } from 'bun:test';
import { createStructuralJudge, structuralVerdict } from './structural.ts';

describe('structuralVerdict', () => {
  test('picks A when only A matches expected', () => {
    const v = structuralVerdict({
      caseInput: 'irrelevant',
      expected: '{"tool":"search","query":"cats"}',
      outputA: '{"tool":"search","query":"cats"}',
      outputB: '{"tool":"search","query":"dogs"}',
      criteria: 'structural-json',
    });
    expect(v.winner).toBe('a');
  });

  test('picks B when only B matches expected', () => {
    const v = structuralVerdict({
      caseInput: 'x',
      expected: '[1,2,3]',
      outputA: '[3,2,1]',
      outputB: '[1,2,3]',
      criteria: 'structural-json',
    });
    expect(v.winner).toBe('b');
  });

  test('tie when both match expected', () => {
    const v = structuralVerdict({
      caseInput: 'x',
      expected: '{"a":1}',
      outputA: '{"a":1}',
      outputB: ' {"a": 1}\n',
      criteria: 'structural-json',
    });
    expect(v.winner).toBe('tie');
    expect(v.reason).toMatch(/both/i);
  });

  test('tolerates ```json fences', () => {
    const v = structuralVerdict({
      caseInput: 'x',
      expected: '{"ok":true}',
      outputA: '```json\n{"ok":true}\n```',
      outputB: 'nope not json',
      criteria: 'structural-json',
    });
    expect(v.winner).toBe('a');
  });

  test('key order is ignored for object equality', () => {
    const v = structuralVerdict({
      caseInput: 'x',
      expected: '{"a":1,"b":2}',
      outputA: '{"b":2,"a":1}',
      outputB: '{"a":1}',
      criteria: 'structural-json',
    });
    expect(v.winner).toBe('a');
  });

  test('without expected: rewards the side that parses as JSON', () => {
    const v = structuralVerdict({
      caseInput: 'x',
      outputA: '{"valid":true}',
      outputB: 'hey I am prose',
      criteria: 'structural-json',
    });
    expect(v.winner).toBe('a');
  });

  test('both-unparseable → tie', () => {
    const v = structuralVerdict({
      caseInput: 'x',
      outputA: 'nope',
      outputB: 'also nope',
      criteria: 'structural-json',
    });
    expect(v.winner).toBe('tie');
  });

  test('neither matches expected but both parse → tie', () => {
    const v = structuralVerdict({
      caseInput: 'x',
      expected: '{"gold":1}',
      outputA: '{"gold":2}',
      outputB: '{"silver":1}',
      criteria: 'structural-json',
    });
    expect(v.winner).toBe('tie');
  });
});

describe('createStructuralJudge', () => {
  test('name is structural-judge', () => {
    const j = createStructuralJudge();
    expect(j.name).toBe('structural-judge');
  });

  test('judge() returns a synchronous-style verdict', async () => {
    const j = createStructuralJudge();
    const v = await j.judge({
      caseInput: 'x',
      expected: '{"a":1}',
      outputA: '{"a":1}',
      outputB: '{"a":2}',
      criteria: 'structural-json',
    });
    expect(v.winner).toBe('a');
  });
});
