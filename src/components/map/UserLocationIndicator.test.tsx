import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HeadingProvider } from '../../services/DeviceHeadingService';
import { UserLocationIndicator } from './UserLocationIndicator';

vi.mock('react-map-gl/maplibre', () => ({
  Source: ({ id, children }: { id: string; children?: React.ReactNode }) => (
    <div data-testid="source" data-source-id={id}>
      {React.Children.map(children, (child) => (
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ source?: string }>, { source: id })
          : child
      ))}
    </div>
  ),
  Layer: ({ id, source }: { id: string; source?: string }) => (
    <div data-testid="dot" data-layer-id={id} data-layer-source-id={source} />
  ),
  Marker: ({ longitude, latitude, style, children }: {
    longitude: number;
    latitude: number;
    style?: React.CSSProperties;
    children?: React.ReactNode;
  }) => (
    <div
      data-testid="marker"
      data-longitude={longitude}
      data-latitude={latitude}
      style={style}
    >
      {children}
    </div>
  ),
}));

class FakeHeadingProvider implements HeadingProvider {
  listener: ((heading: number | null) => void) | null = null;
  unsubscribed = vi.fn();

  subscribe(listener: (heading: number | null) => void): () => void {
    this.listener = listener;
    listener(null);
    return this.unsubscribed;
  }

  emit(heading: number | null): void {
    this.listener?.(heading);
  }
}

describe('UserLocationIndicator', () => {
  it('disables cone animation for reduced-motion users', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.user-location-heading-rotation[\s\S]*transition: none/,
    );
  });

  it('renders nothing without a location', () => {
    const { container } = render(
      <UserLocationIndicator location={null} headingActive headingProvider={new FakeHeadingProvider()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the dot directly bound to its MapLibre source without a heading', () => {
    const provider = new FakeHeadingProvider();
    render(
      <UserLocationIndicator
        location={{ lng: -73, lat: 45 }}
        headingActive={false}
        headingProvider={provider}
      />,
    );
    expect(screen.getByTestId('dot')).toHaveAttribute(
      'data-layer-source-id',
      'user-location-source',
    );
    expect(screen.queryByTestId('user-location-heading-cone')).toBeNull();
    expect(provider.listener).toBeNull();
  });

  it('renders the fixed SVG cone and unwraps north along the shortest path', () => {
    const provider = new FakeHeadingProvider();
    const { rerender } = render(
      <UserLocationIndicator
        location={{ lng: -73, lat: 45 }}
        headingActive
        headingProvider={provider}
      />,
    );
    act(() => provider.emit(359));
    expect(screen.getByTestId('marker')).toHaveAttribute('data-longitude', '-73');
    expect(screen.getByTestId('marker')).toHaveStyle({ pointerEvents: 'none' });
    const cone = screen.getByTestId('user-location-heading-cone') as unknown as SVGPathElement;
    expect(cone).toHaveAttribute('d', 'M56 56 L32.3 5.2 A56 56 0 0 1 79.7 5.2 Z');
    expect(
      Array.from(cone.ownerSVGElement?.querySelectorAll<SVGStopElement>('stop') ?? []).map((stop) => ({
        color: stop.getAttribute('stop-color'),
        opacity: stop.getAttribute('stop-opacity'),
      })),
    ).toEqual([
      { color: '#0B57D0', opacity: '0.95' },
      { color: '#0B57D0', opacity: '0.72' },
      { color: '#0B57D0', opacity: '0.22' },
    ]);
    expect(cone.closest('g')).toHaveStyle({ transform: 'rotate(359deg)' });

    act(() => provider.emit(1));
    expect(cone.closest('g')).toHaveStyle({ transform: 'rotate(361deg)' });
    expect(screen.getByTestId('user-location-heading-marker'))
      .toHaveClass('user-location-heading-marker');

    rerender(
      <UserLocationIndicator
        location={{ lng: -73, lat: 45 }}
        headingActive={false}
        headingProvider={provider}
      />,
    );
    expect(screen.queryByTestId('user-location-heading-cone')).toBeNull();
    expect(provider.unsubscribed).toHaveBeenCalledOnce();
  });
});
