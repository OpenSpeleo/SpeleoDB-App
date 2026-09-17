import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MapRef } from 'react-map-gl/maplibre';
import type { GisGeometryMapRecord, GisGeometrySnapshot } from '../../types/gisGeometry';
import { gisMetadata, gisRecord, gisSnapshot } from '../../test/gisGeometryFixtures';
import { useGisGeometries } from '../../hooks/useGisGeometries';
import { useDashboardGisGeometryActions } from './useDashboardGisGeometryActions';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(initial = gisSnapshot()) {
  const listeners = new Set<() => void>();
  const source = {
    gisGeometrySnapshot: initial,
    subscribeGisGeometries: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getGisGeometryDetail: vi.fn(async (id: string): Promise<GisGeometryMapRecord> => source.gisGeometrySnapshot.records[id]),
  };
  const publish = (updates: Partial<GisGeometrySnapshot>) => {
    source.gisGeometrySnapshot = { ...source.gisGeometrySnapshot, ...updates };
    listeners.forEach(listener => listener());
  };
  const fitBounds = vi.fn();
  const mapRef = { current: { fitBounds } as unknown as MapRef | null };
  const onClosePanel = vi.fn();
  const hook = renderHook(({ active }) => {
    const snapshot = useGisGeometries(source);
    return useDashboardGisGeometryActions({ source, snapshot, mapRef, panelActive: active, onClosePanel });
  }, { initialProps: { active: true } });
  return { ...hook, source, publish, fitBounds, mapRef, onClosePanel, listeners };
}

