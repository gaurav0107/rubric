/**
 * `rubric disagree` — append a user verdict override to this project's
 * override log.
 *
 * Three forms:
 *   rubric disagree <cell-ref> --verdict A|B|tie --reason "..."
 *       Resolves against the most recent run in this project (typically the
 *       watch session). Fastest path — matches the watch UX.
 *   rubric disagree --run <run-id> <cell-ref> --verdict ... --reason "..."
 *       Explicit run. Useful when you want to disagree with an older batch run.
 *   rubric disagree <cell-ref> --undo
 *       Append an undo record for that contentKey. Latest-wins collapse in
 *       `activeOverrides()` means a later override re-activates the override.
 *
 * A cell-ref is `case-<N>/<provider>/<model>`, matching the watch display.
 * Overrides follow *content*, not run ids — the contentKey is derived from
 * the rendered prompts + input + models + judge, identical to the cache key
 * minus the two version fields. Editing your candidate invalidates the
 * override (same rule as the cache).
 *
 * Why: the judge's word is not the last word. A passive calibration set
 * emerges from these overrides over weeks of normal use — that's the v2.3
 * wedge this command feeds.
 */
import {
  appendOverride,
  computeContentKey,
  defaultOverridesRoot,
  defaultRegistryRoot,
  formatCellRef,
  judgeRubricId,
  listRuns,
  loadConfig,
  parseCasesJsonl,
  parseCellRef,
  readCells,
  readManifest,
  renderPrompt,
  resolveCriteria,
  type CellResult,
  type RunManifest,
  type Verdict,
} from '../../../shared/src/index.ts';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export interface DisagreeOptions {
  cellRef: string;
  /** Required unless `undo` is set. */
  verdict?: Verdict;
  reason?: string;
  /** If true, appends an undo record instead of an override. verdict/reason ignored. */
  undo?: boolean;
  /** Explicit run id. Defaults to the latest matching run in the registry. */
  runId?: string;
  configPath?: string;
  cwd?: string;
  registryRoot?: string;
  /** Override root (tests). */
  overridesRoot?: string;
  write?: (line: string) => void;
}

export interface DisagreeResult {
  exitCode: number;
  runId: string;
  cellRef: string;
  contentKey: string;
  op: 'override' | 'undo';
  verdict?: Verdict;
}

const DEFAULT_CONFIG = 'rubric.config.json';

