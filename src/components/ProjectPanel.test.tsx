import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectPanel from './ProjectPanel';
import type { ProjectPanelProps } from './ProjectPanel';
import type { Project } from '../types/project';

// ==================== Mocks ====================

vi.mock('@ionic/react', () => ({
  IonToggle: ({ checked, onIonChange, children, ...rest }: {
    checked?: boolean;
    onIonChange?: (e: { detail: { checked: boolean } }) => void;
    children?: React.ReactNode;
  } & Record<string, unknown>) => (
    <label
      data-testid={rest['data-testid'] as string}
      data-tour={rest['data-tour'] as string}
      aria-label={rest['aria-label'] as string}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onIonChange?.({ detail: { checked: e.target.checked } })}
      />
      {children}
    </label>
  ),
}));

// ==================== Helpers ====================

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    description: '',
    country: '',
    color: '#377eb8',
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
    makeProject({ id: 'p1', name: 'Alpha Cave', color: '#aa0000' }),
    makeProject({ id: 'p2', name: 'Beta Grotto', color: '#00aa00' }),
    makeProject({ id: 'p3', name: 'Gamma Cavern', color: '#0000aa' }),
  ],
  activeProjectIds: new Set(['p1', 'p2', 'p3']),
  geoJsonData: { p1: {}, p2: {}, p3: {} },
  projectColorsById: {
    p1: '#aa0000',
    p2: '#00aa00',
    p3: '#0000aa',
  },
  countryVisibility: {},
  countryCollapsed: {},
  onToggleProject: vi.fn(),
  onZoomToProject: vi.fn(),
  onShowAll: vi.fn(),
  onHideAll: vi.fn(),
  onToggleCountry: vi.fn(),
  onToggleCountryCollapsed: vi.fn(),
  onClose: vi.fn(),
  isOpen: true,
};

function renderPanel(overrides: Partial<ProjectPanelProps> = {}) {
  return render(<ProjectPanel {...defaultProps} {...overrides} />);
}

// ==================== Tests ====================

