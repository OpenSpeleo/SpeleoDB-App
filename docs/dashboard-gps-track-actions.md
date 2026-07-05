# Dashboard GPS Track Actions

## Intent

GPS track interaction state is isolated from Dashboard map and landmark
orchestration. The extraction preserves the controller façade while giving
visibility, lazy geometry, GPX sharing, map zoom, and track mutation dialogs a
single React owner.

## Ownership boundary

`useDashboardGpsTrackActions` owns:

- per-track visibility restored from and written to preferences;
- the in-memory geometry cache, loading identifiers, and sequential restoration
  of visible track geometry;
- the memoized GeoJSON feature collection consumed by `GpsMapLayers`;
- GPX preparation/share dispatch and redacted action diagnostics;
- upload, edit, and delete target/busy state plus mounted-completion guards;
- track-row zoom, bounds fitting, and closing the GPS panel after a valid fit.

The hook depends on only the required controller methods, a map ref, toast and
panel callbacks, and injectable sharing, preference, and diagnostic ports.
`Dashboard` wires those outputs into `GpsPanel`, `GpsMapLayers`, and
`DashboardGpsTrackDialogs`; it no longer owns track-action state or duplicates
geometry loading. Durable track state, offline mutation policy, GPX conversion,
and server synchronization remain in the GPS track coordinators behind the
controller façade.

## Testing and verification

The direct hook suite covers restored visibility, cached and failed geometry,
unmount races, valid/invalid map bounds, GPX preparation and sharing, online and
offline upload feedback, busy guards, edit normalization, deletion cleanup, and
all error paths. It has 100% statement, branch, function, and line coverage. The
Dashboard characterization suite continues to verify the user-visible panel,
map, upload, edit, and legacy-color flows across the extracted boundary.

## Performance implications

Geometry remains lazy and cached per track; cached toggles and zooms do not
refetch. Visible-track GeoJSON is memoized and hidden or incomplete tracks do
not allocate map features. The hook adds no polling or timers. Its production
module is below 600 lines and each function is below 80 lines.
