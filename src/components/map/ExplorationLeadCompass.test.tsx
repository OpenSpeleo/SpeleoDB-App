import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createHeadingCompass } from '@speleodb/map-viewer/heading-compass';
import { ExplorationLeadCompass } from './ExplorationLeadCompass';

describe('shared exploration lead compass', () => {
  it('switches heading tabs without remounting the dial or editor or modifying other headings', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const original = [0, 90, 337.5];
    const changes: number[][] = [];
    const compass = createHeadingCompass(host, { headings: original, onChange: value => changes.push(value) });
    try {
      const dial = host.querySelector('svg');
      const editor = screen.getByRole('spinbutton', { name: 'Direction 1 in degrees' });
      const secondTab = screen.getByRole('tab', { name: 'Lead 2' });
      fireEvent.click(secondTab);
      expect(host.querySelector('svg')).toBe(dial);
      expect(screen.getByRole('spinbutton', { name: 'Direction 2 in degrees' })).toBe(editor);
      expect(editor).toHaveValue(90);
      expect(secondTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getAllByRole('slider')).toEqual([
        screen.getByRole('slider', { name: 'Direction 2: 90 degrees' }),
      ]);
      expect(changes).toEqual([]);
      fireEvent.change(editor, { target: { value: '123' } });
      expect(changes).toEqual([[0, 123, 337.5]]);
      fireEvent.keyDown(secondTab, { key: 'ArrowRight' });
      expect(screen.getByRole('tab', { name: 'Lead 3' })).toHaveFocus();
      expect(screen.getByRole('spinbutton', { name: 'Direction 3 in degrees' })).toBe(editor);
      expect(editor).toHaveValue(338);
      expect(screen.getAllByRole('slider')).toEqual([
        screen.getByRole('slider', { name: 'Direction 3: 338 degrees' }),
      ]);
      fireEvent.click(screen.getByRole('tab', { name: 'Lead 1' }));
      expect(editor).toHaveValue(0);
      expect(host.querySelector('svg')).toBe(dial);
      expect(original).toEqual([0, 90, 337.5]);
      expect(changes).toHaveLength(1);
      fireEvent.click(screen.getByRole('tab', { name: 'Lead 3' }));
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Direction 3: 338 degrees' }), { key: 'ArrowRight' });
      expect(editor).toHaveValue(339);
      expect(changes.at(-1)).toEqual([0, 123, 339]);
    } finally {
      compass.dispose();
      host.remove();
    }
  });

  it('keeps keyboard focus after editing and returns to Add when the final direction is removed', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const compass = createHeadingCompass(host, { headings: [] });
    try {
      screen.getByRole('button', { name: 'Add direction' }).focus();
      fireEvent.click(screen.getByRole('button', { name: 'Add direction' }));
      expect(screen.getByRole('spinbutton', { name: 'Direction 1 in degrees' })).toHaveFocus();
      fireEvent.change(document.activeElement!, { target: { value: '45' } });
      expect(screen.getByRole('spinbutton', { name: 'Direction 1 in degrees' })).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Add direction' }));
      expect(screen.getByRole('spinbutton', { name: 'Direction 2 in degrees' })).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Remove direction' }));
      expect(screen.getByRole('spinbutton', { name: 'Direction 1 in degrees' })).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Remove direction' }));
      expect(screen.getByRole('button', { name: 'Add direction' })).toHaveFocus();
    } finally {
      compass.dispose();
      host.remove();
    }
  });

  it('edits three draft directions and removes them individually without changing caller data', () => {
    const original = [0, 90, 337.5];
    let draft = original;
    const host = document.createElement('div');
    document.body.append(host);
    const compass = createHeadingCompass(host, { headings: original, onChange: value => { draft = value; } });
    try {
      expect(screen.getByRole('button', { name: 'Add direction' })).toBeDisabled();
      fireEvent.click(screen.getByRole('tab', { name: 'Lead 2' }));
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Direction 2 in degrees' }), { target: { value: '360' } });
      expect(compass.reportValidity()).toBe(false);
      expect(draft).toBe(original);
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Direction 2 in degrees' }), { target: { value: '123.5' } });
      expect(compass.reportValidity()).toBe(false);
      expect(draft).toBe(original);
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Direction 2 in degrees' }), { target: { value: '123' } });
      expect(compass.reportValidity()).toBe(true);
      expect(draft).toEqual([0, 123, 337.5]);
      expect(original).toEqual([0, 90, 337.5]);
      fireEvent.click(screen.getByRole('tab', { name: 'Lead 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove direction' }));
      expect(draft).toEqual([123, 337.5]);
      fireEvent.click(screen.getByRole('button', { name: 'Add direction' }));
      expect(draft).toEqual([123, 337.5, 0]);
      fireEvent.keyDown(screen.getByRole('slider', { name: 'Direction 3: 0 degrees' }), { key: 'ArrowLeft' });
      expect(draft).toEqual([123, 337.5, 359]);
      fireEvent.click(screen.getByRole('button', { name: 'Remove direction' }));
      expect(draft).toEqual([123, 337.5]);
      fireEvent.click(screen.getByRole('button', { name: 'Remove direction' }));
      expect(draft).toEqual([123]);
      fireEvent.click(screen.getByRole('button', { name: 'Remove direction' }));
      expect(draft).toEqual([]);
      expect(screen.getByText('No direction set')).toBeInTheDocument();
      compass.update({ headings: [45], readOnly: true });
      expect(draft).toEqual([]);
      expect(screen.getByText('45°')).toBeInTheDocument();
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    } finally {
      compass.dispose();
      host.remove();
    }
  });

  it('updates read-only saved directions and releases DOM when the modal unmounts', () => {
    const { rerender, unmount, container } = render(<ExplorationLeadCompass headings={[]} />);
    expect(screen.getByText('No direction set')).toBeInTheDocument();
    const savedHeadings = [359.9, 22.5];
    rerender(<ExplorationLeadCompass headings={savedHeadings} />);
    expect(screen.getByText('0°')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Lead 2' }));
    expect(screen.getByText('23°')).toBeInTheDocument();
    expect(savedHeadings).toEqual([359.9, 22.5]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();
    expect(container).toBeEmptyDOMElement();
  });
});
