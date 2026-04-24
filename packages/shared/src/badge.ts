/**
 * Shields.io-compatible SVG badge renderer for rubric.
 *
 * A pure function so the CLI, GitHub Action, and future hosted endpoint
 * (rubric.dev/badge/...) all produce identical bytes for the same
 * input. Colors track the three-state calibration story in the PR
 * comment: unverified, calibrated, weak.
 */
import type { CalibrationReport } from './calibrate.ts';
import { classifyVerdict } from './comment.ts';
import type { RunSummary } from './types.ts';

export interface BadgeInput {
  /** Absent when no run has completed yet → renders a "no runs yet" badge. */
  summary?: RunSummary;
  calibration?: CalibrationReport;
  /** Calibrated-but-weak threshold; default 0.8. */
  minAgreement?: number;
  /** Left-side label text. Default "rubric". */
  label?: string;
}

export interface BadgeColors {
  bg: string;
  /** Label side background; fixed to #555 for the Shields look. */
  labelBg: string;
}

const LABEL_BG = '#555';

function colorFor(input: BadgeInput): string {
  if (!input.summary) return '#9f9f9f';
  const verdict = classifyVerdict(input.summary);
  if (verdict === 'error') return '#e05d44'; // red
  if (verdict === 'regress') return '#e05d44';
  if (verdict === 'tie') return '#dfb317'; // yellow
  // verdict === 'pass'
  const min = input.minAgreement ?? 0.8;
  if (!input.calibration) return '#9f9f9f'; // unverified grey
  if (input.calibration.agreement < min) return '#dfb317'; // calibrated-but-weak
  return '#4c1'; // calibrated + passing
}

export function badgeMessage(input: BadgeInput): string {
  if (!input.summary) return 'no runs yet';
  const s = input.summary;
  const verdict = classifyVerdict(s);
  if (verdict === 'error') return `${s.errors} error${s.errors === 1 ? '' : 's'}`;
  if (verdict === 'tie') return 'tie';
  const decisive = s.wins + s.losses;
  const pct = decisive === 0 ? 0 : Math.round((s.wins / decisive) * 100);
  const suffix = input.calibration
    ? input.calibration.agreement < (input.minAgreement ?? 0.8)
      ? ' · weak'
      : ''
    : ' · unverified';
  if (verdict === 'regress') return `regress ${pct}% · ${s.wins}/${decisive}${suffix}`;
  return `${pct}% · ${s.wins}/${decisive}${suffix}`;
}

/**
 * Rough character width in a 11px Verdana-ish font. Shields uses full font
 * metrics; our approximation is within a few pixels for ASCII which is fine
 * for a static-width badge.
 */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/[A-Z]/.test(ch)) w += 7.5;
    else if (ch === ' ' || ch === '.' || ch === ',' || ch === ':' || ch === 'i' || ch === 'l' || ch === '·') w += 3.5;
    else if (/[0-9a-z%]/.test(ch)) w += 6.5;
    else w += 6;
  }
  return Math.ceil(w);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderBadgeSvg(input: BadgeInput): string {
  const label = xmlEscape(input.label ?? 'rubric');
  const message = xmlEscape(badgeMessage(input));
  const color = colorFor(input);

  const padding = 6;
  const labelWidth = textWidth(label) + padding * 2;
  const messageWidth = textWidth(message) + padding * 2;
  const totalWidth = labelWidth + messageWidth;
  const height = 20;
  const labelTextX = labelWidth / 2;
  const messageTextX = labelWidth + messageWidth / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" role="img" aria-label="${label}: ${message}">`,
    `<title>${label}: ${message}</title>`,
    `<linearGradient id="s" x2="0" y2="100%">`,
    `<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>`,
    `<stop offset="1" stop-opacity=".1"/>`,
    `</linearGradient>`,
    `<clipPath id="r"><rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelWidth}" height="${height}" fill="${LABEL_BG}"/>`,
    `<rect x="${labelWidth}" width="${messageWidth}" height="${height}" fill="${color}"/>`,
    `<rect width="${totalWidth}" height="${height}" fill="url(#s)"/>`,
    `</g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">`,
    `<text x="${labelTextX}" y="15" fill="#010101" fill-opacity=".3">${label}</text>`,
    `<text x="${labelTextX}" y="14">${label}</text>`,
    `<text x="${messageTextX}" y="15" fill="#010101" fill-opacity=".3">${message}</text>`,
    `<text x="${messageTextX}" y="14">${message}</text>`,
    `</g>`,
    `</svg>`,
  ].join('');
}
