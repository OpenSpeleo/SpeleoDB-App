import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardSidePanel } from './DashboardSidePanel';

describe('DashboardSidePanel', () => {
  it('focuses its close action, handles escape, and restores the opening control', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { rerender, container } = render(
      <DashboardSidePanel isOpen onClose={onClose} title="GIS Geometry" testId="panel"><button>Child action</button></DashboardSidePanel>,
    );
    expect(screen.getByLabelText('Close panel')).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText('Close panel'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<DashboardSidePanel isOpen={false} onClose={onClose} title="GIS Geometry" testId="panel"><button>Child action</button></DashboardSidePanel>);
    expect(opener).toHaveFocus();
    expect(container.querySelector('section')).toHaveAttribute('inert');
    expect(screen.queryByRole('button', { name: 'Child action' })).not.toBeInTheDocument();
    opener.remove();
  });
});