export function parseVerdictFlag(v: string): Verdict {
  const lower = v.toLowerCase();
  if (lower === 'a') return 'a';
  if (lower === 'b') return 'b';
  if (lower === 'tie') return 'tie';
  throw new Error(`--verdict must be A | B | tie (got "${v}")`);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Pick the best candidate run for this project. Prefers runs whose configHash
 * matches the current config (so you can't accidentally override against a
 * foreign project's registry), newest first. Falls back to the most recent
 * run overall if nothing matches — surfaced as a warning so the caller can
 * course-correct with `--run <id>`.
 */
function findLatestRunForConfig(registryRoot: string, configHash: string): { manifest: RunManifest; matched: boolean } | null {
  const all = listRuns(registryRoot);
  if (all.length === 0) return null;
  const matching = all.find((m) => m.configHash === configHash);
  if (matching) return { manifest: matching, matched: true };
  const first = all[0];
  if (!first) return null;
  return { manifest: first, matched: false };
}

function findCellInRun(registryRoot: string, runId: string, caseIndex: number, modelA: string): CellResult | null {
  const cells = readCells(registryRoot, runId);
  for (const c of cells) {
    if (c.caseIndex === caseIndex && c.model === modelA) return c;
  }
  return null;
}

export async function runDisagree(opts: DisagreeOptions): Promise<DisagreeResult> {
  const write = opts.write ?? ((s: string) => process.stdout.write(s));
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, DEFAULT_CONFIG);
  const undo = opts.undo === true;

  if (!undo && opts.verdict === undefined) {
    throw new Error('--verdict A|B|tie is required (or pass --undo to cancel a previous override)');
  }

  const parsedRef = parseCellRef(opts.cellRef);
  const loaded = loadConfig(configPath);
  for (const w of loaded.warnings) write(`  ⚠ config: ${w}\n`);
  const configHash = sha256(JSON.stringify(loaded.config));

  // Resolve which run we're attaching to.
  const registryRoot = opts.registryRoot ?? defaultRegistryRoot();
  let runId = opts.runId;
  if (runId === undefined) {
    const found = findLatestRunForConfig(registryRoot, configHash);
    if (!found) {
      throw new Error(`no runs found in ${registryRoot} — run \`rubric watch\` or \`rubric run\` first, or pass --run <id>`);
    }
    runId = found.manifest.id;
    if (!found.matched) {
      write(`  ⚠ latest run ${runId} has a different configHash (current config may have changed). Using it anyway — pass --run <id> to pin.\n`);
    }
  } else {
    // Validate the run exists.
    readManifest(registryRoot, runId);
  }

  // Reconstruct the contentKey from the case + prompts + models + judge.
  // This has to match what watch/cache produce, otherwise overrides never
  // bind. Source of truth: the cell at (caseIndex, modelA) in cells.jsonl.
  const cases = parseCasesJsonl(readFileSync(loaded.resolved.dataset, 'utf8'));
  if (parsedRef.caseIndex < 0 || parsedRef.caseIndex >= cases.length) {
    throw new Error(`case-${parsedRef.caseIndex} is out of range (dataset has ${cases.length} cases)`);
  }
  const theCase = cases[parsedRef.caseIndex]!;
  const promptBaseline = readFileSync(loaded.resolved.baseline, 'utf8');
  const promptCandidate = readFileSync(loaded.resolved.candidate, 'utf8');
  const promptA = renderPrompt(promptBaseline, theCase);
  const promptB = renderPrompt(promptCandidate, theCase);
  const criteriaText = resolveCriteria(loaded.config.judge.criteria, loaded.baseDir);
  const rubricId = judgeRubricId(criteriaText);

  const modelA = parsedRef.modelA;
  // Make sure the ref actually exists in this run's recorded cells — a typo'd
  // cell-ref shouldn't silently succeed.
  const cell = findCellInRun(registryRoot, runId, parsedRef.caseIndex, modelA);
  if (!cell) {
    throw new Error(`cell "${opts.cellRef}" not found in run ${runId} (check \`rubric runs show ${runId}\`)`);
  }
  const contentKey = computeContentKey({
    promptA,
    promptB,
    inputText: theCase.input,
    modelA,
    modelB: cell.model,
    judgeModelId: loaded.config.judge.model,
    judgeRubricId: rubricId,
  });

  const cellRef = formatCellRef(parsedRef.caseIndex, modelA);
  const overridesRoot = opts.overridesRoot ?? defaultOverridesRoot();

  if (undo) {
    const record = appendOverride(
      configPath,
      { op: 'undo', cellRef, contentKey, runId },
      overridesRoot,
    );
    write(`  ↶ undo ${cellRef} (run ${runId}) — contentKey ${contentKey.slice(0, 12)}…\n`);
    write(`  logged at ${record.ts}\n`);
    return { exitCode: 0, runId, cellRef, contentKey, op: 'undo' };
  }

  const verdict = opts.verdict!;
  const input: Parameters<typeof appendOverride>[1] = {
    op: 'override',
    cellRef,
    contentKey,
    verdict,
    runId,
  };
  if (opts.reason !== undefined) input.reason = opts.reason;
  const record = appendOverride(configPath, input, overridesRoot);

  const verdictGlyph = verdict === 'a' ? 'A' : verdict === 'b' ? 'B' : 'tie';
  write(`  ✎ ${cellRef} → ${verdictGlyph}${opts.reason ? ` — "${opts.reason}"` : ''}\n`);
  write(`  run ${runId} · contentKey ${contentKey.slice(0, 12)}… · logged at ${record.ts}\n`);
  return { exitCode: 0, runId, cellRef, contentKey, op: 'override', verdict };
}
