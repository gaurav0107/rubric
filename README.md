# rubric

Pairwise prompt evaluation for pull requests. Compare `baseline.md` vs `candidate.md` across your dataset × models with a calibrated LLM-as-judge, and fail CI when the new prompt regresses.

**Status:** Pre-alpha. The CLI (`init`, `serve`, `run`, `seed`, `calibrate`, `comment`, `share`, `pull`) and the GitHub Action wrapper are landed and exercised against mock and live providers (OpenAI, Groq, OpenRouter, Ollama — all OpenAI-compatible). Hosted web UI and the `rubric.dev` sandbox are not built yet — see [`TODOS.md`](TODOS.md).

## Why

Prompt changes ship with almost no safety net. "Looks better" usually means "I tried three examples." rubric runs a pairwise comparison on a real dataset, asks a judge model which response is better per case, and rolls the outcome into a win/loss summary you can gate CI on — with a *calibration* step that measures how much to trust the judge before anyone acts on its verdict.

## Quickstart

```bash
npm install -g rubric    # not published yet — use `npm link` from packages/cli for now
# or download the single-file binary for your platform from a GitHub release:
#   rubric-{linux,darwin,windows}-{x64,arm64}

rubric init              # scaffolds rubric.config.json, prompts/, data/cases.jsonl
# edit prompts/baseline.md and prompts/candidate.md
export OPENAI_API_KEY=sk-...
rubric run               # runs the eval; prints win/loss/tie summary

# or, iterate with a live-diff three-pane UI:
rubric serve             # http://127.0.0.1:5174 — edit prompts, re-run, label pairs
```

`rubric run` exits `0` on pass, `1` on judge errors, and — with `--fail-on-regress` — `2` when the candidate loses more cells than it wins. That's the CI gate.

## Typical CI invocation

```bash
rubric run \
  --config rubric.config.json \
  --fail-on-regress \
  --json-out rubric-run.json \
  --report rubric-report.html \
  --badge-out rubric.svg \
  --calibration rubric-cal.json    # optional; colors the badge
```

Outputs:

- `rubric-run.json` — machine-readable run payload (v1 schema). Feed to `rubric comment`.
- `rubric-report.html` — self-contained per-cell HTML report. Upload as a CI artifact or host it.
- `rubric.svg` — Shields-style status badge. Commit it to your repo and reference from the README.

## Calibration (measure the judge before trusting it)

The judge is just another LLM. Before gating anything on its verdict, sample 10–50 pairs, hand-label the winner, and measure agreement:

```bash
rubric seed --from-langfuse langfuse-export.jsonl   # optional: seed from production logs
# hand-edit prompts/_calibration.json.local to add {"winner": "A"|"B"|"tie"} per case
rubric calibrate --json-out rubric-cal.json --report calibration.html
```

The comment and badge both degrade gracefully:

- **unverified** (no calibration) — grey badge, banner in the PR comment.
- **calibrated** (agreement ≥ `--min-agreement`, default 0.8) — green badge.
- **weak** (agreement below threshold) — yellow badge, warning banner.

## GitHub Action