describe('ProjectPanel', () => {
  describe('flat list (no country data)', () => {
    it('renders project names when open', () => {
      renderPanel();
      expect(screen.getByText('Alpha Cave')).toBeInTheDocument();
      expect(screen.getByText('Beta Grotto')).toBeInTheDocument();
      expect(screen.getByText('Gamma Cavern')).toBeInTheDocument();
    });

    it('does not render any country group headers', () => {
      const { container } = renderPanel();
      expect(container.querySelector('[data-testid^="country-group-"]')).toBeNull();
    });

    it('shows correct effective count of visible projects', () => {
      renderPanel({ activeProjectIds: new Set(['p1']) });
      expect(screen.getByText('1 of 3 visible')).toBeInTheDocument();
    });

    it('shows empty state when no projects', () => {
      renderPanel({ projects: [] });
      expect(screen.getByText('No projects available')).toBeInTheDocument();
    });

    it('renders project dots from provided projectColorsById mapping', () => {
      renderPanel({
        projectColorsById: {
          p1: '#111111',
          p2: '#222222',
          p3: '#333333',
        },
      });

      const betaDot = screen.getByTestId('project-color-dot-p2');
      expect(betaDot).toHaveStyle({ backgroundColor: '#222222' });
    });

    it('calls onZoomToProject when a project name is clicked', async () => {
      const onZoom = vi.fn();
      renderPanel({ onZoomToProject: onZoom });

      await userEvent.click(screen.getByText('Beta Grotto'));
      expect(onZoom).toHaveBeenCalledWith('p2');
    });

    it('calls onToggleProject when the toggle switch is clicked', async () => {
      const onToggle = vi.fn();
      renderPanel({ onToggleProject: onToggle, activeProjectIds: new Set() });

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

    it('renders guided tour selector for bulk actions', () => {
      const { container } = renderPanel();
      const bulkActions = container.querySelector('[data-tour="bulk-actions"]');
      expect(bulkActions).not.toBeNull();
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

    it('reflects project active state in toggle checked attribute', () => {
      renderPanel({ activeProjectIds: new Set(['p1', 'p3']) });

      const p1Toggle = screen.getByTestId('project-toggle-p1');
      const p2Toggle = screen.getByTestId('project-toggle-p2');
      const p3Toggle = screen.getByTestId('project-toggle-p3');

      expect((p1Toggle.querySelector('input') as HTMLInputElement).checked).toBe(true);
      expect((p2Toggle.querySelector('input') as HTMLInputElement).checked).toBe(false);
      expect((p3Toggle.querySelector('input') as HTMLInputElement).checked).toBe(true);
    });

    it('exposes guided tour panel-open marker for runtime readiness checks', () => {
      const { container, rerender } = renderPanel({ isOpen: false });
      const closedPanel = container.querySelector('[data-tour="project-panel"]');
      expect(closedPanel?.getAttribute('data-tour-open')).toBe('false');

      rerender(<ProjectPanel {...defaultProps} isOpen />);
      const openPanel = container.querySelector('[data-tour="project-panel"]');
      expect(openPanel?.getAttribute('data-tour-open')).toBe('true');
    });
  });

  describe('country grouping', () => {
    it('renders one country group per distinct country', () => {
      const { container } = renderPanel({
        projects: [
          makeProject({ id: 'p1', name: 'Alpha', country: 'FR' }),
          makeProject({ id: 'p2', name: 'Bravo', country: 'US' }),
          makeProject({ id: 'p3', name: 'Charlie', country: 'FR' }),
        ],
      });

      expect(container.querySelector('[data-testid="country-group-FR"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="country-group-US"]')).not.toBeNull();
    });

    it('sorts countries alphabetically', () => {
      const { container } = renderPanel({
        projects: [
          makeProject({ id: 'p1', country: 'US' }),
          makeProject({ id: 'p2', country: 'CA' }),
          makeProject({ id: 'p3', country: 'FR' }),
        ],
      });

      const groups = [...container.querySelectorAll('[data-testid^="country-group-"]')];
      expect(groups.map((g) => g.getAttribute('data-testid'))).toEqual([
        'country-group-CA',
        'country-group-FR',
        'country-group-US',
      ]);
    });

    it('falls back to a synthetic Unknown group for projects without a country, mixed with real groups', () => {
      const { container } = renderPanel({
        projects: [
          makeProject({ id: 'p1', name: 'Alpha', country: 'FR' }),
          makeProject({ id: 'p2', name: 'Bravo', country: '' }),
        ],
      });
      expect(container.querySelector('[data-testid="country-group-FR"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="country-group-Unknown"]')).not.toBeNull();
    });

    it('country toggle invokes onToggleCountry with new visibility', async () => {
      const onToggleCountry = vi.fn();
      renderPanel({
        projects: [makeProject({ id: 'p1', country: 'FR' })],
        onToggleCountry,
      });

      const toggleInput = screen
        .getByTestId('country-toggle-FR')
        .querySelector('input') as HTMLInputElement;
      await userEvent.click(toggleInput);

      expect(onToggleCountry).toHaveBeenCalledWith('FR', false);
    });

    it('header click invokes onToggleCountryCollapsed with the new collapsed state', async () => {
      const onToggleCountryCollapsed = vi.fn();
      renderPanel({
        projects: [makeProject({ id: 'p1', country: 'FR' })],
        onToggleCountryCollapsed,
      });

      await userEvent.click(screen.getByTestId('country-collapse-FR'));
      expect(onToggleCountryCollapsed).toHaveBeenCalledWith('FR', true);
    });

    it('country gate OFF mutes the project row dot without un-checking the individual toggle', () => {
      renderPanel({
        projects: [makeProject({ id: 'p1', country: 'FR', color: '#aabbcc' })],
        activeProjectIds: new Set(['p1']),
        countryVisibility: { FR: false },
        projectColorsById: { p1: '#aabbcc' },
      });

      const dot = screen.getByTestId('project-color-dot-p1') as HTMLElement;
      // Muted style: hollow border (color-only outline) with no fill.
      expect(dot.style.backgroundColor).toBe('transparent');
      expect(dot.style.borderColor).toBe('rgb(170, 187, 204)');
      expect(dot.style.borderWidth).toBe('2px');

      const toggleInput = screen
        .getByTestId('project-toggle-p1')
        .querySelector('input') as HTMLInputElement;
      expect(toggleInput.checked).toBe(true);
    });

    it('country gate ON keeps a project row in fully-visible style', () => {
      renderPanel({
        projects: [makeProject({ id: 'p1', country: 'FR', color: '#abcdef' })],
        activeProjectIds: new Set(['p1']),
        countryVisibility: { FR: true },
        projectColorsById: { p1: '#abcdef' },
      });

      const dot = screen.getByTestId('project-color-dot-p1');
      expect(dot).toHaveStyle({ backgroundColor: '#abcdef' });
    });

    it('header subtitle counts effectively visible only', () => {
      renderPanel({
        projects: [
          makeProject({ id: 'p1', country: 'FR' }),
          makeProject({ id: 'p2', country: 'FR' }),
        ],
        activeProjectIds: new Set(['p1', 'p2']),
        countryVisibility: { FR: false },
      });
      expect(screen.getByText('0 of 2 visible')).toBeInTheDocument();
    });

    it('collapsed country hides its rows from the DOM', () => {
      renderPanel({
        projects: [makeProject({ id: 'p1', name: 'Alpha', country: 'FR' })],
        countryCollapsed: { FR: true },
      });

      expect(screen.queryByText('Alpha')).toBeNull();
      // The header itself is still rendered
      expect(screen.getByTestId('country-collapse-FR')).toBeInTheDocument();
    });

    it('country gate toggle reflects current visibility state', () => {
      const { rerender } = renderPanel({
        projects: [makeProject({ id: 'p1', country: 'FR' })],
        countryVisibility: {},
      });
      let toggleInput = screen
        .getByTestId('country-toggle-FR')
        .querySelector('input') as HTMLInputElement;
      expect(toggleInput.checked).toBe(true);

      rerender(
        <ProjectPanel
          {...defaultProps}
          projects={[makeProject({ id: 'p1', country: 'FR' })]}
          countryVisibility={{ FR: false }}
        />,
      );
      toggleInput = screen
        .getByTestId('country-toggle-FR')
        .querySelector('input') as HTMLInputElement;
      expect(toggleInput.checked).toBe(false);
    });

    it('renders the country flag emoji for known ISO codes and skips it for Unknown', () => {
      const { container } = renderPanel({
        projects: [
          makeProject({ id: 'p1', country: 'FR' }),
          makeProject({ id: 'p2', country: '' }),
        ],
      });

      const frHeader = container.querySelector('[data-testid="country-collapse-FR"]');
      const unknownHeader = container.querySelector('[data-testid="country-collapse-Unknown"]');
      expect(frHeader?.textContent).toContain('🇫🇷');
      expect(unknownHeader?.textContent ?? '').not.toContain('🇫🇷');
    });
  });
});
