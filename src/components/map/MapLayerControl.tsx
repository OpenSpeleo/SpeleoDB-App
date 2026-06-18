import React, { useState } from 'react';

import type { MapLayerDefinition, MapLayerId } from '../../types/mapLayer';
import { isLayerSelectable } from '../../services/MapLayersService';

// Stacked-layers icon, copied from the website map viewer (MAP_SOURCE_ICON_SVG)
// so the mobile control matches the private map viewer's layer switcher.
const LAYERS_ICON_PATH =
  'M12.41 148.02l232.94 105.67c6.8 3.09 14.49 3.09 21.29 0l232.94-105.67c16.55-7.51 16.55-32.52 0-40.03L266.65 ' +
  '2.31a25.607 25.607 0 0 0-21.29 0L12.41 107.98c-16.55 7.51-16.55 32.53 0 40.04zm487.18 88.28l-58.09-26.33-161.64 ' +
  '73.27c-7.56 3.43-15.59 5.17-23.86 5.17s-16.29-1.74-23.86-5.17L70.51 209.97l-58.1 26.33c-16.55 7.5-16.55 32.5 0 ' +
  '40l232.94 105.59c6.8 3.08 14.49 3.08 21.29 0L499.59 276.3c16.55-7.5 16.55-32.5 0-40zm0 127.8l-57.87-26.23-161.86 ' +
  '73.37c-7.56 3.43-15.59 5.17-23.86 5.17s-16.29-1.74-23.86-5.17L70.29 337.87 12.41 364.1c-16.55 7.5-16.55 32.5 0 ' +
  '40l232.94 105.59c6.8 3.08 14.49 3.08 21.29 0L499.59 404.1c16.55-7.5 16.55-32.5 0-40z';

/**
 * Presentational metadata for each layer's preview swatch + description. Kept
 * in the control (not the layer config) since it is purely cosmetic.
 */
const LAYER_VISUALS: Record<string, { gradient: string; description: string }> = {
  'esri-satellite': {
    gradient: 'linear-gradient(135deg, #1e3a8a 0%, #15803d 58%, #84cc16 100%)',
    description: 'Satellite imagery',
  },
  'esri-world-hillshade': {
    gradient: 'linear-gradient(135deg, #f8fafc 0%, #cbd5e1 50%, #8a98a8 100%)',
    description: 'Terrain relief — light',
  },
  'esri-world-hillshade-dark': {
    gradient: 'linear-gradient(135deg, #475569 0%, #1e293b 55%, #0b1120 100%)',
    description: 'Terrain relief — dark',
  },
};

const FALLBACK_VISUAL = {
  gradient: 'linear-gradient(135deg, #475569, #1e293b)',
  description: 'Map layer',
};

function visualFor(layerId: string) {
  return LAYER_VISUALS[layerId] ?? FALLBACK_VISUAL;
}

interface MapLayerControlProps {
  layers: readonly MapLayerDefinition[];
  selectedLayerId: string;
  /** True when the app is offline-locked (gates non-synced layers). */
  isOfflineLocked: boolean;
  /** Per-layer offline sync opt-in (forced layers are always available). */
  layerOfflineSync: Record<string, boolean>;
  onSelectLayer: (layerId: string) => void;
}

/**
 * Layer switcher FAB rendered under the My Location button. Tapping opens a
 * card of selectable tile layers (preview swatch + name + description);
 * offline-unavailable layers are disabled.
 */
const MapLayerControl: React.FC<MapLayerControlProps> = ({
  layers,
  selectedLayerId,
  isOfflineLocked,
  layerOfflineSync,
  onSelectLayer,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (layer: MapLayerDefinition) => {
    if (!isLayerSelectable(layer, isOfflineLocked, layerOfflineSync)) return;
    setIsOpen(false);
    if (layer.id !== selectedLayerId) {
      onSelectLayer(layer.id);
    }
  };

  const selectedLabel = layers.find((l) => l.id === (selectedLayerId as MapLayerId))?.label;

  return (
    <div className="relative">
      {isOpen && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className="fixed inset-0 z-10 cursor-default"
          onClick={() => setIsOpen(false)}
          data-testid="map-layer-backdrop"
        />
      )}

      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className={`relative z-20 w-11 h-11 flex items-center justify-center
                   rounded-full backdrop-blur-sm border
                   transition-colors shadow-lg shadow-black/40
                   ${isOpen
                     ? 'bg-cyan-500/90 border-cyan-300/70 text-white'
                     : 'bg-slate-900/80 border-slate-600/60 text-slate-200 hover:bg-slate-800/90'}`}
        aria-label="Map layer"
        aria-expanded={isOpen}
        aria-haspopup="true"
        data-testid="map-layer-button"
      >
        <svg className="w-5 h-5 fill-current" viewBox="0 -0.01 512.01 512.01" aria-hidden="true">
          <path d={LAYERS_ICON_PATH} />
        </svg>
      </button>

      {isOpen && (
        <div
          role="radiogroup"
          aria-label="Map layer"
          className="absolute z-20 right-0 mt-3 w-[min(20rem,calc(100vw-1.5rem))]
                     rounded-2xl border border-slate-700/70 bg-slate-900/95 backdrop-blur-md
                     shadow-2xl shadow-black/60 overflow-hidden
                     ring-1 ring-white/5"
          data-testid="map-layer-menu"
        >
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-slate-700/60">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/15 text-cyan-300">
              <svg className="w-4 h-4 fill-current" viewBox="0 -0.01 512.01 512.01" aria-hidden="true">
                <path d={LAYERS_ICON_PATH} />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white leading-tight">Map Layer</p>
              {selectedLabel && (
                <p className="text-[11px] text-slate-400 truncate leading-tight">{selectedLabel}</p>
              )}
            </div>
          </div>

          <div className="p-2 space-y-1">
            {layers.map((layer) => {
              const selectable = isLayerSelectable(layer, isOfflineLocked, layerOfflineSync);
              const isSelected = layer.id === selectedLayerId;
              const visual = visualFor(layer.id);
              return (
                <button
                  key={layer.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={!selectable}
                  onClick={() => handleSelect(layer)}
                  data-testid={`map-layer-option-${layer.id}`}
                  className={`group w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left
                              transition-colors
                              ${selectable ? 'hover:bg-slate-800/80 active:bg-slate-800' : 'cursor-not-allowed'}
                              ${isSelected ? 'bg-slate-800/90 ring-1 ring-cyan-400/50' : ''}`}
                >
                  <span
                    className={`relative flex items-center justify-center w-11 h-11 rounded-xl
                                flex-shrink-0 ring-1 ring-inset ring-white/10 shadow-inner
                                ${selectable ? '' : 'opacity-40 grayscale'}`}
                    style={{ backgroundImage: visual.gradient }}
                    aria-hidden="true"
                  >
                    {isSelected && (
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-cyan-500 text-white shadow">
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l4 4 8-9" />
                        </svg>
                      </span>
                    )}
                  </span>

                  <span className="flex-1 min-w-0">
                    <span
                      className={`block text-sm font-medium truncate
                                  ${selectable ? 'text-white' : 'text-slate-400'}`}
                    >
                      {layer.label}
                    </span>
                    <span className="block text-[11px] text-slate-400 truncate">
                      {selectable ? visual.description : 'Not downloaded for offline'}
                    </span>
                  </span>

                  {isSelected ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300 flex-shrink-0">
                      Active
                    </span>
                  ) : !selectable ? (
                    <span className="flex-shrink-0 text-slate-500" aria-hidden="true">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MapLayerControl;