```yaml
# .github/workflows/rubric.yml
on:
  pull_request:
    paths: ['prompts/**', 'data/**', 'rubric.config.json']
jobs:
  eval:
    runs-on: ubuntu-latest
    permissions: { pull-requests: write, contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: rubric/rubric@v1
        with:
          calibration: prompts/_calibration.json.local
          fail-on-regress: true
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Comments are idempotent — subsequent runs update the same comment via a hidden HTML marker instead of stacking.

### Drift detection (scheduled)

Drop `examples/drift-detector.yml` into `.github/workflows/` to run the eval on a schedule and upsert a GitHub issue when the candidate starts losing. Same idempotency trick as the PR comment: one issue per `RUBRIC_DRIFT_MARKER`, reopened if a previous drift report was closed. Best-effort — good enough for "did last week's model update quietly shift behaviour?" without paging anyone.

## Command reference

| Command | Purpose |
|--|--|
| `rubric quickstart` | Zero-config mock demo. 5 cases, no API keys, ~10s. |
| `rubric init [--force] [--wizard --describe <text>] [--mock]` | Scaffold config, `prompts/`, `data/cases.jsonl`. `--wizard` asks the judge model (or a mock template) to draft prompts + 10 cases from a one-sentence description. |
| `rubric providers test <name>` | Hello-world smoke-test against a configured provider. Redacts auth headers. |
| `rubric serve [--mock] [--port] [--host]` | Three-pane local UI: prompts · cases · live grid. Toggle vary-prompts ↔ vary-models; in-UI calibration labeling. |
| `rubric run [--mock] [--fail-on-regress] [--json-out] [--report] [--badge-out] [--calibration] [--cost-csv]` | Run the eval. |
| `rubric seed --from-{langfuse,helicone,langsmith,openai-logs,synthetic,csv} <export>` | Convert an LLM-observability export, CSV, or synthetic template into `data/cases.jsonl` + a calibration skeleton. |
| `rubric calibrate [--mock] [--labels] [--json-out] [--report]` | Measure judge vs. human agreement. |
| `rubric comment --from <run.json> [--calibration] [--report-url] [--title]` | Render a Markdown PR comment (stdout) from a run payload. |
| `rubric share --out <bundle.json> [--note] [--no-calibration]` | Export the workspace as a self-contained JSON bundle. |
| `rubric pull <bundle.json> [--target] [--force] [--no-calibration]` | Scaffold a workspace from a shared bundle — Fork-to-local flow. |
| `rubric history [--file] [--limit] [--html]` | Git-log timeline for the prompt files — which commit changed what. |

`--mock` on `run`, `serve`, and `calibrate` uses a deterministic stub provider/judge — useful for CI of rubric itself and for local smoke tests without spending tokens.

### Providers

Model ids are `provider/model` strings. Live mode auto-detects the right provider from the prefix:

| Prefix | Provider | Env var | Notes |
| ------ | -------- | ------- | ----- |
| `openai/` | OpenAI | `OPENAI_API_KEY` | e.g. `openai/gpt-4o-mini` |
| `groq/` | Groq | `GROQ_API_KEY` | OpenAI-compatible at `api.groq.com/openai/v1` |
| `openrouter/` | OpenRouter | `OPENROUTER_API_KEY` | e.g. `openrouter/anthropic/claude-3.5-sonnet` |
| `ollama/` | Ollama (local) | — | Expects a local server at `localhost:11434`; no key required |
| *user-declared* | any OpenAI-chat-compatible gateway | `keyEnv` / `keyFile` | Declare under `providers[]` in the config — see guide |

Judge models follow the same prefix rules — you can run evals on local Ollama and judge with Groq, or any mix.

**Corporate / self-hosted proxies.** Declare a `providers[]` entry with a `name`, `baseUrl`, `keyEnv` or `keyFile` (inline tokens are rejected), and optional `headers`. The name becomes the routing prefix — `corp-proxy/gpt-5.1` → your gateway. See [`docs/guide.md#corporate--self-hosted-proxies`](docs/guide.md#corporate--self-hosted-proxies) for the full recipe. Smoke-test with `rubric providers test <name>` before running a real sweep.

### Zero-config demo

```bash
rubric quickstart              # 5 cases × mock provider × mock judge, no API keys
rubric init --wizard --describe "triage customer support tickets" --mock
```

`quickstart` is the 10-second tour: deterministic mock provider + judge run a full grid end-to-end so you can see the output shape before you wire up a real key. `init --wizard` asks the judge model (or a mock template with `--mock`) to draft `baseline.md` + `candidate.md` + 10 input cases tagged `"_autogenerated": true` — review before trusting the verdict.

### Rubrics

`judge.rubric` picks how outputs are compared:

- `"default"` — pairwise LLM judge with a general "more correct, concise, on-task" rubric.
- `"model-comparison"` — pairwise LLM judge biased toward correctness + specificity (paired with `mode: "compare-models"`).
- `"structural-json"` — deterministic, **no LLM call**. Parses A and B as JSON and picks the side that deep-equals `case.expected`. Great for tool-call / structured-output evals.
- `{ "custom": "prose rubric..." }` — inline custom prose for the LLM judge.
- `{ "file": "rubric.md" }` — load the rubric text from a file (team preset).

### Comparison modes

`rubric.config.json` accepts `"mode": "compare-prompts"` (default) or `"compare-models"`.

