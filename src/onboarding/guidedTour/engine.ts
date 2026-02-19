import { driver, type Driver, type PopoverDOM } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tourStyles.css';
import fingerSlideDownIcon from '../../assets/media/gesture-icons/finger_slide_down.svg';

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
let didObserveRefreshStart = false;
let didObserveCenterProjectTap = false;
let allowSyntheticMenuClick = false;
let allowSyntheticProjectClick = false;
let pullRefreshCueOverlay: HTMLElement | null = null;
let unbindPullRefreshCueViewportListeners: (() => void) | null = null;
let pendingPullRefreshCueFrame: number | null = null;
let pendingSyncReadyWait: Promise<boolean> | null = null;
let syncReadyWaitVersion = 0;

const GUIDED_TOUR_STAGE_PADDING_HEADER = 0;
const GUIDED_TOUR_STAGE_RADIUS_DEFAULT = 8;
const GUIDED_TOUR_STAGE_RADIUS_HEADER = 0;
const MENU_STEP_ADVANCE_DELAY_MS = 600;
const REFRESH_COMPLETE_SETTLE_DELAY_MS = 260;
const BULK_ACTION_TARGET_GRACE_PERIOD_MS = 1200;
const PROJECT_TARGET_GRACE_PERIOD_MS = 6000;
const PROJECT_TARGET_POLL_INTERVAL_MS = 200;
const GUIDED_TOUR_SYNC_READY_POLL_INTERVAL_MS = 120;
const PULL_REFRESH_CUE_ANCHOR_OFFSET_X_PX = 0;
const PULL_REFRESH_CUE_ANCHOR_OFFSET_Y_PX = 15;
const PULL_REFRESH_CUE_LOOP_DURATION_MS = 1450;
const PULL_REFRESH_CUE_DRAG_DISTANCE_PX = 54;
const PULL_REFRESH_CUE_ICON_WIDTH_PX = 84;
const PULL_REFRESH_CUE_ICON_HEIGHT_PX = 84;
const PULL_REFRESH_CUE_BUBBLE_SIZE_PX = 58;

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

function isGuidedTourSyncReady(): boolean {
  return Boolean(queryTourElement(TOUR_SELECTORS.headerSyncReady));
}

function cancelPendingSyncReadyWait(): void {
  syncReadyWaitVersion += 1;
  pendingSyncReadyWait = null;
}

function waitForGuidedTourSyncReady(): Promise<boolean> {
  if (isGuidedTourSyncReady()) {
    return Promise.resolve(true);
  }
  if (pendingSyncReadyWait) {
    return pendingSyncReadyWait;
  }

  const waitVersionAtStart = syncReadyWaitVersion;
  pendingSyncReadyWait = new Promise((resolve) => {
    const poll = () => {
      if (waitVersionAtStart !== syncReadyWaitVersion) {
        resolve(false);
        return;
      }
      if (isGuidedTourSyncReady()) {
        pendingSyncReadyWait = null;
        resolve(true);
        return;
      }
      window.setTimeout(poll, GUIDED_TOUR_SYNC_READY_POLL_INTERVAL_MS);
    };
    poll();
  });

  return pendingSyncReadyWait;
}

function clearPendingPullRefreshCueFrame(): void {
  if (pendingPullRefreshCueFrame === null) return;
  window.cancelAnimationFrame(pendingPullRefreshCueFrame);
  pendingPullRefreshCueFrame = null;
}

function getPullRefreshCueMarkup(): string {
  return `
    <div class="guided-tour-pull-cue" aria-hidden="true">
      <div class="guided-tour-pull-cue-bubble"></div>
      <img class="guided-tour-pull-cue-icon" src="${fingerSlideDownIcon}" alt="" />
    </div>
  `;
}

function setPullRefreshCueSpecVariables(element: HTMLElement): void {
  element.style.setProperty(
    '--guided-tour-pull-cue-loop-duration',
    `${PULL_REFRESH_CUE_LOOP_DURATION_MS}ms`,
  );
  element.style.setProperty(
    '--guided-tour-pull-cue-drag-distance',
    `${PULL_REFRESH_CUE_DRAG_DISTANCE_PX}px`,
  );
  element.style.setProperty(
    '--guided-tour-pull-cue-icon-width',
    `${PULL_REFRESH_CUE_ICON_WIDTH_PX}px`,
  );
  element.style.setProperty(
    '--guided-tour-pull-cue-icon-height',
    `${PULL_REFRESH_CUE_ICON_HEIGHT_PX}px`,
  );
  element.style.setProperty(
    '--guided-tour-pull-cue-bubble-size',
    `${PULL_REFRESH_CUE_BUBBLE_SIZE_PX}px`,
  );
}

