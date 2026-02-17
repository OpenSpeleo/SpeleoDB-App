import { driver, type Driver } from 'driver.js';
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
let refreshTimeoutIds: number[] = [];
let menuTrackingIntervalId: number | null = null;
let hasPersistedCompletionForRun = false;
let didObserveRefreshStart = false;
let didObserveCenterProjectTap = false;
let allowSyntheticMenuClick = false;
let allowSyntheticProjectClick = false;

const GUIDED_TOUR_STAGE_PADDING_HEADER = 0;
const GUIDED_TOUR_STAGE_RADIUS_DEFAULT = 8;
const GUIDED_TOUR_STAGE_RADIUS_HEADER = 0;
const MENU_STEP_ADVANCE_DELAY_MS = 600;
const MENU_STEP_TRACKING_INTERVAL_MS = 120;
const REFRESH_COMPLETE_SETTLE_DELAY_MS = 260;
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

function clearRefreshTimeouts(): void {
  for (const timeoutId of refreshTimeoutIds) {
    window.clearTimeout(timeoutId);
  }
  refreshTimeoutIds = [];
}

function clearMenuTrackingInterval(): void {
  if (menuTrackingIntervalId === null) return;
  window.clearInterval(menuTrackingIntervalId);
  menuTrackingIntervalId = null;
}

function queueDriverRefreshBurst(delaysMs: number[]): void {
  clearRefreshTimeouts();
  for (const delay of delaysMs) {
    const timeoutId = window.setTimeout(() => {
      if (!activeDriver || !activeDriver.isActive()) return;
      activeDriver.refresh();
    }, delay);
    refreshTimeoutIds.push(timeoutId);
  }
}

