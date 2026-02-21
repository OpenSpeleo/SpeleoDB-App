export const TOUR_SELECTORS = {
  menuToggle: '[data-tour="menu-toggle"]',
  projectPanel: '[data-tour="project-panel"]',
  projectToggle: '[data-tour="project-toggle"]',
  projectName: '[data-tour="project-name"]',
  projectRowZoomAction: '[data-tour-action="project-row-zoom"]',
  showAllAction: '[data-tour-action="show-all"]',
  hideAllAction: '[data-tour-action="hide-all"]',
} as const;

export const TOUR_EVENTS = {
  projectZoomComplete: 'speleo:project-zoom-complete',
} as const;

export const TOUR_BODY_CLASSES = {
  active: 'guided-tour-active',
  menuStepClickthrough: 'tour-step-menu-clickthrough',
  bulkHideOnly: 'tour-step-bulk-hide-only',
  bulkShowOnly: 'tour-step-bulk-show-only',
  transitionHandoff: 'tour-step-transition-handoff',
} as const;

export function queryTourElement(selector: string): Element | null {
  return document.querySelector(selector);
}

export function hasProjectTourTargets(): boolean {
  return Boolean(
    queryTourElement(TOUR_SELECTORS.projectName) &&
    queryTourElement(TOUR_SELECTORS.projectToggle),
  );
}

export function eventMatchesSelector(event: Event, selector: string): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(selector));
}
