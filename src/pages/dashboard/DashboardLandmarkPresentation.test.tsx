import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MAP } from '../../constants';
import type { LandmarkDetails } from '../../utils/overlayMarkerDetails';
import {
  DashboardLandmarkDialogs,
  DashboardLandmarkFeedback,
  type DashboardLandmarkDialogsProps,
} from './DashboardLandmarkPresentation';

vi.mock('../../components/OverlayMarkerDetailsModal', () => ({
  default: ({
    detail,
    onClose,
    onCreateLandmark,
    onEditLandmark,
    onDeleteLandmark,
  }: {
    detail: unknown;
    onClose: () => void;
    onCreateLandmark: () => void;
    onEditLandmark: () => void;
    onDeleteLandmark: () => void;
  }) => (
    <div data-testid="detail" data-open={String(detail !== null)}>
      <button onClick={onClose}>close detail</button>
      <button onClick={onCreateLandmark}>create landmark</button>
      <button onClick={onEditLandmark}>edit landmark</button>
      <button onClick={onDeleteLandmark}>delete landmark</button>
    </div>
  ),
}));

vi.mock('../../components/LandmarkFormModal', () => ({
  default: ({
    mode,
    busy,
    submitError,
    onSubmit,
    onCancel,
  }: {
    mode: string;
    busy: boolean;
    submitError: string | null;
    onSubmit: (value: never) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="form" data-mode={mode} data-busy={String(busy)}>
      {submitError}
      <button onClick={() => onSubmit({} as never)}>submit form</button>
      <button onClick={onCancel}>cancel form</button>
    </div>
  ),
}));

vi.mock('../../components/ConfirmDialog', () => ({
  default: ({
    isOpen,
    message,
    warning,
    busy,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    message: ReactNode;
    warning: ReactNode;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) => (isOpen ? (
    <div data-testid="delete" data-busy={String(busy)}>
      {message}{warning}
      <button onClick={onConfirm}>confirm deletion</button>
      <button onClick={onCancel}>cancel deletion</button>
    </div>
  ) : null),
}));

vi.mock('../../components/LongPressRing', () => ({
  default: ({
    x,
    y,
    durationMs,
    sizePx,
    strokePx,
  }: {
    x: number;
    y: number;
    durationMs: number;
    sizePx: number;
    strokePx: number;
  }) => (
    <div
      data-testid="ring"
      data-x={x}
      data-y={y}
      data-duration={durationMs}
      data-size={sizePx}
      data-stroke={strokePx}
    />
  ),
}));

function landmark(name: string): LandmarkDetails {
  return {
    type: 'landmark',
    id: 'landmark-1',
    name,
    description: '',
    gpsCoordinate: '45, -73',
    collectionName: 'Survey',
    isPersonalCollection: false,
    canWrite: true,
    canDelete: true,
    collectionId: 'survey',
    latitude: 45,
    longitude: -73,
  };
}

function dialogProps(): DashboardLandmarkDialogsProps {
  return {
    detail: {
      value: null,
      onClose: vi.fn(),
      onCreate: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    },
    form: {
      value: null,
      collections: [],
      busy: false,
      error: null,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    },
    deletion: {
      target: null,
      busy: false,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    },
  };
}

describe('Dashboard landmark presentation', () => {
  it('keeps optional form, deletion, toast, and ring surfaces absent', () => {
    const props = dialogProps();
    render(
      <>
        <DashboardLandmarkDialogs {...props} />
        <DashboardLandmarkFeedback toast={null} longPressRing={null} />
      </>,
    );

    expect(screen.getByTestId('detail')).toHaveAttribute('data-open', 'false');
    expect(screen.queryByTestId('form')).toBeNull();
    expect(screen.queryByTestId('delete')).toBeNull();
    expect(screen.queryByTestId('landmark-toast')).toBeNull();
    expect(screen.queryByTestId('ring')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'close detail' }));
    fireEvent.click(screen.getByRole('button', { name: 'create landmark' }));
    fireEvent.click(screen.getByRole('button', { name: 'edit landmark' }));
    fireEvent.click(screen.getByRole('button', { name: 'delete landmark' }));
    expect(props.detail.onClose).toHaveBeenCalledOnce();
    expect(props.detail.onCreate).toHaveBeenCalledOnce();
    expect(props.detail.onEdit).toHaveBeenCalledOnce();
    expect(props.detail.onDelete).toHaveBeenCalledOnce();
  });

  it('renders and forwards active form, named deletion, success toast, and ring state', () => {
    const props = dialogProps();
    props.form.value = {
      mode: 'create',
      editId: null,
      initialValues: { latitude: 45, longitude: -73 },
    };
    props.form.busy = true;
    props.form.error = 'Duplicate coordinate';
    props.deletion.target = landmark('Entrance');
    props.deletion.busy = true;
    render(
      <>
        <DashboardLandmarkDialogs {...props} />
        <DashboardLandmarkFeedback
          toast={{ message: 'Landmark created', tone: 'success' }}
          longPressRing={{ x: 12, y: 34 }}
        />
      </>,
    );

    expect(screen.getByTestId('form')).toHaveAttribute('data-mode', 'create');
    expect(screen.getByTestId('form')).toHaveAttribute('data-busy', 'true');
    expect(screen.getByText('Duplicate coordinate')).toBeInTheDocument();
    expect(screen.getByTestId('delete')).toHaveTextContent('Entrance');
    expect(screen.getByTestId('delete')).toHaveAttribute('data-busy', 'true');
    expect(screen.getByTestId('landmark-toast')).toHaveClass('bg-emerald-600');
    expect(screen.getByTestId('ring')).toHaveAttribute('data-x', '12');
    expect(screen.getByTestId('ring')).toHaveAttribute('data-y', '34');
    expect(screen.getByTestId('ring')).toHaveAttribute(
      'data-duration',
      String(MAP.LONG_PRESS_DURATION_MS - MAP.LONG_PRESS_RING_REVEAL_DELAY_MS),
    );
    expect(screen.getByTestId('ring')).toHaveAttribute('data-size', String(MAP.LONG_PRESS_RING_SIZE_PX));
    expect(screen.getByTestId('ring')).toHaveAttribute('data-stroke', String(MAP.LONG_PRESS_RING_STROKE_PX));
    fireEvent.click(screen.getByRole('button', { name: 'submit form' }));
    fireEvent.click(screen.getByRole('button', { name: 'cancel form' }));
    fireEvent.click(screen.getByRole('button', { name: 'confirm deletion' }));
    fireEvent.click(screen.getByRole('button', { name: 'cancel deletion' }));
    expect(props.form.onSubmit).toHaveBeenCalledOnce();
    expect(props.form.onCancel).toHaveBeenCalledOnce();
    expect(props.deletion.onConfirm).toHaveBeenCalledOnce();
    expect(props.deletion.onCancel).toHaveBeenCalledOnce();
  });

  it('uses anonymous deletion copy and error styling for unavailable names', () => {
    const props = dialogProps();
    props.deletion.target = landmark('N/A');
    render(
      <>
        <DashboardLandmarkDialogs {...props} />
        <DashboardLandmarkFeedback
          toast={{ message: 'Delete failed', tone: 'error' }}
          longPressRing={null}
        />
      </>,
    );

    expect(screen.getByTestId('delete')).toHaveTextContent('this landmark');
    expect(screen.getByTestId('landmark-toast')).toHaveClass('bg-red-600');
  });
});
