import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const names = ['@speleodb/map-core', '@speleodb/map-viewer'];
for (const name of names) {
    const dependency = manifest.dependencies?.[name];
    if (typeof dependency !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(dependency)) {
        console.error(`Standalone release unavailable: ${name} must pin an exact stable npm version. Use the monorepo local source overlay for local development.`);
        process.exitCode = 1;
    }
}
if (manifest.overrides?.['@speleodb/map-core'] !== manifest.dependencies?.['@speleodb/map-core']) {
    console.error('Standalone release unavailable: the map-core override must exactly match its direct npm dependency so map-viewer resolves the same core version.');
    process.exitCode = 1;
}
