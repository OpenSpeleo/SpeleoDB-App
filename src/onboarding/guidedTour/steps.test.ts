import { describe, expect, it, vi } from 'vitest';
import {
  GUIDED_TOUR_STAGE_PADDING_DEFAULT,
  GUIDED_TOUR_STAGE_PADDING_MENU,
  buildTourSteps,
} from './steps';

describe('buildTourSteps', () => {
  it('builds full step flow', () => {
    const { stepIds, steps } = buildTourSteps({});

    expect(stepIds).toEqual([
      'openProjectPanel',
      'hideAllProjects',
      'showAllProjects',
      'toggleProject',
      'centerProject',
      'completion',
    ]);
    expect(steps).toHaveLength(6);
  });

  it('always includes project steps and defers skipping to runtime', () => {
    const { stepIds } = buildTourSteps({});
    expect(stepIds).toContain('hideAllProjects');
    expect(stepIds).toContain('showAllProjects');
    expect(stepIds).toContain('toggleProject');
    expect(stepIds).toContain('centerProject');
  });

  it('sets first step to close-only navigation', () => {
    const { steps } = buildTourSteps({});
    expect(steps[0].popover?.showButtons).toEqual(['close']);
  });

  it('keeps close button available on interaction-gated steps', () => {
    const { steps } = buildTourSteps({});

    // openProjectPanel, hide-all, show-all, toggle, center
    expect(steps[0].popover?.showButtons).toEqual(['close']);
    expect(steps[1].popover?.showButtons).toEqual(['close']);
    expect(steps[2].popover?.showButtons).toEqual(['close']);
    expect(steps[3].popover?.showButtons).toEqual(['close']);
    expect(steps[4].popover?.showButtons).toEqual(['close']);
  });

  it('sets toggle step popover to bottom-end alignment', () => {
    const { steps } = buildTourSteps({});
    expect(steps[3].popover?.side).toBe('bottom');
    expect(steps[3].popover?.align).toBe('end');
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

  it('invokes menu and bulk hooks on step lifecycle', () => {
    const onEnterMenuStep = vi.fn();
    const onExitMenuStep = vi.fn();
    const onEnterHideAllStep = vi.fn();
    const onExitHideAllStep = vi.fn();
    const onEnterShowAllStep = vi.fn();
    const onExitShowAllStep = vi.fn();

    const { steps } = buildTourSteps({
      onEnterMenuStep,
      onExitMenuStep,
      onEnterHideAllStep,
      onExitHideAllStep,
      onEnterShowAllStep,
      onExitShowAllStep,
    });

    // step 0: openProjectPanel
    steps[0].onHighlightStarted?.(undefined, steps[0], {} as never);
    steps[0].onDeselected?.(undefined, steps[0], {} as never);
    // step 1: hideAllProjects
    steps[1].onHighlightStarted?.(undefined, steps[1], {} as never);
    steps[1].onDeselected?.(undefined, steps[1], {} as never);
    // step 2: showAllProjects
    steps[2].onHighlightStarted?.(undefined, steps[2], {} as never);
    steps[2].onDeselected?.(undefined, steps[2], {} as never);

    expect(onEnterMenuStep).toHaveBeenCalledOnce();
    expect(onExitMenuStep).toHaveBeenCalledOnce();
    expect(onEnterHideAllStep).toHaveBeenCalledOnce();
    expect(onExitHideAllStep).toHaveBeenCalledOnce();
    expect(onEnterShowAllStep).toHaveBeenCalledOnce();
    expect(onExitShowAllStep).toHaveBeenCalledOnce();

    expect(GUIDED_TOUR_STAGE_PADDING_DEFAULT).toBe(8);
    expect(GUIDED_TOUR_STAGE_PADDING_MENU).toBe(14);
  });
});
