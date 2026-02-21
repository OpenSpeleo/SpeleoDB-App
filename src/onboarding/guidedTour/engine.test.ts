import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  driverOptionsRef,
  driverState,
  mockDriverFactory,
  mockDriverRefresh,
  mockDriverMoveNext,
  mockDriverDestroy,
  mockSetHasCompletedGuidedTour,
  mockGetHasCompletedGuidedTour,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driverOptionsRef: { current: any } = { current: null };
  const driverState = {
    active: false,
    activeIndex: 0,
    config: {} as Record<string, unknown>,
  };

  const mockDriverMoveNext = vi.fn(() => {
    driverState.activeIndex += 1;
  });
  const mockDriverRefresh = vi.fn();
  const mockDriverDestroy = vi.fn(() => {
    driverState.active = false;
    driverOptionsRef.current?.onDestroyed?.(
      undefined,
      driverOptionsRef.current?.steps?.[driverState.activeIndex] ?? {},
      {
        config: driverState.config,
        state: { activeIndex: driverState.activeIndex },
        driver: mockDriver,
      },
    );
  });

  const mockDriver = {
    isActive: vi.fn(() => driverState.active),
    refresh: mockDriverRefresh,
    drive: vi.fn(() => {
      driverState.active = true;
      driverState.activeIndex = 0;
    }),
    setConfig: vi.fn((nextConfig: Record<string, unknown>) => {
      driverState.config = nextConfig;
    }),
    setSteps: vi.fn(),
    getConfig: vi.fn(() => driverState.config),
    getState: vi.fn(() => ({ activeIndex: driverState.activeIndex })),
    getActiveIndex: vi.fn(() => driverState.activeIndex),
    isFirstStep: vi.fn(() => driverState.activeIndex === 0),
    isLastStep: vi.fn(() =>
      driverOptionsRef.current
        ? driverState.activeIndex === driverOptionsRef.current.steps.length - 1
        : false,
    ),
    getActiveStep: vi.fn(
      () => driverOptionsRef.current?.steps?.[driverState.activeIndex],
    ),
    getActiveElement: vi.fn(),
    getPreviousElement: vi.fn(),
    getPreviousStep: vi.fn(),
    moveNext: mockDriverMoveNext,
    movePrevious: vi.fn(),
    moveTo: vi.fn((index: number) => {
      driverState.activeIndex = index;
    }),
    hasNextStep: vi.fn(),
    hasPreviousStep: vi.fn(),
    highlight: vi.fn(),
    destroy: mockDriverDestroy,
  };

  const mockDriverFactory = vi.fn((options: Record<string, unknown>) => {
    driverOptionsRef.current = options;
    driverState.config = options;
    driverState.active = true;
    driverState.activeIndex = 0;
    return mockDriver;
  });

  const mockSetHasCompletedGuidedTour = vi.fn();
  const mockGetHasCompletedGuidedTour = vi.fn(() => false);

  return {
    driverOptionsRef,
    driverState,
    mockDriverFactory,
    mockDriverRefresh,
    mockDriverMoveNext,
    mockDriverDestroy,
    mockSetHasCompletedGuidedTour,
    mockGetHasCompletedGuidedTour,
  };
});

vi.mock('driver.js', () => ({
  driver: mockDriverFactory,
}));

vi.mock('../../services/PreferencesService', () => ({
  setHasCompletedGuidedTour: mockSetHasCompletedGuidedTour,
  getHasCompletedGuidedTour: mockGetHasCompletedGuidedTour,
}));

import {
  destroyGuidedTour,
  restartGuidedTourFromHelp,
  startGuidedTour,
} from './engine';
import { TOUR_BODY_CLASSES, TOUR_EVENTS } from './selectors';

interface RenderTourTargetsOptions {
  includeBulkTargets?: boolean;
  includeProjectTargets?: boolean;
  panelOpen?: boolean;
}

