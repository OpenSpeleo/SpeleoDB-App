import { execFileSync } from 'node:child_process';

const [lane, minimumRuntime = '15.0', fieldFlag, requestedField] = process.argv.slice(2);
if (lane !== 'minimum' && lane !== 'latest') {
  throw new Error('Usage: select-ios-simulator.mjs <minimum|latest> [minimum-runtime] [--field name]');
}

const payload = JSON.parse(execFileSync(
  'xcrun',
  ['simctl', 'list', '--json', 'devices', 'available'],
  { encoding: 'utf8' },
));

const candidates = Object.entries(payload.devices)
  .filter(([runtime]) => runtime.includes('SimRuntime.iOS-'))
  .flatMap(([runtime, devices]) => {
    const version = runtime.split('SimRuntime.iOS-')[1].replaceAll('-', '.');
    return devices
      .filter((device) => device.isAvailable && device.name.startsWith('iPhone'))
      .map((device) => ({ ...device, runtime: version }));
  });

const versionParts = (version) => version.split('.').map(Number);
const compareVersions = (left, right) => {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const eligible = lane === 'minimum'
  ? candidates.filter((candidate) => candidate.runtime === minimumRuntime)
  : candidates;
if (eligible.length === 0) {
  throw new Error(
    lane === 'minimum'
      ? `No available iPhone simulator uses the required minimum iOS ${minimumRuntime} runtime`
      : 'No available iPhone simulator runtime was found',
  );
}

eligible.sort((left, right) => compareVersions(left.runtime, right.runtime));
const selected = lane === 'minimum' ? eligible[0] : eligible.at(-1);
const result = { udid: selected.udid, name: selected.name, runtime: selected.runtime };

if (fieldFlag === '--field') {
  if (!(requestedField in result)) throw new Error(`Unknown simulator field: ${requestedField}`);
  process.stdout.write(String(result[requestedField]));
} else {
  for (const [key, value] of Object.entries(result)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}
