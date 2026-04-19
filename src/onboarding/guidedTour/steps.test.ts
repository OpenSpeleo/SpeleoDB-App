import { describe, expect, it, vi } from 'vitest';
import {
  GUIDED_TOUR_STAGE_PADDING_DEFAULT,
  GUIDED_TOUR_STAGE_PADDING_MENU,
  buildTourSteps,
} from './steps';

describe('buildTourSteps', () => {
  it('builds the new 6-step flow', () => {
    const { stepIds, steps } = buildTourSteps({});

    expect(stepIds).toEqual([
      'openProjectPanel',
      'goToSettings',
      'settingsColorMode',
      'settingsShowLandmarks',
      'settingsMeasurementUnit',
      'completion',
    ]);
    expect(steps).toHaveLength(6);
  });

  it('keeps the close-only navigation on the two gesture-driven steps', () => {
    const { steps } = buildTourSteps({});
    expect(steps[0].popover?.showButtons).toEqual(['close']);
    expect(steps[1].popover?.showButtons).toEqual(['close']);
  });

  it('shows next + close on the three descriptive settings steps', () => {
    const { steps } = buildTourSteps({});
    expect(steps[2].popover?.showButtons).toEqual(['next', 'close']);
    expect(steps[3].popover?.showButtons).toEqual(['next', 'close']);
    expect(steps[4].popover?.showButtons).toEqual(['next', 'close']);
  });

  it('places the project-panel step popover at top-start', () => {
    const { steps } = buildTourSteps({});
    expect(steps[0].popover?.side).toBe('top');
    expect(steps[0].popover?.align).toBe('start');
  });

  it('places the settings-tab step popover at top-end (Settings is the rightmost tab)', () => {
    const { steps } = buildTourSteps({});
    expect(steps[1].popover?.side).toBe('top');
    expect(steps[1].popover?.align).toBe('end');
  });

  it('fires completion callback on Finish click', () => {
    const onCompletionNext = vi.fn();
    const { steps } = buildTourSteps({
      onCompletionNext,
    });

    steps[steps.length - 1].popover?.onNextClick?.(
      undefined,
      steps[steps.length - 1],
      {} as never,
    );
    expect(onCompletionNext).toHaveBeenCalledOnce();
  });

  it('invokes menu and settings-tab hooks on step lifecycle', () => {
    const onEnterMenuStep = vi.fn();
    const onExitMenuStep = vi.fn();
    const onEnterSettingsTabStep = vi.fn();
    const onExitSettingsTabStep = vi.fn();

    const { steps } = buildTourSteps({
      onEnterMenuStep,
      onExitMenuStep,
      onEnterSettingsTabStep,
      onExitSettingsTabStep,
    });

    steps[0].onHighlightStarted?.(undefined, steps[0], {} as never);
    steps[0].onDeselected?.(undefined, steps[0], {} as never);
    steps[1].onHighlightStarted?.(undefined, steps[1], {} as never);
    steps[1].onDeselected?.(undefined, steps[1], {} as never);

    expect(onEnterMenuStep).toHaveBeenCalledOnce();
    expect(onExitMenuStep).toHaveBeenCalledOnce();
    expect(onEnterSettingsTabStep).toHaveBeenCalledOnce();
    expect(onExitSettingsTabStep).toHaveBeenCalledOnce();
  });

  it('shares one settings-content hook across the three descriptive steps', () => {
    const onEnterSettingsContentStep = vi.fn();
    const onExitSettingsContentStep = vi.fn();

    const { steps } = buildTourSteps({
      onEnterSettingsContentStep,
      onExitSettingsContentStep,
    });

    for (const index of [2, 3, 4]) {
      steps[index].onHighlightStarted?.(undefined, steps[index], {} as never);
      steps[index].onDeselected?.(undefined, steps[index], {} as never);
    }

    expect(onEnterSettingsContentStep).toHaveBeenCalledTimes(3);
    expect(onExitSettingsContentStep).toHaveBeenCalledTimes(3);
  });

  it('exposes stable padding constants', () => {
    expect(GUIDED_TOUR_STAGE_PADDING_DEFAULT).toBe(8);
    expect(GUIDED_TOUR_STAGE_PADDING_MENU).toBe(14);
  });
});