function startMenuHighlightTracking(): void {
  clearMenuTrackingInterval();
  const refreshWhileMenuStepIsActive = () => {
    if (!activeDriver || !activeDriver.isActive()) return;
    if (getActiveStepId() !== 'openProjectPanel') return;
    activeDriver.refresh();
  };

  refreshWhileMenuStepIsActive();
  menuTrackingIntervalId = window.setInterval(() => {
    refreshWhileMenuStepIsActive();
  }, MENU_STEP_TRACKING_INTERVAL_MS);
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

function setHeaderStageFraming(): void {
  setStageFraming(
    GUIDED_TOUR_STAGE_PADDING_HEADER,
    GUIDED_TOUR_STAGE_RADIUS_HEADER,
  );
}

function setMenuStagePadding(): void {
  setStageFraming(
    GUIDED_TOUR_STAGE_PADDING_MENU,
    GUIDED_TOUR_STAGE_RADIUS_DEFAULT,
  );
  // Refresher/map settle animations can shift layout briefly after step changes.
  // Burst refresh keeps the cutout locked to the menu button during that window.
  queueDriverRefreshBurst([0, 120, 280, 520, 820]);
  // If the refresher is still animating/completing, keep syncing highlight geometry
  // until the step exits so the menu cutout stays centered on the real button.
  startMenuHighlightTracking();
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

function updatePullRefreshFeedback(message: string): void {
  const feedback = document.querySelector(
    '[data-tour-feedback="pull-refresh"]',
  );
  if (feedback instanceof HTMLElement) {
    feedback.textContent = message;
  }
}

function hidePullRefreshArrow(): void {
  const arrow = document.querySelector('.guided-tour-pull-arrow');
  if (arrow instanceof HTMLElement) {
    arrow.style.display = 'none';
  }
}

function onIonRefreshEvent(event: Event): void {
  if (getActiveStepId() !== 'pullToRefresh') return;
  if (!eventMatchesSelector(event, TOUR_SELECTORS.refresher)) return;

  didObserveRefreshStart = true;
  hidePullRefreshArrow();
  updatePullRefreshFeedback('Refreshing...');
}

function onRefreshCompleteEvent(): void {
  if (getActiveStepId() !== 'pullToRefresh') return;
  if (!didObserveRefreshStart) return;

  updatePullRefreshFeedback('Nice! Moving on...');
  moveNextForStep('pullToRefresh', REFRESH_COMPLETE_SETTLE_DELAY_MS);
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
    // Only the highlighted first-row project-name target is valid for step 7.
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
  const onRefresh = (event: Event) => onIonRefreshEvent(event);
  const onRefreshComplete = () => onRefreshCompleteEvent();
  const onProjectZoomComplete = () => onProjectZoomCompleteEvent();

  document.addEventListener('click', onClick, true);
  document.addEventListener('ionRefresh', onRefresh, true);
  document.addEventListener(TOUR_EVENTS.refreshComplete, onRefreshComplete, true);
  document.addEventListener(
    TOUR_EVENTS.projectZoomComplete,
    onProjectZoomComplete,
    true,
  );
  unbindListeners.push(() => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('ionRefresh', onRefresh, true);
    document.removeEventListener(
      TOUR_EVENTS.refreshComplete,
      onRefreshComplete,
      true,
    );
    document.removeEventListener(
      TOUR_EVENTS.projectZoomComplete,
      onProjectZoomComplete,
      true,
    );
  });

  const refresher = queryTourElement(TOUR_SELECTORS.refresher);
  if (refresher) {
    refresher.addEventListener('ionRefresh', onRefresh as EventListener, true);
    unbindListeners.push(() => {
      refresher.removeEventListener('ionRefresh', onRefresh as EventListener, true);
    });
  }
}

function detachInteractionListeners(): void {
  for (const unbind of unbindListeners) {
    unbind();
  }
  unbindListeners = [];
}

function resetRunState(): void {
  clearPendingMoveTimeout();
  clearRefreshTimeouts();
  clearMenuTrackingInterval();
  detachInteractionListeners();
  removeBodyClass(TOUR_BODY_CLASSES.pullRefreshPassthrough);
  removeBodyClass(TOUR_BODY_CLASSES.menuStepClickthrough);
  removeBodyClass(TOUR_BODY_CLASSES.bulkHideOnly);
  removeBodyClass(TOUR_BODY_CLASSES.bulkShowOnly);
  removeBodyClass(TOUR_BODY_CLASSES.transitionHandoff);
  removeBodyClass(TOUR_BODY_CLASSES.active);
  activeStepIds = [];
  didObserveRefreshStart = false;
  didObserveCenterProjectTap = false;
  allowSyntheticMenuClick = false;
  allowSyntheticProjectClick = false;
  hasPersistedCompletionForRun = false;
  activeDriver = null;
}

function markCompletedAndClose(): void {
  if (hasPersistedCompletionForRun) return;
  hasPersistedCompletionForRun = true;
  setHasCompletedGuidedTour(true);
  activeDriver?.destroy();
}

export function isGuidedTourActive(): boolean {
  return Boolean(activeDriver?.isActive());
}

export function destroyGuidedTour(): void {
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

  destroyGuidedTour();
  addBodyClass(TOUR_BODY_CLASSES.active);

  const { steps, stepIds } = buildTourSteps({
    onEnterStatusBar: () => {
      setHeaderStageFraming();
    },
    onEnterPullToRefresh: () => {
      setHeaderStageFraming();
      addBodyClass(TOUR_BODY_CLASSES.pullRefreshPassthrough);
      didObserveRefreshStart = false;
      updatePullRefreshFeedback('');
    },
    onExitPullToRefresh: () => {
      removeBodyClass(TOUR_BODY_CLASSES.pullRefreshPassthrough);
    },
    onEnterMenuStep: () => {
      addBodyClass(TOUR_BODY_CLASSES.menuStepClickthrough);
      restoreTourVisualsAfterActionHandoff();
      setMenuStagePadding();
    },
    onExitMenuStep: () => {
      clearMenuTrackingInterval();
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
  activeDriver = driver({
    animate: true,
    allowClose: false,
    allowKeyboardControl: false,
    stagePadding: GUIDED_TOUR_STAGE_PADDING_DEFAULT,
    stageRadius: GUIDED_TOUR_STAGE_RADIUS_DEFAULT,
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    popoverClass: 'guided-tour-popover',
    onDestroyed: () => {
      resetRunState();
    },
    steps,
  });

  attachInteractionListeners();
  activeDriver.drive();
}
