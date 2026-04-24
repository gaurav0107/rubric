/**
 * `rubric pull` — import a bundle.json written by `share` into a target dir.
 *
 * Scaffolds rubric.config.json + prompts/ + data/ from the bundle's
 * inline contents. Refuses to overwrite existing files unless --force.
 * Optionally restores the calibration sidecar.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { validateConfig } from '../../../shared/src/index.ts';
import { BUNDLE_VERSION, type Bundle } from './share.ts';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleError';
  }
}

export function parseBundle(raw: unknown): Bundle {
  if (!isRecord(raw)) throw new BundleError('bundle must be a JSON object');
  if (raw.version !== BUNDLE_VERSION) {
    throw new BundleError(`bundle version ${JSON.stringify(raw.version)} not supported (expected ${BUNDLE_VERSION})`);
  }
  if (!isRecord(raw.prompts) || typeof raw.prompts.baseline !== 'string' || typeof raw.prompts.candidate !== 'string') {
    throw new BundleError('bundle.prompts.baseline and .candidate must be strings');
  }
  if (typeof raw.dataset !== 'string') {
    throw new BundleError('bundle.dataset must be a string (JSONL text)');
  }
  const config = validateConfig(raw.config, 'bundle.config');

  const out: Bundle = {
    version: BUNDLE_VERSION,
    config,
    prompts: { baseline: raw.prompts.baseline, candidate: raw.prompts.candidate },
    dataset: raw.dataset,
  };
  if (isRecord(raw.calibration) && Array.isArray((raw.calibration as Record<string, unknown>).entries)) {
    out.calibration = { entries: (raw.calibration as { entries: unknown[] }).entries };
  }
  if (typeof raw.note === 'string') out.note = raw.note;
  return out;
}

export interface PullOptions {
  cwd?: string;
  /** Bundle file path (required). */
  bundlePath: string;
  /** Target directory (relative to cwd). Defaults to cwd. */
  target?: string;
  /** Overwrite existing files. */
  force?: boolean;
  /** Skip the calibration sidecar even if the bundle includes one. */
  noCalibration?: boolean;
}

export interface PullResult {
  targetDir: string;
  written: string[];
  skipped: string[];
  note?: string;
  calibrationEntries: number;
}

export function runPull(opts: PullOptions): PullResult {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const bundleAbs = resolve(cwd, opts.bundlePath);
  const targetDir = resolve(cwd, opts.target ?? '.');
  const force = opts.force ?? false;

  const text = readFileSync(bundleAbs, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BundleError(`failed to parse bundle ${bundleAbs}: ${msg}`);
  }
  const bundle = parseBundle(parsed);

  // Resolve target paths from the bundle's config (trust validator already checked them).
  const configPath = join(targetDir, 'rubric.config.json');
  const baselinePath = join(targetDir, bundle.config.prompts.baseline);
  const candidatePath = join(targetDir, bundle.config.prompts.candidate);
  const datasetPath = join(targetDir, bundle.config.dataset);

  const files: Array<{ path: string; content: string }> = [
    { path: configPath, content: JSON.stringify(bundle.config, null, 2) + '\n' },
    { path: baselinePath, content: bundle.prompts.baseline },
    { path: candidatePath, content: bundle.prompts.candidate },
    { path: datasetPath, content: bundle.dataset },
  ];

  let calibrationEntries = 0;
  if (bundle.calibration && !opts.noCalibration) {
    const calibPath = join(dirname(baselinePath), '_calibration.json.local');
    files.push({
      path: calibPath,
      content: JSON.stringify({ entries: bundle.calibration.entries }, null, 2) + '\n',
    });
    calibrationEntries = bundle.calibration.entries.length;
  }

  const written: string[] = [];
  const skipped: string[] = [];

  for (const f of files) {
    mkdirSync(dirname(f.path), { recursive: true });
    if (existsSync(f.path) && !force) {
      skipped.push(f.path);
      continue;
    }
    writeFileSync(f.path, f.content, 'utf8');
    written.push(f.path);
  }

  const result: PullResult = { targetDir, written, skipped, calibrationEntries };
  if (bundle.note) result.note = bundle.note;
  return result;
}
