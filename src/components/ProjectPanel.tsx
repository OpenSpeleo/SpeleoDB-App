/**
 * ProjectPanel -- collapsible side panel for toggling project GeoJSON layers.
 *
 * Slides in from the left over the map. Each project gets a colored dot
 * (driven by Dashboard's project color mapping) and a toggle switch. A backdrop click or the close
 * button dismisses the panel.
 *
 * Clicking the project name/dot zooms the map to that project.
 * Clicking the toggle switch activates/deactivates the layer.
 */

import React from 'react';
import type { Project } from '../types/project';
import type { TilePrefetchJobState } from '../types/tilePrefetch';
import { getProjectColor } from '../utils/projectColors';

// ==================== Props ====================

export interface ProjectPanelProps {
  projects: Project[];
  activeProjectIds: Set<string>;
  geoJsonData: Record<string, unknown>;
  projectColorsById: Record<string, string>;
  tilePrefetchByProject: Record<string, TilePrefetchJobState | undefined>;
  onToggleProject: (projectId: string) => void;
  onZoomToProject: (projectId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onClose: () => void;
  isOpen: boolean;
}

function prefetchStatusLabel(job: TilePrefetchJobState | undefined): string | null {
  if (!job) return null;
  const processed = job.completedTiles + job.failedTiles;
  const pct = job.totalTiles > 0 ? Math.floor((processed / job.totalTiles) * 100) : 0;

  if (job.status === 'done') return `Map ready (${pct}%)`;
  if (job.status === 'error') return `Map prefetch failed (${pct}%)`;
  if (job.status === 'paused') return `Map prefetch paused (${pct}%)`;
  if (job.status === 'downloading' || job.status === 'queued') {
    return `Caching map (${pct}%)`;
  }
  return null;
}

// ==================== Component ====================

const ProjectPanel: React.FC<ProjectPanelProps> = ({
  projects,
  activeProjectIds,
  geoJsonData,
  projectColorsById,
  tilePrefetchByProject,
  onToggleProject,
  onZoomToProject,
  onShowAll,
  onHideAll,
  onClose,
  isOpen,
}) => {
  const activeCount = activeProjectIds.size;
  const totalCount = projects.length;

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
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
        data-tour="project-panel"
        data-tour-open={isOpen ? 'true' : 'false'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Projects</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeCount} of {totalCount} visible
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                       hover:text-slate-100 hover:bg-slate-700/50 transition-colors"
            aria-label="Close panel"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Bulk actions */}
        <div
          className="flex gap-2 px-4 py-2.5 border-b border-slate-700/50"
          data-tour="bulk-actions"
        >
          <button
            onClick={onShowAll}
            data-tour-action="show-all"
            className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg
                       bg-slate-700/50 text-slate-300 hover:bg-slate-600/50
                       hover:text-slate-100 transition-colors"
          >
            Show all
          </button>
          <button
            onClick={onHideAll}
            data-tour-action="hide-all"
            className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg
                       bg-slate-700/50 text-slate-300 hover:bg-slate-600/50
                       hover:text-slate-100 transition-colors"
          >
            Hide all
          </button>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          {projects.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No projects available
            </div>
          ) : (
            <ul className="py-1">
              {projects.map((project, index) => {
                const color = getProjectColor(project.id, projectColorsById);
                const isActive = activeProjectIds.has(project.id);
                const hasGeoJson = project.id in geoJsonData;
                const prefetchLabel = prefetchStatusLabel(tilePrefetchByProject[project.id]);
                const isFirstProject = index === 0;

                return (
                  <li
                    key={project.id}
                    className="hover:bg-slate-700/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 pl-4 pr-3 py-2.5">
                      {/* Name area -- click to zoom */}
                      <div className="min-w-0 flex-1">
                        <button
                          onClick={() => onZoomToProject(project.id)}
                          data-tour={isFirstProject ? 'project-name' : undefined}
                          data-tour-action="project-row-zoom"
                          className="flex min-w-0 w-full items-center gap-3 text-left"
                          title={hasGeoJson ? `Zoom to ${project.name}` : project.name}
                        >
                          {/* Color dot */}
                          <span
                            data-testid={`project-color-dot-${project.id}`}
                            className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-white/20"
                            style={{
                              backgroundColor: isActive ? color : 'transparent',
                              borderWidth: isActive ? 0 : 2,
                              borderColor: color,
                              borderStyle: 'solid',
                            }}
                          />

                          {/* Project name */}
                          <div className="min-w-0 flex-1">
                            <span
                              className={`block text-sm truncate ${
                                isActive ? 'text-slate-100' : 'text-slate-500'
                              }`}
                            >
                              {project.name}
                            </span>
                            {prefetchLabel && (
                              <span className="block text-[10px] text-emerald-300/90 truncate">
                                {prefetchLabel}
                              </span>
                            )}
                          </div>
                        </button>
                      </div>

                      {/* Toggle switch -- kept in normal flow to prevent overflow */}
                      <button
                        onClick={() => onToggleProject(project.id)}
                        data-tour={isFirstProject ? 'project-toggle' : undefined}
                        className="flex h-8 w-12 shrink-0 items-center justify-center"
                        aria-label={`Toggle ${project.name}`}
                      >
                        <span
                          className={`relative block w-9 h-5 rounded-full transition-colors ${
                            isActive ? 'bg-purple-500' : 'bg-slate-600'
                          }`}
                        >
                          <span
                            className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm
                                        transition-transform ${
                                          isActive ? 'translate-x-4' : 'translate-x-0'
                                        }`}
                          />
                        </span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
};

export default ProjectPanel;