describe('GIS Geometry display intent and zoom', () => {
  it('starts hidden even with cached geometry and keeps toggling independent of the camera', () => {
    const record = gisRecord();
    const state = setup(gisSnapshot({ records: { [record.detail.id]: record } }));
    expect(state.result.current.visibleCount).toBe(0);
    act(() => state.result.current.toggle(record.detail.id, true));
    expect(state.result.current.featureCollection.features).toEqual([
      { ...record.feature, properties: { name: record.detail.name, color: record.detail.color } },
    ]);
    act(() => state.result.current.toggle(record.detail.id, false));
    expect(state.result.current.visibleCount).toBe(0);
    expect(state.fitBounds).not.toHaveBeenCalled();
    expect(state.onClosePanel).not.toHaveBeenCalled();
  });

  it('keeps a later hide when a requested geometry arrives and cancels its pending zoom', async () => {
    const state = setup();
    const pending = deferred<GisGeometryMapRecord>();
    state.source.getGisGeometryDetail.mockReturnValue(pending.promise);
    const record = gisRecord();
    act(() => state.result.current.zoom(record.detail.id));
    act(() => state.result.current.toggle(record.detail.id, false));
    await act(async () => {
      state.publish({ records: { [record.detail.id]: record } });
      pending.resolve(record);
    });
    expect(state.result.current.visibleCount).toBe(0);
    expect(state.result.current.visibility[record.detail.id]).toBe(false);
    expect(state.fitBounds).not.toHaveBeenCalled();
    expect(state.onClosePanel).not.toHaveBeenCalled();
  });

  it('lets only the newest name tap frame bounds, with unwrapped min/max longitudes', async () => {
    const first = gisRecord();
    const second = gisRecord(gisMetadata({ id: '22345678-1234-4234-8234-123456789abc', name: 'Across the world' }));
    second.bounds = { west: -170, east: 170, south: 0, north: 0, crossesDateline: false };
    const state = setup(gisSnapshot({ items: [first.detail, second.detail] }));
    const older = deferred<GisGeometryMapRecord>();
    const newer = deferred<GisGeometryMapRecord>();
    state.source.getGisGeometryDetail.mockImplementation(id => id === first.detail.id ? older.promise : newer.promise);
    act(() => state.result.current.zoom(first.detail.id));
    act(() => state.result.current.zoom(second.detail.id));
    await act(async () => {
      state.publish({ records: { [second.detail.id]: second } });
      newer.resolve(second);
    });
    expect(state.fitBounds).toHaveBeenCalledExactlyOnceWith([[-170, 0], [170, 0]], { padding: 60, maxZoom: 16, duration: 800 });
    expect(state.onClosePanel).toHaveBeenCalledOnce();
    await act(async () => {
      state.publish({ records: { [first.detail.id]: first, [second.detail.id]: second } });
      older.resolve(first);
    });
    expect(state.fitBounds).toHaveBeenCalledOnce();
    expect(state.result.current.visibleCount).toBe(2);
  });

  it('does not close a different panel or move after route departure', async () => {
    const state = setup();
    const pending = deferred<GisGeometryMapRecord>();
    const record = gisRecord();
    state.source.getGisGeometryDetail.mockReturnValue(pending.promise);
    act(() => state.result.current.zoom(record.detail.id));
    state.rerender({ active: false });
    await act(async () => {
      state.publish({ records: { [record.detail.id]: record } });
      pending.resolve(record);
    });
    expect(state.fitBounds).not.toHaveBeenCalled();
    expect(state.onClosePanel).not.toHaveBeenCalled();
  });

  it('gates old revisions and revoked records without resetting explicit visibility intent', () => {
    const record = gisRecord();
    const state = setup(gisSnapshot({ records: { [record.detail.id]: record } }));
    act(() => state.result.current.showAll());
    act(() => state.publish({ items: [{ ...record.detail, revision: 2 }] }));
    expect(state.result.current.visibleCount).toBe(0);
    expect(state.result.current.visibility[record.detail.id]).toBe(true);
    act(() => state.publish({ items: [], records: {} }));
    expect(state.result.current.visibleCount).toBe(0);
  });

  it('keeps hidden background preparation from republishing empty map data', () => {
    const state = setup();
    const empty = state.result.current.featureCollection;
    const record = gisRecord();
    act(() => state.publish({ records: { [record.detail.id]: record } }));
    expect(state.result.current.featureCollection).toBe(empty);
  });

  it('does not let an old failed display request undo a newer successful record', async () => {
    const state = setup();
    const older = deferred<GisGeometryMapRecord>();
    const record = gisRecord();
    state.source.getGisGeometryDetail.mockReturnValueOnce(older.promise);
    act(() => state.result.current.toggle(record.detail.id, true));
    act(() => state.publish({ records: { [record.detail.id]: record } }));
    expect(state.result.current.visibleCount).toBe(1);
    await act(async () => older.reject(new Error('Old transport failure')));
    expect(state.result.current.visibleCount).toBe(1);
    expect(state.result.current.visibility[record.detail.id]).toBe(true);
  });

  it('resets display on a new account scope and releases its store subscription', () => {
    const record = gisRecord();
    const state = setup(gisSnapshot({ records: { [record.detail.id]: record } }));
    act(() => state.result.current.showAll());
    expect(state.result.current.visibleCount).toBe(1);
    act(() => state.publish({ scope: 'session-b' }));
    expect(state.result.current.visibleCount).toBe(0);
    act(() => state.result.current.toggle(record.detail.id, true));
    expect(state.result.current.visibleCount).toBe(1);
    state.unmount();
    expect(state.listeners.size).toBe(0);
    const restored = setup(gisSnapshot({ records: { [record.detail.id]: record } }));
    expect(restored.result.current.visibleCount).toBe(0);
  });

  it('handles failure, retry, hide all and unmount without late camera actions', async () => {
    const record = gisRecord();
    const state = setup();
    state.source.getGisGeometryDetail.mockRejectedValueOnce(new Error('Unusable access'));
    act(() => state.result.current.zoom(record.detail.id));
    await waitFor(() => expect(state.source.getGisGeometryDetail).toHaveBeenCalledOnce());
    expect(state.fitBounds).not.toHaveBeenCalled();
    expect(state.result.current.visibility[record.detail.id]).toBe(true);
    const pending = deferred<GisGeometryMapRecord>();
    state.source.getGisGeometryDetail.mockReturnValue(pending.promise);
    act(() => state.result.current.retry(record.detail.id));
    act(() => state.result.current.hideAll());
    state.unmount();
    await act(async () => pending.resolve(record));
    expect(state.fitBounds).not.toHaveBeenCalled();
  });
});
