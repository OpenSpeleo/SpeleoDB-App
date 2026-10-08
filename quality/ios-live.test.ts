import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const temporaryRoots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).filter(child => child.exitCode === null && child.signalCode === null).map(child => new Promise<void>(resolve => {
    child.once('close', () => resolve());
    child.kill('SIGTERM');
  })));
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(fail: boolean) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'speleodb-ios-live-'));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules/vite'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules/@capacitor/cli/bin'), { recursive: true });
  copyFileSync('scripts/ios-live.mjs', path.join(root, 'scripts/ios-live.mjs'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { build: 'bun fake-build.mjs' } }));
  writeFileSync(path.join(root, 'node_modules/vite/package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }));
  writeFileSync(path.join(root, 'node_modules/vite/index.mjs'), `
    import { appendFileSync } from 'node:fs';
    export async function createServer() { return {
      async listen() { appendFileSync('events', 'listen\\n'); }, printUrls() {},
      async close() { appendFileSync('events', 'close\\n'); },
    }; }
  `);
  writeFileSync(path.join(root, 'fake-build.mjs'), `
    import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
    mkdirSync('dist', { recursive: true });
    writeFileSync('dist/index.html', '<!doctype html>');
    appendFileSync('events', 'build\\n');
  `);
  writeFileSync(path.join(root, 'node_modules/@capacitor/cli/bin/capacitor'), `
    import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
    const config = 'ios/App/App/capacitor.config.json';
    if (process.argv[2] === 'sync') {
      mkdirSync('ios/App/App', { recursive: true });
      writeFileSync(config, 'original-config');
    } else {
      writeFileSync(config, 'temporary-live-url');
      appendFileSync('events', 'run\\n');
      ${fail ? 'process.exit(7);' : "process.on('SIGINT', async () => { appendFileSync('events', 'interrupt\\n'); await new Promise(resolve => setTimeout(resolve, 60)); writeFileSync(config, 'cap-cleanup'); appendFileSync('events', 'child-cleanup\\n'); process.exit(0); }); setInterval(() => {}, 1000);"}
    }
  `);
  const child = spawn(process.execPath, ['scripts/ios-live.mjs'], {
    cwd: root, env: { ...process.env, IOS_LIVE_HOST: '127.0.0.1' }, stdio: 'pipe',
  });
  children.push(child);
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { root, child, exited };
}

describe('Bun iOS live session', () => {
  it('forwards termination as an interrupt, restores config, then closes Vite', async () => {
    const { root, child, exited } = fixture(false);
    await vi.waitFor(() => {
      expect(existsSync(path.join(root, 'events'))).toBe(true);
      expect(readFileSync(path.join(root, 'events'), 'utf8')).toContain('run\n');
    });
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
    expect(readFileSync(path.join(root, 'ios/App/App/capacitor.config.json'), 'utf8')).toBe('original-config');
    expect(readFileSync(path.join(root, 'events'), 'utf8')).toBe('build\nlisten\nrun\ninterrupt\nchild-cleanup\nclose\n');
  });

  it('restores config and closes Vite when native deployment fails', async () => {
    const { root, exited } = fixture(true);
    expect(await exited).toBe(7);
    expect(readFileSync(path.join(root, 'ios/App/App/capacitor.config.json'), 'utf8')).toBe('original-config');
    expect(readFileSync(path.join(root, 'events'), 'utf8')).toBe('build\nlisten\nrun\nclose\n');
  });
});
