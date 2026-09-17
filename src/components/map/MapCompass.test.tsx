import { StrictMode, useEffect, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeadingProvider } from '../../services/DeviceHeadingService';
import { MapCompass } from './MapCompass';

vi.mock('react-map-gl/maplibre', () => ({
  useControl: (create: () => { onAdd(map: { getContainer(): HTMLElement }): HTMLElement; onRemove(): void }, options: { position: string }) => {
    const [control] = useState(create);
    useEffect(() => {
      const container = document.createElement('div');
      container.dataset.testid = 'map-host';
      Object.defineProperty(container, 'clientWidth', { value: 390, configurable: true });
      container.getBoundingClientRect = () => new DOMRect(0, 0, container.clientWidth, 600);
      const element = control.onAdd({ getContainer: () => container });
      element.dataset.position = options.position;
      container.append(element);
      document.body.append(container);
      return () => { control.onRemove(); container.remove(); };
    }, [control, options.position]);
    return control;
  },
}));

class TestHeadingProvider implements HeadingProvider {
  listeners = new Set<(heading: number | null) => void>();

  subscribe(listener: (heading: number | null) => void) {
    this.listeners.add(listener);
    listener(null);
    return () => { this.listeners.delete(listener); };
  }

  emit(heading: number | null) {
    for (const listener of this.listeners) listener(heading);
  }
}

describe('MapCompass', () => {
  const observers: Array<{ callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(readonly callback: () => void) { observers.push(this); }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sizes from the actual map container and releases its resize observer', () => {
    const view = render(<MapCompass active={false} headingProvider={new TestHeadingProvider()} />);
    const host = screen.getByTestId('map-host');
    const control = screen.getByTestId('map-compass').parentElement!;
    expect(observers[0].observe).toHaveBeenCalledWith(host);
    expect(control.style.getPropertyValue('--map-compass-size')).toBe('156px');
    Object.defineProperty(host, 'clientWidth', { value: 320, configurable: true });
    act(() => observers[0].callback());
    expect(control.style.getPropertyValue('--map-compass-size')).toBe('128px');
    Object.defineProperty(host, 'clientWidth', { value: 320.75, configurable: true });
    act(() => observers[0].callback());
    expect(control.style.getPropertyValue('--map-compass-size')).toBe('128px');
    Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true });
    act(() => observers[0].callback());
    expect(control.style.getPropertyValue('--map-compass-size')).toBe('172px');
    view.unmount();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it('keeps one mounted control and subscription through StrictMode remounts', () => {
    const provider = new TestHeadingProvider();
    const view = render(<StrictMode><MapCompass active headingProvider={provider} /></StrictMode>);
    expect(document.querySelectorAll('.map-compass-control')).toHaveLength(1);
    expect(provider.listeners.size).toBe(1);
    act(() => provider.emit(260));
    expect(screen.getByTestId('compass-heading')).toHaveTextContent('260°');
    view.unmount();
    expect(document.querySelectorAll('.map-compass-control')).toHaveLength(0);
    expect(provider.listeners.size).toBe(0);
  });

  it('shows only eight rose labels and provides an honest unavailable state', () => {
    const provider = new TestHeadingProvider();
    render(<MapCompass active headingProvider={provider} />);
    const compass = screen.getByRole('img', { name: 'Compass heading unavailable' });
    expect(screen.getByTestId('compass-heading')).toHaveTextContent('—°');
    expect(screen.getByText('No heading')).toBeInTheDocument();
    expect(screen.queryByTestId('compass-heading-pointer')).not.toBeInTheDocument();
    expect(Array.from(compass.querySelectorAll('text')).map((label) => label.textContent)).toEqual([
      'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW',
    ]);
    expect(compass.querySelector('[aria-live]')).toBeNull();
  });

  it.each([
    [0, 'N'], [22.5, 'NNE'], [45, 'NE'], [67.5, 'ENE'],
    [90, 'E'], [112.5, 'ESE'], [135, 'SE'], [157.5, 'SSE'],
    [180, 'S'], [202.5, 'SSW'], [225, 'SW'], [247.5, 'WSW'],
    [270, 'W'], [292.5, 'WNW'], [315, 'NW'], [337.5, 'NNW'],
  ])('labels device heading %s as %s', (heading, direction) => {
    const provider = new TestHeadingProvider();
    render(<MapCompass active headingProvider={provider} />);
    act(() => provider.emit(heading as number));
    expect(screen.getByRole('img')).toHaveAccessibleName(
      `Compass heading ${Math.round(heading as number)} degrees, ${direction}`,
    );
    expect(screen.getByText(direction, { selector: '.map-compass__direction' })).toBeInTheDocument();
  });

  it.each([
    [260, '260°', 'W'], [-100, '260°', 'W'], [620, '260°', 'W'],
    [359.6, '0°', 'N'], [360, '0°', 'N'], [11.24, '11°', 'N'],
    [11.25, '11°', 'NNE'], [348.75, '349°', 'N'],
  ])('normalizes and rounds %s while choosing the nearest wind', (heading, reading, direction) => {
    const provider = new TestHeadingProvider();
    render(<MapCompass active headingProvider={provider} />);
    act(() => provider.emit(heading as number));
    expect(screen.getByTestId('compass-heading')).toHaveTextContent(reading as string);
    expect(screen.getByRole('img')).toHaveAccessibleName(expect.stringContaining(`, ${direction}`));
  });

  it('crosses north in both directions without rotating the long way or moving labels', () => {
    const provider = new TestHeadingProvider();
    render(<MapCompass active headingProvider={provider} />);
    act(() => provider.emit(359));
    const pointer = screen.getByTestId('compass-heading-pointer');
    expect(pointer).toHaveStyle({ transform: 'rotate(359deg)' });
    act(() => provider.emit(1));
    expect(pointer).toHaveStyle({ transform: 'rotate(361deg)' });
    expect(screen.getByTestId('compass-heading')).toHaveTextContent('1°');
    act(() => provider.emit(358));
    expect(pointer).toHaveStyle({ transform: 'rotate(358deg)' });
    expect(screen.getByText('N', { selector: 'text' })).not.toHaveAttribute('transform');
  });

  it('releases ownership while inactive, resumes without stale data and removes its control', () => {
    const provider = new TestHeadingProvider();
    const view = render(<MapCompass active={false} headingProvider={provider} />);
    const control = screen.getByTestId('map-compass').parentElement!;
    expect(control).toHaveAttribute('data-position', 'bottom-right');
    expect(provider.listeners.size).toBe(0);
    view.rerender(<MapCompass active headingProvider={provider} />);
    expect(provider.listeners.size).toBe(1);
    act(() => provider.emit(260));
    expect(screen.getByTestId('compass-heading')).toHaveTextContent('260°');
    view.rerender(<MapCompass active={false} headingProvider={provider} />);
    expect(provider.listeners.size).toBe(0);
    expect(screen.getByTestId('compass-heading')).toHaveTextContent('—°');
    view.rerender(<MapCompass active headingProvider={provider} />);
    expect(screen.getByTestId('compass-heading')).toHaveTextContent('—°');
    act(() => provider.emit(45));
    act(() => provider.emit(null));
    expect(screen.getByRole('img', { name: 'Compass heading unavailable' })).toBeInTheDocument();
    expect(screen.queryByTestId('compass-heading-pointer')).not.toBeInTheDocument();
    view.unmount();
    expect(provider.listeners.size).toBe(0);
    expect(control).not.toBeInTheDocument();
  });
});
