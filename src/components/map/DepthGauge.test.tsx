import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DepthGauge from './DepthGauge';
import { DEPTH_COLOR_STOPS } from '../../utils/depthColoring';

function hexToRgb(hex: string): string {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

describe('DepthGauge', () => {
  it('aligns min and max labels with gauge bounds', () => {
    render(
      <DepthGauge
        depthDomain={{ min: 0, max: 120 }}
        currentDepth={30}
        measurementUnit="feet"
      />,
    );

    expect(screen.getByTestId('depth-gauge-labels')).toHaveClass('h-24');
    expect(screen.getByTestId('depth-gauge-labels')).toHaveClass('justify-between');
    expect(screen.getByTestId('depth-gauge-max')).toHaveTextContent('120 ft');
    expect(screen.getByTestId('depth-gauge-min')).toHaveTextContent('0 ft');
  });

  it('uses a richer shared color ramp and emphasized marker position', () => {
    render(
      <DepthGauge
        depthDomain={{ min: 0, max: 100 }}
        currentDepth={25}
        measurementUnit="feet"
      />,
    );

    const gradient = screen.getByTestId('depth-gauge-gradient');
    const gradientBackground = (gradient as HTMLElement).style.background;
    expect(gradientBackground).toContain('linear-gradient');
    expect(gradientBackground).toContain(hexToRgb(DEPTH_COLOR_STOPS[0].color));
    expect(gradientBackground).toContain(hexToRgb(DEPTH_COLOR_STOPS[DEPTH_COLOR_STOPS.length - 1].color));
    expect(gradientBackground).toContain('31.36%');
    expect(screen.getByTestId('depth-gauge-marker')).toHaveStyle({ top: '75%' });
  });

  it('shows 0 ft label for zero depth', () => {
    render(
      <DepthGauge
        depthDomain={{ min: 0, max: 100 }}
        currentDepth={0}
        measurementUnit="feet"
      />,
    );

    expect(screen.getByTestId('depth-gauge-current')).toHaveTextContent('0 ft');
    expect(screen.getByTestId('depth-gauge-marker')).toBeInTheDocument();
  });

  it('converts depth labels to meters when metric unit is selected', () => {
    render(
      <DepthGauge
        depthDomain={{ min: 0, max: 100 }}
        currentDepth={50}
        measurementUnit="meters"
      />,
    );

    expect(screen.getByTestId('depth-gauge-current')).toHaveTextContent('15.2 m');
    expect(screen.getByTestId('depth-gauge-max')).toHaveTextContent('30.5 m');
    expect(screen.getByTestId('depth-gauge-min')).toHaveTextContent('0 m');
  });

  it('shows empty current depth and N/A min/max when domain is null', () => {
    render(
      <DepthGauge
        depthDomain={null}
        currentDepth={null}
        measurementUnit="feet"
      />,
    );

    expect(screen.getByTestId('depth-gauge-current')).toHaveTextContent('');
    expect(screen.getByTestId('depth-gauge-max')).toHaveTextContent('N/A');
    expect(screen.getByTestId('depth-gauge-min')).toHaveTextContent('N/A');
    expect(screen.queryByTestId('depth-gauge-marker')).not.toBeInTheDocument();
  });
});
