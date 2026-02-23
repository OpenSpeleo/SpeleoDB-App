import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DistanceScale from './DistanceScale';
import { computeDistanceScaleMetrics } from '../../utils/distanceScale';
import { FEET_TO_METERS } from '../../utils/measurementUnits';

describe('DistanceScale', () => {
  it('renders with label and bar', () => {
    render(<DistanceScale zoom={5} latitude={46.6} measurementUnit="feet" />);
    expect(screen.getByTestId('distance-scale')).toBeInTheDocument();
    expect(screen.getByText(/ft|mi/)).toBeInTheDocument();
  });

  it('computes a bounded width and positive distance', () => {
    const metrics = computeDistanceScaleMetrics(8, 40);
    expect(metrics.distanceFeet).toBeGreaterThan(0);
    expect(metrics.widthPx).toBeGreaterThanOrEqual(48);
    expect(metrics.widthPx).toBeLessThanOrEqual(112);
  });

  it('scales down distances at higher zoom levels', () => {
    const lowZoom = computeDistanceScaleMetrics(5, 46.6);
    const highZoom = computeDistanceScaleMetrics(15, 46.6);
    expect(highZoom.distanceFeet).toBeLessThan(lowZoom.distanceFeet);
  });

  it('produces feet values consistent with ground distance at zoom 15', () => {
    const metrics = computeDistanceScaleMetrics(15, 46.6);
    expect(metrics.distanceFeet).toBe(1000);
    const expectedMeters = 1000 * FEET_TO_METERS;
    expect(expectedMeters).toBeCloseTo(304.8, 1);
  });

  it('produces a 1/2/5 nice distance value in feet', () => {
    for (let zoom = 2; zoom <= 18; zoom++) {
      const metrics = computeDistanceScaleMetrics(zoom, 45);
      const d = metrics.distanceFeet;
      const magnitude = 10 ** Math.floor(Math.log10(d));
      const leading = Math.round(d / magnitude);
      expect([1, 2, 5]).toContain(leading);
    }
  });

  it('shows smaller distances at higher latitudes for same zoom', () => {
    const equator = computeDistanceScaleMetrics(10, 0);
    const arctic = computeDistanceScaleMetrics(10, 80);
    expect(arctic.distanceFeet).toBeLessThan(equator.distanceFeet);
  });

  it('renders metric labels when meters mode is selected', () => {
    render(<DistanceScale zoom={15} latitude={46.6} measurementUnit="meters" />);
    expect(screen.getByText('305 m')).toBeInTheDocument();
  });

  it('renders feet labels when feet mode is selected', () => {
    render(<DistanceScale zoom={15} latitude={46.6} measurementUnit="feet" />);
    expect(screen.getByText('1000 ft')).toBeInTheDocument();
  });
});
