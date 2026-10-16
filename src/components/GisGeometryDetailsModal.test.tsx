import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GisGeometryDetailsModal } from './GisGeometryDetailsModal';
import { gisMetadata, gisRecord, gisSnapshot } from '../test/gisGeometryFixtures';

vi.mock('@ionic/react', () => ({
  IonModal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div>{children}</div> : null,
  IonContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('read-only geometry information', () => {
  it('renders cached descriptions as text and closes without modifying geometry', async () => {
    const item = gisMetadata({ alias: 'Center' }), record = gisRecord(item);
    record.detail.description = '<script>alert(1)</script>\nCave notes';
    const onClose = vi.fn(), onRetry = vi.fn();
    const { container } = render(<GisGeometryDetailsModal item={item}
      snapshot={gisSnapshot({ records: { [item.id]: record } })} onClose={onClose} onRetry={onRetry} />);
    expect(screen.getByText('Center')).toBeVisible();
    expect(screen.getByText(/Cave notes/)).toHaveTextContent('<script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('distinguishes migrated unknown descriptions from an authoritative empty description', () => {
    const item = gisMetadata(), record = { ...gisRecord(item), needsMetadataRefresh: true };
    render(<GisGeometryDetailsModal item={item} snapshot={gisSnapshot({ records: { [item.id]: record } })}
      onClose={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('Description not yet available. Connect online to refresh.')).toBeVisible();
    expect(screen.queryByText('No description')).not.toBeInTheDocument();
  });
});
