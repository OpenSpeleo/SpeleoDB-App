import { driver, type Driver, type PopoverDOM } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tourStyles.css';

import {
  getHasCompletedGuidedTour,
  setHasCompletedGuidedTour,
} from '../../services/PreferencesService';
import {
  SETTINGS_TOUR_PATHNAME,
  TOUR_BODY_CLASSES,
  TOUR_SELECTORS,
  eventMatchesSelector,
  hasSettingsTourTargets,
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
let allowSyntheticTabClick = false;

const GUIDED_TOUR_STAGE_RADIUS_DEFAULT = 8;
const TAB_STEP_ADVANCE_DELAY_MS = 600;
const PROJECT_PANEL_TARGET_GRACE_PERIOD_MS = 1200;
const SETTINGS_TARGET_GRACE_PERIOD_MS = 6000;
const TARGET_POLL_INTERVAL_MS = 200;

interface TabHandoffConfig {
  selector: string;
  initialDelayMs: number;
  timeoutMs: number;
  shouldAdvance: () => boolean;
}

const TAB_HANDOFFS: Partial<Record<GuidedTourStepId, TabHandoffConfig>> = {
  openProjectPanel: {
    selector: TOUR_SELECTORS.menuToggle,
    initialDelayMs: TAB_STEP_ADVANCE_DELAY_MS,
    timeoutMs: PROJECT_PANEL_TARGET_GRACE_PERIOD_MS,
    shouldAdvance: () => isProjectPanelOpen(),
  },
  goToSettings: {
    selector: TOUR_SELECTORS.settingsTab,
    initialDelayMs: TAB_STEP_ADVANCE_DELAY_MS,
    timeoutMs: SETTINGS_TARGET_GRACE_PERIOD_MS,
    shouldAdvance: () => areSettingsTourTargetsReady(),
  },
};

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

function setTabStagePadding(): void {
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

function areSettingsTourTargetsReady(): boolean {
  // Both Dashboard and Settings stay mounted under App.tsx's visibility
  // toggle, so DOM presence alone is not enough — the highlight must only
  // land on the Settings page once the route actually points there.
  return (
    window.location.pathname === SETTINGS_TOUR_PATHNAME &&
    hasSettingsTourTargets()
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
        TARGET_POLL_INTERVAL_MS,
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

function continueAfterTabTap(stepId: GuidedTourStepId, config: TabHandoffConfig): void {
  if (!activeDriver || !activeDriver.isActive()) return;
  pollStepUntil(stepId, {
    initialDelayMs: config.initialDelayMs,
    timeoutMs: config.timeoutMs,
    shouldAdvance: config.shouldAdvance,
    onTimeout: () => {
      moveToStep('completion');
    },
  });
}

function onDocumentClick(event: Event): void {
  const stepId = getActiveStepId();
  if (!stepId) return;

  const handoff = TAB_HANDOFFS[stepId];
  if (!handoff) return;
  if (!eventMatchesSelector(event, handoff.selector)) return;

  if (allowSyntheticTabClick) {
    allowSyntheticTabClick = false;
    return;
  }

  consumeEvent(event);
  hideTourVisualsForActionHandoff();
  const tabTarget = queryTourElement(handoff.selector);
  window.setTimeout(() => {
    if (!activeDriver || !activeDriver.isActive()) return;
    if (getActiveStepId() !== stepId) return;
    if (tabTarget) {
      allowSyntheticTabClick = true;
      dispatchSyntheticClick(tabTarget);
    }
    continueAfterTabTap(stepId, handoff);
  }, 0);
}

function attachInteractionListeners(): void {
  const onClick = (event: Event) => onDocumentClick(event);

  document.addEventListener('click', onClick, true);
  unbindListeners.push(() => {
    document.removeEventListener('click', onClick, true);
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
  removeBodyClass(TOUR_BODY_CLASSES.tabClickthrough);
  removeBodyClass(TOUR_BODY_CLASSES.transitionHandoff);
  removeBodyClass(TOUR_BODY_CLASSES.active);
  activeStepIds = [];
  allowSyntheticTabClick = false;
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

  destroyGuidedTour();
  addBodyClass(TOUR_BODY_CLASSES.active);

  const enterTabStep = () => {
    addBodyClass(TOUR_BODY_CLASSES.tabClickthrough);
    restoreTourVisualsAfterActionHandoff();
    setTabStagePadding();
  };
  const exitTabStep = () => {
    removeBodyClass(TOUR_BODY_CLASSES.tabClickthrough);
    restoreTourVisualsAfterActionHandoff();
    resetStagePaddingToDefault();
  };

  const { steps, stepIds } = buildTourSteps({
    onEnterMenuStep: enterTabStep,
    onExitMenuStep: exitTabStep,
    onEnterSettingsTabStep: enterTabStep,
    onExitSettingsTabStep: exitTabStep,
    onEnterSettingsContentStep: () => {
      restoreTourVisualsAfterActionHandoff();
      resetStagePaddingToDefault();
    },
    onExitSettingsContentStep: () => {
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
