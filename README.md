# diffprompt

Pairwise prompt evaluation for pull requests. Compare `baseline.md` vs `candidate.md` across your dataset × models with a calibrated LLM-as-judge, and fail CI when the new prompt regresses.

**Status:** Pre-alpha. The CLI (`init`, `serve`, `run`, `seed`, `calibrate`, `comment`, `share`, `pull`) and the GitHub Action wrapper are landed and exercised against mock and live OpenAI providers. Hosted web UI and the `diffprompt.dev` sandbox are not built yet — see [`TODOS.md`](TODOS.md).

## Why

Prompt changes ship with almost no safety net. "Looks better" usually means "I tried three examples." diffprompt runs a pairwise comparison on a real dataset, asks a judge model which response is better per case, and rolls the outcome into a win/loss summary you can gate CI on — with a *calibration* step that measures how much to trust the judge before anyone acts on its verdict.

## Quickstart

```bash
npm install -g diffprompt    # not published yet — use `npm link` from packages/cli for now

diffprompt init              # scaffolds diffprompt.config.json, prompts/, data/cases.jsonl
# edit prompts/baseline.md and prompts/candidate.md
export OPENAI_API_KEY=sk-...
diffprompt run               # runs the eval; prints win/loss/tie summary

# or, iterate with a live-diff three-pane UI:
diffprompt serve             # http://127.0.0.1:5174 — edit prompts, re-run, label pairs
```

`diffprompt run` exits `0` on pass, `1` on judge errors, and — with `--fail-on-regress` — `2` when the candidate loses more cells than it wins. That's the CI gate.

## Typical CI invocation

```bash
diffprompt run \
  --config diffprompt.config.json \
  --fail-on-regress \
  --json-out diffprompt-run.json \
  --report diffprompt-report.html \
  --badge-out diffprompt.svg \
  --calibration diffprompt-cal.json    # optional; colors the badge
```

Outputs:

- `diffprompt-run.json` — machine-readable run payload (v1 schema). Feed to `diffprompt comment`.
- `diffprompt-report.html` — self-contained per-cell HTML report. Upload as a CI artifact or host it.
- `diffprompt.svg` — Shields-style status badge. Commit it to your repo and reference from the README.

## Calibration (measure the judge before trusting it)

The judge is just another LLM. Before gating anything on its verdict, sample 10–50 pairs, hand-label the winner, and measure agreement:

```bash
diffprompt seed --from-langfuse langfuse-export.jsonl   # optional: seed from production logs
# hand-edit prompts/_calibration.json.local to add {"winner": "A"|"B"|"tie"} per case
diffprompt calibrate --json-out diffprompt-cal.json --report calibration.html
```

The comment and badge both degrade gracefully:

- **unverified** (no calibration) — grey badge, banner in the PR comment.
- **calibrated** (agreement ≥ `--min-agreement`, default 0.8) — green badge.
- **weak** (agreement below threshold) — yellow badge, warning banner.

## GitHub Action

