import { describe, it, expect } from 'vitest';

import {
  buildLayerStyle,
  getAllMapLayers,
  getDefaultMapLayer,
  getForcedOfflineLayerIds,
  getLayerTileUrlPrefixes,
  getMapLayerById,
  isLayerTileUrl,
  resolveMapLayer,
} from './MapLayersService';
import { DEFAULT_MAP_LAYER_ID, MAP } from '../constants';

describe('MapLayersService', () => {
  describe('layer config invariants', () => {
    it('exposes exactly one forced (default) satellite layer', () => {
      const forced = getForcedOfflineLayerIds();
      expect(forced).toEqual(['esri-satellite']);
      expect(getDefaultMapLayer().id).toBe(DEFAULT_MAP_LAYER_ID);
      expect(getDefaultMapLayer().forcedOffline).toBe(true);
    });

    it('includes the two ESRI hillshade layers and drops Mapbox', () => {
      const ids = getAllMapLayers().map((layer) => layer.id);
      expect(ids).toContain('esri-world-hillshade');
      expect(ids).toContain('esri-world-hillshade-dark');
      expect(ids.some((id) => id.includes('mapbox'))).toBe(false);
    });

    it('gives every layer a unique id and XYZ template', () => {
      const layers = getAllMapLayers();
      const ids = new Set(layers.map((l) => l.id));
      expect(ids.size).toBe(layers.length);
      for (const layer of layers) {
        expect(layer.tileUrlTemplate).toContain('{z}');
        expect(layer.tileUrlTemplate).toContain('{x}');
        expect(layer.tileUrlTemplate).toContain('{y}');
      }
    });

    it('scopes the verified no-data fingerprint to satellite only', () => {
      expect(getMapLayerById('esri-satellite')?.noDataSha256Hashes)
        .toEqual(MAP.MISSING_TILE_SHA256_HASHES);
      expect(getMapLayerById('esri-world-hillshade')?.noDataSha256Hashes).toEqual([]);
      expect(getMapLayerById('esri-world-hillshade-dark')?.noDataSha256Hashes).toEqual([]);
    });
  });

  describe('resolveMapLayer', () => {
    it('returns the matching layer for a known id', () => {
      expect(resolveMapLayer('esri-world-hillshade').id).toBe('esri-world-hillshade');
    });

    it('falls back to the default layer for unknown / nullish ids', () => {
      expect(resolveMapLayer('nope').id).toBe(DEFAULT_MAP_LAYER_ID);
      expect(resolveMapLayer(null).id).toBe(DEFAULT_MAP_LAYER_ID);
      expect(resolveMapLayer(undefined).id).toBe(DEFAULT_MAP_LAYER_ID);
    });
  });

  describe('buildLayerStyle', () => {
    it('builds a raster style with the layer source + raw https tiles', () => {
      const layer = getMapLayerById('esri-world-hillshade')!;
      const style = buildLayerStyle('esri-world-hillshade') as {
        version: number;
        sources: Record<string, { type: string; tiles: string[]; maxzoom: number }>;
        layers: Array<{ id: string; type: string; source: string; maxzoom: number }>;
      };

      expect(style.version).toBe(8);
      expect(style.sources['esri-world-hillshade'].type).toBe('raster');
      expect(style.sources['esri-world-hillshade'].tiles).toEqual([layer.tileUrlTemplate]);
      // Source max zoom = layer configured zoom (z18, matching satellite for
      // offline parity); display layer overzooms beyond it.
      expect(style.sources['esri-world-hillshade'].maxzoom).toBe(18);
      expect(style.layers[0].source).toBe('esri-world-hillshade');
      expect(style.layers[0].maxzoom).toBeGreaterThanOrEqual(Math.ceil(MAP.MAX_ZOOM));
    });

    it('falls back to the default layer for an unknown id', () => {
      const style = buildLayerStyle('bogus') as { sources: Record<string, unknown> };
      expect(Object.keys(style.sources)).toEqual([DEFAULT_MAP_LAYER_ID]);
    });
  });

  describe('isLayerTileUrl', () => {
    it('recognizes configured raster tile URLs (raw + cached-https)', () => {
      const satellite = getMapLayerById('esri-satellite')!;
      const sample = satellite.tileUrlTemplate
        .replace('{z}', '5')
        .replace('{x}', '1')
        .replace('{y}', '2');
      expect(isLayerTileUrl(sample)).toBe(true);
      expect(isLayerTileUrl(sample.replace('https://', 'cached-https://'))).toBe(true);
    });

    it('rejects non-tile URLs', () => {
      expect(isLayerTileUrl('https://fonts.example.com/0-255.pbf')).toBe(false);
      expect(isLayerTileUrl('https://example.com/sprite.png')).toBe(false);
    });

    it('derives a non-empty prefix per layer', () => {
      const prefixes = getLayerTileUrlPrefixes();
      expect(prefixes.length).toBe(getAllMapLayers().length);
      for (const prefix of prefixes) {
        expect(prefix.length).toBeGreaterThan(0);
        expect(prefix).not.toContain('{z}');
      }
    });
  });
});
