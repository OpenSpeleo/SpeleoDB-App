import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LongPressRing from './LongPressRing';

describe('LongPressRing', () => {
  const base = { x: 100, y: 200, durationMs: 550, sizePx: 64, strokePx: 4 };

  it('renders a non-interactive ring positioned at the touch point', () => {
    render(<LongPressRing {...base} />);
    const ring = screen.getByTestId('long-press-ring');
    expect(ring).toBeInTheDocument();
    expect(ring).toHaveAttribute('aria-hidden', 'true');
    // Centered on the touch point: left = x - size/2, top = y - size/2.
    expect(ring.style.left).toBe('68px');
    expect(ring.style.top).toBe('168px');
    expect(ring.style.pointerEvents).toBe('none');
  });

  it('animates the progress arc with a duration matched to the long-press time', () => {
    render(<LongPressRing {...base} />);
    const progress = screen.getByTestId('long-press-ring-progress');
    expect(progress.style.animation).toContain('550ms');
  });

  it('uses the configured size for the svg', () => {
    render(<LongPressRing {...base} sizePx={80} />);
    const svg = screen.getByTestId('long-press-ring').querySelector('svg');
    expect(svg).toHaveAttribute('width', '80');
    expect(svg).toHaveAttribute('height', '80');
  });
});