function getPullRefreshCueAnchorElement(): HTMLElement | null {
  const syncingStatus = queryTourElement(TOUR_SELECTORS.headerSyncStatus);
  if (syncingStatus instanceof HTMLElement) return syncingStatus;

  const projectCount = queryTourElement(TOUR_SELECTORS.headerProjectCount);
  if (projectCount instanceof HTMLElement) return projectCount;

  const header = queryTourElement(TOUR_SELECTORS.header);
  return header instanceof HTMLElement ? header : null;
}

function getPullRefreshCueAnchorPoint(): { x: number; y: number } | null {
  const anchorElement = getPullRefreshCueAnchorElement();
  if (!anchorElement) return null;
  const rect = anchorElement.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;

  return {
    x: rect.left + rect.width / 2 + PULL_REFRESH_CUE_ANCHOR_OFFSET_X_PX,
    y: rect.top + PULL_REFRESH_CUE_ANCHOR_OFFSET_Y_PX,
  };
}

function positionPullRefreshCueOverlay(): void {
  if (!pullRefreshCueOverlay) return;
  const anchor = getPullRefreshCueAnchorPoint();
  if (!anchor) {
    pullRefreshCueOverlay.style.display = 'none';
    return;
  }

  pullRefreshCueOverlay.style.left = `${anchor.x}px`;
  pullRefreshCueOverlay.style.top = `${anchor.y}px`;
  if (pullRefreshCueOverlay.dataset.hidden !== 'true') {
    pullRefreshCueOverlay.style.display = '';
  }
}

function requestPullRefreshCueReposition(): void {
  if (!pullRefreshCueOverlay) return;
  if (pendingPullRefreshCueFrame !== null) return;

  pendingPullRefreshCueFrame = window.requestAnimationFrame(() => {
    pendingPullRefreshCueFrame = null;
    positionPullRefreshCueOverlay();
  });
}

function bindPullRefreshCueViewportListeners(): void {
  if (unbindPullRefreshCueViewportListeners) return;

  const onViewportChange = () => {
    requestPullRefreshCueReposition();
  };

  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  unbindPullRefreshCueViewportListeners = () => {
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('orientationchange', onViewportChange);
  };
}

function ensurePullRefreshCueOverlay(): HTMLElement {
  if (pullRefreshCueOverlay && document.body.contains(pullRefreshCueOverlay)) {
    return pullRefreshCueOverlay;
  }

  const overlay = document.createElement('div');
  overlay.className = 'guided-tour-pull-gesture-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.dataset.hidden = 'false';
  setPullRefreshCueSpecVariables(overlay);
  overlay.innerHTML = getPullRefreshCueMarkup();
  document.body.appendChild(overlay);

  pullRefreshCueOverlay = overlay;
  bindPullRefreshCueViewportListeners();
  return overlay;
}

function mountPullRefreshCueOverlay(): void {
  const overlay = ensurePullRefreshCueOverlay();
  overlay.dataset.hidden = 'false';
  overlay.style.display = '';
  requestPullRefreshCueReposition();
}

function destroyPullRefreshCueOverlay(): void {
  clearPendingPullRefreshCueFrame();
  if (unbindPullRefreshCueViewportListeners) {
    unbindPullRefreshCueViewportListeners();
    unbindPullRefreshCueViewportListeners = null;
  }
  if (!pullRefreshCueOverlay) return;
  pullRefreshCueOverlay.remove();
  pullRefreshCueOverlay = null;
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

function setPullRefreshCueVisibility(isVisible: boolean): void {
  if (!pullRefreshCueOverlay) return;
  pullRefreshCueOverlay.dataset.hidden = isVisible ? 'false' : 'true';
  pullRefreshCueOverlay.style.display = isVisible ? '' : 'none';
  if (isVisible) {
    requestPullRefreshCueReposition();
  }
}

function onIonRefreshEvent(event: Event): void {
  if (getActiveStepId() !== 'pullToRefresh') return;
  if (!eventMatchesSelector(event, TOUR_SELECTORS.refresher)) return;

  didObserveRefreshStart = true;
  setPullRefreshCueVisibility(false);
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
  destroyPullRefreshCueOverlay();
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
  cancelPendingSyncReadyWait();
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

  const syncReady = await waitForGuidedTourSyncReady();
  if (!syncReady) return;
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
      mountPullRefreshCueOverlay();
      updatePullRefreshFeedback('');
    },
    onExitPullToRefresh: () => {
      removeBodyClass(TOUR_BODY_CLASSES.pullRefreshPassthrough);
      destroyPullRefreshCueOverlay();
    },
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
    // Close only through the explicit Close control in the popover.
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
