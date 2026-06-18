import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MapLayerControl from './MapLayerControl';
import { isLayerSelectable } from '../../services/MapLayersService';
import { MAP_LAYERS } from '../../constants';
import type { MapLayerDefinition } from '../../types/mapLayer';

const satellite = MAP_LAYERS.find((l) => l.id === 'esri-satellite') as MapLayerDefinition;
const hillshade = MAP_LAYERS.find((l) => l.id === 'esri-world-hillshade') as MapLayerDefinition;

function renderControl(overrides: Partial<React.ComponentProps<typeof MapLayerControl>> = {}) {
  const onSelectLayer = vi.fn();
  render(
    <MapLayerControl
      layers={MAP_LAYERS}
      selectedLayerId="esri-satellite"
      isOfflineLocked={false}
      layerOfflineSync={{}}
      onSelectLayer={onSelectLayer}
      {...overrides}
    />,
  );
  return { onSelectLayer };
}

describe('isLayerSelectable', () => {
  it('allows any layer while online', () => {
    expect(isLayerSelectable(hillshade, false, {})).toBe(true);
  });

  it('offline: allows forced + synced layers, blocks un-synced layers', () => {
    expect(isLayerSelectable(satellite, true, {})).toBe(true);
    expect(isLayerSelectable(hillshade, true, {})).toBe(false);
    expect(isLayerSelectable(hillshade, true, { 'esri-world-hillshade': true })).toBe(true);
  });
});

describe('MapLayerControl', () => {
  it('opens the menu and lists every layer', async () => {
    const user = userEvent.setup();
    renderControl();

    expect(screen.queryByTestId('map-layer-menu')).toBeNull();
    await user.click(screen.getByTestId('map-layer-button'));

    expect(screen.getByTestId('map-layer-menu')).toBeInTheDocument();
    for (const layer of MAP_LAYERS) {
      expect(screen.getByTestId(`map-layer-option-${layer.id}`)).toBeInTheDocument();
    }
  });

  it('selects a layer and closes the menu', async () => {
    const user = userEvent.setup();
    const { onSelectLayer } = renderControl();

    await user.click(screen.getByTestId('map-layer-button'));
    await user.click(screen.getByTestId('map-layer-option-esri-world-hillshade'));

    expect(onSelectLayer).toHaveBeenCalledWith('esri-world-hillshade');
    expect(screen.queryByTestId('map-layer-menu')).toBeNull();
  });

  it('does not re-select the already-selected layer', async () => {
    const user = userEvent.setup();
    const { onSelectLayer } = renderControl({ selectedLayerId: 'esri-satellite' });

    await user.click(screen.getByTestId('map-layer-button'));
    await user.click(screen.getByTestId('map-layer-option-esri-satellite'));

    expect(onSelectLayer).not.toHaveBeenCalled();
  });

  it('disables un-synced layers when offline-locked', async () => {
    const user = userEvent.setup();
    const { onSelectLayer } = renderControl({ isOfflineLocked: true, layerOfflineSync: {} });

    await user.click(screen.getByTestId('map-layer-button'));

    const hillOption = screen.getByTestId('map-layer-option-esri-world-hillshade');
    expect(hillOption).toBeDisabled();
    // Satellite (forced) remains selectable offline.
    expect(screen.getByTestId('map-layer-option-esri-satellite')).not.toBeDisabled();

    await user.click(hillOption);
    expect(onSelectLayer).not.toHaveBeenCalled();
  });

  it('enables a synced extra layer when offline-locked', async () => {
    const user = userEvent.setup();
    const { onSelectLayer } = renderControl({
      isOfflineLocked: true,
      layerOfflineSync: { 'esri-world-hillshade': true },
    });

    await user.click(screen.getByTestId('map-layer-button'));
    const hillOption = screen.getByTestId('map-layer-option-esri-world-hillshade');
    expect(hillOption).not.toBeDisabled();

    await user.click(hillOption);
    expect(onSelectLayer).toHaveBeenCalledWith('esri-world-hillshade');
  });
});
