import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideBanner, resolveBannerOnce } from './migration-banner.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'rubric-banner-'));
}

describe('decideBanner', () => {
  test('fires when upgrading from v2.1 to v2.2', () => {
    expect(decideBanner('2.1.0', '2.2.0')).toContain('removed');
    expect(decideBanner('2.1.5', '2.2.3')).toContain('removed');
  });

  test('fires when marker is missing', () => {
    expect(decideBanner(null, '2.2.0')).toContain('removed');
  });

  test('suppressed once marker already records v2.2+', () => {
    expect(decideBanner('2.2.0', '2.2.0')).toBeNull();
    expect(decideBanner('2.2.1', '2.2.3')).toBeNull();
  });

  test('does not fire on later majors / other minors', () => {
    expect(decideBanner('2.1.0', '2.3.0')).toBeNull();
    expect(decideBanner(null, '3.0.0')).toBeNull();
  });

  test('unparseable recorded version is treated as pre-2.2', () => {
    expect(decideBanner('not-a-version', '2.2.0')).toContain('removed');
  });

  test('unparseable current version prints nothing', () => {
    expect(decideBanner(null, 'garbage')).toBeNull();
  });
});

describe('resolveBannerOnce', () => {
  test('first call writes the marker and returns the banner', () => {
    const dir = scratch();
    try {
      const marker = join(dir, '.last-cli-version');
      const banner = resolveBannerOnce('2.2.0', marker);
      expect(banner).toContain('removed');
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, 'utf8').trim()).toBe('2.2.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('second call on same version returns null', () => {
    const dir = scratch();
    try {
      const marker = join(dir, '.last-cli-version');
      resolveBannerOnce('2.2.0', marker);
      expect(resolveBannerOnce('2.2.0', marker)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('upgrade from 2.1 fires banner and updates marker', () => {
    const dir = scratch();
    try {
      const marker = join(dir, '.last-cli-version');
      writeFileSync(marker, '2.1.0', 'utf8');
      const banner = resolveBannerOnce('2.2.0', marker);
      expect(banner).toContain('removed');
      expect(readFileSync(marker, 'utf8').trim()).toBe('2.2.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
