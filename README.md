# rubric

Pairwise prompt evaluation for pull requests. Compare `baseline.md` vs `candidate.md` across your dataset × models with an LLM-as-judge, and fail CI when the new prompt regresses.

**Status:** v2.2 — radical cut from v2.1. The CLI (`init`, `quickstart`, `serve`, `watch`, `disagree`, `run`, `seed --from-csv`, `comment`, `runs`, `providers test`) and the GitHub Action wrapper ship against mock and live providers (OpenAI, Groq, OpenRouter, Ollama — all OpenAI-compatible). Hosted web UI and the `rubric.dev` sandbox are not built yet.

## Why

Prompt changes ship with almost no safety net. "Looks better" usually means "I tried three examples." rubric runs a pairwise comparison on a real dataset, asks a judge model which response is better per case, and rolls the outcome into a win/loss summary you can gate CI on — with a built-in override log (`rubric disagree`) so you can capture every case where you disagree with the judge. That override log is the calibration corpus.

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
  --report rubric-report.html
```

Outputs:

- `rubric-run.json` — machine-readable run payload (v1 schema). Feed to `rubric comment`.
- `rubric-report.html` — self-contained per-cell HTML report. Upload as a CI artifact or host it.

## Disagreeing with the judge

The judge is just another LLM. When you disagree with a verdict, say so:

```bash
rubric disagree case-3/openai/gpt-4o-mini --verdict A --reason "judge missed the factual error in B"
```

Every override is appended to `~/.rubric/runs/<id>/overrides.jsonl` and is visible in the serve UI (and in the PR comment footer). The override log is the calibration corpus — in v2.3 it will train a small residual classifier that scores the *judge*, not the outputs.

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
      - uses: rubric/rubric@v2
        with:
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
| `rubric serve [--mock] [--port] [--host] [--registry-root]` | Three-pane local UI: prompts · cases · live grid. Header `runs.log` drawer browses, inspects, and diffs past runs from the registry. |
| `rubric watch [--mock] [--concurrency] [--no-cache] [--once] [--debounce-ms]` | Watch prompt files; re-eval on save with a persistent judge-call cache so only changed cells spend tokens. |
| `rubric run [--mock] [--fail-on-regress] [--json-out] [--report] [--cost-csv] [--verbose]` | Run the eval. `--verbose` prints a provider diagnostics block (base URLs, key sources, redacted headers) — safe to paste into a bug report. |
| `rubric disagree <cell-ref> --verdict A\|B\|tie [--reason] [--run] [--undo]` | Override the judge on one cell in your latest run. Appends to the override log that feeds v2.3 calibration. |
| `rubric runs <list\|show\|status\|diff\|rerun>` | Local run registry (`~/.rubric/runs`). `rerun <id>` re-executes a run's config against the current prompts/dataset. |
| `rubric seed --from-csv <in.csv> [--out]` | Convert a CSV export into `data/cases.jsonl`. Requires an `input` column; optional `expected`; extra columns become metadata. |
| `rubric comment --from <run.json> [--report-url] [--title]` | Render a Markdown PR comment (stdout) from a run payload. |

`--mock` on `run`, `serve`, and `watch` uses a deterministic stub provider/judge — useful for CI of rubric itself and for local smoke tests without spending tokens.

### Removed in v2.2

`rubric finetune`, `rubric calibrate`, `rubric history`, `rubric share`, `rubric pull`, `rubric run --detach`, `rubric runs wait/resume`, `--badge-out`, failure clustering, Steelman, Together.ai adapter, seed adapters other than `--from-csv`, and `mode: compare-models`. See [`CHANGELOG.md`](CHANGELOG.md) for migration notes.

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

`judge.criteria` picks how outputs are compared:

- `"default"` — pairwise LLM judge with a general "more correct, concise, on-task" rubric.
- `"structural-json"` — deterministic, **no LLM call**. Parses A and B as JSON and picks the side that deep-equals `case.expected`. Great for tool-call / structured-output evals.
- `{ "custom": "prose rubric..." }` — inline custom prose for the LLM judge.
- `{ "file": "rubric.md" }` — load the rubric text from a file (team preset).

`rubric.config.json` accepts `"mode": "compare-prompts"` (the default and only supported mode in v2.2).

## Repository layout

```
packages/
  cli/      — `rubric` binary (init / run / watch / seed / comment / disagree / runs / serve)
  shared/   — eval engine, grader, HTML report, PR comment renderer, override log
  action/   — thin GitHub REST wrapper that upserts the PR comment
  web/      — (placeholder) future `rubric serve` + `rubric.dev` sandbox
action.yml  — composite GitHub Action: install → run → comment → post
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

- [x] Monorepo scaffold: `packages/{cli,web,action,shared}`.
- [x] Eval engine with semver contract in `packages/shared`.
- [x] CLI commands: `init`, `quickstart`, `serve`, `watch`, `run`, `seed --from-csv`, `comment`, `disagree`, `runs`, `providers test`.
- [x] `--fail-on-regress`, `--json-out`, `--report`, `--cost-csv` on `run`.
- [x] PR comment with judge-model callout + cost rollup + optional report link.
- [x] `rubric serve` three-pane live-diff UI with in-UI disagreement logging.
- [x] `rubric watch` re-evals on file save with a persistent judge-call cache.
- [x] `rubric disagree` override log (seed corpus for v2.3 calibration).
- [x] GitHub Action composite wrapper with idempotent comment upsert.
- [ ] Internal launch to 10-person team (v2.2).
- [ ] v2.3: residual-classifier calibration trained on the override log.
- [ ] Hosted `rubric.dev` anonymous sandbox + shareable URLs.
- [ ] Publish to npm.

## License

MIT (see [`LICENSE`](LICENSE)).
