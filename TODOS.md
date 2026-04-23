# diffprompt — TODOS

Tracked work items from CEO plan `ceo-plans/2026-04-21-diffprompt.md` and design doc `gdubey-main-design-20260420-235114.md`.

## v1 Launch Gate (blocks ship)

- [ ] Tech-stack spike (~half day, Week 1): Workers + Durable Objects eval runner with real workload. Fallback: Fly.io VPS for eval layer.
- [x] Monorepo scaffold: `packages/cli`, `packages/web`, `packages/action`, `packages/shared`.
- [x] `packages/shared` eval engine with semver contract.
- [ ] `diffprompt init`, `serve`, `run`, `share`, `pull`, **`calibrate`**, **`seed --from-langfuse`** CLI commands. *(init, serve, run, calibrate, seed, comment landed; share/pull pending)*
- [x] Langfuse JSONL parser + stratified sampler + feedback→label mapping. PII-scrub warnings on import.
- [x] Comparison-mode toggle in `serve` UI: "Vary [prompts | models]." Reuses existing grid + judge plumbing.
- [x] `diffprompt serve` three-pane live-diff UI.
- [x] Launch dataset: 50 support tickets, 10 hand-audited, `examples/support-tickets.jsonl`.
- [ ] Hosted `diffprompt.dev` anonymous sandbox.
- [ ] Shareable URLs + **Remix-in-browser (primary)** + **Fork-to-local (secondary)**.
- [ ] GitHub OAuth for persistent URLs.
- [ ] GitHub App `diffprompt-action`: webhook, comment rendering, direct-URL install. *(composite action landed; direct-URL install + hosted webhook pending)*
- [ ] README badge SVG endpoint (60s cache, SWR). *(self-hostable SVG via `diffprompt run --badge-out` shipped; hosted endpoint pending)*
- [x] `diffprompt calibrate` CLI + in-UI labeling flow + `_calibration.json` read/write.
- [x] Calibration-aware PR-bot comment + badge (unverified vs calibrated states).
- [x] `run --fail-on-regress` CLI flag.
- [ ] Abuse & Cost Containment: provider-TOS review, $50/day cap, per-IP rate limits, 4k-char prompt cap, 20-case dataset cap, OpenAI moderation endpoint, PII nudge, kill switch, budget alerting.
- [ ] BYOK fallback mode (localStorage-only keys) shipped as feature flag.
- [ ] Legal pages: TOS, privacy policy, DMCA (Vercel + Plausible templates).
- [ ] Observability: Sentry + spend dashboard.
- [ ] Name availability check: `diffprompt.dev` domain, `diffprompt` npm package, `diffprompt` GitHub org. Fallbacks: `promptcmp`, `diffprompt`, `prompteval`.
- [ ] Launch gif recorded on curated dataset.
- [ ] HN / X / Reddit posts drafted.

## Week-6 Polish (cuttable to v1.1 if slipping)

- [ ] Steelman-my-prompt button (hosted + local).
- [ ] Why-failed drawer with micro-steelman.
- [ ] Cost tracker: post-run totals, status-bar rollup.

## v1.1 (1-2 weeks after v1)

- [ ] Drift detector: monthly cron, GitHub-issue-only notification (email + Slack → v1.2).
  - Framed as best-effort, not SLA.
  - Reuses v1 model-comparison mode — cron just schedules it.
- [ ] Import adapters: Helicone, LangSmith, OpenAI chat-completion logs. Same pattern as Langfuse adapter.
- [ ] CSV export from cost tracker.
- [ ] Hand-audit launch dataset from 10 → 50 samples.
- [ ] Calibrate remix-rate threshold based on first-week data.

## v2 (~6 weeks post v1)

- [ ] Dataset bootstrapping: `--from-logs`, `--synthetic`.
- [ ] Single-file binary via `bun build --compile`.
- [ ] Homebrew tap.
- [ ] VS Code extension.
- [ ] Team preset / shared rubric file.
- [ ] Prompt history scrubber (git-log visualization).
- [ ] Tool-call / structured-output comparison.
- [ ] Provider parity testing for Groq / OpenRouter / Ollama.
- [ ] GitHub Marketplace listing (started Week 4, review 2-4 weeks wall clock).

## Risks tracked

- Promptfoo could ship a diff-view in a weekend — mitigation: integrated calibrated-judge + PR-bot + remix loop, not diff alone.
- Provider TOS may disallow anonymous demo keys — mitigation: BYOK-only fallback mode shipped in v1 as feature flag.
- DO eval-runner may not scale to paid-tier free quota for a 50×3 sweep — mitigation: Week-1 spike validates; Fly.io fallback.
- Judge calibration on 50+ pairs may itself be the step users skip — mitigation: in-UI flow ≤5 min, unverified public surface degrades gracefully.

## Kill criteria (at 4 weeks post-launch)

If ALL true: <100 GitHub stars AND <10 PR-bot installs AND no public "caught a regression" mentions → pause v1.1 feature work, debrief 5 non-adopters, decide: push / sunset / pivot.
