import { detectPii, type PiiFinding } from './pii.ts';
import type { Case } from './types.ts';

/**
 * Input-size + PII guardrails for `rubric run`.
 *
 * Local CLI defaults are permissive (undefined caps + soft PII warnings) —
 * the hosted sandbox, when it ships, will pass strict caps matching the v1
 * abuse & cost containment budget (4k char / 20 cases). Keeping the function
 * pure and cwd-free makes it trivial to reuse from both surfaces.
 */

export interface RunLimits {
  /** Max characters for each of baseline/candidate prompt. Undefined = no cap. */
  maxPromptChars?: number;
  /** Max cases in the dataset. Undefined = no cap. */
  maxCases?: number;
  /** Scan `case.input` + `case.expected` for PII and emit a warning per hit. */
  scanPii?: boolean;
}

export interface RunLimitIssue {
  kind: 'error' | 'warning';
  code: 'prompt-too-long' | 'dataset-too-large' | 'pii-detected';
  message: string;
}

export interface ValidateRunInputsArgs {
  prompts: { baseline: string; candidate: string };
  cases: Case[];
  limits: RunLimits;
}

export interface ValidateRunInputsResult {
  errors: RunLimitIssue[];
  warnings: RunLimitIssue[];
}

function piiSummary(findings: PiiFinding[]): string {
  const kinds = new Set(findings.map((f) => f.kind));
  return Array.from(kinds).join(', ');
}

export function validateRunInputs(args: ValidateRunInputsArgs): ValidateRunInputsResult {
  const { prompts, cases, limits } = args;
  const errors: RunLimitIssue[] = [];
  const warnings: RunLimitIssue[] = [];

  if (typeof limits.maxPromptChars === 'number') {
    for (const side of ['baseline', 'candidate'] as const) {
      const len = prompts[side].length;
      if (len > limits.maxPromptChars) {
        errors.push({
          kind: 'error',
          code: 'prompt-too-long',
          message: `${side} prompt is ${len} chars, exceeds cap of ${limits.maxPromptChars}`,
        });
      }
    }
  }

  if (typeof limits.maxCases === 'number' && cases.length > limits.maxCases) {
    errors.push({
      kind: 'error',
      code: 'dataset-too-large',
      message: `dataset has ${cases.length} cases, exceeds cap of ${limits.maxCases}`,
    });
  }

  if (limits.scanPii) {
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]!;
      const inputFindings = detectPii(c.input);
      if (inputFindings.length > 0) {
        warnings.push({
          kind: 'warning',
          code: 'pii-detected',
          message: `case ${i} input may contain PII: ${piiSummary(inputFindings)}`,
        });
      }
      if (c.expected) {
        const expectedFindings = detectPii(c.expected);
        if (expectedFindings.length > 0) {
          warnings.push({
            kind: 'warning',
            code: 'pii-detected',
            message: `case ${i} expected may contain PII: ${piiSummary(expectedFindings)}`,
          });
        }
      }
    }
  }

  return { errors, warnings };
}
