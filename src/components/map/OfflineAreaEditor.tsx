import { downloadAreaColor } from '../../services/downloadAreaColors';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { getTileCacheStats } from '../../services/tileCache/TileCacheRepository';
import type { MapRef } from 'react-map-gl/maplibre';
import type {
  DownloadArea,
  ManualDownloadAreaInput,
} from '../../types/downloadArea';
import {
  areaMapBounds,
  countAreaCoordinates,
  FALLBACK_TILE_BYTES,
  MAX_AREA_COORDINATES,
  validAreaCorners,
} from '../../services/downloadAreaGeometry';
import {
  clampWebMercatorLatitude,
  normalizeLongitude,
} from '../../utils/geographicBounds';

type Frame = { left: number; top: number; right: number; bottom: number };
interface EditorProps {
  initial?: DownloadArea;
  mapRef: RefObject<MapRef | null>;
  offline: boolean;
  layerCount?: number;
  onCancel(): void;
  onSave(input: ManualDownloadAreaInput): Promise<void>;
}
export function OfflineAreaEditor({
  initial,
  mapRef,
  offline,
  layerCount = 1,
  onCancel,
  onSave,
}: EditorProps) {
  const [tileBytes, setTileBytes] = useState(FALLBACK_TILE_BYTES);
  const [draft, setDraft] = useState<ManualDownloadAreaInput>(() =>
    initial
      ? { topLeft: initial.topLeft, bottomRight: initial.bottomRight }
      : { topLeft: [0, 1], bottomRight: [1, 0] },
  );
  const [frame, setFrame] = useState<Frame | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const boundsRef = useRef<Pick<
    ManualDownloadAreaInput,
    'topLeft' | 'bottomRight'
  > | null>(initial ?? null);
  const fitting = useRef(false);
  const headingRef = useRef<HTMLDivElement>(null);
  const frameLimits = useRef({ top: 56, bottom: 128 });
  const drag = useRef<{ corner: string; pointerId: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getTileCacheStats()
      .then((stats) => {
        if (alive && stats.tileCount > 0)
          setTileBytes(stats.totalBytes / stats.tileCount);
      })
      .catch(() => {}); // A size estimate must not prevent saving intent.
    return () => {
      alive = false;
    };
  }, []);
  const updateFromFrame = (next: Frame) => {
    const map = mapRef.current;
    if (!map) return;
    const tl = map.unproject([next.left, next.top]);
    const br = map.unproject([next.right, next.bottom]);
    const span = br.lng - tl.lng;
    const corners: Pick<ManualDownloadAreaInput, 'topLeft' | 'bottomRight'> = {
      topLeft: [
        span >= 360 ? -180 : normalizeLongitude(tl.lng),
        clampWebMercatorLatitude(tl.lat),
      ],
      bottomRight: [
        span >= 360 ? 180 : normalizeLongitude(br.lng),
        clampWebMercatorLatitude(br.lat),
      ],
    };
    boundsRef.current = corners;
    setDraft((current) => ({ ...current, ...corners }));
  };
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    let alive = true;
    const projectBounds = (bounds: ManualDownloadAreaInput): Frame => {
      const east =
        bounds.bottomRight[0] < bounds.topLeft[0]
          ? bounds.bottomRight[0] + 360
          : bounds.bottomRight[0];
      const tl = map.project(bounds.topLeft);
      const br = map.project([east, bounds.bottomRight[1]]);
      return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
    };
    const layout = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      // The editor and MapLibre observe the same DOM resize independently.
      // Synchronize the map transform before fitting/projecting; neither this
      // resize nor its camera events are edits to the geographic draft.
      fitting.current = true;
      map.resize();
      const top = Math.max(
        64,
        (headingRef.current?.getBoundingClientRect().bottom ?? 0) -
          container.getBoundingClientRect().top +
          24,
      );
      const bottom = Math.max(top + 64, height * 0.56 - 32);
      frameLimits.current = { top, bottom };
      let next = { left: width * 0.1, right: width * 0.9, top, bottom };
      const bounds = boundsRef.current;
      // Refitting a world-scale draft can hit Mercator/zoom limits and collapse
      // the corner targets on short screens. Preserve downloadable geometry;
      // an oversized draft keeps the normal frame so the user can zoom in.
      const preserveBounds =
        bounds &&
        validAreaCorners(bounds.topLeft, bounds.bottomRight) &&
        countAreaCoordinates(bounds) <= MAX_AREA_COORDINATES;
      if (preserveBounds) {
        map.fitBounds(
          areaMapBounds(bounds),
          {
            padding: {
              left: next.left,
              right: width - next.right,
              top: next.top,
              bottom: height - next.bottom,
            },
            duration: 0,
          },
        );
        next = projectBounds(bounds);
      }
      fitting.current = false;
      frameRef.current = next;
      queueMicrotask(() => {
        if (alive) {
          setFrame(next);
          if (!preserveBounds) updateFromFrame(next);
        }
      });
    };
    layout();
    const move = (event: { originalEvent?: Event }) => {
      if (fitting.current || !frameRef.current) return;
      if (event.originalEvent) {
        // Pan, pinch, wheel and their inertia intentionally move the selection.
        updateFromFrame(frameRef.current);
      } else if (boundsRef.current) {
        // Resize, initial fitting and other programmatic camera movement only
        // reposition the frame. Never round-trip the saved bounds through pixels.
        const next = projectBounds(boundsRef.current);
        frameRef.current = next;
        setFrame(next);
      }
    };
    map.on('move', move);
    const resize = new ResizeObserver(layout);
    resize.observe(container);
    return () => {
      alive = false;
      resize.disconnect();
      map.off('move', move);
    };
    // Initial geometry is fixed for this editor instance; movement owns subsequent bounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, initial]);
  let count = 0;
  try {
    count = countAreaCoordinates(draft);
  } catch {
    /* The map has not supplied a valid frame yet. */
  }
  const tooLarge = count > MAX_AREA_COORDINATES;
  const valid = count > 0 && !tooLarge;
  const mb = (count * layerCount * tileBytes) / 1024 / 1024;
  const moveHandle = (corner: string, x: number, y: number) => {
    const current = frameRef.current;
    const container = mapRef.current?.getContainer();
    if (!current || !container) return;
    const next = { ...current };
    if (corner.includes('left'))
      next.left = Math.max(12, Math.min(current.right - 64, x));
    else
      next.right = Math.min(
        container.clientWidth - 12,
        Math.max(current.left + 64, x),
      );
    if (corner.includes('top'))
      next.top = Math.max(
        frameLimits.current.top,
        Math.min(current.bottom - 64, y),
      );
    else
      next.bottom = Math.min(
        frameLimits.current.bottom,
        Math.max(current.top + 64, y),
      );
    frameRef.current = next;
    setFrame(next);
    updateFromFrame(next);
  };
  return (
    <>
      <div ref={headingRef} className="offline-editor-top">
        <span>
          Select an area<small>Move the map or drag the corners</small>
        </span>
      </div>
      {frame && (
        <div
          className="offline-selection-frame"
          aria-label="Selected map area"
          style={{
            borderColor: initial ? downloadAreaColor(initial) : undefined,
            left: frame.left,
            top: frame.top,
            width: frame.right - frame.left,
            height: frame.bottom - frame.top,
          }}
        >
          {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(
            (corner) => (
              <button
                key={corner}
                type="button"
                className={`offline-selection-handle ${corner}`}
                aria-label={`Resize ${corner.replace('-', ' ')} corner`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  drag.current = { corner, pointerId: event.pointerId };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (drag.current?.pointerId !== event.pointerId) return;
                  const rect = mapRef.current
                    ?.getContainer()
                    .getBoundingClientRect();
                  if (rect)
                    moveHandle(
                      corner,
                      event.clientX - rect.left,
                      event.clientY - rect.top,
                    );
                }}
                onPointerUp={(event) => {
                  drag.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                onKeyDown={(event) => {
                  if (
                    ![
                      'ArrowUp',
                      'ArrowDown',
                      'ArrowLeft',
                      'ArrowRight',
                    ].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const delta = event.shiftKey ? 10 : 1;
                  moveHandle(
                    corner,
                    (corner.includes('left') ? frame.left : frame.right) +
                      (event.key === 'ArrowLeft'
                        ? -delta
                        : event.key === 'ArrowRight'
                          ? delta
                          : 0),
                    (corner.includes('top') ? frame.top : frame.bottom) +
                      (event.key === 'ArrowUp'
                        ? -delta
                        : event.key === 'ArrowDown'
                          ? delta
                          : 0),
                  );
                }}
              />
            ),
          )}
        </div>
      )}
      <section
        className="offline-map-sheet offline-editor-sheet"
        role="dialog"
        aria-label="Select offline area"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onCancel();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || busy) return;
            setBusy(true);
            setError(null);
            void onSave(draft).catch((reason) => {
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'Unable to save this area.',
              );
              setBusy(false);
            });
          }}
        >
          <div className="offline-editor-copy">
            <p>
              {tooLarge
                ? 'Zoom in to resize'
                : `About ${mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.ceil(mb)} MB`}`}
            </p>
            <span>
              {offline ? 'Download after reconnecting' : `${layerCount} map ${layerCount === 1 ? 'layer' : 'layers'}`}
            </span>
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="offline-editor-footer">
            <button
              type="button"
              className="app-btn app-btn--secondary"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="app-btn app-btn--primary"
              disabled={!valid || busy || !frame}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
