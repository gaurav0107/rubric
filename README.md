# rubric

**A workbench for prompt iteration.** Edit a prompt, run it against your dataset, let a judge model score the result, get concrete improvement suggestions, and promote the winner into your new baseline. Do that loop daily and your prompt gets measurably better — with a git commit recording every promotion.

Shipping today as **v2.2.1**. Single-file binary. Local-first. No account.

---

## Why it exists

Iterating on a prompt is guessing. We have `git diff`, `npm test --watch`, linters, REPLs. For prompts we have a ChatGPT tab open in another window and a feeling.

`rubric` is the thing you open instead of that tab:

- **Run** — sweep candidate vs. baseline across a real dataset, let the judge pick a winner per case.
- **Coach** — after the sweep, the judge reads the losses together and proposes specific edits to your candidate prompt. One click applies each suggestion.
- **Promote** — when candidate beats baseline, swap them. Candidate resets to the new best. Git commits the stats.
- **Gate (optional)** — the same engine runs in CI via a GitHub Action and fails the build if a future PR regresses below the promoted bar.

The workbench loop is the primary job. CI gating is a consequence of it.

---

## Install

Pick the line for your platform. Paste it into a terminal. **Run the four commands one at a time** — don't try to paste them as a block, some terminals break multi-line paste.

**macOS — Apple Silicon (M1/M2/M3/M4):**

```bash
curl -fL -o rubric https://github.com/gaurav0107/rubric/releases/latest/download/rubric-darwin-arm64
```

**macOS — Intel:**

```bash
curl -fL -o rubric https://github.com/gaurav0107/rubric/releases/latest/download/rubric-darwin-x64
```

**Linux — x64:**

```bash
curl -fL -o rubric https://github.com/gaurav0107/rubric/releases/latest/download/rubric-linux-x64
```

**Linux — ARM64:**

```bash
curl -fL -o rubric https://github.com/gaurav0107/rubric/releases/latest/download/rubric-linux-arm64
```

