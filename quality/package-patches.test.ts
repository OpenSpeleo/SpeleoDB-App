import { afterEach, describe, expect, it } from 'vitest';
import { linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePackagePatch } from '../scripts/write-package-patch.mjs';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('installed native package patches', () => {
  it('replaces a hardlinked installed file without altering the package cache', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'speleodb-package-patch-'));
    directories.push(directory);
    const cache = path.join(directory, 'cache.swift');
    const installed = path.join(directory, 'installed.swift');
    writeFileSync(cache, 'original', { mode: 0o644 });
    linkSync(cache, installed);
    writePackagePatch(installed, 'patched');
    expect(readFileSync(installed, 'utf8')).toBe('patched');
    expect(readFileSync(cache, 'utf8')).toBe('original');
    expect(statSync(installed).mode & 0o777).toBe(0o644);
    expect(readdirSync(directory).sort()).toEqual(['cache.swift', 'installed.swift']);
  });
});
