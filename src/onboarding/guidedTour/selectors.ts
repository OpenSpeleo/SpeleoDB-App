export const TOUR_SELECTORS = {
  menuToggle: '[data-tour="menu-toggle"]',
  projectPanel: '[data-tour="project-panel"]',
  settingsTab: '[data-tour="settings-tab"]',
  settingsColorMode: '[data-tour="settings-color-mode"]',
  settingsShowLandmarks: '[data-tour="settings-show-landmarks"]',
  settingsMeasurementUnit: '[data-tour="settings-measurement-unit"]',
} as const;

export const TOUR_BODY_CLASSES = {
  active: 'guided-tour-active',
  tabClickthrough: 'tour-step-tab-clickthrough',
  transitionHandoff: 'tour-step-transition-handoff',
} as const;

export const SETTINGS_TOUR_PATHNAME = '/settings';

export function queryTourElement(selector: string): Element | null {
  return document.querySelector(selector);
}

export function hasSettingsTourTargets(): boolean {
  return Boolean(
    queryTourElement(TOUR_SELECTORS.settingsColorMode) &&
      queryTourElement(TOUR_SELECTORS.settingsShowLandmarks) &&
      queryTourElement(TOUR_SELECTORS.settingsMeasurementUnit),
  );
}

export function eventMatchesSelector(event: Event, selector: string): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(selector));
}
