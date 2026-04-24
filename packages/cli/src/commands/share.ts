/**
 * `rubric share` — export the workspace as a single self-contained bundle.json.
 *
 * Pre-hosted URLs this is the Fork-to-local flow: attach the bundle to an
 * issue/gist, the reviewer `rubric pull`s it, and they're running the
 * exact same prompts+dataset+rubric locally. Mirrors the shareable-URL
 * primary flow but with zero backend.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, type Config } from '../../../shared/src/index.ts';

export const BUNDLE_VERSION = 1;

export interface Bundle {
  version: number;
  config: Config;
  prompts: { baseline: string; candidate: string };
  /** JSONL text (one case per line), preserved verbatim. */
  dataset: string;
  /** Optional calibration sidecar contents (entries array). */
  calibration?: { entries: unknown[] };
  /** Optional human-readable note the sharer attaches. */
  note?: string;
}

export interface ShareOptions {
  cwd?: string;
  configPath?: string;
  out: string;
  note?: string;
  /** Skip the _calibration.json.local sidecar even if present. */
  noCalibration?: boolean;
}

export interface ShareResult {
  bundlePath: string;
  bytes: number;
  included: {
    calibration: boolean;
    calibrationEntries: number;
    cases: number;
  };
}

export function runShare(opts: ShareOptions): ShareResult {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const configPath = opts.configPath ?? resolve(cwd, 'rubric.config.json');
  const loaded = loadConfig(configPath);

  const baseline = readFileSync(loaded.resolved.baseline, 'utf8');
  const candidate = readFileSync(loaded.resolved.candidate, 'utf8');
  const dataset = readFileSync(loaded.resolved.dataset, 'utf8');
  const caseCount = dataset.split('\n').filter((l) => l.trim().length > 0).length;

  const bundle: Bundle = {
    version: BUNDLE_VERSION,
    config: loaded.config,
    prompts: { baseline, candidate },
    dataset,
  };

  let calibrationEntries = 0;
  let includedCalibration = false;
  if (!opts.noCalibration) {
    const calibPath = resolve(loaded.baseDir, 'prompts', '_calibration.json.local');
    if (existsSync(calibPath)) {
      const text = readFileSync(calibPath, 'utf8');
      try {
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.entries)) {
          bundle.calibration = { entries: parsed.entries };
          calibrationEntries = parsed.entries.length;
          includedCalibration = true;
        }
      } catch {
        // ignore malformed calibration — exporting the workspace shouldn't fail on it
      }
    }
  }
  if (opts.note) bundle.note = opts.note;

  const bundlePath = resolve(cwd, opts.out);
  const content = JSON.stringify(bundle, null, 2) + '\n';
  writeFileSync(bundlePath, content, 'utf8');

  return {
    bundlePath,
    bytes: Buffer.byteLength(content, 'utf8'),
    included: {
      calibration: includedCalibration,
      calibrationEntries,
      cases: caseCount,
    },
  };
}
