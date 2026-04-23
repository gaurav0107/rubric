/**
 * Lightweight PII detector. Warning-only — we surface findings to nudge the
 * user before they ship a Langfuse dump into a public repo, but we do not
 * mutate or block. Conservative by design: false negatives are cheaper than
 * false positives that spam the console and train users to ignore warnings.
 *
 * Heuristics (not a compliance tool):
 *  - emails: standard shape
 *  - phone: 10–15 digit runs with common separators, plus leading + optional
 *  - ssn: US XXX-XX-XXXX
 *  - credit-card-ish: 13–19 digit runs that pass the Luhn check
 *  - provider keys: sk-*, sk-ant-*, xai-*, AIza* (Google), ghp_/gho_/ghs_/ghr_ (GitHub)
 */

export type PiiKind = 'email' | 'phone' | 'ssn' | 'credit-card' | 'provider-key';

export interface PiiFinding {
  kind: PiiKind;
  /** The matched substring. Caller may want to redact this for logging. */
  match: string;
  /** 0-based index in the source text. */
  index: number;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Conservative phone: optional +, then 10–15 digits allowing spaces, dots, dashes, parens.
// We anchor on a digit run length rather than locale rules.
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/g;

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

// Luhn candidate: 13–19 digit runs separated by spaces or dashes.
const CC_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

const PROVIDER_KEY_RES: Array<{ kind: PiiKind; re: RegExp }> = [
  { kind: 'provider-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'provider-key', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { kind: 'provider-key', re: /\bxai-[A-Za-z0-9]{20,}\b/g },
  { kind: 'provider-key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { kind: 'provider-key', re: /\bgh[pours]_[A-Za-z0-9]{30,}\b/g },
];

function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function pushMatches(text: string, re: RegExp, kind: PiiKind, out: PiiFinding[]): void {
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    out.push({ kind, match: m[0], index: m.index });
  }
}

export function detectPii(text: string): PiiFinding[] {
  if (text.length === 0) return [];
  const findings: PiiFinding[] = [];

  pushMatches(text, EMAIL_RE, 'email', findings);
  pushMatches(text, SSN_RE, 'ssn', findings);
  for (const { kind, re } of PROVIDER_KEY_RES) pushMatches(text, re, kind, findings);

  // Credit cards must pass Luhn to qualify — reduces false positives on order
  // numbers and timestamps.
  for (const m of text.matchAll(CC_RE)) {
    if (m.index === undefined) continue;
    const digits = m[0].replace(/[^\d]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
      findings.push({ kind: 'credit-card', match: m[0], index: m.index });
    }
  }

  // Phone: skip if this substring is already flagged as CC/SSN/provider-key, to
  // avoid double-reporting digit runs.
  const taken: Array<[number, number]> = findings
    .filter((f) => f.kind === 'credit-card' || f.kind === 'ssn' || f.kind === 'provider-key')
    .map((f) => [f.index, f.index + f.match.length]);
  for (const m of text.matchAll(PHONE_RE)) {
    if (m.index === undefined) continue;
    const start = m.index;
    const end = start + m[0].length;
    const overlaps = taken.some(([s, e]) => start < e && end > s);
    if (overlaps) continue;
    const digits = m[0].replace(/[^\d]/g, '');
    if (digits.length < 10 || digits.length > 15) continue;
    findings.push({ kind: 'phone', match: m[0], index: start });
  }

  findings.sort((a, b) => a.index - b.index);
  return findings;
}

/** One-liner suitable for CLI stderr. */
export function summarizePiiFindings(findings: PiiFinding[]): string {
  if (findings.length === 0) return '';
  const byKind = new Map<PiiKind, number>();
  for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  const parts = [...byKind.entries()].map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`);
  return parts.join(', ');
}
