import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activeOverrides,
  appendOverride,
  computeContentKey,
  defaultOverridesRoot,
  formatCellRef,
  loadActiveOverrides,
  overridesLogPaths,
  parseCellRef,
  projectSlug,
  readOverrideLog,
  type OverrideRecord,
} from './log.ts';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});
function newRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'rubric-overrides-'));
  tmpDirs.push(d);
  return d;
}

const SAMPLE_CONFIG = '/tmp/fake/rubric.config.json';

describe('projectSlug', () => {
  it('derives a stable lowercase slug with 8-hex suffix', () => {
    const a = projectSlug('/Users/me/work/refund-classifier/rubric.config.json');
    const b = projectSlug('/Users/me/work/refund-classifier/rubric.config.json');
    expect(a).toBe(b);
    expect(a).toMatch(/^refund-classifier-[0-9a-f]{8}$/);
  });

  it('sanitizes exotic directory names', () => {
    const s = projectSlug('/tmp/My Project 🌟/rubric.config.json');
    expect(s).toMatch(/^my-project-[0-9a-f]{8}$/);
  });

  it('different paths produce different slugs', () => {
    const a = projectSlug('/tmp/proj-a/rubric.config.json');
    const b = projectSlug('/tmp/proj-b/rubric.config.json');
    expect(a).not.toBe(b);
  });
});

describe('overridesLogPaths', () => {
  it('returns dir, file, and slug under the given root', () => {
    const root = '/tmp/overrides-root';
    const p = overridesLogPaths(SAMPLE_CONFIG, root);
    expect(p.dir).toBe(root);
    expect(p.file).toBe(join(root, `${p.slug}.jsonl`));
    expect(p.slug.length).toBeGreaterThan(8);
  });
});

describe('defaultOverridesRoot', () => {
  it('respects RUBRIC_HOME when present', () => {
    const r = defaultOverridesRoot({ RUBRIC_HOME: '/opt/rubric' } as NodeJS.ProcessEnv);
    expect(r).toBe('/opt/rubric/overrides');
  });

  it('falls back to ~/.rubric/overrides otherwise', () => {
    const r = defaultOverridesRoot({} as NodeJS.ProcessEnv);
    expect(r).toMatch(/\.rubric\/overrides$/);
  });
});

describe('computeContentKey', () => {
  const base = {
    promptA: 'A', promptB: 'B', inputText: 'x',
    modelA: 'openai/gpt-4o', modelB: 'openai/gpt-4o',
    judgeModelId: 'openai/gpt-4o', judgeRubricId: 'default',
  };
  it('is deterministic', () => {
    expect(computeContentKey(base)).toBe(computeContentKey(base));
  });
  it('changes when any field changes', () => {
    const base64 = computeContentKey(base);
    for (const k of Object.keys(base) as Array<keyof typeof base>) {
      const mutated = { ...base, [k]: base[k] + '!' };
      expect(computeContentKey(mutated)).not.toBe(base64);
    }
  });
  it('produces a 64-char sha256 hex', () => {
    expect(computeContentKey(base).length).toBe(64);
  });
});

describe('appendOverride + readOverrideLog round-trip', () => {
  it('writes one JSON record per call under the project slug', () => {
    const root = newRoot();
    const contentKey = computeContentKey({
      promptA: 'a', promptB: 'b', inputText: 'c',
      modelA: 'openai/x', modelB: 'openai/x',
      judgeModelId: 'openai/x', judgeRubricId: 'default',
    });
    appendOverride(SAMPLE_CONFIG, {
      op: 'override', cellRef: 'case-0/openai/x', contentKey,
      verdict: 'b', reason: 'more concise', runId: 'r-test',
    }, root);
    appendOverride(SAMPLE_CONFIG, {
      op: 'override', cellRef: 'case-0/openai/x', contentKey,
      verdict: 'a', reason: 'changed my mind', runId: 'r-test',
    }, root);

    const records = readOverrideLog(SAMPLE_CONFIG, root);
    expect(records.length).toBe(2);
    expect(records[0]!.verdict).toBe('b');
    expect(records[1]!.verdict).toBe('a');
  });

  it('returns [] when no log file exists for this project', () => {
    const root = newRoot();
    expect(readOverrideLog(SAMPLE_CONFIG, root)).toEqual([]);
  });

  it('skips corrupt/partial lines without throwing', () => {
    const root = newRoot();
    const contentKey = 'x'.repeat(64);
    appendOverride(SAMPLE_CONFIG, {
      op: 'override', cellRef: 'case-0/openai/x', contentKey, verdict: 'b',
    }, root);
    const paths = overridesLogPaths(SAMPLE_CONFIG, root);
    const raw = readFileSync(paths.file, 'utf8');
    // Append garbage + a valid second line.
    const { writeFileSync } = require('node:fs');
    writeFileSync(paths.file, raw + '{not valid\n' + JSON.stringify({
      version: 1, op: 'override', ts: '2026-04-27T00:00:00.000Z',
      cellRef: 'case-1/openai/x', contentKey, verdict: 'a',
    }) + '\n', 'utf8');
    const records = readOverrideLog(SAMPLE_CONFIG, root);
    // Two valid, one garbage skipped.
    expect(records.length).toBe(2);
  });
});

