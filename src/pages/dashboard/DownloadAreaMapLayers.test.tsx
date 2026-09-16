import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MapRef } from 'react-map-gl/maplibre';
import { DownloadAreaMapLayers } from './DownloadAreaMapLayers';
import { DownloadAreaType, type DownloadArea } from '../../types/downloadArea';

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({
    id,
    data,
    children,
  }: {
    id: string;
    data: unknown;
    children: React.ReactNode;
  }) => (
    <div data-source={id} data-geojson={JSON.stringify(data)}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(
              child as React.ReactElement<{ source?: string }>,
              { source: id },
            )
          : child,
      )}
    </div>
  ),
  Layer: ({
    id,
    source,
    paint,
  }: {
    id: string;
    source?: string;
    paint: unknown;
  }) => (
    <div
      data-layer={id}
      data-owner={source}
      data-paint={JSON.stringify(paint)}
    />
  ),
}));
afterEach(cleanup);
it('binds all layers directly, filters automatic/hidden areas, and reinstalls the pattern after style replacement', async () => {
  let styleLoaded = false;
  let hasImage = false;
  const map = {
    hasImage: vi.fn(() => hasImage),
    addImage: vi.fn(() => {
      hasImage = true;
    }),
    isStyleLoaded: () => styleLoaded,
    on: vi.fn(),
    off: vi.fn(),
  };
  const mapRef = { current: { getMap: () => map } as unknown as MapRef };
  const area: DownloadArea = {
    areaId: 'manual',
    color: '#fb923c',
    type: DownloadAreaType.Manual,
    objectId: null,
    topLeft: [179, 1],
    bottomRight: [-179, 0],
    visible: true,
    revision: 1,
    sourceKey: 'manual',
    sourceRevision: null,
    layerIds: ['esri-satellite'],
  };
  const { container, unmount } = render(
    <DownloadAreaMapLayers
      areas={[
        area,
        { ...area, areaId: 'hidden', visible: false },
        { ...area, areaId: 'auto', type: DownloadAreaType.Project },
      ]}
      mapRef={mapRef}
    />,
  );
  expect(
    container.querySelectorAll('[data-owner="download-areas"]'),
  ).toHaveLength(3);
  const data = JSON.parse(
    container.querySelector('[data-source]')!.getAttribute('data-geojson')!,
  );
  expect(data.features).toHaveLength(1);
  expect(data.features[0].properties.color).toBe('#fb923c');
  expect(
    container.querySelector('[data-layer="download-areas-fill"]'),
  ).toHaveAttribute(
    'data-paint',
    JSON.stringify({ 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 }),
  );
  expect(data.features[0].geometry.type).toBe('MultiPolygon');
  expect(map.addImage).not.toHaveBeenCalled();
  styleLoaded = true;
  const styleChange = map.on.mock.calls[0][1];
  await act(async () => styleChange());
  await waitFor(() =>
    expect(
      container.querySelector('[data-layer="download-areas-stripes"]'),
    ).toHaveAttribute(
      'data-paint',
      JSON.stringify({ 'fill-pattern': 'offline-area-stripes' }),
    ),
  );
  expect(map.addImage).toHaveBeenCalledWith(
    'offline-area-stripes',
    expect.objectContaining({
      width: 16,
      height: 16,
      data: expect.any(Uint8Array),
    }),
  );
  await act(async () => styleChange());
  expect(map.addImage).toHaveBeenCalledTimes(1);
  hasImage = false;
  await act(async () => styleChange());
  expect(map.addImage).toHaveBeenCalledTimes(2);
  unmount();
  expect(map.off).toHaveBeenCalledWith('styledata', styleChange);
});
