/**
 * `rubric history` — git-log visualization for prompt files.
 *
 * Reads `git log -p` for baseline.md and candidate.md (or any files passed via
 * `--file`) and renders either:
 *   - a compact ASCII timeline to stdout (default), or
 *   - a self-contained HTML report (`--html <path>`).
 *
 * The point: prompt files evolve over months; when a regression shows up,
 * you want a fast way to see "which commit changed the system instruction"
 * without paging through full git history.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadConfig } from '../../../shared/src/index.ts';

export interface HistoryEntry {
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  /** Net +added / -removed line counts for the tracked files in this commit. */
  additions: number;
  deletions: number;
  /** File paths touched in this commit (relative to repo root). */
  files: string[];
}

export interface HistoryResult {
  repoRoot: string;
  tracked: string[];
  entries: HistoryEntry[];
  /** The target of --html, if provided. */
  htmlPath?: string;
}

export interface HistoryOptions {
  cwd?: string;
  configPath?: string;
  /** Override the set of files to track. Empty → falls back to prompts from config. */
  files?: string[];
  /** Write an HTML report to this path. */
  htmlPath?: string;
  /** Max commits to include (default: 100). */
  limit?: number;
  write?: (line: string) => void;
}

function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

function findRepoRoot(cwd: string): string {
  const out = git(['rev-parse', '--show-toplevel'], cwd).trim();
  if (!out) throw new Error('not inside a git repository');
  return out;
}

// U+001E RS + U+001C FS — ASCII control chars that won't appear in commit
// messages or file paths, so they're safe separators for structured git-log.
const REC = String.fromCharCode(0x1e);
const FS = String.fromCharCode(0x1c);

function parseLog(raw: string): HistoryEntry[] {
  // Each record is emitted as REC<meta fields separated by FS>\n<numstat lines>.
  // Splitting on REC gives a leading empty chunk plus one chunk per commit,
  // where the first line of each chunk is the meta and remaining lines are
  // numstat output for that commit.
  const entries: HistoryEntry[] = [];
  const chunks = raw.split(REC).filter((s) => s.length > 0);
  for (const chunk of chunks) {
    const newline = chunk.indexOf('\n');
    const metaLine = newline === -1 ? chunk : chunk.slice(0, newline);
    const body = newline === -1 ? '' : chunk.slice(newline + 1);
    const [sha, shortSha, authorName, authorEmail, authorDate, subject] = metaLine.split(FS);
    if (!sha || !shortSha || !authorDate || !subject) continue;

    let additions = 0;
    let deletions = 0;
    const files: string[] = [];
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const [addStr, delStr, path] = parts;
      if (!path) continue;
      files.push(path);
      const a = Number(addStr);
      const d = Number(delStr);
      if (Number.isFinite(a)) additions += a;
      if (Number.isFinite(d)) deletions += d;
    }
    entries.push({
      sha,
      shortSha,
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authorDate,
      subject,
      additions,
      deletions,
      files,
    });
  }
  return entries;
}

export function loadHistory(opts: HistoryOptions = {}): HistoryResult {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const limit = opts.limit ?? 100;

  const repoRoot = findRepoRoot(cwd);
  // Resolve symlinks so macOS's /tmp → /private/tmp doesn't throw off the
  // repo-root-relative math.
  const canonicalRoot = realpathSync(repoRoot);

  let tracked: string[] = opts.files ?? [];
  if (tracked.length === 0) {
    const configPath = opts.configPath ?? resolve(cwd, 'rubric.config.json');
    const loaded = loadConfig(configPath);
    tracked = [loaded.resolved.baseline, loaded.resolved.candidate];
  }
  const relTracked = tracked.map((p) => relative(canonicalRoot, realpathSync(resolve(cwd, p))));
  for (const p of relTracked) {
    if (!existsSync(resolve(canonicalRoot, p))) {
      throw new Error(`tracked file not found: ${p}`);
    }
  }

  const format = `--pretty=format:${REC}%H${FS}%h${FS}%an${FS}%ae${FS}%aI${FS}%s`;
  const raw = git(
    ['log', format, '--numstat', `-n${limit}`, '--', ...relTracked],
    canonicalRoot,
  );
  const entries = parseLog(raw);

  const result: HistoryResult = { repoRoot: canonicalRoot, tracked: relTracked, entries };
  if (opts.htmlPath) result.htmlPath = resolve(cwd, opts.htmlPath);
  return result;
}

export interface RunHistoryOptions extends HistoryOptions {
  /** Default false. True skips stdout print and only writes HTML. */
  silent?: boolean;
}

export function runHistory(opts: RunHistoryOptions = {}): HistoryResult {
  const write = opts.write ?? ((line: string) => process.stdout.write(line));
  const result = loadHistory(opts);

  if (!opts.silent) {
    write(`rubric history: ${result.entries.length} commit(s) touching\n`);
    for (const f of result.tracked) write(`  - ${f}\n`);
    write('\n');
    for (const e of result.entries) {
      const date = e.authorDate.slice(0, 10);
      const who = e.authorName || e.authorEmail || 'unknown';
      const diffStr = `+${e.additions}/-${e.deletions}`;
      write(`  ${e.shortSha}  ${date}  ${diffStr.padEnd(12)}  ${who.padEnd(20)}  ${e.subject}\n`);
    }
    if (result.entries.length === 0) {
      write('  (no commits yet — prompts may be untracked or the repo has no history)\n');
    }
  }

  if (result.htmlPath) {
    const html = renderHistoryHtml(result);
    writeFileSync(result.htmlPath, html, 'utf8');
    write(`\n  report:  ${result.htmlPath}\n`);
  }

  return result;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderHistoryHtml(result: HistoryResult): string {
  const rows = result.entries
    .map((e) => {
      const date = e.authorDate.slice(0, 10);
      const who = escape(e.authorName || e.authorEmail || 'unknown');
      return `
      <tr>
        <td class="sha"><code>${escape(e.shortSha)}</code></td>
        <td class="date">${escape(date)}</td>
        <td class="who">${who}</td>
        <td class="diff">
          <span class="add">+${e.additions}</span>
          <span class="del">-${e.deletions}</span>
        </td>
        <td class="subject">${escape(e.subject)}</td>
      </tr>`;
    })
    .join('\n');

  const trackedList = result.tracked.map((f) => `<li><code>${escape(f)}</code></li>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>rubric history</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header>
    <h1>rubric history</h1>
    <p class="meta">${result.entries.length} commit(s) across ${result.tracked.length} tracked file(s)</p>
    <ul class="tracked">${trackedList}</ul>
  </header>
  <table>
    <thead>
      <tr>
        <th>sha</th><th>date</th><th>author</th><th>Δ</th><th>subject</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="5" class="empty">no commits</td></tr>'}</tbody>
  </table>
</main>
</body>
</html>
`;
}

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #fafaf8; color: #1a1a1a;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px; }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  .meta { color: #6b7280; margin: 0 0 12px; font-size: 13px; }
  ul.tracked { list-style: none; padding: 0; margin: 0 0 24px; display: flex; gap: 8px; flex-wrap: wrap; }
  ul.tracked code { background: #f3f4f6; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
  th { background: #f9fafb; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: #6b7280; }
  tr:last-child td { border-bottom: 0; }
  td.sha code { color: #2563eb; font-size: 13px; }
  td.date, td.who { color: #374151; font-size: 13px; }
  td.diff .add { color: #16a34a; font-weight: 600; margin-right: 6px; }
  td.diff .del { color: #dc2626; font-weight: 600; }
  td.empty { text-align: center; color: #6b7280; padding: 24px; }
  code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
`;
