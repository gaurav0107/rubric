import { describe, expect, test } from 'bun:test';
import { renderReportHtml } from './report.ts';
import type { Case, CellResult, Config, ModelId, RunSummary } from './types.ts';

const config: Config = {
  prompts: { baseline: 'a.md', candidate: 'b.md' },
  dataset: 'd.jsonl',
  models: ['mock/m1' as ModelId],
  judge: { model: 'mock/judge' as ModelId, criteria: 'default' },
  mode: 'compare-prompts',
};

const cases: Case[] = [
  { input: 'What is 2+2?', expected: '4' },
  { input: 'Escape test: <script>alert(1)</script>' },
];

const cells: CellResult[] = [
  {
    caseIndex: 0,
    model: 'mock/m1' as ModelId,
    outputA: 'four',
    outputB: '4',
    judge: { winner: 'b', reason: 'more concise' },
    latencyMs: 12,
  },
  {
    caseIndex: 1,
    model: 'mock/m1' as ModelId,
    outputA: '<b>bold</b>',
    outputB: '',
    judge: { error: 'provider down' },
    latencyMs: 5,
  },
];

const summary: RunSummary = { wins: 1, losses: 0, ties: 0, errors: 1, winRate: 1 };

describe('renderReportHtml', () => {
  test('produces a well-formed HTML document', () => {
    const html = renderReportHtml({
      config,
      cases,
      cells,
      summary,
      generatedAt: new Date('2026-04-23T12:00:00Z'),
    });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>rubric report</title>');
    expect(html).toContain('2026-04-23T12:00:00');
  });

  test('escapes HTML in inputs and outputs', () => {
    const html = renderReportHtml({ config, cases, cells, summary });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  test('renders verdict styling classes and handles errors', () => {
    const html = renderReportHtml({ config, cases, cells, summary });
    expect(html).toContain('verdict-b');
    expect(html).toContain('judge-err');
    expect(html).toContain('more concise');
    expect(html).toContain('provider down');
  });

  test('includes summary tiles', () => {
    const html = renderReportHtml({ config, cases, cells, summary });
    expect(html).toContain('>1<');
    expect(html).toContain('wins');
    expect(html).toContain('errors');
  });
});
