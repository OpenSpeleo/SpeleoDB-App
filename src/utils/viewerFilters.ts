import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';

export function visibleIdsFilter(ids: Iterable<string>, property = 'id'): ExpressionSpecification {
  return ['in', ['to-string', ['coalesce', ['get', property], '']], ['literal', [...ids]]];
}

export function visibleRecordsFilter(visibility: Readonly<Record<string, boolean>>, property = 'id'): ExpressionSpecification {
  return visibleIdsFilter(Object.keys(visibility).filter(id => visibility[id]), property);
}

export function landmarkCollectionsFilter(visibility: Readonly<Record<string, boolean>>): ExpressionSpecification {
  return ['!', ['in',
    ['case', ['==', ['to-string', ['coalesce', ['get', 'collection'], '']], ''],
      '__personal__', ['to-string', ['get', 'collection']]],
    ['literal', Object.keys(visibility).filter(id => visibility[id] === false)],
  ]];
}