- **compare-prompts** — for every case × every model, run `baseline.md` on side A and `candidate.md` on side B. Picks the better *prompt*.
- **compare-models** — one cell per case: run `baseline.md` on `models[0]` (side A) vs `models[1]` (side B). Picks the better *model* at a fixed prompt. Requires ≥ 2 models.

`rubric serve` exposes a segmented control in the header so you can switch modes without editing the config.

### Steelman-my-prompt

`rubric serve` ships two revise-with-LLM helpers that reuse your configured judge model:

- **✨ Steelman** (prompts-pane footer) — rewrites the currently active prompt with tighter constraints and clearer format guidance. No case anchor; fast when you want a second opinion on the prompt alone.
- **✨ Steelman the losing prompt** (per-cell verdict banner) — opens on any decided cell (not tie, not error) and rewrites the losing prompt *anchored on that failing case*, with one-click apply → editor. Useful for "why did this one fail?" drilldown without re-running the sweep.

Both go to the judge model by default, so the revision is costed against the same budget as grading. Use `mock` mode in the header to sanity-check the wiring without spending tokens — the default mock provider will return a parse error since it has no steelman response to echo.

## Repository layout

```
packages/
  cli/      — `rubric` binary (init / run / seed / calibrate / comment)
  shared/   — eval engine, Langfuse parser, grader, HTML report, PR comment, badge renderer
  action/   — thin GitHub REST wrapper that upserts the PR comment
  web/      — (placeholder) future `rubric serve` + `rubric.dev` sandbox
action.yml  — composite GitHub Action: install → run → calibrate → comment → post
```

All cross-package imports use relative paths (`../../../shared/src/index.ts`) so `bun` and `tsx` can run TypeScript sources directly without a build step.

### Building standalone binaries

`packages/cli/package.json` exposes `bun build --compile` scripts that produce a single-file, dependency-free executable per target:

```bash
cd packages/cli
bun run build:binary            # native target (current OS/arch)
bun run build:binary:all        # linux-x64/arm64, darwin-x64/arm64, windows-x64
```

The `release` GitHub workflow builds all five targets on tag push (`v*.*.*`) and attaches them to the release.

### Homebrew tap

`packaging/homebrew/rubric.rb.template` is a ready-to-publish Formula scaffold. After a release is cut, run:

```bash
packaging/homebrew/build-formula.sh 0.1.0 ./downloaded-binaries/ > Formula/rubric.rb
```

and commit the generated `Formula/rubric.rb` to a companion `homebrew-rubric` tap repo. Users then `brew tap rubric/rubric && brew install rubric` to get the correct platform binary, auto-renamed to `rubric` on PATH.

## Planning artifacts

- [`docs/design.md`](docs/design.md) — Builder-mode design doc. Approach C (local server + live diff playground). APPROVED.
- [`docs/ceo-plan.md`](docs/ceo-plan.md) — CEO review; v1 = 6-week ship plan with launch gate, week-6 polish, v1.1, and kill criteria.
- [`TODOS.md`](TODOS.md) — live launch-gate checklist.

## Status

- [x] Name locked: `rubric` (npm / rubric.dev / github.com/rubric all free as of 2026-04-22).
- [x] Monorepo scaffold: `packages/{cli,web,action,shared}`.
- [x] Eval engine with semver contract in `packages/shared`.
- [x] CLI commands: `init`, `serve`, `run`, `seed`, `calibrate`, `comment`, `share`, `pull`.
- [x] `--fail-on-regress`, `--json-out`, `--report`, `--badge-out` on `run`.
- [x] Calibration-aware PR comment + status badge SVG + cost rollup.
- [x] `rubric serve` three-pane live-diff UI with compare-prompts / compare-models toggle + in-UI labeling.
- [x] `rubric share` + `rubric pull` — Fork-to-local workspace bundles.
- [x] GitHub Action composite wrapper with idempotent comment upsert.
- [ ] Provider-TOS review (OpenAI / Anthropic / Google on anonymous demo keys).
- [ ] Week-1 spike: Cloudflare Workers + Durable Objects eval runner. Fly.io VPS fallback.
- [ ] Hosted `rubric.dev` anonymous sandbox + shareable URLs.
- [ ] Abuse & cost containment ($50/day cap, per-IP rate limits, kill switch).
- [ ] Publish to npm.

## License

MIT (see [`LICENSE`](LICENSE)).
