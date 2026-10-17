import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

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
});