```yaml
# .github/workflows/diffprompt.yml
on:
  pull_request:
    paths: ['prompts/**', 'data/**', 'diffprompt.config.json']
jobs:
  eval:
    runs-on: ubuntu-latest
    permissions: { pull-requests: write, contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: diffprompt/diffprompt@v1
        with:
          calibration: prompts/_calibration.json.local
          fail-on-regress: true
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Comments are idempotent — subsequent runs update the same comment via a hidden HTML marker instead of stacking.

## Command reference

| Command | Purpose |
|--|--|
| `diffprompt init [--force]` | Scaffold config, `prompts/`, `data/cases.jsonl`. |
| `diffprompt serve [--mock] [--port] [--host]` | Three-pane local UI: prompts · cases · live grid. Toggle vary-prompts ↔ vary-models; in-UI calibration labeling. |
| `diffprompt run [--mock] [--fail-on-regress] [--json-out] [--report] [--badge-out] [--calibration] [--cost-csv]` | Run the eval. |
| `diffprompt seed --from-{langfuse,helicone,langsmith,openai-logs} <export>` | Convert an LLM-observability export into `data/cases.jsonl` + a calibration skeleton. |
| `diffprompt calibrate [--mock] [--labels] [--json-out] [--report]` | Measure judge vs. human agreement. |
| `diffprompt comment --from <run.json> [--calibration] [--report-url] [--title]` | Render a Markdown PR comment (stdout) from a run payload. |
| `diffprompt share --out <bundle.json> [--note] [--no-calibration]` | Export the workspace as a self-contained JSON bundle. |
| `diffprompt pull <bundle.json> [--target] [--force] [--no-calibration]` | Scaffold a workspace from a shared bundle — Fork-to-local flow. |

`--mock` on `run`, `serve`, and `calibrate` uses a deterministic stub provider/judge — useful for CI of diffprompt itself and for local smoke tests without spending tokens.

### Comparison modes

`diffprompt.config.json` accepts `"mode": "compare-prompts"` (default) or `"compare-models"`.

- **compare-prompts** — for every case × every model, run `baseline.md` on side A and `candidate.md` on side B. Picks the better *prompt*.
- **compare-models** — one cell per case: run `baseline.md` on `models[0]` (side A) vs `models[1]` (side B). Picks the better *model* at a fixed prompt. Requires ≥ 2 models.

`diffprompt serve` exposes a segmented control in the header so you can switch modes without editing the config.

## Repository layout

```
packages/
  cli/      — `diffprompt` binary (init / run / seed / calibrate / comment)
  shared/   — eval engine, Langfuse parser, grader, HTML report, PR comment, badge renderer
  action/   — thin GitHub REST wrapper that upserts the PR comment
  web/      — (placeholder) future `diffprompt serve` + `diffprompt.dev` sandbox
action.yml  — composite GitHub Action: install → run → calibrate → comment → post
```

All cross-package imports use relative paths (`../../../shared/src/index.ts`) so `bun` and `tsx` can run TypeScript sources directly without a build step.

## Planning artifacts

- [`docs/design.md`](docs/design.md) — Builder-mode design doc. Approach C (local server + live diff playground). APPROVED.
- [`docs/ceo-plan.md`](docs/ceo-plan.md) — CEO review; v1 = 6-week ship plan with launch gate, week-6 polish, v1.1, and kill criteria.
- [`TODOS.md`](TODOS.md) — live launch-gate checklist.

## Status

- [x] Name locked: `diffprompt` (npm / diffprompt.dev / github.com/diffprompt all free as of 2026-04-22).
- [x] Monorepo scaffold: `packages/{cli,web,action,shared}`.
- [x] Eval engine with semver contract in `packages/shared`.
- [x] CLI commands: `init`, `serve`, `run`, `seed`, `calibrate`, `comment`, `share`, `pull`.
- [x] `--fail-on-regress`, `--json-out`, `--report`, `--badge-out` on `run`.
- [x] Calibration-aware PR comment + status badge SVG + cost rollup.
- [x] `diffprompt serve` three-pane live-diff UI with compare-prompts / compare-models toggle + in-UI labeling.
- [x] `diffprompt share` + `diffprompt pull` — Fork-to-local workspace bundles.
- [x] GitHub Action composite wrapper with idempotent comment upsert.
- [ ] Provider-TOS review (OpenAI / Anthropic / Google on anonymous demo keys).
- [ ] Week-1 spike: Cloudflare Workers + Durable Objects eval runner. Fly.io VPS fallback.
- [ ] Hosted `diffprompt.dev` anonymous sandbox + shareable URLs.
- [ ] Abuse & cost containment ($50/day cap, per-IP rate limits, kill switch).
- [ ] Publish to npm.

## License

MIT (see [`LICENSE`](LICENSE)).
