import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { Router } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory } from 'history';
import type { MapRef } from 'react-map-gl/maplibre';
import type { SpeleoDBController } from '../../controllers/SpeleoDBController';
import {
  DownloadAreaType,
  EMPTY_DOWNLOAD_AREAS,
  type DownloadArea,
  type DownloadAreasSnapshot,
} from '../../types/downloadArea';
import { MAP_LAYERS } from '../../constants';
import { OfflineMapsPanel } from './OfflineMapsPanel';
import { OfflineAreaEditor } from './OfflineAreaEditor';

const area: DownloadArea = {
  areaId: 'manual-1',
  type: DownloadAreaType.Manual,
  objectId: null,
  name: 'Camp',
  topLeft: [2, 46.001],
  bottomRight: [2.001, 46],
  layerIds: MAP_LAYERS.map((l) => l.id),
  visible: true,
  revision: 1,
  sourceRevision: null,
  sourceKey: 'manual:manual-1',
};
let map: {
  getContainer: Mock<() => HTMLElement>;
  unproject: ReturnType<typeof vi.fn>;
  project: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  resize: Mock<() => void>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
};
let mapRef: { current: MapRef | null };
let controller: {
  saveDownloadArea: ReturnType<typeof vi.fn>;
  deleteDownloadArea: ReturnType<typeof vi.fn>;
  retryDownloadArea: ReturnType<typeof vi.fn>;
};
let onClose: Mock<() => void>;
let onEditingChange: Mock<(editing: boolean) => void>;
let resize: () => void;
beforeEach(() => {
  const container = document.createElement('div');
  Object.defineProperties(container, {
    clientWidth: { value: 390, configurable: true },
    clientHeight: { value: 800, configurable: true },
  });
  map = {
    getContainer: vi.fn(() => container),
    unproject: vi.fn(([x, y]: number[]) => ({
      lng: 2 + x / 100000,
      lat: 46.01 - y / 100000,
    })),
    project: vi.fn(([lng, lat]: number[]) => ({
      x: (lng - 2) * 100000,
      y: (46.01 - lat) * 100000,
    })),
    fitBounds: vi.fn(),
    resize: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  mapRef = { current: map as unknown as MapRef };
  controller = {
    saveDownloadArea: vi.fn(async () => area.areaId),
    deleteDownloadArea: vi.fn(async () => {}),
    retryDownloadArea: vi.fn(),
  };
  onClose = vi.fn();
  onEditingChange = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function snapshot(
  status: 'downloaded' | 'downloading' | 'incomplete' = 'downloaded',
): DownloadAreasSnapshot {
  return {
    ...EMPTY_DOWNLOAD_AREAS,
    areas: [
      area,
      {
        ...area,
        areaId: 'project',
        type: DownloadAreaType.Project,
        visible: false,
        name: 'Secret automatic area',
      },
    ],
    progress: {
      [area.areaId]: {
        revision: 1,
        status,
        completedTiles: 30,
        totalTiles: 60,
      },
      project: {
        revision: 1,
        status: 'too-large',
        completedTiles: 0,
        totalTiles: 0,
      },
    },
  };
}
function panel(state = snapshot(), offline = false) {
  const history = createMemoryHistory();
  const content = (next: DownloadAreasSnapshot) => (
    <Router history={history}>
      <OfflineMapsPanel
        controller={controller as unknown as SpeleoDBController}
        snapshot={next}
        mapRef={mapRef}
        offline={offline}
        onClose={onClose}
        onEditingChange={onEditingChange}
      />
    </Router>
  );
  const view = render(content(state));
  return {
    history,
    ...view,
    updateSnapshot: (next: DownloadAreasSnapshot) =>
      view.rerender(content(next)),
  };
}

function editor(
  options: {
    initial?: DownloadArea;
    offline?: boolean;
    onSave?: (input: unknown) => Promise<void>;
  } = {},
) {
  const confirm = vi.fn((_message: string, callback: (ok: boolean) => void) =>
    callback(false),
  );
  const history = createMemoryHistory({ getUserConfirmation: confirm });
  const save = options.onSave ?? vi.fn(async () => {});
  return {
    save,
    history,
    confirm,
    ...render(
      <Router history={history}>
        <OfflineAreaEditor
          initial={options.initial}
          mapRef={mapRef}
          offline={options.offline ?? false}
          onCancel={onClose}
          onSave={save}
        />
      </Router>,
    ),
  };
}
describe('offline map manager interactions', () => {
  it('lists multiple areas with zoom, edit and delete in order, without names or detail actions', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const state = snapshot('downloading');
    state.areas = [
      ...state.areas,
      { ...area, areaId: 'second', color: '#fb923c' },
    ];
    const view = panel(state);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(screen.getByText('Downloading · 50%')).toBeVisible();
    expect(screen.queryByText('Camp')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret automatic area')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Retry|Refresh/ }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Area 1' }))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Zoom to Area 1', 'Edit Area 1', 'Delete Area 1']);
    expect(screen.getByRole('button', { name: 'Edit Area 2' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Add new offline area' }),
    ).toBeEnabled();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
  it('shows an empty state and closes by button or escape', () => {
    panel(EMPTY_DOWNLOAD_AREAS);
    expect(
      screen.getByText('Choose an area on the map to keep offline.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it('keeps service errors in the scroll region without consuming the fixed controls', () => {
    panel({
      ...snapshot(),
      error: 'Layer settings were saved. Download storage will be checked again on restart.',
    });
    const rows = screen.getByRole('region', { name: 'Offline areas' });
    expect(within(rows).getByRole('alert')).toHaveTextContent('Download storage');
    expect(within(rows).getByRole('button', { name: 'Edit Area 1' })).toBeEnabled();
    expect(rows).not.toContainElement(screen.getByRole('heading', { name: 'Offline Maps' }));
    expect(rows).not.toContainElement(screen.getByRole('button', { name: 'Add new offline area' }));
  });
  it.each(['{Enter}', ' '])('zooms to an area using the keyboard (%s)', async (key) => {
    const user = userEvent.setup();
    panel();
    screen.getByRole('button', { name: 'Zoom to Area 1' }).focus();
    await user.keyboard(key);
    expect(map.fitBounds).toHaveBeenCalledExactlyOnceWith(
      [[2, 46], [2.001, 46.001]],
      { padding: 60, maxZoom: 16, duration: 800 },
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Offline Maps' })).toBeVisible();
    expect(controller.saveDownloadArea).not.toHaveBeenCalled();
  });
  it('keeps the menu open when the map is unavailable', () => {
    mapRef.current = null;
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to Area 1' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
  });
  it('fits above the measured menu and remeasures after layout changes', () => {
    panel();
    const viewport = vi.spyOn(map.getContainer(), 'getBoundingClientRect');
    const sheet = vi.spyOn(
      screen.getByRole('dialog', { name: 'Offline Maps' }),
      'getBoundingClientRect',
    );
    viewport.mockReturnValue(new DOMRect(0, 40, 390, 800));
    sheet.mockReturnValue(new DOMRect(12, 540, 366, 288));
    const select = () => fireEvent.click(screen.getByRole('button', { name: 'Zoom to Area 1' }));
    select();
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [[2, 46], [2.001, 46.001]],
      { padding: { top: 60, bottom: 360, left: 60, right: 60 }, maxZoom: 16, duration: 800 },
    );
    // A taller list moves the sheet upward without changing the viewport.
    sheet.mockReturnValue(new DOMRect(12, 440, 366, 388));
    select();
    expect(map.fitBounds.mock.lastCall?.[1].padding).toEqual({
      top: 60, bottom: 460, left: 60, right: 60,
    });
    // In landscape, shrink the margins to retain positive fitting space.
    viewport.mockReturnValue(new DOMRect(0, 20, 568, 300));
    sheet.mockReturnValue(new DOMRect(12, 100, 544, 208));
    select();
    expect(map.fitBounds.mock.lastCall?.[1].padding).toEqual({
      top: 20, bottom: 240, left: 20, right: 20,
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(controller.saveDownloadArea).not.toHaveBeenCalled();
  });
  it('opens the boundary directly and saves edits to the same area', async () => {
    panel();
    onEditingChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Area 1' }));
    await screen.findByLabelText('Selected map area');
    expect(onEditingChange).toHaveBeenCalledWith(true);
    expect(onEditingChange.mock.invocationCallOrder[0]).toBeLessThan(
      map.resize.mock.invocationCallOrder[0],
    );
    expect(map.fitBounds).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole('dialog'))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cancel', 'Save']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(controller.saveDownloadArea).toHaveBeenCalledWith(
        { topLeft: area.topLeft, bottomRight: area.bottomRight },
        area.areaId,
      ),
    );
    expect(
      await screen.findByRole('button', { name: 'Add new offline area' }),
    ).toBeVisible();
  });
  it('requires confirmation to delete and leaves other areas untouched', async () => {
    panel({ ...snapshot(), areas: [area, { ...area, areaId: 'second' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Area 2' }));
    expect(screen.getByRole('button', { name: 'Zoom to Area 1' })).toBeDisabled();
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(controller.deleteDownloadArea).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(controller.deleteDownloadArea).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Area 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete area' }));
    await waitFor(() =>
      expect(controller.deleteDownloadArea).toHaveBeenCalledWith('second'),
    );
    await waitFor(() =>
      expect(
        screen.queryByText('Delete this offline area?'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Edit Area 1' })).toBeEnabled();
  });
  it.each(['confirming', 'saving'])(
    'unlocks after the catalog commit and preserves the next delete while %s',
    async (phase) => {
      let finishFirst!: () => void;
      let finishSecond!: () => void;
      const first = new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      const second = new Promise<void>((resolve) => {
        finishSecond = resolve;
      });
      controller.deleteDownloadArea
        .mockImplementationOnce(() => first)
        .mockImplementationOnce(() => second);
      const remaining = [
        { ...area, areaId: 'second' },
        { ...area, areaId: 'third' },
      ];
      const view = panel({ ...snapshot(), areas: [area, ...remaining] });
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Delete Area 1' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete area' }));
        expect(
          screen.getByRole('button', { name: 'Delete Area 2' }),
        ).toBeDisabled();
        // Catalog removal is authoritative; the operation still awaits tile cleanup.
        view.updateSnapshot({ ...snapshot(), areas: remaining });
        expect(
          screen.getByRole('button', { name: 'Delete Area 1' }),
        ).toBeEnabled();
        expect(
          screen.getByRole('button', { name: 'Edit Area 1' }),
        ).toBeEnabled();
        expect(
          screen.getByRole('button', { name: 'Add new offline area' }),
        ).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Area 1' }));
        if (phase === 'saving')
          fireEvent.click(screen.getByRole('button', { name: 'Delete area' }));
        await act(async () => {
          finishFirst();
          await first;
        });
        expect(screen.getByText('Delete this offline area?')).toBeVisible();
        if (phase === 'saving')
          expect(
            screen.getByRole('button', { name: 'Delete area' }),
          ).toBeDisabled();
        else {
          expect(
            screen.getByRole('button', { name: 'Delete area' }),
          ).toBeEnabled();
          fireEvent.click(screen.getByRole('button', { name: 'Delete area' }));
        }
        expect(
          controller.deleteDownloadArea.mock.calls.map(([id]) => id),
        ).toEqual([area.areaId, 'second']);
        view.updateSnapshot({ ...snapshot(), areas: [remaining[1]] });
        expect(
          screen.getByRole('button', { name: 'Delete Area 1' }),
        ).toBeEnabled();
      } finally {
        await act(async () => {
          finishFirst();
          finishSecond();
          await Promise.all([first, second]);
        });
      }
    },
  );
  it('keeps a failed deletion visible and allows confirmation again', async () => {
    controller.deleteDownloadArea.mockRejectedValueOnce(
      new Error('Storage unavailable'),
    );
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Area 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete area' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Storage unavailable',
    );
    expect(screen.getByRole('group', { name: 'Area 1' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete area' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete area' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Delete this offline area?'),
      ).not.toBeInTheDocument(),
    );
    expect(controller.deleteDownloadArea).toHaveBeenCalledTimes(2);
  });
  it('returns to the list after saving a new unnamed area, ready to add another', async () => {
    panel(EMPTY_DOWNLOAD_AREAS);
    fireEvent.click(
      screen.getByRole('button', { name: 'Add new offline area' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    expect(onEditingChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(controller.saveDownloadArea).toHaveBeenCalledWith(
        { topLeft: [2.00039, 46.00936], bottomRight: [2.00351, 46.00584] },
        undefined,
      ),
    );
    await waitFor(() =>
      expect(onEditingChange).toHaveBeenLastCalledWith(false),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Add new offline area' }),
    );
    expect(
      await screen.findByLabelText('Selected map area'),
    ).toBeInTheDocument();
  });
});
describe('area selection', () => {
  it('saves offline coordinates from the map frame, with no network dependency', async () => {
    const view = editor({ offline: true });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    expect(screen.getByText(/Download after reconnecting/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(view.save).toHaveBeenCalledWith(
        expect.objectContaining({
          topLeft: [2.00039, 46.00936],
          bottomRight: [2.00351, 46.00584],
        }),
      ),
    );
  });
  it('cancels local boundary changes directly without saving', async () => {
    const view = editor();
    await screen.findByLabelText('Selected map area');
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Resize top left corner' }),
      { key: 'ArrowRight' },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(view.save).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it('updates bounds when the map moves and offers keyboard corner refinement', async () => {
    const view = editor();
    await screen.findByLabelText('Selected map area');
    const handle = screen.getByRole('button', {
      name: 'Resize top left corner',
    });
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.keyDown(handle, { key: 'ArrowDown' });

    fireEvent.keyDown(handle, { key: 'Enter' });
    const move = map.on.mock.calls.find(([name]) => name === 'move')![1];
    map.unproject.mockImplementation(([x, y]: number[]) => ({
      lng: 3 + x / 100000,
      lat: 46.01 - y / 100000,
    }));
    act(() => move({ originalEvent: new Event('wheel') }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(view.save).toHaveBeenCalledWith(
      expect.objectContaining({ topLeft: [3.00049, 46.00935] }),
    );
    expect(screen.getByText('1 map layer')).toBeVisible();
    view.unmount();
    expect(map.off).toHaveBeenCalledWith('move', move);
  });
  it('rejects oversized map selections and reports save errors after refinement', async () => {
    const save = vi.fn(async () => {
      throw new Error('No space');
    });
    editor({ onSave: save });
    await screen.findByLabelText('Selected map area');
    const project = map.unproject.getMockImplementation()!;
    const move = map.on.mock.calls.find(([name]) => name === 'move')![1];
    map.unproject.mockImplementation(([x]: number[]) => ({
      lng: x < 100 ? -170 : 170,
      lat: x < 100 ? 60 : -60,
    }));
    act(() => move({ originalEvent: new Event('wheel') }));
    expect(screen.getByText('Zoom in to resize')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    map.unproject.mockImplementation(project);
    act(() => move({ originalEvent: new Event('wheel') }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No space');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
  it('fits dateline-crossing existing geometry and accommodates a short viewport', async () => {
    Object.defineProperty(map.getContainer(), 'clientHeight', { value: 300 });
    editor({
      initial: {
        ...area,
        topLeft: [179.999, 0.001],
        bottomRight: [-179.999, 0],
      },
    });
    await screen.findByLabelText('Selected map area');
    expect(map.fitBounds.mock.calls[0][0][1][0]).toBeCloseTo(180.001);
    expect(map.fitBounds.mock.calls[0][1].padding.bottom).toBeLessThan(300);
    await act(async () => resize());
  });
  it('preserves edited corners when a keyboard or rotation resizes the map', async () => {
    const view = editor();
    await screen.findByLabelText('Selected map area');
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Resize top left corner' }),
      { key: 'ArrowRight', shiftKey: true },
    );
    Object.defineProperty(map.getContainer(), 'clientHeight', { value: 500 });
    await act(async () => resize());
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [
        [2.00049, 46.00584],
        [2.00351, 46.00936],
      ],
      expect.anything(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(view.save).toHaveBeenCalledWith(
      expect.objectContaining({
        topLeft: [2.00049, 46.00936],
        bottomRight: [2.00351, 46.00584],
      }),
    );
  });
  it.each(['map-first', 'editor-first'])(
    'preserves exact saved bounds across %s resize ordering and aligns the projected frame',
    async (order) => {
      let viewportHeight = 800;
      let transformHeight = 800;
      const bounds = {
        ...area,
        topLeft: [2.00039, 46.00936] as [number, number],
        bottomRight: [2.00351, 46.00584] as [number, number],
      };
      Object.defineProperty(map.getContainer(), 'clientHeight', {
        get: () => viewportHeight,
      });
      map.project.mockImplementation(([lng, lat]: number[]) => ({
        x: (lng - 2) * 100000,
        y: (46.01 - lat) * 100000 + (transformHeight - 800) / 2,
      }));
      map.unproject.mockImplementation(([x, y]: number[]) => ({
        lng: 2 + x / 100000,
        lat: 46.01 - (y - (transformHeight - 800) / 2) / 100000,
      }));
      const emitMove = () =>
        map.on.mock.calls.find(([name]) => name === 'move')?.[1]({});
      map.resize.mockImplementation(() => {
        transformHeight = viewportHeight;
        emitMove();
      });
      map.fitBounds.mockImplementation(() => {
        expect(transformHeight).toBe(viewportHeight);
        emitMove();
      });
      const view = editor({ initial: bounds });
      await screen.findByLabelText('Selected map area');
      viewportHeight = 884;
      await act(async () => {
        if (order === 'map-first') map.resize();
        resize();
        if (order === 'editor-first') map.resize();
      });
      expect(
        parseFloat(screen.getByLabelText('Selected map area').style.top),
      ).toBeCloseTo(106);
      expect(
        parseFloat(screen.getByLabelText('Selected map area').style.height),
      ).toBeCloseTo(352);
      expect(map.unproject).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(view.save).toHaveBeenCalledWith({
        topLeft: bounds.topLeft,
        bottomRight: bounds.bottomRight,
      });
    },
  );
  it('keeps oversized selections usable when a short viewport resizes', async () => {
    Object.defineProperty(map.getContainer(), 'clientHeight', { value: 300 });
    map.unproject.mockImplementation(([x]: number[]) => ({
      lng: x < 100 ? -180 : 180,
      lat: x < 100 ? 80 : -80,
    }));
    editor();
    await screen.findByLabelText('Selected map area');
    await act(async () => resize());
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Selected map area')).toHaveStyle({
      height: '72px',
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
  it('uses a world interval when the map repeats across more than 360 degrees', async () => {
    map.unproject.mockImplementation(([x]: number[]) => ({
      lng: x < 100 ? -200 : 200,
      lat: x < 100 ? 10 : -10,
    }));
    editor();
    await screen.findByLabelText('Selected map area');
    expect(screen.getByText('Zoom in to resize')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
