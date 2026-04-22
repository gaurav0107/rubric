# diffprompt

Pairwise prompt evaluation framework. Compare v1 vs v2 side-by-side across multiple models with a calibrated LLM-as-judge.

**Status:** Pre-alpha. Plan docs live under `docs/`. No code yet.

## What it does (planned v1)

- `diffprompt init` — scaffold `./prompts/`, `./cases.jsonl`, `./diffprompt.config.ts`.
- `diffprompt serve` — localhost UI, edit two prompts, click Run, stream side-by-side diff across your dataset × models.
- `diffprompt run` — headless eval for CI. Exits non-zero on regression with `--fail-on-regress`.
- `diffprompt calibrate` — label 50+ pairs, get judge-vs-human agreement rate. Public surfaces (PR bot, README badge) degrade gracefully when uncalibrated.
- `diffprompt seed --from-langfuse <export>` — seed calibration + test set from Langfuse feedback exports.
- Compare-prompts OR compare-models mode. Same grid, different axis.

## Planning artifacts

- [`docs/design.md`](docs/design.md) — Builder-mode design doc. Approach C (local server + live diff playground). APPROVED.
- [`docs/ceo-plan.md`](docs/ceo-plan.md) — CEO review in SCOPE EXPANSION mode. v1 = 6-week ship plan with launch gate, week-6 polish, v1.1, and kill criteria.
- [`TODOS.md`](TODOS.md) — live launch-gate checklist.

## Status

- [x] Name locked: `diffprompt` (npm / diffprompt.dev / github.com/diffprompt all free as of 2026-04-22).
- [ ] Provider-TOS review (OpenAI / Anthropic / Google on anonymous demo keys).
- [ ] Week-1 spike: Cloudflare Workers + Durable Objects eval runner with real 50×3 workload. Fly.io VPS fallback.
- [ ] Monorepo scaffold: `packages/{cli,web,action,shared}`.

## License

MIT (see `LICENSE`).
