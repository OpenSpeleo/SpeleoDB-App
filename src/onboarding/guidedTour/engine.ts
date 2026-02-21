import { driver, type Driver, type PopoverDOM } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tourStyles.css';

import {
  getHasCompletedGuidedTour,
  setHasCompletedGuidedTour,
} from '../../services/PreferencesService';
import {
  TOUR_BODY_CLASSES,
  TOUR_EVENTS,
  TOUR_SELECTORS,
  eventMatchesSelector,
  hasProjectTourTargets,
  queryTourElement,
} from './selectors';
import {
  GUIDED_TOUR_STAGE_PADDING_DEFAULT,
  GUIDED_TOUR_STAGE_PADDING_MENU,
  type GuidedTourStepId,
  buildTourSteps,
} from './steps';

interface StartGuidedTourOptions {
  force?: boolean;
}

let activeDriver: Driver | null = null;
let activeStepIds: GuidedTourStepId[] = [];
let unbindListeners: Array<() => void> = [];
let pendingMoveTimeout: number | null = null;
let hasPersistedCompletionForRun = false;
let shouldPersistCompletionOnDriverDestroyed = false;
let didObserveCenterProjectTap = false;
let allowSyntheticMenuClick = false;
let allowSyntheticProjectClick = false;

const GUIDED_TOUR_STAGE_RADIUS_DEFAULT = 8;
const MENU_STEP_ADVANCE_DELAY_MS = 600;
const BULK_ACTION_TARGET_GRACE_PERIOD_MS = 1200;
const PROJECT_TARGET_GRACE_PERIOD_MS = 6000;
const PROJECT_TARGET_POLL_INTERVAL_MS = 200;

function clearPendingMoveTimeout(): void {
  if (pendingMoveTimeout === null) return;
  window.clearTimeout(pendingMoveTimeout);
  pendingMoveTimeout = null;
}

function addBodyClass(name: string): void {
  document.body.classList.add(name);
}

function removeBodyClass(name: string): void {
  document.body.classList.remove(name);
}

function setStageFraming(stagePadding: number, stageRadius: number): void {
  if (!activeDriver) return;
  activeDriver.setConfig({
    ...activeDriver.getConfig(),
    stagePadding,
    stageRadius,
  });
  activeDriver.refresh();
}

function hideTourVisualsForActionHandoff(): void {
  addBodyClass(TOUR_BODY_CLASSES.transitionHandoff);
  activeDriver?.refresh();
}

function restoreTourVisualsAfterActionHandoff(): void {
  removeBodyClass(TOUR_BODY_CLASSES.transitionHandoff);
  activeDriver?.refresh();
}

function resetStagePaddingToDefault(): void {
  setStageFraming(
    GUIDED_TOUR_STAGE_PADDING_DEFAULT,
    GUIDED_TOUR_STAGE_RADIUS_DEFAULT,
  );
}

function setMenuStagePadding(): void {
  setStageFraming(
    GUIDED_TOUR_STAGE_PADDING_MENU,
    GUIDED_TOUR_STAGE_RADIUS_DEFAULT,
  );
}

function styleGuidedTourCloseButton(popover: PopoverDOM): void {
  const stepId = getActiveStepId();
  if (stepId === null || stepId === 'completion') return;

  const closeButton = popover.closeButton;
  const footerButtons = popover.footerButtons;
  if (!(closeButton instanceof HTMLButtonElement)) return;
  if (!(footerButtons instanceof HTMLElement)) return;

  const nextButtonIsVisible = popover.nextButton.style.display !== 'none';
  const closeButtonNotInFooter = closeButton.parentElement !== footerButtons;
  if (closeButtonNotInFooter) {
    if (nextButtonIsVisible) {
      footerButtons.insertBefore(closeButton, popover.nextButton);
    } else {
      footerButtons.appendChild(closeButton);
    }
  }

  closeButton.classList.add('guided-tour-footer-close-btn');
  closeButton.textContent = 'Close';
  closeButton.setAttribute('aria-label', 'Close tutorial');
  closeButton.style.display = 'block';
}

