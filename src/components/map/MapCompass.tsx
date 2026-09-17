import { memo } from 'react';
import { createPortal } from 'react-dom';
import { useControl } from 'react-map-gl/maplibre';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useDeviceHeading } from '../../hooks/useDeviceHeading';
import type { HeadingProvider } from '../../services/DeviceHeadingService';
import { normalizeHeading } from '../../utils/userLocation';
import './mapCompass.css';

const DIRECTIONS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

/** Let MapLibre stack the dial above attribution, including expanded credits. */
class CompassControl {
  readonly element = document.createElement('div');
  private resizeObserver: ResizeObserver | null = null;

  onAdd(map: MapLibreMap) {
    this.element.className = 'maplibregl-ctrl map-compass-control';
    const container = map.getContainer();
    const updateSize = () => {
      const size = Math.min(172, Math.floor(container.getBoundingClientRect().width * 0.4));
      this.element.style.setProperty('--map-compass-size', `${size}px`);
    };
    updateSize();
    this.resizeObserver = new ResizeObserver(updateSize);
    this.resizeObserver.observe(container);
    return this.element;
  }

  onRemove() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element.remove();
  }
}

const CompassRose = memo(function CompassRose() {
  return (
    <svg className="map-compass__rose" viewBox="0 0 172 172" aria-hidden="true">
      <circle className="map-compass__inner-ring" cx="86" cy="86" r="43" />
      {Array.from({ length: 64 }, (_, index) => (
        <line
          key={index}
          className={index % 4 === 0 ? 'map-compass__tick map-compass__tick--major' : 'map-compass__tick'}
          x1="86" y1="30" x2="86" y2={index % 4 === 0 ? 37 : 33}
          transform={`rotate(${index * 5.625} 86 86)`}
        />
      ))}
      {DIRECTIONS.map((direction, index) => {
        if (index % 2 !== 0) return null;
        const angle = index * Math.PI / 8;
        return (
          <text
            key={direction}
            className={`map-compass__label${index % 4 === 0 ? ' map-compass__label--cardinal' : ''}${index === 0 ? ' map-compass__label--north' : ''}`}
            x={86 + 71 * Math.sin(angle)}
            y={86 - 71 * Math.cos(angle)}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {direction}
          </text>
        );
      })}
    </svg>
  );
});

export function MapCompass({
  active,
  headingProvider,
}: {
  active: boolean;
  headingProvider?: HeadingProvider;
}) {
  const control = useControl(() => new CompassControl(), { position: 'bottom-right' });
  const heading = useDeviceHeading(active, headingProvider);
  const normalized = heading === null ? null : normalizeHeading(heading);
  const degrees = normalized === null ? null : Math.round(normalized) % 360;
  const direction = normalized === null ? null : DIRECTIONS[Math.round(normalized / 22.5) % 16];

  return createPortal(
    <div
      className="map-compass"
      data-testid="map-compass"
      role="img"
      aria-label={degrees === null
        ? 'Compass heading unavailable'
        : `Compass heading ${degrees} degrees, ${direction}`}
    >
      <CompassRose />
      {normalized !== null && (
        <svg className="map-compass__pointer" viewBox="0 0 172 172" aria-hidden="true">
          <g
            className="map-compass__rotation"
            data-testid="compass-heading-pointer"
            style={{ transform: `rotate(${heading}deg)` }}
          >
            <path d="M86 37 L92 50 L86 47 L80 50 Z" />
          </g>
        </svg>
      )}
      <div className="map-compass__reading" aria-hidden="true">
        <span className="map-compass__degrees" data-testid="compass-heading">
          {degrees === null ? '—' : degrees}<span className="map-compass__degree-symbol">°</span>
        </span>
        <span className={`map-compass__direction${direction === null ? ' map-compass__direction--unavailable' : ''}`}>
          {direction ?? 'No heading'}
        </span>
      </div>
    </div>,
    control.element,
  );
}