describe('activeOverrides collapse', () => {
  const ck = (s: string) => s.padEnd(64, '0');

  it('latest override per contentKey wins', () => {
    const records: OverrideRecord[] = [
      { version: 1, op: 'override', ts: '2026-04-01T00:00:00Z', cellRef: 'case-0/x/y', contentKey: ck('a'), verdict: 'a' },
      { version: 1, op: 'override', ts: '2026-04-02T00:00:00Z', cellRef: 'case-0/x/y', contentKey: ck('a'), verdict: 'b', reason: 'newer' },
    ];
    const actives = activeOverrides(records);
    expect(actives.size).toBe(1);
    expect(actives.get(ck('a'))!.verdict).toBe('b');
    expect(actives.get(ck('a'))!.reason).toBe('newer');
  });

  it('undo cancels the preceding override', () => {
    const records: OverrideRecord[] = [
      { version: 1, op: 'override', ts: '2026-04-01T00:00:00Z', cellRef: 'r', contentKey: ck('k'), verdict: 'a' },
      { version: 1, op: 'undo',     ts: '2026-04-02T00:00:00Z', cellRef: 'r', contentKey: ck('k') },
    ];
    const actives = activeOverrides(records);
    expect(actives.has(ck('k'))).toBe(false);
  });

  it('re-override after undo reactivates', () => {
    const records: OverrideRecord[] = [
      { version: 1, op: 'override', ts: '2026-04-01T00:00:00Z', cellRef: 'r', contentKey: ck('k'), verdict: 'a' },
      { version: 1, op: 'undo',     ts: '2026-04-02T00:00:00Z', cellRef: 'r', contentKey: ck('k') },
      { version: 1, op: 'override', ts: '2026-04-03T00:00:00Z', cellRef: 'r', contentKey: ck('k'), verdict: 'tie', reason: 'second thoughts' },
    ];
    const actives = activeOverrides(records);
    expect(actives.get(ck('k'))!.verdict).toBe('tie');
    expect(actives.get(ck('k'))!.reason).toBe('second thoughts');
  });

  it('overrides for different contentKeys live independently', () => {
    const records: OverrideRecord[] = [
      { version: 1, op: 'override', ts: '2026-04-01T00:00:00Z', cellRef: 'a', contentKey: ck('1'), verdict: 'a' },
      { version: 1, op: 'override', ts: '2026-04-02T00:00:00Z', cellRef: 'b', contentKey: ck('2'), verdict: 'b' },
    ];
    const actives = activeOverrides(records);
    expect(actives.size).toBe(2);
  });
});

describe('loadActiveOverrides convenience', () => {
  it('returns empty map when no log exists', () => {
    const root = newRoot();
    const m = loadActiveOverrides(SAMPLE_CONFIG, root);
    expect(m.size).toBe(0);
  });

  it('reads + collapses in one step', () => {
    const root = newRoot();
    const contentKey = computeContentKey({
      promptA: 'a', promptB: 'b', inputText: 'c',
      modelA: 'openai/x', modelB: 'openai/x',
      judgeModelId: 'openai/x', judgeRubricId: 'default',
    });
    appendOverride(SAMPLE_CONFIG, { op: 'override', cellRef: 'case-0/openai/x', contentKey, verdict: 'b' }, root);
    const m = loadActiveOverrides(SAMPLE_CONFIG, root);
    expect(m.size).toBe(1);
    expect(m.get(contentKey)!.verdict).toBe('b');
  });
});

describe('parseCellRef + formatCellRef', () => {
  it('parses a well-formed ref', () => {
    const { caseIndex, modelA } = parseCellRef('case-17/openai/gpt-4o');
    expect(caseIndex).toBe(17);
    expect(modelA).toBe('openai/gpt-4o');
  });

  it('round-trips through format + parse', () => {
    const s = formatCellRef(3, 'openai/gpt-4o-mini');
    const { caseIndex, modelA } = parseCellRef(s);
    expect(caseIndex).toBe(3);
    expect(modelA).toBe('openai/gpt-4o-mini');
  });

  it('rejects malformed refs with a helpful message', () => {
    expect(() => parseCellRef('case-XX/openai/gpt-4o')).toThrow(/invalid case segment/);
    expect(() => parseCellRef('case-1/openai')).toThrow(/invalid model segment/);
    expect(() => parseCellRef('not-a-ref')).toThrow(/must be/);
  });
});

describe('file shape', () => {
  it('each record ends with a newline so `tail -f` is sane', () => {
    const root = newRoot();
    const contentKey = 'x'.repeat(64);
    appendOverride(SAMPLE_CONFIG, { op: 'override', cellRef: 'case-0/x/y', contentKey, verdict: 'b' }, root);
    const paths = overridesLogPaths(SAMPLE_CONFIG, root);
    const raw = readFileSync(paths.file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('creates the overrides dir if it does not exist', () => {
    const root = join(newRoot(), 'fresh-subdir');
    expect(existsSync(root)).toBe(false);
    appendOverride(SAMPLE_CONFIG, { op: 'override', cellRef: 'case-0/x/y', contentKey: 'z'.repeat(64), verdict: 'a' }, root);
    expect(existsSync(root)).toBe(true);
  });
});
