import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LandmarkFormModal from './LandmarkFormModal';
import type { LandmarkFormModalProps } from './LandmarkFormModal';
import type { LandmarkCollection } from '../types/landmark';

vi.mock('@ionic/react', () => ({
  IonModal: ({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) =>
    isOpen ? <div data-testid="ion-modal">{children}</div> : null,
  IonContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const collections: LandmarkCollection[] = [
  { id: 'col-personal', name: 'Personal Landmarks', color: '#fff', isPersonal: true, canWrite: true },
  { id: 'col-survey', name: 'Survey A', color: '#111', isPersonal: false, canWrite: true },
];

function renderForm(overrides: Partial<LandmarkFormModalProps> = {}) {
  const props: LandmarkFormModalProps = {
    isOpen: true,
    mode: 'create',
    initialValues: { latitude: 45.5, longitude: -122.25 },
    collections,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const utils = render(<LandmarkFormModal {...props} />);
  return { props, ...utils };
}

describe('LandmarkFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render body when closed', () => {
    renderForm({ isOpen: false });
    expect(screen.queryByTestId('landmark-form-modal')).not.toBeInTheDocument();
  });

  it('renders create title and prefilled coordinates', () => {
    renderForm();
    expect(screen.getByText('Create Landmark')).toBeInTheDocument();
    expect(screen.getByTestId('landmark-latitude-input')).toHaveValue('45.5');
    expect(screen.getByTestId('landmark-longitude-input')).toHaveValue('-122.25');
  });

  it('defaults the collection to the personal collection in create mode', () => {
    renderForm();
    expect(screen.getByTestId('landmark-collection-select')).toHaveValue('col-personal');
  });

  it('reseeds the collection default to personal once the list loads after opening', () => {
    // The picker list is fetched asynchronously, so the modal first renders with
    // no collections (only the synthetic personal fallback). When the real list
    // arrives, the select must switch to the personal collection id so the shown
    // selection matches what gets submitted -- otherwise the controlled value is
    // stale ('') and the form silently creates the landmark in another
    // collection than the one displayed.
    const { rerender } = renderForm({ collections: [] });
    expect(screen.getByTestId('landmark-collection-select')).toHaveValue('');

    rerender(
      <LandmarkFormModal
        isOpen
        mode="create"
        initialValues={{ latitude: 45.5, longitude: -122.25 }}
        collections={collections}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId('landmark-collection-select')).toHaveValue('col-personal');
  });

  it('does not overwrite a user-picked collection when the list reloads', async () => {
    const user = userEvent.setup();
    const { rerender } = renderForm();
    await user.selectOptions(screen.getByTestId('landmark-collection-select'), 'col-survey');
    expect(screen.getByTestId('landmark-collection-select')).toHaveValue('col-survey');

    // A later list refresh (same collections) must not clobber the manual choice.
    rerender(
      <LandmarkFormModal
        isOpen
        mode="create"
        initialValues={{ latitude: 45.5, longitude: -122.25 }}
        collections={[...collections]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId('landmark-collection-select')).toHaveValue('col-survey');
  });

  it('renders edit title and prefilled values', () => {
    renderForm({
      mode: 'edit',
      initialValues: {
        name: 'Camp',
        description: 'Base',
        latitude: 1,
        longitude: 2,
        collectionId: 'col-survey',
        collectionName: 'Survey A',
      },
    });
    expect(screen.getByText('Edit Landmark')).toBeInTheDocument();
    expect(screen.getByTestId('landmark-name-input')).toHaveValue('Camp');
    expect(screen.getByTestId('landmark-description-input')).toHaveValue('Base');
    expect(screen.getByTestId('landmark-collection-select')).toHaveValue('col-survey');
  });

  it('shows a validation error and does NOT submit when the name is empty', async () => {
    const user = userEvent.setup();
    const { props } = renderForm();
    await user.click(screen.getByTestId('landmark-form-submit'));
    expect(screen.getByTestId('landmark-name-error')).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('shows a validation error for out-of-range coordinates', async () => {
    const user = userEvent.setup();
    const { props } = renderForm();
    await user.type(screen.getByTestId('landmark-name-input'), 'Camp');
    await user.clear(screen.getByTestId('landmark-latitude-input'));
    await user.type(screen.getByTestId('landmark-latitude-input'), '999');
    await user.click(screen.getByTestId('landmark-form-submit'));
    expect(screen.getByTestId('landmark-latitude-error')).toBeInTheDocument();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('submits normalized values, mapping the personal option to null collection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    await user.type(screen.getByTestId('landmark-name-input'), '  Camp  ');
    await user.click(screen.getByTestId('landmark-form-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Camp',
      description: '',
      latitude: 45.5,
      longitude: -122.25,
      collection: 'col-personal',
    });
  });

  it('submits the chosen collection id', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ onSubmit });
    await user.type(screen.getByTestId('landmark-name-input'), 'Camp');
    await user.selectOptions(screen.getByTestId('landmark-collection-select'), 'col-survey');
    await user.click(screen.getByTestId('landmark-form-submit'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ collection: 'col-survey' }));
  });

  it('offers a Personal Landmarks fallback option when no personal collection is available', () => {
    renderForm({ collections: [collections[1]] });
    const select = screen.getByTestId('landmark-collection-select') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain('Personal Landmarks');
  });

  it('keeps the current collection selectable in edit mode even if not writable-listed', () => {
    renderForm({
      mode: 'edit',
      collections: [collections[0]],
      initialValues: {
        name: 'Camp',
        latitude: 1,
        longitude: 2,
        collectionId: 'col-archived',
        collectionName: 'Archived Set',
      },
    });
    const select = screen.getByTestId('landmark-collection-select') as HTMLSelectElement;
    expect(select.value).toBe('col-archived');
    expect(Array.from(select.options).map((o) => o.textContent)).toContain('Archived Set');
  });

  it('surfaces a server submit error', () => {
    renderForm({ submitError: 'A landmark already exists here.' });
    expect(screen.getByTestId('landmark-submit-error')).toHaveTextContent(
      'A landmark already exists here.',
    );
  });

  it('disables inputs and buttons while busy', () => {
    renderForm({ busy: true });
    expect(screen.getByTestId('landmark-name-input')).toBeDisabled();
    expect(screen.getByTestId('landmark-form-submit')).toBeDisabled();
    expect(screen.getByTestId('landmark-form-cancel')).toBeDisabled();
  });

  it('does not submit again while a submit is in flight (busy)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm({ busy: true, onSubmit });
    await user.click(screen.getByTestId('landmark-form-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('fires onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderForm({ onCancel });
    await user.click(screen.getByTestId('landmark-form-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('reseeds fields when reopened with new initial values', () => {
    const { rerender } = renderForm({
      isOpen: false,
      initialValues: { latitude: 10, longitude: 20 },
    });
    rerender(
      <LandmarkFormModal
        isOpen
        mode="create"
        initialValues={{ latitude: 33, longitude: 44 }}
        collections={collections}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('landmark-latitude-input')).toHaveValue('33');
    expect(screen.getByTestId('landmark-longitude-input')).toHaveValue('44');
  });
});
