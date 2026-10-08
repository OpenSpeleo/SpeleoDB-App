import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const names = ['@speleodb/map-core', '@speleodb/map-viewer'];
for (const name of names) {
    const dependency = manifest.dependencies?.[name];
    if (typeof dependency !== 'string' || !/^git\+https:\/\/github\.com\/[^/]+\/[^#]+#[a-f0-9]{40}$/.test(dependency)) {
        console.error(`Standalone release unavailable: ${name} needs its public GitHub URL and full 40-character commit SHA. Use an immutable commit from the package repository; use the monorepo local source overlay for local development.`);
        process.exitCode = 1;
    }
}
if (manifest.overrides?.['@speleodb/map-core'] !== manifest.dependencies?.['@speleodb/map-core']) {
    console.error('Standalone release unavailable: the map-core override must exactly match its direct Git dependency so map-viewer resolves the same core revision.');
    process.exitCode = 1;
}
