import { createGeometryLabelFeature } from '@speleodb/map-core';

type Label = ReturnType<typeof createGeometryLabelFeature>;
interface Entry {
  revision: unknown;
  alias: unknown;
  color: unknown;
  geometry: GeoJSON.Geometry;
  label: Label;
}

/** Late peer details do not repeat bounded polygon searches for existing records. */
export class GeometryLabelFeatureCache {
  private readonly entries = new Map<string, Entry>();

  prepare(source: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection<GeoJSON.Point> {
    const present = new Set<string>();
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const feature of source.features) {
      if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'Polygon') continue;
      const { id, revision, alias = '', color } = feature.properties ?? {};
      if (typeof id !== 'string') continue;
      present.add(id);
      let entry = this.entries.get(id);
      if (!entry || entry.revision !== revision || entry.alias !== alias || entry.color !== color
        || (revision === undefined && entry.geometry !== feature.geometry)) {
        entry = { revision, alias, color, geometry: feature.geometry,
          label: createGeometryLabelFeature({ id, alias, color, geometry: feature.geometry }) };
        this.entries.set(id, entry);
      }
      if (entry.label) features.push(entry.label);
    }
    for (const id of this.entries.keys()) if (!present.has(id)) this.entries.delete(id);
    return { type: 'FeatureCollection', features };
  }
}
