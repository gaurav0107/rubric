# Changelog

All notable changes to rubric. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **`mode: "compare-models"` revived.** v2.2 removed it; early use showed the workaround (`{ baseline: "shared.md", candidate: "shared.md", models: [A, B] }`) gave the wrong fan-out — one cell per model per case instead of one A-vs-B cell per case — so the judge couldn't score "A vs B" directly. Revived with tighter semantics: `models` must have exactly 2 entries; `models[0]` is A, `models[1]` is B; `prompts.baseline` is the single prompt used for both sides; `prompts.candidate` is required by schema but ignored. `CellResult` gains an optional `modelB` field (present only in compare-models), surfaced in the JSON payload, cost CSV, HTML report, and PR comment. Cache keys already distinguished `modelA ≠ modelB`, so no cache bust.
- **`rubric run --fail-on-regress` in `compare-models`.** Answers "should we upgrade from `models[0]` to `models[1]`?" — exits 2 when B loses more than it wins (same semantics as compare-prompts).

### Changed

- **Migration banner no longer lists `compare-models` as removed.** v2.2 banner text shortened to match what actually shipped removed.

## [2.2.0] — 2026-04-27

Radical cut. v2.1 sprawled — calibrate, finetune, history, share, pull, failure clustering, steelman, multiple seed adapters, a second rubric type, a second mode, a second finetune provider. The internal-launch audit said none of that was load-bearing on the pairwise-eval wedge. v2.2 rips it all out and refocuses on the override log as the calibration corpus for v2.3.

### Removed

- **Commands.** `rubric finetune`, `rubric calibrate`, `rubric history`, `rubric share`, `rubric pull`. Migration stubs remain in `bin.ts` — running any of them prints `removed in v2.2 — see CHANGELOG` to stderr and exits 2.
- **Async run lifecycle.** `rubric run --detach`, `rubric runs wait`, `rubric runs resume`. The remaining `rubric runs <list|show|status|diff|rerun>` commands read the registry; they no longer drive background workers.
- **Flags.** `--badge-out` on `rubric run`. `--calibration` / `--min-agreement` on `rubric run` and `rubric comment`. Action inputs `calibration` and `min-agreement` are gone.
- **Rubric + mode.** `"model-comparison"` criteria and `"compare-models"` mode. To compare two models, point `baseline.md` and `candidate.md` at the same prompt file and list the two models in `models[]` — each one becomes its own cell in the grid.
- **Seed adapters.** `rubric seed --from-langfuse / --from-helicone / --from-langsmith / --from-openai-logs / --from-synthetic`. CSV is the only supported source — every tool in the stack can export CSV.
- **Evaluator types.** `cluster`, `steelman`. Declared but unused evaluators of these types warn-and-drop at config load so v2.1 configs don't throw.
- **Providers.** Together.ai adapter (was paired with finetune).
- **UI.** Failure clustering in the runs drawer. Steelman-my-prompt button. "Vary prompts | models" segmented control in the serve header.

### Added

- **`rubric disagree <cell-ref> --verdict A|B|tie [--reason] [--run] [--undo]`.** CLI for overriding the judge on one cell. Writes to `~/.rubric/runs/<id>/overrides.jsonl` (append-only). The PR comment footer lists overrides. This log is the calibration corpus — v2.3 will train a residual classifier on it to score the judge, not the outputs. In-UI override buttons in `rubric serve` are **not** shipped in v2.2 (the v2.1 per-side `+good / -bad` calibration widget was removed); wire from the CLI for now.
- **Migration banner.** First `rubric <anything>` on a machine that last ran a pre-2.2 CLI prints one stderr line listing the removed features + CHANGELOG pointer. Gated on `$RUBRIC_HOME/.last-cli-version`; fires at-most-once per upgrade.
- **Config back-compat warnings.** Legacy top-level keys (`finetunes`, `share`, `calibrate`, `cluster`) and legacy evaluator `type`s (`cluster`, `steelman`) now surface as `LoadedConfig.warnings` instead of throwing. CLI entry points (`run`, `watch`, `providers`, `disagree`, `serve`) print each warning to stderr so v2.1 configs load cleanly with a visible nudge toward cleanup.

### Changed

- **Documentation.** `README.md`, `docs/guide.md`, `action.yml`, and `examples/drift-detector.yml` rewritten against the v2.2 surface. TOC, command reference, rubric table, comparison-mode section, common recipes, and troubleshooting all reflect only what ships. `docs/design.md` and `docs/ceo-plan.md` marked superseded; read `TODOS.md` "v2.2 Radical Cut" and this entry for current scope.
- **TODOS.** "v2.2 Radical Cut" section added at the top; v2.3 calibration plan scaffolded.

