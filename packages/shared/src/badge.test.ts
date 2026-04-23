import { describe, expect, test } from 'bun:test';
import { badgeMessage, renderBadgeSvg, type BadgeInput } from './badge.ts';
import type { CalibrationReport } from './calibrate.ts';
import type { RunSummary } from './types.ts';

function summary(partial: Partial<RunSummary> = {}): RunSummary {
  return {
    wins: 0,
    losses: 0,
    ties: 0,
    errors: 0,
    winRate: 0,
    ...partial,
  };
}

function calibrated(agreement: number): CalibrationReport {
  return {
    total: 10,
    agreements: Math.round(agreement * 10),
    disagreements: 10 - Math.round(agreement * 10),
    errors: 0,
    agreement,
    matrix: {
      humanPositiveJudgePositive: 0,
      humanPositiveJudgeNegative: 0,
      humanNegativeJudgePositive: 0,
      humanNegativeJudgeNegative: 0,
    },
    results: [],
  };
}

describe('badgeMessage', () => {
  test('no run ever → "no runs yet"', () => {
    expect(badgeMessage({})).toBe('no runs yet');
  });

  test('pass + unverified → percentage with unverified tag', () => {
    expect(badgeMessage({ summary: summary({ wins: 3, losses: 1, winRate: 0.75 }) }))
      .toBe('75% · 3/4 · unverified');
  });

  test('pass + calibrated, above threshold → clean percentage', () => {
    expect(
      badgeMessage({
        summary: summary({ wins: 3, losses: 1, winRate: 0.75 }),
        calibration: calibrated(0.9),
      }),
    ).toBe('75% · 3/4');
  });

  test('pass + calibrated but weak → "weak" suffix', () => {
    expect(
      badgeMessage({
        summary: summary({ wins: 3, losses: 1, winRate: 0.75 }),
        calibration: calibrated(0.6),
      }),
    ).toBe('75% · 3/4 · weak');
  });

  test('regress → "regress" prefix', () => {
    expect(badgeMessage({ summary: summary({ wins: 1, losses: 3, winRate: 0.25 }) }))
      .toBe('regress 25% · 1/4 · unverified');
  });

  test('error-only run → error count', () => {
    expect(badgeMessage({ summary: summary({ errors: 2 }) })).toBe('2 errors');
  });

  test('singular error', () => {
    expect(badgeMessage({ summary: summary({ errors: 1 }) })).toBe('1 error');
  });

  test('tie (zero decisive) → "tie"', () => {
    expect(badgeMessage({ summary: summary({ ties: 2 }) })).toBe('tie');
  });
});

describe('renderBadgeSvg', () => {
  function extractColors(svg: string): string[] {
    return [...svg.matchAll(/fill="(#[0-9a-fA-F]+)"/g)].map((m) => m[1]!);
  }

  test('produces a self-contained SVG with correct xmlns', () => {
    const svg = renderBadgeSvg({ summary: summary({ wins: 3, losses: 1, winRate: 0.75 }) });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.includes('xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  test('green message background when calibrated + passing', () => {
    const svg = renderBadgeSvg({
      summary: summary({ wins: 3, losses: 1, winRate: 0.75 }),
      calibration: calibrated(0.9),
    });
    expect(extractColors(svg).includes('#4c1')).toBe(true);
  });

  test('grey when unverified', () => {
    const svg = renderBadgeSvg({ summary: summary({ wins: 3, losses: 1, winRate: 0.75 }) });
    expect(extractColors(svg).includes('#9f9f9f')).toBe(true);
  });

  test('yellow when calibrated-but-weak', () => {
    const svg = renderBadgeSvg({
      summary: summary({ wins: 3, losses: 1, winRate: 0.75 }),
      calibration: calibrated(0.6),
    });
    expect(extractColors(svg).includes('#dfb317')).toBe(true);
  });

  test('red when regression or errors', () => {
    const regressSvg = renderBadgeSvg({ summary: summary({ wins: 1, losses: 3, winRate: 0.25 }) });
    expect(extractColors(regressSvg).includes('#e05d44')).toBe(true);

    const errSvg = renderBadgeSvg({ summary: summary({ errors: 5 }) });
    expect(extractColors(errSvg).includes('#e05d44')).toBe(true);
  });

  test('xml-escapes user-supplied label', () => {
    const svg = renderBadgeSvg({ label: 'bad<script>', summary: summary() });
    expect(svg.includes('<script>')).toBe(false);
    expect(svg.includes('bad&lt;script&gt;')).toBe(true);
  });

  test('"no runs yet" path renders grey', () => {
    const svg = renderBadgeSvg({});
    expect(svg.includes('no runs yet')).toBe(true);
    expect(extractColors(svg).includes('#9f9f9f')).toBe(true);
  });
});
