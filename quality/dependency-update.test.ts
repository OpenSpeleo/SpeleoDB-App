import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runUpdate(failingCommand?: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'speleodb-update-'));
  directories.push(directory);
  const log = path.join(directory, 'commands.log');
  writeFileSync(log, '');
  for (const command of ['npx', 'npm']) {
    writeFileSync(path.join(directory, command), `#!/bin/sh
printf '%s\\n' "${command} $*" >> "$UPDATE_TEST_LOG"
if [ "${command} $*" = "$UPDATE_TEST_FAILURE" ]; then exit 17; fi
exit 0
`, { mode: 0o755 });
  }
  // A file with the target's name must not prevent dependency maintenance.
  writeFileSync(path.join(directory, 'update'), '');
  const result = spawnSync('make', ['-f', path.resolve('Makefile'), 'update'], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      MAKEFLAGS: '',
      UPDATE_TEST_LOG: log,
      UPDATE_TEST_FAILURE: failingCommand ?? '',
    },
  });
  expect(result.error).toBeUndefined();
  return {
    status: result.status,
    commands: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean),
  };
}

describe('make update', () => {
  const checkUpdates = 'npx --yes npm-check-updates -u --peer --target minor --reject react,react-dom';
  const checkReactUpdates = 'npx --yes npm-check-updates -u --peer --target patch --filter react,react-dom';

  it('checks peers within current majors before installing, even with an update file', () => {
    expect(runUpdate()).toEqual({
      status: 0,
      commands: [checkUpdates, checkReactUpdates, 'npm install'],
    });
  });

  it('does not install when the version check fails', () => {
    const result = runUpdate(checkUpdates);
    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual([checkUpdates]);
  });

  it('does not install when the React patch check fails', () => {
    const result = runUpdate(checkReactUpdates);
    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual([checkUpdates, checkReactUpdates]);
  });

  it('reports install failures without bypassing peer resolution', () => {
    const result = runUpdate('npm install');
    expect(result.status).not.toBe(0);
    expect(result.commands).toEqual([checkUpdates, checkReactUpdates, 'npm install']);
  });
});
