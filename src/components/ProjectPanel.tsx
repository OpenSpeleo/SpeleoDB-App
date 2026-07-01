/**
 * ProjectPanel -- collapsible side panel for toggling project GeoJSON layers.
 *
 * Slides in from the left over the map. Renders projects either as a flat
 * list (when no project carries a country) or grouped by ISO country code
 * with collapsible sections and a per-country gate. Each project row shows
 * a colored dot and a per-project toggle.
 *
 * Two-level visibility model:
 *  - The per-project toggle reflects the user's individual preference.
 *  - The country gate is a hard mask layered on top.
 *  - A project is "effectively visible" iff both are ON. The Dashboard owns
 *    that AND and feeds it to the map; the panel only displays the result
 *    via dot fill style and muted text.
 *
 * Stateless: data and callbacks come in via props.
 */

import React from 'react';
import { IonToggle } from '@ionic/react';
import type { Project } from '../types/project';
import { getProjectColor } from '../utils/projectColors';
import { countryFlag } from '../utils/countryFlag';

// ==================== Constants ====================

const UNKNOWN_COUNTRY_LABEL = 'Unknown';

// ==================== Props ====================

export interface ProjectPanelProps {
  projects: Project[];
  activeProjectIds: Set<string>;
  geoJsonData: Record<string, unknown>;
  projectColorsById: Record<string, string>;
  countryVisibility: Record<string, boolean>;
  countryCollapsed: Record<string, boolean>;
  onToggleProject: (projectId: string) => void;
  onZoomToProject: (projectId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onToggleCountry: (country: string, visible: boolean) => void;
  onToggleCountryCollapsed: (country: string, collapsed: boolean) => void;
  onClose: () => void;
  isOpen: boolean;
}

// ==================== Helpers ====================

function isCountryOn(
  country: string,
  countryVisibility: Record<string, boolean>,
): boolean {
  return countryVisibility[country] !== false;
}

function isCountryCollapsed(
  country: string,
  countryCollapsed: Record<string, boolean>,
): boolean {
  return countryCollapsed[country] === true;
}

function groupProjectsByCountry(projects: Project[]): Map<string, Project[]> {
  const groups = new Map<string, Project[]>();
  for (const project of projects) {
    const key = project.country || UNKNOWN_COUNTRY_LABEL;
    const bucket = groups.get(key);
    if (bucket) bucket.push(project);
    else groups.set(key, [project]);
  }
  return groups;
}

function sortCountriesAlphabetically(
  groups: Map<string, Project[]>,
): Array<[string, Project[]]> {
  return [...groups.entries()].sort(([a], [b]) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
}

// ==================== Country header ====================

interface CountryHeaderProps {
  country: string;
  count: number;
  countryOn: boolean;
  collapsed: boolean;
  onToggleCountry: (country: string, visible: boolean) => void;
  onToggleCollapsed: (country: string, collapsed: boolean) => void;
}

const CountryHeader: React.FC<CountryHeaderProps> = ({
  country,
  count,
  countryOn,
  collapsed,
  onToggleCountry,
  onToggleCollapsed,
}) => {
  const flag = countryFlag(country);
  const label = country === UNKNOWN_COUNTRY_LABEL ? UNKNOWN_COUNTRY_LABEL : country;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 cursor-pointer
                 hover:bg-slate-700/30 transition-colors select-none"
      onClick={() => onToggleCollapsed(country, !collapsed)}
      data-testid={`country-collapse-${country}`}
    >
      <svg
        className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200
                    ${collapsed ? '-rotate-90' : 'rotate-0'}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
      {flag && (
        <span className="text-base leading-none" aria-hidden="true">
          {flag}
        </span>
      )}
      <span className="flex-1 text-xs font-semibold text-slate-200 uppercase tracking-wide">
        {label}
      </span>
      <span className="text-[10px] text-slate-500">({count})</span>
      <div
        // The toggle and its container must not bubble into the header click,
        // otherwise tapping the gate would also collapse the section.
        onClick={(e) => e.stopPropagation()}
      >
        <IonToggle
          checked={countryOn}
          onIonChange={(e) => {
            if (e.detail.checked !== countryOn) {
              onToggleCountry(country, e.detail.checked);
            }
          }}
          data-testid={`country-toggle-${country}`}
          aria-label={`Toggle country ${country}`}
        />
      </div>
    </div>
  );
};

// ==================== Component ====================

const ProjectPanel: React.FC<ProjectPanelProps> = ({
  projects,
  activeProjectIds,
  geoJsonData,
  projectColorsById,
  countryVisibility,
  countryCollapsed,
  onToggleProject,
  onZoomToProject,
  onShowAll,
  onHideAll,
  onToggleCountry,
  onToggleCountryCollapsed,
  onClose,
  isOpen,
}) => {
  const totalCount = projects.length;
  const effectiveActiveCount = projects.filter((p) => {
    if (!activeProjectIds.has(p.id)) return false;
    const country = p.country || UNKNOWN_COUNTRY_LABEL;
    return isCountryOn(country, countryVisibility);
  }).length;

  const renderProjectRow = (project: Project, countryOn: boolean): React.ReactNode => {
    const individualOn = activeProjectIds.has(project.id);
    const effectiveOn = individualOn && countryOn;
    const color = getProjectColor(project.id, projectColorsById);
    const hasGeoJson = project.id in geoJsonData;

    return (
      <li key={project.id} className="hover:bg-slate-700/30 transition-colors">
        <div className="flex items-center gap-2 pl-4 pr-3 py-2.5">
          <div className="min-w-0 flex-1">
            <button
              onClick={() => onZoomToProject(project.id)}
              className="flex min-w-0 w-full items-center gap-3 text-left"
              title={hasGeoJson ? `Zoom to ${project.name}` : project.name}
            >
              <span
                data-testid={`project-color-dot-${project.id}`}
                className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-white/20"
                style={{
                  backgroundColor: effectiveOn ? color : 'transparent',
                  borderWidth: effectiveOn ? 0 : 2,
                  borderColor: color,
                  borderStyle: 'solid',
                }}
              />
              <div className="min-w-0 flex-1">
                <span
                  className={`block text-sm truncate ${
                    effectiveOn ? 'text-slate-100' : 'text-slate-500'
                  }`}
                >
                  {project.name}
                </span>
              </div>
            </button>
          </div>
          <IonToggle
            checked={individualOn}
            onIonChange={(e) => {
              if (e.detail.checked !== individualOn) onToggleProject(project.id);
            }}
            aria-label={`Toggle ${project.name}`}
            data-testid={`project-toggle-${project.id}`}
          />
        </div>
      </li>
    );
  };

  const hasAnyCountry = projects.some((p) => Boolean(p.country));

  const renderFlatProjects = (): React.ReactNode =>
    projects.map((project) => renderProjectRow(project, true));

  const renderGroupedProjects = (): React.ReactNode => {
    const groups = groupProjectsByCountry(projects);
    const sortedGroups = sortCountriesAlphabetically(groups);

    return sortedGroups.map(([country, countryProjects]) => {
      const countryOn = isCountryOn(country, countryVisibility);
      const collapsed = isCountryCollapsed(country, countryCollapsed);

      return (
        <li key={`country-${country}`} data-testid={`country-group-${country}`}>
          <CountryHeader
            country={country}
            count={countryProjects.length}
            countryOn={countryOn}
            collapsed={collapsed}
            onToggleCountry={onToggleCountry}
            onToggleCollapsed={onToggleCountryCollapsed}
          />
          {!collapsed && (
            <ul className="pl-3">
              {countryProjects.map((project) => renderProjectRow(project, countryOn))}
            </ul>
          )}
        </li>
      );
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-20 bg-black/40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`absolute top-0 left-0 bottom-0 z-30 w-72 max-w-[80vw]
          bg-slate-900/95 backdrop-blur-md border-r border-slate-700/50
          flex flex-col transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))' }}
        data-tour="project-panel"
        data-tour-open={isOpen ? 'true' : 'false'}
        data-testid="project-panel"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-slate-700/50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100">Projects</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400
                         hover:bg-slate-700/50 hover:text-slate-100 transition-colors"
              aria-label="Close panel"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {effectiveActiveCount} of {totalCount} visible
          </p>
        </div>

        {/* Bulk actions */}
        <div
          className="shrink-0 border-b border-slate-700/50 px-4 py-2"
          data-tour="bulk-actions"
        >
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onShowAll}
              aria-label="Show all projects"
              className="app-btn app-btn--compact app-btn--primary touch-manipulation"
            >
              Show all
            </button>
            <button
              type="button"
              onClick={onHideAll}
              aria-label="Hide all projects"
              className="app-btn app-btn--compact app-btn--secondary touch-manipulation"
            >
              Hide all
            </button>
          </div>
        </div>

        {/* Project list */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
          data-testid="project-panel-list"
        >
          {projects.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No projects available
            </div>
          ) : (
            <ul className="py-1">
              {hasAnyCountry ? renderGroupedProjects() : renderFlatProjects()}
            </ul>
          )}
        </div>
      </div>
    </>
  );
};

export default ProjectPanel;