function renderTourTargets(options: RenderTourTargetsOptions = {}): void {
  const includeBulkTargets = options.includeBulkTargets ?? true;
  const includeProjectTargets = options.includeProjectTargets ?? true;
  const panelOpen = options.panelOpen ?? true;

  document.body.innerHTML = `
    <button data-tour="menu-toggle"></button>
    <div data-tour="project-panel" data-tour-open="${panelOpen ? 'true' : 'false'}">
    ${
      includeBulkTargets
        ? `
      <div data-tour="bulk-actions">
        <button data-tour-action="hide-all"></button>
        <button data-tour-action="show-all"></button>
      </div>
    `
        : ''
    }
    ${
      includeProjectTargets
        ? `
      <button data-tour="project-toggle"></button>
      <button data-tour="project-name" data-tour-action="project-row-zoom"></button>
      <button data-tour-action="project-row-zoom"></button>
    `
        : ''
    }
    </div>
  `;
}

describe('guided tour engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    driverOptionsRef.current = null;
    driverState.active = false;
    driverState.activeIndex = 0;
    driverState.config = {};
    document.body.className = '';
    document.body.innerHTML = '';
    mockGetHasCompletedGuidedTour.mockReturnValue(false);
    destroyGuidedTour();
  });

  it('does not start when completion is already persisted', async () => {
    mockGetHasCompletedGuidedTour.mockReturnValue(true);
    renderTourTargets({ includeProjectTargets: false });

    await startGuidedTour();
    expect(mockDriverFactory).not.toHaveBeenCalled();
  });

  it('starts and marks body active class', async () => {
    renderTourTargets({ includeProjectTargets: false });

    await startGuidedTour();
    expect(mockDriverFactory).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('guided-tour-active')).toBe(true);
    expect(driverOptionsRef.current.allowClose).toBe(true);
    expect(typeof driverOptionsRef.current.overlayClickBehavior).toBe('function');
  });

  it('renders a clearly labeled close control on non-completion steps', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    const closeButton = document.createElement('button');
    const footerButtons = document.createElement('span');
    const nextButton = document.createElement('button');
    footerButtons.appendChild(nextButton);
    nextButton.style.display = 'block';
    driverState.activeIndex = 0;
    driverOptionsRef.current.onPopoverRender?.(
      { closeButton, footerButtons, nextButton } as never,
      {
        config: driverState.config,
        state: { activeIndex: 0 },
        driver: {} as never,
      } as never,
    );
    // Re-render should keep a single close button in the same slot.
    driverOptionsRef.current.onPopoverRender?.(
      { closeButton, footerButtons, nextButton } as never,
      {
        config: driverState.config,
        state: { activeIndex: 0 },
        driver: {} as never,
      } as never,
    );

    expect(closeButton.textContent).toBe('Close');
    expect(closeButton.getAttribute('aria-label')).toBe('Close tutorial');
    expect(closeButton.classList.contains('guided-tour-footer-close-btn')).toBe(true);
    expect(closeButton.style.display).toBe('block');
    expect(footerButtons.children[0]).toBe(closeButton);
    expect(footerButtons.children[1]).toBe(nextButton);
    expect(footerButtons.children).toHaveLength(2);
  });

  it('restarts from help by resetting completion and forcing start', async () => {
    renderTourTargets({ includeProjectTargets: false });

    await restartGuidedTourFromHelp();
    expect(mockSetHasCompletedGuidedTour).toHaveBeenCalledWith(false);
    expect(mockDriverFactory).toHaveBeenCalledOnce();
  });

  it('persists completion when user uses explicit close control', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    const activeStep = driverOptionsRef.current.steps[0];
    driverOptionsRef.current.onCloseClick?.(
      undefined,
      activeStep,
      {
        config: driverState.config,
        state: { activeIndex: 0 },
        driver: {} as never,
      } as never,
    );

    expect(mockDriverDestroy).toHaveBeenCalledOnce();
    expect(mockSetHasCompletedGuidedTour).toHaveBeenCalledWith(true);
  });

  it('does not close or persist when backdrop is clicked', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    driverOptionsRef.current.overlayClickBehavior?.();

    expect(mockDriverDestroy).not.toHaveBeenCalled();
    expect(mockSetHasCompletedGuidedTour).not.toHaveBeenCalled();
  });

  it('does not persist completion when tour is programmatically destroyed', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    destroyGuidedTour();

    expect(mockSetHasCompletedGuidedTour).not.toHaveBeenCalled();
  });

  it('advances menu step after tapping menu toggle', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    driverState.activeIndex = 0;
    const menu = document.querySelector('[data-tour="menu-toggle"]');
    menu?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(700);

    expect(mockDriverMoveNext).toHaveBeenCalledOnce();
  });

  it('hides visuals and re-emits menu click during step handoff', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    const menuStep = driverOptionsRef.current.steps[0];
    const menu = document.querySelector('[data-tour="menu-toggle"]');
    const onMenuClick = vi.fn();
    menu?.addEventListener('click', onMenuClick);
    driverState.activeIndex = 0;
    menuStep.onHighlightStarted?.(undefined, menuStep, {} as never);

    menu?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(1);

    expect(document.body.classList.contains(TOUR_BODY_CLASSES.transitionHandoff)).toBe(
      true,
    );
    expect(onMenuClick).toHaveBeenCalledOnce();

    menuStep.onDeselected?.(undefined, menuStep, {} as never);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.transitionHandoff)).toBe(
      false,
    );
  });

  it('waits for project panel open signal before leaving menu step', async () => {
    renderTourTargets({ includeProjectTargets: false, panelOpen: false });
    await startGuidedTour();

    driverState.activeIndex = 0;
    const menu = document.querySelector('[data-tour="menu-toggle"]');
    menu?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(900);
    expect(driverState.activeIndex).toBe(0);

    const panel = document.querySelector('[data-tour="project-panel"]');
    panel?.setAttribute('data-tour-open', 'true');
    vi.advanceTimersByTime(800);
    expect(driverState.activeIndex).toBe(1);
  });

  it('applies menu-stage framing without repeated layout tracking refresh', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    driverState.activeIndex = 0;
    const menuStep = driverOptionsRef.current.steps[0];
    menuStep.onHighlightStarted?.(undefined, menuStep, {} as never);
    vi.advanceTimersByTime(900);

    expect(mockDriverRefresh.mock.calls.length).toBeLessThanOrEqual(3);
    expect(driverState.config.stagePadding).toBe(14);
  });

  it('does not accumulate additional menu refresh loops over time', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    const menuStep = driverOptionsRef.current.steps[0];
    driverState.activeIndex = 0;
    menuStep.onHighlightStarted?.(undefined, menuStep, {} as never);

    vi.advanceTimersByTime(1600);
    const refreshCallsWhileActive = mockDriverRefresh.mock.calls.length;
    expect(refreshCallsWhileActive).toBeLessThanOrEqual(3);

    menuStep.onDeselected?.(undefined, menuStep, {} as never);
    vi.advanceTimersByTime(300);
    const refreshCallsAfterExitSettled = mockDriverRefresh.mock.calls.length;
    vi.advanceTimersByTime(800);
    expect(mockDriverRefresh.mock.calls.length).toBe(refreshCallsAfterExitSettled);
  });

  it('toggles menu clickthrough class on menu step entry and exit', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    const menuStep = driverOptionsRef.current.steps[0];
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.menuStepClickthrough),
    ).toBe(false);

    menuStep.onHighlightStarted?.(undefined, menuStep, {} as never);
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.menuStepClickthrough),
    ).toBe(true);

    menuStep.onDeselected?.(undefined, menuStep, {} as never);
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.menuStepClickthrough),
    ).toBe(false);
  });

  it('clears menu clickthrough class when tour is destroyed mid-step', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    const menuStep = driverOptionsRef.current.steps[0];
    menuStep.onHighlightStarted?.(undefined, menuStep, {} as never);
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.menuStepClickthrough),
    ).toBe(true);

    destroyGuidedTour();
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.menuStepClickthrough),
    ).toBe(false);
    vi.advanceTimersByTime(300);
    const refreshCallsAfterDestroySettled = mockDriverRefresh.mock.calls.length;
    vi.advanceTimersByTime(800);
    expect(mockDriverRefresh.mock.calls.length).toBe(
      refreshCallsAfterDestroySettled,
    );
  });

  it('skips to completion when panel controls never appear after menu tap', async () => {
    renderTourTargets({ includeBulkTargets: false, includeProjectTargets: false });
    await startGuidedTour();

    driverState.activeIndex = 0;
    const menu = document.querySelector('[data-tour="menu-toggle"]');
    menu?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(2000);

    expect(driverState.activeIndex).toBe(
      driverOptionsRef.current.steps.length - 1,
    );
  });

  it('defers project-target skip until after show-all step', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    driverState.activeIndex = 0;
    const menu = document.querySelector('[data-tour="menu-toggle"]');
    menu?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(700);
    expect(driverState.activeIndex).toBe(1);

    const hideAll = document.querySelector('[data-tour-action="hide-all"]');
    hideAll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(driverState.activeIndex).toBe(2);

    const showAll = document.querySelector('[data-tour-action="show-all"]');
    showAll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(6500);
    expect(driverState.activeIndex).toBe(
      driverOptionsRef.current.steps.length - 1,
    );
  });

  it('proceeds to project steps when project targets appear during grace period', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    driverState.activeIndex = 0;
    const menu = document.querySelector('[data-tour="menu-toggle"]');
    menu?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(700);
    expect(driverState.activeIndex).toBe(1);

    const hideAll = document.querySelector('[data-tour-action="hide-all"]');
    hideAll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(driverState.activeIndex).toBe(2);

    const panel = document.querySelector('[data-tour="project-panel"]');
    window.setTimeout(() => {
      if (!panel) return;
      panel.insertAdjacentHTML(
        'beforeend',
        '<button data-tour="project-toggle"></button><button data-tour="project-name" data-tour-action="project-row-zoom"></button>',
      );
    }, 1000);

    const showAll = document.querySelector('[data-tour-action="show-all"]');
    showAll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(1700);
    expect(driverState.activeIndex).toBe(3);
  });

  it('advances through dedicated hide-all then show-all bulk steps', async () => {
    renderTourTargets();
    await startGuidedTour();

    driverState.activeIndex = 1;

    const showAll = document.querySelector('[data-tour-action="show-all"]');
    const hideAll = document.querySelector('[data-tour-action="hide-all"]');

    showAll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(mockDriverMoveNext).not.toHaveBeenCalled();

    hideAll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(mockDriverMoveNext).toHaveBeenCalledOnce();

    driverState.activeIndex = 2;
    hideAll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(mockDriverMoveNext).toHaveBeenCalledOnce();

    showAll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(mockDriverMoveNext).toHaveBeenCalledTimes(2);
  });

  it('toggles bulk-action visibility classes between hide and show steps', async () => {
    renderTourTargets();
    await startGuidedTour();

    const hideStep = driverOptionsRef.current.steps[1];
    const showStep = driverOptionsRef.current.steps[2];

    hideStep.onHighlightStarted?.(undefined, hideStep, {} as never);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.bulkHideOnly)).toBe(
      true,
    );
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.bulkShowOnly)).toBe(
      false,
    );

    hideStep.onDeselected?.(undefined, hideStep, {} as never);
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.bulkHideOnly),
    ).toBe(false);

    showStep.onHighlightStarted?.(undefined, showStep, {} as never);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.bulkShowOnly)).toBe(
      true,
    );
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.bulkHideOnly)).toBe(
      false,
    );

    showStep.onDeselected?.(undefined, showStep, {} as never);
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.bulkShowOnly),
    ).toBe(false);
  });

  it('does not add extra body guard classes during toggle step', async () => {
    renderTourTargets();
    await startGuidedTour();

    const toggleStep = driverOptionsRef.current.steps[3];
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.bulkHideOnly)).toBe(false);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.bulkShowOnly)).toBe(false);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.menuStepClickthrough)).toBe(false);

    toggleStep.onHighlightStarted?.(undefined, toggleStep, {} as never);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.bulkHideOnly)).toBe(false);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.bulkShowOnly)).toBe(false);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.menuStepClickthrough)).toBe(false);

    toggleStep.onDeselected?.(undefined, toggleStep, {} as never);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.bulkHideOnly)).toBe(false);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.bulkShowOnly)).toBe(false);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.menuStepClickthrough)).toBe(false);
  });

  it('does not advance on project-row click during toggle step', async () => {
    renderTourTargets();
    await startGuidedTour();

    const toggleStep = driverOptionsRef.current.steps[3];
    driverState.activeIndex = 3;
    toggleStep.onHighlightStarted?.(undefined, toggleStep, {} as never);
    const projectName = document.querySelector('[data-tour="project-name"]');
    const nonTargetProjectName = document.querySelectorAll(
      '[data-tour-action="project-row-zoom"]',
    )[1];
    const onProjectRowClick = vi.fn();
    const onNonTargetProjectRowClick = vi.fn();
    projectName?.addEventListener('click', onProjectRowClick);
    nonTargetProjectName?.addEventListener('click', onNonTargetProjectRowClick);
    projectName?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    nonTargetProjectName?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(1000);

    expect(mockDriverMoveNext).not.toHaveBeenCalled();
    expect(onProjectRowClick).toHaveBeenCalledOnce();
    expect(onNonTargetProjectRowClick).toHaveBeenCalledOnce();
  });

  it('waits for zoom-complete event before showing completion step', async () => {
    renderTourTargets();
    await startGuidedTour();

    driverState.activeIndex = 4;
    const centerStep = driverOptionsRef.current.steps[4];
    centerStep.onHighlightStarted?.(undefined, centerStep, {} as never);

    const projectName = document.querySelector('[data-tour="project-name"]');
    const onProjectNameClick = vi.fn();
    projectName?.addEventListener('click', onProjectNameClick);

    projectName?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(5);

    expect(document.body.classList.contains(TOUR_BODY_CLASSES.transitionHandoff)).toBe(
      true,
    );
    expect(onProjectNameClick).toHaveBeenCalledOnce();
    expect(mockDriverMoveNext).not.toHaveBeenCalled();

    document.dispatchEvent(new CustomEvent(TOUR_EVENTS.projectZoomComplete));
    vi.advanceTimersByTime(1);
    expect(mockDriverMoveNext).toHaveBeenCalledOnce();

    centerStep.onDeselected?.(undefined, centerStep, {} as never);
    expect(document.body.classList.contains(TOUR_BODY_CLASSES.transitionHandoff)).toBe(
      false,
    );
  });

  it('marks completion and destroys the tour on final next', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();

    const finalIndex = driverOptionsRef.current.steps.length - 1;
    driverState.activeIndex = finalIndex;
    const finalStep = driverOptionsRef.current.steps[finalIndex];
    finalStep.popover.onNextClick(undefined, finalStep, {} as never);

    expect(mockSetHasCompletedGuidedTour).toHaveBeenCalledWith(true);
    expect(mockDriverDestroy).toHaveBeenCalled();
  });

  it('is idempotent when start is called while already active', async () => {
    renderTourTargets({ includeProjectTargets: false });
    await startGuidedTour();
    await startGuidedTour();
    expect(mockDriverFactory).toHaveBeenCalledOnce();
  });
});
