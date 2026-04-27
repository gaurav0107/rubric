import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const BANNER_MAJOR_MINOR = '2.2';
const MARKER_FILENAME = '.last-cli-version';
const BANNER_TEXT =
  `rubric v${BANNER_MAJOR_MINOR} removed: finetune, calibrate, history, share, pull, failure clustering, compare-models. See CHANGELOG.`;

/**
 * Resolve the marker path. Honours RUBRIC_HOME for test isolation and for
 * teams that relocate the rubric dir (e.g. NFS). Falls back to `~/.rubric`.
 */
export function defaultMarkerPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.RUBRIC_HOME && env.RUBRIC_HOME.length > 0
    ? env.RUBRIC_HOME
    : join(homedir(), '.rubric');
  return join(root, MARKER_FILENAME);
}

/**
 * Compare "2.1.3" < "2.2.0". Returns the major.minor slice of each side.
 * Unparseable versions return `null`, which the caller treats as "fire once".
 */
function majorMinor(v: string): { major: number; minor: number } | null {
  const m = /^(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/**
 * Decide whether to print the v2.2 upgrade banner. Banner fires once when the
 * recorded "last seen CLI version" is missing or below 2.2. Pure: accepts the
 * recorded version string (or null if the marker is absent) and the current
 * CLI version, returns the banner text or null.
 */
export function decideBanner(recorded: string | null, current: string): string | null {
  const cur = majorMinor(current);
  if (!cur) return null; // unknown current version — don't spam.
  // Only fire the v2.2 banner while the CLI is v2.2.x.
  if (cur.major !== 2 || cur.minor !== 2) return null;
  if (recorded === null) return BANNER_TEXT;
  const rec = majorMinor(recorded);
  if (!rec) return BANNER_TEXT;
  if (rec.major < 2 || (rec.major === 2 && rec.minor < 2)) return BANNER_TEXT;
  return null;
}

/**
 * Read the marker, decide whether to print the banner, persist the current
 * version, and return the banner text (or null if none). Swallows I/O errors —
 * the banner is a nice-to-have and MUST never block the CLI.
 */
export function resolveBannerOnce(
  currentVersion: string,
  markerPath: string = defaultMarkerPath(),
): string | null {
  let recorded: string | null = null;
  try {
    if (existsSync(markerPath)) {
      recorded = readFileSync(markerPath, 'utf8').trim() || null;
    }
  } catch {
    recorded = null;
  }

  const banner = decideBanner(recorded, currentVersion);

  // Always persist the current version so the banner fires at most once per
  // upgrade even if we didn't print anything this invocation.
  try {
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, currentVersion, 'utf8');
  } catch {
    /* best-effort */
  }

  return banner;
}