function getActiveStepId(): GuidedTourStepId | null {
  if (!activeDriver) return null;
  const index = activeDriver.getActiveIndex();
  if (index === undefined) return null;
  if (index < 0 || index >= activeStepIds.length) return null;
  return activeStepIds[index] ?? null;
}

function getStepIndex(stepId: GuidedTourStepId): number {
  return activeStepIds.indexOf(stepId);
}

function isProjectPanelOpen(): boolean {
  const panel = queryTourElement(TOUR_SELECTORS.projectPanel);
  return panel instanceof HTMLElement && panel.dataset.tourOpen === 'true';
}

function areBulkActionTargetsReady(): boolean {
  return Boolean(
    isProjectPanelOpen() &&
      queryTourElement(TOUR_SELECTORS.hideAllAction) &&
      queryTourElement(TOUR_SELECTORS.showAllAction),
  );
}

function pollStepUntil(
  stepId: GuidedTourStepId,
  options: {
    initialDelayMs: number;
    timeoutMs: number;
    shouldAdvance: () => boolean;
    onTimeout: () => void;
  },
): void {
  clearPendingMoveTimeout();
  const startedAt = Date.now();

  const attemptProgress = () => {
    pendingMoveTimeout = null;
    if (!activeDriver || !activeDriver.isActive()) return;
    if (getActiveStepId() !== stepId) return;

    if (options.shouldAdvance()) {
      activeDriver.moveNext();
      return;
    }

    if (Date.now() - startedAt < options.timeoutMs) {
      pendingMoveTimeout = window.setTimeout(
        attemptProgress,
        PROJECT_TARGET_POLL_INTERVAL_MS,
      );
      return;
    }

    options.onTimeout();
  };

  pendingMoveTimeout = window.setTimeout(
    attemptProgress,
    options.initialDelayMs,
  );
}

function moveNextForStep(stepId: GuidedTourStepId, delayMs = 0): void {
  if (!activeDriver || !activeDriver.isActive()) return;
  if (getActiveStepId() !== stepId) return;

  clearPendingMoveTimeout();
  if (delayMs <= 0) {
    activeDriver.moveNext();
    return;
  }

  pendingMoveTimeout = window.setTimeout(() => {
    pendingMoveTimeout = null;
    if (!activeDriver || !activeDriver.isActive()) return;
    if (getActiveStepId() !== stepId) return;
    activeDriver.moveNext();
  }, delayMs);
}

function moveToStep(stepId: GuidedTourStepId): void {
  if (!activeDriver || !activeDriver.isActive()) return;
  const index = getStepIndex(stepId);
  if (index < 0) return;
  activeDriver.moveTo(index);
}

function dispatchSyntheticClick(target: Element): void {
  if (!(target instanceof HTMLElement)) return;
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  );
}

