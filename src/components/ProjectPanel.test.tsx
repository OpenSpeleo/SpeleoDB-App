import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectPanel from './ProjectPanel';
import type { ProjectPanelProps } from './ProjectPanel';
import type { Project } from '../types/project';

// ==================== Helpers ====================

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    description: '',
    country: 'FR',
    type: 'survey',
    visibility: 'public',
    is_active: true,
    created_by: 'user',
    creation_date: '2025-01-01',
    modified_date: '2025-01-01',
    commit_count: 1,
    active_mutex: null,
    fork_from: null,
    exclude_geojson: false,
    geojson_file: 'test.geojson',
    latest_commit: {
      id: 'c1',
      message: 'init',
      author_email: 'a@b.com',
      author_name: 'Author',
      authored_date: '2025-01-01',
      dt_since: '1 day ago',
      parent_ids: [],
      url: '',
      formats: [],
      tree: [],
    },
    ...overrides,
  };
}

const defaultProps: ProjectPanelProps = {
  projects: [
    makeProject({ id: 'p1', name: 'Alpha Cave' }),
    makeProject({ id: 'p2', name: 'Beta Grotto' }),
    makeProject({ id: 'p3', name: 'Gamma Cavern' }),
  ],
  activeProjectIds: new Set(['p1', 'p2', 'p3']),
  geoJsonData: { p1: {}, p2: {}, p3: {} },
  tilePrefetchByProject: {},
  onToggleProject: vi.fn(),
  onZoomToProject: vi.fn(),
  onShowAll: vi.fn(),
  onHideAll: vi.fn(),
  onClose: vi.fn(),
  isOpen: true,
};

function renderPanel(overrides: Partial<ProjectPanelProps> = {}) {
  return render(<ProjectPanel {...defaultProps} {...overrides} />);
}

// ==================== Tests ====================

describe('ProjectPanel', () => {
  it('renders project names when open', () => {
    renderPanel();
    expect(screen.getByText('Alpha Cave')).toBeInTheDocument();
    expect(screen.getByText('Beta Grotto')).toBeInTheDocument();
    expect(screen.getByText('Gamma Cavern')).toBeInTheDocument();
  });

  it('shows correct count of visible projects', () => {
    renderPanel({ activeProjectIds: new Set(['p1']) });
    expect(screen.getByText('1 of 3 visible')).toBeInTheDocument();
  });

  it('shows empty state when no projects', () => {
    renderPanel({ projects: [] });
    expect(screen.getByText('No projects available')).toBeInTheDocument();
  });

  it('calls onZoomToProject when a project name is clicked', async () => {
    const onZoom = vi.fn();
    renderPanel({ onZoomToProject: onZoom });

    await userEvent.click(screen.getByText('Beta Grotto'));
    expect(onZoom).toHaveBeenCalledWith('p2');
  });

  it('calls onToggleProject when the toggle switch is clicked', async () => {
    const onToggle = vi.fn();
    renderPanel({ onToggleProject: onToggle });

    await userEvent.click(screen.getByLabelText('Toggle Beta Grotto'));
    expect(onToggle).toHaveBeenCalledWith('p2');
  });

  it('calls onShowAll when "Show all" is clicked', async () => {
    const onShowAll = vi.fn();
    renderPanel({ onShowAll });

    await userEvent.click(screen.getByText('Show all'));
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it('calls onHideAll when "Hide all" is clicked', async () => {
    const onHideAll = vi.fn();
    renderPanel({ onHideAll });

    await userEvent.click(screen.getByText('Hide all'));
    expect(onHideAll).toHaveBeenCalledOnce();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    await userEvent.click(screen.getByLabelText('Close panel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('applies -translate-x-full when closed', () => {
    const { container } = renderPanel({ isOpen: false });
    const panel = container.querySelector('.-translate-x-full');
    expect(panel).not.toBeNull();
  });

  it('applies translate-x-0 when open', () => {
    const { container } = renderPanel({ isOpen: true });
    const panel = container.querySelector('.translate-x-0');
    expect(panel).not.toBeNull();
  });
});
