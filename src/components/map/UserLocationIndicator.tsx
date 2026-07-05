import { useId, useMemo } from 'react';
import { Layer, Marker, Source } from 'react-map-gl/maplibre';
import type { FeatureCollection, Point } from 'geojson';
import { useDeviceHeading } from '../../hooks/useDeviceHeading';
import {
  deviceHeadingService,
  type HeadingProvider,
} from '../../services/DeviceHeadingService';
import type { UserMapLocation } from '../../types/userLocation';

export interface UserLocationIndicatorProps {
  location: UserMapLocation | null;
  headingActive: boolean;
  headingProvider?: HeadingProvider;
}

export function UserLocationIndicator({
  location,
  headingActive,
  headingProvider = deviceHeadingService,
}: UserLocationIndicatorProps) {
  const heading = useDeviceHeading(Boolean(location) && headingActive, headingProvider);
  const identifier = useId().replaceAll(':', '');
  const data = useMemo<FeatureCollection<Point> | null>(() => (
    location ? {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
        properties: {},
      }],
    } : null
  ), [location]);

  if (!location || !data) return null;

  const gradientId = `user-location-cone-gradient-${identifier}`;
  const maskId = `user-location-cone-mask-${identifier}`;

  return (
    <>
      <Source id="user-location-source" type="geojson" data={data}>
        <Layer
          id="user-location-dot"
          type="circle"
          paint={{
            'circle-radius': 8,
            'circle-color': '#4285F4',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.9,
          }}
        />
      </Source>
      {heading !== null && (
        <Marker
          longitude={location.lng}
          latitude={location.lat}
          anchor="center"
          style={{ pointerEvents: 'none' }}
        >
          <svg
            aria-hidden="true"
            className="user-location-heading-marker"
            data-testid="user-location-heading-marker"
            viewBox="0 0 112 112"
          >
            <defs>
              <radialGradient
                id={gradientId}
                cx="56"
                cy="56"
                r="56"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stopColor="#0B57D0" stopOpacity="0.95" />
                <stop offset="0.48" stopColor="#0B57D0" stopOpacity="0.72" />
                <stop offset="1" stopColor="#0B57D0" stopOpacity="0.22" />
              </radialGradient>
              <mask id={maskId}>
                <rect width="112" height="112" fill="white" />
                <circle cx="56" cy="56" r="12" fill="black" />
              </mask>
            </defs>
            <g
              className="user-location-heading-rotation"
              style={{ transform: `rotate(${heading}deg)` }}
            >
              <path
                data-testid="user-location-heading-cone"
                d="M56 56 L32.3 5.2 A56 56 0 0 1 79.7 5.2 Z"
                fill={`url(#${gradientId})`}
                mask={`url(#${maskId})`}
              />
            </g>
          </svg>
        </Marker>
      )}
    </>
  );
}
