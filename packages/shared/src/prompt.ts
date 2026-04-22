import type { Case } from './types.ts';

export class PromptRenderError extends Error {
  constructor(message: string, public readonly variable: string) {
    super(message);
    this.name = 'PromptRenderError';
  }
}

export interface RenderOptions {
  /**
   * What to do when a template references a variable that isn't present.
   * - 'throw' (default): fail with PromptRenderError.
   * - 'empty': substitute an empty string.
   * - 'keep': leave the original {{token}} in place.
   */
  onMissing?: 'throw' | 'empty' | 'keep';
}

const TOKEN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

function lookup(path: string, ctx: Record<string, unknown>): unknown {
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Render a prompt template against a case. Supports {{input}}, {{expected}},
 * and dotted metadata paths like {{metadata.tag}} or {{metadata.langfuse.output}}.
 */
export function renderPrompt(template: string, c: Case, opts: RenderOptions = {}): string {
  const onMissing = opts.onMissing ?? 'throw';
  const ctx: Record<string, unknown> = {
    input: c.input,
    expected: c.expected,
    metadata: c.metadata ?? {},
  };

  return template.replace(TOKEN, (match, rawKey: string) => {
    const key = rawKey as string;
    const value = lookup(key, ctx);
    if (value === undefined) {
      if (onMissing === 'throw') {
        throw new PromptRenderError(`template references missing variable "{{${key}}}"`, key);
      }
      if (onMissing === 'keep') return match;
      return '';
    }
    return stringify(value);
  });
}

/**
 * Returns the set of variable names a template references.
 */
export function listTemplateVars(template: string): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(TOKEN)) {
    if (m[1]) seen.add(m[1]);
  }
  return [...seen];
}
