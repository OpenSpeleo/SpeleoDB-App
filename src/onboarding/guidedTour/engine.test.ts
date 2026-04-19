import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { TOUR_BODY_CLASSES } from './selectors';

interface RenderTourTargetsOptions {
  panelOpen?: boolean;
  includeSettingsTargets?: boolean;
  pathname?: '/dashboard' | '/settings';
}

function renderTourTargets(options: RenderTourTargetsOptions = {}): void {
  const panelOpen = options.panelOpen ?? true;
  const includeSettingsTargets = options.includeSettingsTargets ?? true;
  const pathname = options.pathname ?? '/dashboard';

  document.body.innerHTML = `
    <button data-tour="menu-toggle"></button>
    <button data-tour="settings-tab"></button>
    <div data-tour="project-panel" data-tour-open="${panelOpen ? 'true' : 'false'}"></div>
    ${
      includeSettingsTargets
        ? `
      <div data-tour="settings-color-mode"></div>
      <div data-tour="settings-show-landmarks"></div>
      <div data-tour="settings-measurement-unit"></div>
    `
        : ''
    }
  `;
  window.history.pushState({}, '', pathname);
}

function setActivePathname(pathname: '/dashboard' | '/settings'): void {
  window.history.pushState({}, '', pathname);
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
    window.history.replaceState({}, '', '/dashboard');
    mockGetHasCompletedGuidedTour.mockReturnValue(false);
    destroyGuidedTour();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start when completion is already persisted', async () => {
    mockGetHasCompletedGuidedTour.mockReturnValue(true);
    renderTourTargets();

    await startGuidedTour();
    expect(mockDriverFactory).not.toHaveBeenCalled();
  });

  it('starts and marks body active class', async () => {
    renderTourTargets();

    await startGuidedTour();
    expect(mockDriverFactory).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('guided-tour-active')).toBe(true);
    expect(driverOptionsRef.current.allowClose).toBe(true);
    expect(typeof driverOptionsRef.current.overlayClickBehavior).toBe('function');
  });

  it('renders a clearly labeled close control on non-completion steps', async () => {
    renderTourTargets();
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
    renderTourTargets();

    await restartGuidedTourFromHelp();
    expect(mockSetHasCompletedGuidedTour).toHaveBeenCalledWith(false);
    expect(mockDriverFactory).toHaveBeenCalledOnce();
  });

  it('persists completion when user uses explicit close control', async () => {
    renderTourTargets();
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
    renderTourTargets();
    await startGuidedTour();

    driverOptionsRef.current.overlayClickBehavior?.();

    expect(mockDriverDestroy).not.toHaveBeenCalled();
    expect(mockSetHasCompletedGuidedTour).not.toHaveBeenCalled();
  });

  it('does not persist completion when tour is programmatically destroyed', async () => {
    renderTourTargets();
    await startGuidedTour();

    destroyGuidedTour();

    expect(mockSetHasCompletedGuidedTour).not.toHaveBeenCalled();
  });

  it('advances panel-open step after tapping menu toggle', async () => {
    renderTourTargets();
    await startGuidedTour();

    driverState.activeIndex = 0;
    const menu = document.querySelector('[data-tour="menu-toggle"]');
    menu?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(700);

    expect(mockDriverMoveNext).toHaveBeenCalledOnce();
  });

  it('hides visuals and re-emits menu click during step handoff', async () => {
    renderTourTargets();
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
    renderTourTargets({ panelOpen: false });
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

  it('applies tab-step framing without repeated layout tracking refresh', async () => {
    renderTourTargets();
    await startGuidedTour();

    driverState.activeIndex = 0;
    const menuStep = driverOptionsRef.current.steps[0];
    menuStep.onHighlightStarted?.(undefined, menuStep, {} as never);
    vi.advanceTimersByTime(900);

    expect(mockDriverRefresh.mock.calls.length).toBeLessThanOrEqual(3);
    expect(driverState.config.stagePadding).toBe(14);
  });

  it('toggles tab clickthrough class on menu step entry and exit', async () => {
    renderTourTargets();
    await startGuidedTour();

    const menuStep = driverOptionsRef.current.steps[0];
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.tabClickthrough),
    ).toBe(false);

    menuStep.onHighlightStarted?.(undefined, menuStep, {} as never);
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.tabClickthrough),
    ).toBe(true);

    menuStep.onDeselected?.(undefined, menuStep, {} as never);
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.tabClickthrough),
    ).toBe(false);
  });

  it('clears tab clickthrough class when tour is destroyed mid-step', async () => {
    renderTourTargets();
    await startGuidedTour();

    const menuStep = driverOptionsRef.current.steps[0];
    menuStep.onHighlightStarted?.(undefined, menuStep, {} as never);
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.tabClickthrough),
    ).toBe(true);

    destroyGuidedTour();
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.tabClickthrough),
    ).toBe(false);
  });

  it('skips to completion when project panel never opens after menu tap', async () => {
    renderTourTargets({ panelOpen: false });
    await startGuidedTour();

    driverState.activeIndex = 0;
    const menu = document.querySelector('[data-tour="menu-toggle"]');
    menu?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(2000);

    expect(driverState.activeIndex).toBe(
      driverOptionsRef.current.steps.length - 1,
    );
  });

  it('reuses the tab clickthrough class on the settings-tab step', async () => {
    renderTourTargets();
    await startGuidedTour();

    const settingsStep = driverOptionsRef.current.steps[1];
    settingsStep.onHighlightStarted?.(undefined, settingsStep, {} as never);
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.tabClickthrough),
    ).toBe(true);

    settingsStep.onDeselected?.(undefined, settingsStep, {} as never);
    expect(
      document.body.classList.contains(TOUR_BODY_CLASSES.tabClickthrough),
    ).toBe(false);
  });

  it('hides visuals and re-emits settings-tab click during step handoff', async () => {
    renderTourTargets();
    await startGuidedTour();

    driverState.activeIndex = 1;
    const settingsStep = driverOptionsRef.current.steps[1];
    settingsStep.onHighlightStarted?.(undefined, settingsStep, {} as never);

    const settingsTab = document.querySelector('[data-tour="settings-tab"]');
    const onSettingsClick = vi.fn();
    settingsTab?.addEventListener('click', onSettingsClick);

    settingsTab?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    vi.advanceTimersByTime(1);

    expect(document.body.classList.contains(TOUR_BODY_CLASSES.transitionHandoff)).toBe(
      true,
    );
    expect(onSettingsClick).toHaveBeenCalledOnce();
  });

  it('advances to settingsColorMode once /settings is active and DOM is ready', async () => {
    renderTourTargets();
    await startGuidedTour();

    driverState.activeIndex = 1;
    setActivePathname('/dashboard');
    const settingsTab = document.querySelector('[data-tour="settings-tab"]');
    settingsTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    vi.advanceTimersByTime(700);
    expect(driverState.activeIndex).toBe(1);

    setActivePathname('/settings');
    vi.advanceTimersByTime(800);
    expect(driverState.activeIndex).toBe(2);
  });

  it('skips to completion when settings DOM never appears after settings-tab tap', async () => {
    renderTourTargets({ includeSettingsTargets: false });
    await startGuidedTour();

    driverState.activeIndex = 1;
    setActivePathname('/settings');
    const settingsTab = document.querySelector('[data-tour="settings-tab"]');
    settingsTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(7000);

    expect(driverState.activeIndex).toBe(
      driverOptionsRef.current.steps.length - 1,
    );
  });

  it('does not intercept interactions on descriptive settings steps', async () => {
    renderTourTargets({ pathname: '/settings' });
    await startGuidedTour();

    for (const stepIndex of [2, 3, 4]) {
      driverState.activeIndex = stepIndex;
      const stepEl = document.querySelector(
        driverOptionsRef.current.steps[stepIndex].element,
      );
      stepEl?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    vi.advanceTimersByTime(1500);

    expect(mockDriverMoveNext).not.toHaveBeenCalled();
  });

  it('marks completion and destroys the tour on final next', async () => {
    renderTourTargets();
    await startGuidedTour();

    const finalIndex = driverOptionsRef.current.steps.length - 1;
    driverState.activeIndex = finalIndex;
    const finalStep = driverOptionsRef.current.steps[finalIndex];
    finalStep.popover.onNextClick(undefined, finalStep, {} as never);

    expect(mockSetHasCompletedGuidedTour).toHaveBeenCalledWith(true);
    expect(mockDriverDestroy).toHaveBeenCalled();
  });

  it('is idempotent when start is called while already active', async () => {
    renderTourTargets();
    await startGuidedTour();
    await startGuidedTour();
    expect(mockDriverFactory).toHaveBeenCalledOnce();
  });
});
