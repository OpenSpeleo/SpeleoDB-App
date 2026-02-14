import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = {
  ios: {
    dsnKeys: ['SENTRY_DSN_IOS', 'VITE_SENTRY_DSN_IOS'],
    publicDirParts: ['ios', 'App', 'App', 'public'],
  },
  android: {
    dsnKeys: ['SENTRY_DSN_ANDROID', 'VITE_SENTRY_DSN_ANDROID'],
    publicDirParts: ['android', 'app', 'src', 'main', 'assets', 'public'],
  },
};

function parseDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const env = {};
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const lineWithoutExport = line.startsWith('export ') ? line.slice(7) : line;
    const separatorIndex = lineWithoutExport.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = lineWithoutExport.slice(0, separatorIndex).trim();
    let value = lineWithoutExport.slice(separatorIndex + 1).trim();

    if (!key) continue;

    const hasWrappingDoubleQuotes = value.startsWith('"') && value.endsWith('"');
    const hasWrappingSingleQuotes = value.startsWith("'") && value.endsWith("'");

    if (hasWrappingDoubleQuotes || hasWrappingSingleQuotes) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function loadEnv(repoRoot) {
  return {
    ...parseDotEnv(path.join(repoRoot, '.env')),
    ...parseDotEnv(path.join(repoRoot, '.env.local')),
  };
}

function firstDefinedValue(keys, source) {
  for (const key of keys) {
    const value = source[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    console.error(`[sentry] Failed to execute "${command}": ${result.error.message}`);
    console.error(
      '[sentry] If this is an Xcode build, ensure NODE_BINARY and/or NPM_BINARY are set.',
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveNpmCommand(env) {
  const explicitNpmBinary = env.NPM_BINARY?.trim();
  if (explicitNpmBinary) {
    return { command: explicitNpmBinary, argsPrefix: [] };
  }

  const npmExecPath = env.npm_execpath?.trim();
  if (npmExecPath) {
    return {
      command: process.execPath,
      argsPrefix: [npmExecPath],
    };
  }

  const npmBinaryName = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmNextToNode = path.join(path.dirname(process.execPath), npmBinaryName);
  if (existsSync(npmNextToNode)) {
    return { command: npmNextToNode, argsPrefix: [] };
  }

  return { command: npmBinaryName, argsPrefix: [] };
}

function main() {
  const platform = process.argv[2];
  if (!platform || !(platform in TARGETS)) {
    console.error('Usage: node scripts/build-native-assets.mjs <ios|android>');
    process.exit(1);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const target = TARGETS[platform];
  const fileEnv = loadEnv(repoRoot);
  const resolvedEnv = {
    ...fileEnv,
    ...process.env,
  };

  const dsn = firstDefinedValue(target.dsnKeys, resolvedEnv);
  if (!dsn) {
    console.error(
      `[sentry] Missing DSN for ${platform}. Set one of: ${target.dsnKeys.join(', ')}`,
    );
    process.exit(1);
  }

  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const nodeDir = path.dirname(process.execPath);
  const currentPath = resolvedEnv.PATH ?? '';
  const pathWithNode = currentPath
    .split(pathSeparator)
    .filter(Boolean)
    .includes(nodeDir)
    ? currentPath
    : `${nodeDir}${currentPath ? `${pathSeparator}${currentPath}` : ''}`;

  const buildEnv = {
    ...resolvedEnv,
    PATH: pathWithNode,
    VITE_SENTRY_DSN: dsn,
  };
  const npm = resolveNpmCommand(buildEnv);

  console.log(`[sentry] Building web assets for ${platform}...`);
  run(npm.command, [...npm.argsPrefix, 'run', 'build'], { cwd: repoRoot, env: buildEnv });

  const distDir = path.join(repoRoot, 'dist');
  if (!existsSync(distDir)) {
    console.error('[sentry] Build succeeded but dist/ was not found.');
    process.exit(1);
  }

  const publicDir = path.join(repoRoot, ...target.publicDirParts);
  mkdirSync(path.dirname(publicDir), { recursive: true });
  rmSync(publicDir, { recursive: true, force: true });
  cpSync(distDir, publicDir, { recursive: true });

  console.log(`[sentry] Synced assets to ${publicDir}`);
}

main();
