import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from './ConfirmDialog';

vi.mock('@ionic/react', () => ({
  IonModal: ({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) =>
    isOpen ? <div data-testid="ion-modal">{children}</div> : null,
  IonContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

describe('ConfirmDialog', () => {
  const baseProps = {
    isOpen: true,
    title: 'Delete Landmark',
    message: 'Are you sure?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('does not render its body when closed', () => {
    render(<ConfirmDialog {...baseProps} isOpen={false} />);
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('renders title, message, and warning', () => {
    render(<ConfirmDialog {...baseProps} warning="This action cannot be undone." />);
    expect(screen.getByText('Delete Landmark')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog-warning')).toHaveTextContent(
      'This action cannot be undone.',
    );
  });

  it('omits the warning element when not provided', () => {
    render(<ConfirmDialog {...baseProps} />);
    expect(screen.queryByTestId('confirm-dialog-warning')).not.toBeInTheDocument();
  });

  it('fires onConfirm and onCancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />);

    await user.click(screen.getByTestId('confirm-dialog-cancel'));
    await user.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('disables both buttons while busy and shows the busy label', () => {
    render(<ConfirmDialog {...baseProps} busy busyLabel="Deleting…" confirmLabel="Delete" />);
    expect(screen.getByTestId('confirm-dialog-confirm')).toBeDisabled();
    expect(screen.getByTestId('confirm-dialog-cancel')).toBeDisabled();
    expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Deleting…');
  });

  it('does not fire callbacks when busy (clicks are no-ops on disabled buttons)', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...baseProps} busy onConfirm={onConfirm} onCancel={onCancel} />);

    await user.click(screen.getByTestId('confirm-dialog-confirm'));
    await user.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('honors a custom testId', () => {
    render(<ConfirmDialog {...baseProps} testId="delete-landmark-confirm" />);
    expect(screen.getByTestId('delete-landmark-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('delete-landmark-confirm-confirm')).toBeInTheDocument();
  });

  it('renders rich-node messages', () => {
    render(
      <ConfirmDialog
        {...baseProps}
        message={<span data-testid="rich">Delete <strong>Camp</strong>?</span>}
      />,
    );
    expect(screen.getByTestId('rich')).toBeInTheDocument();
  });
});