**Windows:** [download `rubric-windows-x64.exe`](https://github.com/gaurav0107/rubric/releases/latest) from the release page.

Then, on macOS / Linux:

```bash
chmod +x rubric
```

```bash
sudo mv rubric /usr/local/bin/
```

```bash
rubric quickstart
```

If `rubric quickstart` prints a win/loss summary, you're done.

### Troubleshooting

**macOS: `zsh: killed` or the command exits silently.** Gatekeeper blocked the unsigned binary. Clear it:

```bash
xattr -d com.apple.quarantine /usr/local/bin/rubric
```

Then re-run `rubric quickstart`.

**`chmod: rubric: No such file or directory`.** The `curl` line didn't finish — usually because the command got split across two pasted lines and `curl` ran without a URL. Re-paste the `curl` command as a single line.

**`zsh: parse error near ')'`.** Smart-quote conversion when copying from the rendered GitHub README. Retype the command instead of pasting, or use the per-platform commands above (no shell substitutions, nothing to break).

### One-liner, for people who want it

Works in Bash / zsh if you paste it cleanly on one line — but fails on smart-quote conversion from some rendered doc views. Prefer the per-platform commands above if in doubt.

```bash
curl -fL -o rubric "https://github.com/gaurav0107/rubric/releases/latest/download/rubric-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')" && chmod +x rubric && sudo mv rubric /usr/local/bin/
```

---

## Your first 5 minutes

```bash
rubric init                # scaffolds rubric.config.json + prompts/ + data/cases.jsonl
export OPENAI_KEY=sk-...   # or OPENAI_API_KEY; or keyFile via the config (see below)
rubric serve               # opens the workbench at http://127.0.0.1:5174
```

That's it. Open the browser. You'll see three panes:

- **Prompts** (left) — tabs for `Baseline`, `Candidate`, `Judge`. Edit, ⌘S saves to disk.
- **Cases** (middle) — your dataset, loaded from `data/cases.jsonl`.
- **Results** (right) — summary strip, Coach pane, grid with per-case verdicts.

Click **Run**. Wait for the sweep. Every cell shows a winner (`Baseline` / `Candidate` / `Tie`). The Δ column shows how each case moved since your previous run.

---

## The workbench loop

Five steps. Ten to fifteen minutes per cycle. Do it once or twice a day.

### 1. Edit the candidate

In the Prompts pane, click the `Candidate` tab. Write the variant you want to try. ⌘S to save.

### 2. Run

Click **Run** (or press `R`). The sweep fires. Each cell streams in. The summary strip updates live; the Δ column lights up with per-case movement vs. your last run.

### 3. Read the coach

Under the summary strip, click **Get suggestions**. The judge model re-reads all the losses and ties together and returns:

- **A summary** — one sentence on what the losing cases have in common.
- **Up to 5 concrete suggestions** — each with a title, a rationale grounded in specific cases, and a block of prompt text.

Example output from a real run:

> **Avoid risky migration guidance**  
> *Case 1: candidate suggested adding a DEFAULT on ALTER TABLE. Baseline avoided it and won on safety.*
>
> ```
> For large-table schema changes: never recommend adding a
> column with a DEFAULT in the same ADD COLUMN step. Add
> NULLable → backfill → enforce NOT NULL separately.
> ```

### 4. Apply, review, run again

Each suggestion has an **Apply to candidate** button. Click it — the text is appended to `candidate.md`, the editor switches to the Candidate tab, and the file is marked dirty. You review, then ⌘S. Then **Run** again.

Either the change flipped the losing case (Δ shows ▲), or it didn't (Δ shows · or ▼). Either way you have data, not a feeling.

### 5. Promote

When candidate has more wins than losses, the **Promote** button in the Prompts footer lights up. Click it. Three things happen:

1. `candidate.md` → `baseline.md` on disk.
2. `candidate.md` resets to a copy of the new baseline (so your next iteration starts from the current best).
3. A git commit lands: `rubric: promote candidate → baseline (wins=4 losses=1 run=…)`.

Your bar just moved up. `git log prompts/` is the story of the move.

---

## Disagreeing with the judge

The judge is another LLM. It will be wrong sometimes. Say so.

**From the CLI:**

```bash
rubric disagree case-3/openai/gpt-5.2 --verdict A --reason "judge missed the factual error in B"
```

**Or inline in the workbench** — each cell's detail pane has `[Baseline] [Candidate] [Tie]` buttons and an optional reason field.

Every override appends to `~/.rubric/overrides/<project>.jsonl`. CLI and UI round-trip through the same file. This log becomes the training corpus for the v2.3 calibration classifier that scores the judge itself.

---

## Config

`rubric.config.json` is the whole surface. One file, on disk, committed to git.

```json
{
  "prompts": {
    "baseline":  "prompts/baseline.md",
    "candidate": "prompts/candidate.md"
  },
  "dataset": "data/cases.jsonl",
  "models": ["openai/gpt-5.2"],
  "judge": {
    "model":    "openai/gpt-5.2",
    "criteria": "default"
  },
  "mode":        "compare-prompts",
  "concurrency": 4
}
```

| Field | What it does |
|---|---|
| `prompts.baseline` / `prompts.candidate` | Paths to the two prompt files. Use `{{input}}` in the file to interpolate per-case data. |
| `dataset` | JSONL file, one case per line. Each case needs `input`; optional `expected` + arbitrary metadata. |
| `models[]` | `provider/model` ids. Supports `openai/`, `groq/`, `openrouter/`, `ollama/`, and any user-declared provider. |
| `judge.model` | The LLM that picks a winner per cell. Can be the same as `models[0]` or a different one. |
| `judge.criteria` | `"default"` (general "more correct, concise, on-task"), `"structural-json"` (deterministic deep-equal against `expected`), `{ "custom": "prose…" }`, or `{ "file": "rubric.md" }`. |
| `mode` | `"compare-prompts"` (default — same model, baseline vs. candidate) or `"compare-models"` (two models, one shared prompt; `models[]` must have exactly 2 entries). |
| `concurrency` | Parallel in-flight LLM calls per sweep. |

### Custom providers (corporate proxies, Azure gateways, etc.)

Declare a `providers[]` block. Inline API keys are rejected — use `keyEnv` (env var name) or `keyFile` (path, gitignored):

```json
{
  "providers": [
    {
      "name":    "my-gateway",
      "baseUrl": "https://gateway.example.com/proxy/external/v1",
      "keyFile": ".secrets/gateway.key",
      "headers": { "x-client-app": "rubric" }
    }
  ],
  "models": ["my-gateway/gpt-5.2"]
}
```

The `name` becomes the model-id prefix. See [`docs/guide.md`](docs/guide.md#corporate--self-hosted-proxies) for the full recipe including TLS CA bundles for corp networks.

### Model allowlist for the UI picker

Drop a newline-delimited file at `.secrets/available_models` (gitignored by default):

```
openai/gpt-5.2
openai/gpt-4o-mini
# my internal proxy:
my-gateway/gpt-5.2
```

The workbench header gets dropdown selectors for `Models` and `Judge` instead of free-text boxes. Lines starting with `#` are comments; missing file falls back to free-text.

---

## CI gate — the optional safety net

Once you've promoted a prompt you're happy with, let GitHub Actions make sure no future PR regresses it. Drop this into `.github/workflows/rubric.yml`:

```yaml
on:
  pull_request:
    paths: ['prompts/**', 'data/**', 'rubric.config.json']

jobs:
  eval:
    runs-on: ubuntu-latest
    permissions: { pull-requests: write, contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: gaurav0107/rubric@v2.2.1
        with:
          fail-on-regress: true
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

The Action downloads the release binary — no `npm install`, ~15s setup. It runs `rubric run`, renders a PR comment with the top regressions inline (case input, judge reason, both outputs side-by-side), and fails the job with exit code 2 if candidate lost more than it won.

The PR comment is idempotent — subsequent pushes update the same comment via a hidden marker instead of stacking.

### Scheduled drift detection

Drop [`examples/drift-detector.yml`](examples/drift-detector.yml) into `.github/workflows/` to run the eval on a schedule and upsert a GitHub issue when the candidate starts losing. Useful for spotting when an upstream model update silently shifted behavior.

---

## Command reference

| Command | Purpose |
|---|---|
| `rubric quickstart` | Zero-config mock demo. 5 cases, no API keys, ~10s. Prove the binary works. |
| `rubric init [--force] [--wizard --describe <text>] [--mock]` | Scaffold `rubric.config.json`, `prompts/`, `data/cases.jsonl`. `--wizard` asks the judge model (or a mock) to draft prompts + 10 cases from a one-sentence task description. |
| `rubric serve [--mock] [--port] [--host]` | Open the workbench. `--mock` uses a deterministic stub provider + judge. |
| `rubric run [--fail-on-regress] [--json-out] [--report] [--cost-csv] [--format human\|json\|compact] [--verbose]` | Run a sweep from the CLI. This is what CI calls. |
| `rubric watch [--mock] [--once] [--concurrency] [--no-cache]` | Watch prompt files; re-run on save with a persistent judge-call cache so only changed cells spend tokens. |
| `rubric disagree <cell-ref> --verdict A\|B\|tie [--reason] [--run] [--undo]` | Override the judge on one cell. Appends to the override log that feeds v2.3 calibration. |
| `rubric runs <list\|show\|status\|diff\|rerun>` | Browse the local run registry at `~/.rubric/runs/`. |
| `rubric seed --from-csv <in.csv> [--out]` | Convert a CSV export into `data/cases.jsonl`. Requires an `input` column. |
| `rubric comment --from <run.json> [--report-url] [--title]` | Render a Markdown PR comment (stdout) from a run payload. Used by the GitHub Action. |
| `rubric providers test <name>` | Hello-world smoke-test against a configured provider. Redacts auth headers. |

Add `--help` to any command for the exhaustive flag list.

### Provider model-id prefixes

| Prefix | Provider | Env var |
|---|---|---|
| `openai/` | OpenAI | `OPENAI_KEY` or `OPENAI_API_KEY` |
| `groq/` | Groq | `GROQ_API_KEY` |
| `openrouter/` | OpenRouter | `OPENROUTER_API_KEY` |
| `ollama/` | Ollama (local) | none |
| *user-declared* | any OpenAI-chat-compatible gateway | `keyEnv` / `keyFile` in config |

`OPENAI_PROXY` overrides the OpenAI base URL — the path Azure OpenAI behind a corporate gateway typically takes.

---

## Data model

Everything rubric produces lives on disk, in files you can read:

```
~/.rubric/
  runs/<run-id>/
    manifest.json        # config snapshot, summary, status
    cells.jsonl          # one line per cell: inputs, outputs, verdict, cost, latency
  overrides/
    <project-slug>.jsonl # your override log — the v2.3 training corpus
```

In your project:

```
rubric.config.json       # the config — committed
prompts/
  baseline.md            # committed; promotion overwrites it
  candidate.md           # committed; promotion resets it
data/cases.jsonl         # committed
.secrets/                # gitignored by default — keys, CA bundles, allowlists
```

---

## What's next

- **v2.3 · Calibration classifier.** Train a small residual classifier on the override log. Output: a per-cell "judge likely wrong" score that surfaces in the PR comment as `trusted` / `review` / `flagged`. Every override you log today is training data.
- **Later · Hosted workbench.** Shared workspace at `rubric.dev` for teams. Prompts still live in git; runs + overrides live in shared storage. Deferred until the local CLI has weekly-active users.

---

## More

- [`docs/presentation/rubric-workbench.html`](docs/presentation/rubric-workbench.html) — 10-slide intro deck. Open in a browser; `⌘P` exports to PDF.
- [`docs/guide.md`](docs/guide.md) — long-form guide (corporate proxies, structural-json mode, cost controls, evaluator catalog).
- [`CHANGELOG.md`](CHANGELOG.md) — what shipped when and why.
- [`examples/drift-detector.yml`](examples/drift-detector.yml) — scheduled drift-detection workflow.

MIT. Built in the open at [github.com/gaurav0107/rubric](https://github.com/gaurav0107/rubric).
