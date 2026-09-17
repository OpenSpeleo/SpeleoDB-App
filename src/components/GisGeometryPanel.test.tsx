import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GisGeometryPanel, type GisGeometryPanelProps } from './GisGeometryPanel';
import { gisMetadata, gisSnapshot } from '../test/gisGeometryFixtures';

vi.mock('@ionic/react', () => ({
  IonToggle: ({ checked, disabled, onIonChange, ...props }: {
    checked: boolean; disabled?: boolean;
    onIonChange(event: { detail: { checked: boolean } }): void;
    'aria-label': string; 'data-testid': string;
  }) => <input type="checkbox" checked={checked} disabled={disabled} aria-label={props['aria-label']}
    data-testid={props['data-testid']} onChange={event => onIonChange({ detail: { checked: event.target.checked } })} />,
}));

function setup(overrides: Partial<GisGeometryPanelProps> = {}) {
  const props: GisGeometryPanelProps = {
    isOpen: true, onClose: vi.fn(), snapshot: gisSnapshot(),
    offline: false, visibility: {}, visibleCount: 0, onToggle: vi.fn(), onZoom: vi.fn(),
    onRetry: vi.fn(), onRefresh: vi.fn(), onShowAll: vi.fn(), onHideAll: vi.fn(), ...overrides,
  };
  return { props, ...render(<GisGeometryPanel {...props} />) };
}

describe('Geometries panel', () => {
  it('matches project presentation: name, color, independent toggle and bulk buttons', () => {
    const { props } = setup();
    expect(screen.getByRole('heading', { name: 'Geometries' })).toBeInTheDocument();
    expect(screen.getByText('0 of 1 visible')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to Reference line' }));
    expect(props.onZoom).toHaveBeenCalledExactlyOnceWith(gisMetadata().id);
    expect(props.onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(gisMetadata().id, true);
    expect(props.onZoom).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Tap a name|Preparing offline|LineString|Polygon|Offline ready/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Info|Edit|Delete|Access|Share|Refresh/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom to Reference line' }).querySelector('svg')).toBeNull();
  });

  it('allows hiding while explicitly requested geometry is loading', () => {
    const id = gisMetadata().id;
    const { props } = setup({ snapshot: gisSnapshot({ loadingIds: [id] }), visibility: { [id]: true } });
    expect(screen.getByRole('status', { name: 'Loading Reference line' })).toBeInTheDocument();
    const toggle = screen.getByRole('checkbox');
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(id, false);
  });

  it('keeps automatic offline preparation out of the normal row presentation', () => {
    const id = gisMetadata().id;
    setup({ snapshot: gisSnapshot({ loadingIds: [id], errors: { [id]: 'Not saved offline' } }) });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Preparing|Offline maps|saved offline/)).not.toBeInTheDocument();
  });

  it.each([1, 2, 3] as const)('shows the same read-only browser for permission level %s', level => {
    setup({ snapshot: gisSnapshot({ items: [gisMetadata({ user_permission_level: level, geometry_type: 'Polygon' })] }) });
    expect(screen.getByRole('checkbox')).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Edit|Delete|permissions/i })).not.toBeInTheDocument();
  });

  it('wires bulk controls and explicit error retry with safe error text', () => {
    const id = gisMetadata().id;
    const error = '<script>unsafe()</script>';
    const { props, container } = setup({ snapshot: gisSnapshot({ errors: { [id]: error } }), visibility: { [id]: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Show all geometries' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide all geometries' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry Reference line' }));
    expect(props.onShowAll).toHaveBeenCalledOnce();
    expect(props.onHideAll).toHaveBeenCalledOnce();
    expect(props.onRetry).toHaveBeenCalledExactlyOnceWith(id);
    expect(screen.getByText(error)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });

  it('distinguishes loading, empty success and a retryable collection failure', () => {
    const { props, rerender } = setup({ snapshot: gisSnapshot({ items: [], status: 'loading' }) });
    expect(screen.getByRole('status')).toHaveTextContent('Loading geometries');
    expect(screen.queryByText('No geometries available.')).not.toBeInTheDocument();
    rerender(<GisGeometryPanel {...props} snapshot={gisSnapshot({ items: [] })} />);
    expect(screen.getByText('No geometries available.')).toBeInTheDocument();
    rerender(<GisGeometryPanel {...props} snapshot={gisSnapshot({ items: [], status: 'error', error: 'Unable to load geometries.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load geometries.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry geometries' }));
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(screen.queryByText('No geometries available.')).not.toBeInTheDocument();
  });

  it('explains an empty offline list', () => {
    setup({ offline: true, snapshot: gisSnapshot({ items: [] }) });
    expect(screen.getByText('No geometries saved on this device.')).toBeInTheDocument();
  });
});
