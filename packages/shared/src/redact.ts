/**
 * Redaction helpers shared between `rubric run --verbose`, `rubric providers
 * test`, and any other place we echo provider config. The rule: *any* header
 * whose name matches `/auth|token|key|secret/i` becomes `***`, full stop. No
 * opt-in list, no substring heuristics on values — the header name is the
 * signal.
 *
 * We deliberately keep this helper tiny and pure so it's trivial to audit.
 * Leaking a bearer token via `--verbose` is exactly the failure mode this
 * whole module exists to prevent; any future logging path that shows request
 * headers MUST route through here.
 */

const SECRET_HEADER_RE = /auth|token|key|secret/i;

export function isSecretHeaderName(name: string): boolean {
  return SECRET_HEADER_RE.test(name);
}

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSecretHeaderName(k) ? '***' : v;
  }
  return out;
}

/**
 * Redact a known-sensitive string anywhere it appears in text. Useful for
 * scrubbing URLs/bodies that might have embedded tokens (e.g. a provider
 * that accepts `?api_key=...` in the query string). Callers must pass the
 * actual secret so we can do literal substring replacement — we do NOT
 * attempt pattern-based detection here because false positives would be
 * worse than silently leaking a non-matching string.
 */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join('***');
}
