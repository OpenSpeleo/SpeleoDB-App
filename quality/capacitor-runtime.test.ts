import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Bun Capacitor CLI integration', () => {
  it('generates portable app-local Android plugin paths through a symlinked dependency tree', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'speleodb-capacitor-paths-'));
    temporaryRoots.push(root);
    copyFileSync('package.json', path.join(root, 'package.json'));
    writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify({
      appId: 'org.speleodb.portability', appName: 'Portability', webDir: 'dist',
    }));
    mkdirSync(path.join(root, 'dist'), { recursive: true });
    writeFileSync(path.join(root, 'dist/index.html'), '<!doctype html><title>Portability</title>');
    mkdirSync(path.join(root, 'android/app/src/main'), { recursive: true });
    writeFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), '<manifest/>');
    writeFileSync(path.join(root, 'android/app/build.gradle'), '');
    symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir');
    const result = spawnSync(process.execPath, ['run', 'cap', 'sync', 'android'], {
      cwd: root, encoding: 'utf8', env: process.env,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const settings = readFileSync(path.join(root, 'android/capacitor.settings.gradle'), 'utf8');
    const pluginPaths = [...settings.matchAll(/new File\('([^']+)'\)/g)].map(match => match[1]);
    expect(pluginPaths.length).toBeGreaterThan(1);
    expect(pluginPaths).toContain('../node_modules/@capacitor/android/capacitor');
    for (const pluginPath of pluginPaths) {
      expect(pluginPath).toMatch(/^\.\.\/node_modules\//);
      expect(existsSync(path.resolve(root, 'android', pluginPath))).toBe(true);
    }
  });
});
