import path from 'node:path';
import { patchMapLibre } from '@speleodb/map-viewer/tooling/maplibre-gestures';

// The app chooses its installed renderer; the shared package owns the correction.
const changed = patchMapLibre(path.join(process.cwd(), 'node_modules/maplibre-gl'));
console.log(`[maplibre-patch] Gesture fixes verified (${changed} files updated).`);
