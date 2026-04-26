# Changelog

All notable changes to rubric. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [2.0.2] — 2026-04-27

Critical hotfix — v2.0.1 shipped with a broken `rubric serve` UI.

### Fixed

- **Blank `rubric serve` UI.** Dropping `String.raw` in v2.0.1 (to fix the emoji rendering bug) also stripped the `\n` escapes inside two SSE-parsing lines (`buffered.indexOf('\n\n')` and `raw.split('\n')`). The resulting raw newline inside a single-quoted string made the entire `<script>` block a syntax error, so no event listeners were bound and no API calls fired — config path, prompts, and case list never populated. Served HTML was 200 OK with an empty shell. Fixed by re-escaping those two literals as `'\\n\\n'` / `'\\n'` so the template literal emits the intended `\n` escape into the served JS.
- Tests didn't catch this — the server test asserts response status and length, not that the embedded script parses in a browser. Added to the post-release checklist: curl + headless-browse smoke test before tagging.

### Notes

- No API, config, or data changes. Single-file edit to `packages/cli/src/server/ui.ts`.
- 360 tests green. Manual verification: `curl http://127.0.0.1:7333/` returns 200, config path populates, 5 demo cases render, no console errors.

## [2.0.1] — 2026-04-26

Hotfix for a shipped regression in the `rubric serve` UI plus polish for typography and mobile.

### Fixed

- **Broken emoji in `rubric serve` header.** `INDEX_HTML` was tagged with `String.raw`, and Bun's raw tag escapes non-ASCII source characters into literal `\u{…}` text. Every 📜 / ▶ / ✨ / ⌘ / em-dash rendered as six-to-eight ASCII characters in the served HTML. Dropped the tag — the template had zero backslashes and zero interpolations, so the tag was pure overhead plus the escape bug.
- **Default serif body font.** Added an explicit `ui-sans-serif, "Inter var", ...` stack with `font-feature-settings: "ss01", "cv11"`. Brand `rubric` promoted to 18px / 700 / -0.01em letter-spacing. Stat cells got `font-variant-numeric: tabular-nums` so numeric columns stop shimmying between runs.
- **Three-pane grid on mobile.** `@media (max-width: 768px)` now stacks panes vertically with `border-bottom` separators, wraps the header, breaks the stat summary into a 4-col grid, and widens the runs drawer to 100%.
- **Sub-44px touch targets on coarse pointers.** `@media (pointer: coarse)` enforces `min-height: 44px` on all header, tab, footer, and drawer buttons.

### Notes

- All fixes are CSS / single-file template changes in `packages/cli/src/server/ui.ts`. No logic touched. Tests green (360 pass / 0 fail).
- Full audit: `~/.gstack/projects/rubric/designs/design-audit-20260426/design-audit-localhost.md`.

## [2.0.0] — 2026-04-26

Second major release. Everything here ships today; the hosted cloud layer is deliberately deferred.

### Added

- **Runs drawer in `rubric serve`.** Header button (📜 Runs) opens a slide-in panel that browses, inspects, and diffs past runs from `~/.rubric/runs`. Two-up diff view shows Δ win-rate and counts side-by-side. Registry root is overridable via `--registry-root`.
- **Per-evaluator rows in HTML report + PR comment.** `renderReportHtml` and `renderPrComment` accept a `metrics` array and a `gateBreaches` array. Reports gain a dedicated metrics table with pass-rate / mean / n / side (A/B/A+B/mixed). Gate breaches get a red-bordered banner at the top and the offending row is tinted; threshold shown as `< <threshold>%`. PR comments get a collapsible `<details>` block plus a `> **Gate breached**` callout.
- **Together.ai fine-tune adapter.** `createTogetherFinetuneClient` implements the same `FinetuneClient` shape as OpenAI (upload → create → get → cancel). Routing is provider-prefix driven: `base: "together/…"` routes through Together, `openai/…` keeps the pre-2.0 behavior. Flat top-level `n_epochs` / `batch_size` / `learning_rate` match Together's API. `finetune eval` emits `together/<trained>` model ids so the existing `together/` provider takes over unchanged. Export `TOGETHER_API_KEY` instead of `OPENAI_API_KEY` for Together jobs.
- **Failure clustering in serve.** New `clusterFailures` in `@rubric/shared`: bag-of-keywords Jaccard clustering over losing-cell judge reasons, no embedding model required. Surfaces in the runs drawer under each run detail as a ranked list of cluster labels (e.g. `verbose · rambling · long`) with counts and sample reasons. Exposed as `GET /api/runs/<id>/clusters`.
- **`rubric run --verbose`.** Prints a provider diagnostics block (base URLs, key sources, redacted headers) before the sweep. Every secret-looking header (`auth|token|key|secret`) collapses to `***`; key *values* are never printed — only the env var name or the file path. Safe to paste into a GitHub issue.

### Changed

- `redactHeaders` hoisted out of `packages/cli/src/commands/providers.ts` into shared `packages/shared/src/redact.ts` so any future logging path routes through the same audited helper. New `redactSecret(text, secret)` complements it for scrubbing URLs/bodies that might embed tokens.
- README + `docs/guide.md` Workflow G updated to document Together.ai parity.

### Fixed

- Template-literal backtick collision in `packages/cli/src/server/ui.ts` that was breaking the CLI typecheck since the runs-drawer commit.

### Not in this release

- Hosted cloud layer (`packages/web`) stays behind the v2.0 line — no Cloudflare Workers / D1 / R2 deploy is part of this release. Explicitly deferred; every other v1.3-polish item ships.

## [1.2.0] — earlier

See commit history up to `689177c` for the v1.2 surface: evaluator catalog, runs registry, async `--detach` + `runs wait` / `runs resume`, and finetune orchestration.

## [1.1.0] — earlier

Named providers, `rubric quickstart`, `rubric init --wizard`, `--from-csv` seeding.

## [1.0.0] — earlier

Initial public release under the `rubric` name (previously `diffprompt`).