### Migration

- **v2.1 configs load as-is.** Any of `finetunes`, `share`, `calibrate`, `cluster` at the top level → warn and drop. Any evaluator with `type: "cluster"` or `type: "steelman"` → warn and drop. No action required unless you want to silence the warnings.
- **Replace `rubric calibrate` with `rubric disagree`.** The workflow is the opposite shape: instead of a dedicated labeling session on a fixed set, you override verdicts whenever you notice the judge is wrong while using the tool. The log is the calibration corpus.
- **Replace `rubric finetune <*>` with your provider's native CLI.** OpenAI's `openai api fine_tuning.jobs.create` or Together's dashboard are the supported paths. Point `judge.model` / `models[]` at the trained model id via the existing `provider/model` routing.
- **Replace `rubric share` / `rubric pull` with `git`.** The workspace is already a repo's worth of files (config + prompts + dataset). Clone, branch, PR.
- **Replace `rubric history` with `git log`.** Prompts live on disk as `.md` files; git already tracks who changed them when. Use `git log -p prompts/`.
- **Replace `rubric run --detach` with your shell.** `rubric run ... &` or `nohup rubric run ...` or a CI runner. The registry at `~/.rubric/runs/` is written synchronously regardless, so `rubric runs status <id>` still works against a backgrounded run.
- **Replace `"compare-models"` mode with duplicated prompt paths.** `{ "prompts": { "baseline": "shared.md", "candidate": "shared.md" }, "models": ["A", "B"] }`. Both models run against the same prompt; the grid shows one cell per model.

### Notes

- Tests: 284 pass / 0 fail against the v2.2 surface. Typecheck clean (pre-existing TS5097 noise on `.ts` extension imports is unchanged).
- Smoke: `rubric quickstart` + `rubric run --mock --report` + `rubric serve --mock` all green.
- No config schema version bump — existing v1 schema still covers the shrunk surface.

## [2.1.0] — 2026-04-27

Visual redesign — `rubric serve` now looks like it belongs in a terminal. Zero functional changes, no API/config/data changes, no test suite changes.

### Changed

- **Hacker terminal theme for `rubric serve`.** Full CSS rewrite of the single-file UI at `packages/cli/src/server/ui.ts`. Palette collapsed to phosphor green (`#39ff14`) on near-black (`#030603`) with red for loss/error, amber for tie. Everything in monospace (`ui-monospace, JetBrains Mono, Fira Code, Menlo`), no sans-serif anywhere — the surface is meant to feel like a shell, not a dashboard. Zero border-radius on buttons, pills, and chips. Uppercase labels with `0.14em` letter-spacing. CRT scanline overlay (`body::before` repeating-linear-gradient with `mix-blend-mode: multiply`) plus a subtle 24×24 phosphor grid (`body::after`) masked to fade at the edges. Custom monospace scrollbars and block-character checkboxes.
- **Terminal-grammar labels.** Brand `>_ RUBRIC █` with a blinking cursor. Pane titles prefixed with `[ ` (bracket-open), case rows prefixed with `$ ` (shell dollar), empty states prefixed with `// `, error banner prefixed with `ERROR::`. Button text rewritten in shell idiom: `▶ Run` → `> run`, `📜 Runs` → `runs.log`, `Save (⌘S)` → `:w (⌘S)`, `✨ Steelman` → `steelman()`, drawer `Close` → `[esc]`, `Diff 2` → `diff <2>`. Placeholder values (`—`) standardized on dim-green `--`.
- **ASCII idle state.** Empty results pane now shows a block-character "RUBRIC" wordmark with `awaiting input █ · press > run to populate grid` plus a dim `// no runs yet · prompts and cases are ready` sub-hint. Replaces the previous one-line "Run an evaluation to populate the grid." dead zone.
- **Verdict color semantics tightened.** Win cells get a `0 0 6px rgba(57,255,20,0.45)` phosphor glow. Loss cells glow red. Tie cells glow amber. The summary row uses the same text-shadow values so the eye locks onto outcomes immediately.

### Notes

- Single file touched: `packages/cli/src/server/ui.ts` (+300 lines CSS, label/placeholder text edits). No logic changed. 360 tests pass. Typecheck unchanged (preexisting `allowImportingTsExtensions` issues in `@rubric/shared` are unrelated and persist on main).
- Verified via headless browser at 1440×900: idle state renders correctly, mock-mode sweep over 5 demo cases completes with correct verdict coloring (win=phosphor, loss=red, tie=amber, err=red).
- No dependency changes. No config or data migrations. Existing runs in `~/.rubric/runs` display identically in the redesigned runs drawer.

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
