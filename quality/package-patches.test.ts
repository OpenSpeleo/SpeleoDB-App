import { afterEach, describe, expect, it } from 'vitest';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { writePackagePatch } from '../scripts/write-package-patch.mjs';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('installed native package patches', () => {
  it('patches directories and linked packages despite dangling sibling links, and remains idempotent', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'speleodb-capacitor-patch-'));
    directories.push(directory);
    const packages = path.join(directory, 'node_modules', '@capacitor');
    const directPackage = path.join(packages, 'app');
    const linkedPackage = path.join(directory, 'installed-device');
    const original = "proguardFiles getDefaultProguardFile('proguard-android.txt')\napply plugin: 'kotlin-android'\n";
    const expected = "proguardFiles getDefaultProguardFile('proguard-android-optimize.txt')\nif (!project.extensions.findByName('kotlin')) {\n    apply plugin: 'kotlin-android'\n}\n";
    for (const packageDirectory of [directPackage, linkedPackage]) {
      mkdirSync(path.join(packageDirectory, 'android'), { recursive: true });
      writeFileSync(path.join(packageDirectory, 'android', 'build.gradle'), original);
    }
    symlinkSync('../../installed-device', path.join(packages, 'device'), 'dir');
    symlinkSync('../../missing-cli', path.join(packages, 'cli'), 'dir');
    writeFileSync(path.join(packages, 'metadata'), 'not a package');
    symlinkSync('metadata', path.join(packages, 'metadata-link'));

    const script = path.resolve('scripts/patch-native-dependencies.mjs');
    for (let run = 0; run < 2; run += 1) {
      execFileSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
      for (const packageDirectory of [directPackage, linkedPackage]) {
        expect(readFileSync(path.join(packageDirectory, 'android', 'build.gradle'), 'utf8')).toBe(expected);
      }
    }
  });

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