function consumeEvent(event: Event): void {
  if (typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  if (typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
  if ('stopImmediatePropagation' in event) {
    const stopImmediate = (event as Event & { stopImmediatePropagation?: () => void })
      .stopImmediatePropagation;
    if (typeof stopImmediate === 'function') {
      stopImmediate.call(event);
    }
  }
}

function continueAfterOpenPanelTap(): void {
  if (!activeDriver || !activeDriver.isActive()) return;
  pollStepUntil('openProjectPanel', {
    initialDelayMs: MENU_STEP_ADVANCE_DELAY_MS,
    timeoutMs: BULK_ACTION_TARGET_GRACE_PERIOD_MS,
    shouldAdvance: () => areBulkActionTargetsReady(),
    onTimeout: () => {
      moveToStep('completion');
    },
  });
}

function continueAfterShowAllTap(): void {
  if (!activeDriver || !activeDriver.isActive()) return;
  pollStepUntil('showAllProjects', {
    initialDelayMs: 300,
    timeoutMs: PROJECT_TARGET_GRACE_PERIOD_MS,
    shouldAdvance: () => hasProjectTourTargets(),
    onTimeout: () => {
      moveToStep('completion');
    },
  });
}

function onProjectZoomCompleteEvent(): void {
  if (getActiveStepId() !== 'centerProject') return;
  if (!didObserveCenterProjectTap) return;

  didObserveCenterProjectTap = false;
  moveNextForStep('centerProject', 0);
}

function onDocumentClick(event: Event): void {
  const stepId = getActiveStepId();
  if (!stepId) return;

  if (
    stepId === 'openProjectPanel' &&
    eventMatchesSelector(event, TOUR_SELECTORS.menuToggle)
  ) {
    if (allowSyntheticMenuClick) {
      allowSyntheticMenuClick = false;
      return;
    }

    consumeEvent(event);
    hideTourVisualsForActionHandoff();
    const menuToggle = queryTourElement(TOUR_SELECTORS.menuToggle);
    window.setTimeout(() => {
      if (!activeDriver || !activeDriver.isActive()) return;
      if (getActiveStepId() !== 'openProjectPanel') return;
      if (menuToggle) {
        allowSyntheticMenuClick = true;
        dispatchSyntheticClick(menuToggle);
      }
      continueAfterOpenPanelTap();
    }, 0);
    return;
  }

  if (
    stepId === 'hideAllProjects' &&
    eventMatchesSelector(event, TOUR_SELECTORS.hideAllAction)
  ) {
    moveNextForStep('hideAllProjects', 300);
    return;
  }

  if (
    stepId === 'showAllProjects' &&
    eventMatchesSelector(event, TOUR_SELECTORS.showAllAction)
  ) {
    continueAfterShowAllTap();
    return;
  }

  if (
    stepId === 'toggleProject' &&
    eventMatchesSelector(event, TOUR_SELECTORS.projectToggle)
  ) {
    moveNextForStep('toggleProject', 250);
    return;
  }

  if (
    stepId === 'centerProject' &&
    eventMatchesSelector(event, TOUR_SELECTORS.projectRowZoomAction)
  ) {
    if (allowSyntheticProjectClick) {
      allowSyntheticProjectClick = false;
      return;
    }

    consumeEvent(event);
    if (!eventMatchesSelector(event, TOUR_SELECTORS.projectName)) return;

    didObserveCenterProjectTap = true;
    hideTourVisualsForActionHandoff();

    const projectTarget = queryTourElement(TOUR_SELECTORS.projectName);
    window.setTimeout(() => {
      if (!activeDriver || !activeDriver.isActive()) return;
      if (getActiveStepId() !== 'centerProject') return;
      if (!projectTarget) return;
      allowSyntheticProjectClick = true;
      dispatchSyntheticClick(projectTarget);
    }, 0);
  }
}

function attachInteractionListeners(): void {
  const onClick = (event: Event) => onDocumentClick(event);
  const onProjectZoomComplete = () => onProjectZoomCompleteEvent();

  document.addEventListener('click', onClick, true);
  document.addEventListener(
    TOUR_EVENTS.projectZoomComplete,
    onProjectZoomComplete,
    true,
  );
  unbindListeners.push(() => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener(
      TOUR_EVENTS.projectZoomComplete,
      onProjectZoomComplete,
      true,
    );
  });
}

function detachInteractionListeners(): void {
  for (const unbind of unbindListeners) {
    unbind();
  }
  unbindListeners = [];
}

function resetRunState(): void {
  clearPendingMoveTimeout();
  detachInteractionListeners();
  removeBodyClass(TOUR_BODY_CLASSES.menuStepClickthrough);
  removeBodyClass(TOUR_BODY_CLASSES.bulkHideOnly);
  removeBodyClass(TOUR_BODY_CLASSES.bulkShowOnly);
  removeBodyClass(TOUR_BODY_CLASSES.transitionHandoff);
  removeBodyClass(TOUR_BODY_CLASSES.active);
  activeStepIds = [];
  didObserveCenterProjectTap = false;
  allowSyntheticMenuClick = false;
  allowSyntheticProjectClick = false;
  shouldPersistCompletionOnDriverDestroyed = false;
  hasPersistedCompletionForRun = false;
  activeDriver = null;
}

function persistCompletionForRun(): void {
  if (hasPersistedCompletionForRun) return;
  hasPersistedCompletionForRun = true;
  setHasCompletedGuidedTour(true);
}

function markCompletedAndClose(): void {
  persistCompletionForRun();
  shouldPersistCompletionOnDriverDestroyed = false;
  activeDriver?.destroy();
}

export function isGuidedTourActive(): boolean {
  return Boolean(activeDriver?.isActive());
}

export function destroyGuidedTour(): void {
  shouldPersistCompletionOnDriverDestroyed = false;
  const existingDriver = activeDriver;
  if (existingDriver && existingDriver.isActive()) {
    existingDriver.destroy();
  }
  resetRunState();
}

export async function restartGuidedTourFromHelp(): Promise<void> {
  setHasCompletedGuidedTour(false);
  destroyGuidedTour();
  await startGuidedTour({ force: true });
}

export async function startGuidedTour(
  options: StartGuidedTourOptions = {},
): Promise<void> {
  if (!options.force && getHasCompletedGuidedTour()) return;
  if (isGuidedTourActive()) return;

  if (!options.force && getHasCompletedGuidedTour()) return;
  if (isGuidedTourActive()) return;

  destroyGuidedTour();
  addBodyClass(TOUR_BODY_CLASSES.active);

  const { steps, stepIds } = buildTourSteps({
    onEnterMenuStep: () => {
      addBodyClass(TOUR_BODY_CLASSES.menuStepClickthrough);
      restoreTourVisualsAfterActionHandoff();
      setMenuStagePadding();
    },
    onExitMenuStep: () => {
      removeBodyClass(TOUR_BODY_CLASSES.menuStepClickthrough);
      restoreTourVisualsAfterActionHandoff();
      resetStagePaddingToDefault();
    },
    onEnterHideAllStep: () => {
      addBodyClass(TOUR_BODY_CLASSES.bulkHideOnly);
      resetStagePaddingToDefault();
    },
    onExitHideAllStep: () => {
      removeBodyClass(TOUR_BODY_CLASSES.bulkHideOnly);
    },
    onEnterShowAllStep: () => {
      addBodyClass(TOUR_BODY_CLASSES.bulkShowOnly);
      resetStagePaddingToDefault();
    },
    onExitShowAllStep: () => {
      removeBodyClass(TOUR_BODY_CLASSES.bulkShowOnly);
    },
    onEnterCenterProject: () => {
      didObserveCenterProjectTap = false;
      restoreTourVisualsAfterActionHandoff();
      resetStagePaddingToDefault();
    },
    onExitCenterProject: () => {
      didObserveCenterProjectTap = false;
      restoreTourVisualsAfterActionHandoff();
    },
    onCompletionNext: () => {
      markCompletedAndClose();
    },
  });

  activeStepIds = stepIds;
  shouldPersistCompletionOnDriverDestroyed = true;
  activeDriver = driver({
    animate: true,
    allowClose: true,
    overlayClickBehavior: () => {},
    allowKeyboardControl: false,
    stagePadding: GUIDED_TOUR_STAGE_PADDING_DEFAULT,
    stageRadius: GUIDED_TOUR_STAGE_RADIUS_DEFAULT,
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    popoverClass: 'guided-tour-popover',
    onPopoverRender: (popover) => {
      styleGuidedTourCloseButton(popover);
    },
    onCloseClick: () => {
      markCompletedAndClose();
    },
    onDestroyed: () => {
      if (shouldPersistCompletionOnDriverDestroyed) {
        persistCompletionForRun();
      }
      resetRunState();
    },
    steps,
  });

  attachInteractionListeners();
  activeDriver.drive();
}
