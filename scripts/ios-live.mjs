import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

const host = process.env.IOS_LIVE_HOST ?? Object.values(networkInterfaces()).flat()
  .find(address => address?.family === 'IPv4' && !address.internal)?.address ?? '127.0.0.1';
const port = Number(process.env.IOS_LIVE_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('IOS_LIVE_PORT must be a valid TCP port.');
const generatedConfigPath = path.resolve('ios/App/App/capacitor.config.json');
let child;
let stopping = false;
let generatedConfig;
let server;

function stop(signal) {
  stopping = true;
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  // Capacitor restores its live URL on SIGINT. Stop its entire native build
  // process group and await exit before restoring our own post-sync snapshot.
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGINT'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
const interrupt = () => stop('SIGINT');
const terminate = () => stop('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);

async function run(args, label) {
  const code = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { stdio: 'inherit', detached: true });
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 1));
  });
  child = undefined;
  if (code !== 0 && !stopping) {
    process.exitCode = code;
    throw new Error(`${label} exited with code ${code}.`);
  }
}

const cap = args => run([
  // Match the canonical cap script, but await the actual CLI process so its
  // asynchronous native-config restoration finishes before our own cleanup.
  '--preserve-symlinks', path.resolve('node_modules/@capacitor/cli/bin/capacitor'), ...args,
], 'Capacitor');

try {
  if (!existsSync('dist/index.html')) await run(['run', 'build'], 'Web asset build');
  if (!stopping) {
    server = await createServer({
      configLoader: 'native', server: { host: '0.0.0.0', port, strictPort: true },
    });
    await server.listen();
    server.printUrls();
    if (!stopping) await cap(['sync', 'ios']);
    if (!stopping) {
      generatedConfig = await readFile(generatedConfigPath);
      if (!stopping) await cap(['run', 'ios', '--no-sync', '--live-reload', '--host', host, '--port', String(port), ...process.argv.slice(2)]);
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode ||= 1;
} finally {
  // Capacitor registers its interrupt handler only after native deployment.
  // Preserve the authored URL even when interrupted during that earlier build.
  try {
    if (generatedConfig !== undefined) await writeFile(generatedConfigPath, generatedConfig);
  } finally {
    await server?.close();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}
