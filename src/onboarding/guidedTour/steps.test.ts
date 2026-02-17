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
      'statusBar',
      'pullToRefresh',
      'openProjectPanel',
      'hideAllProjects',
      'showAllProjects',
      'toggleProject',
      'centerProject',
      'completion',
    ]);
    expect(steps).toHaveLength(8);
  });

  it('always includes project steps and defers skipping to runtime', () => {
    const { stepIds } = buildTourSteps({});
    expect(stepIds).toContain('hideAllProjects');
    expect(stepIds).toContain('showAllProjects');
    expect(stepIds).toContain('toggleProject');
    expect(stepIds).toContain('centerProject');
  });

  it('sets first step to next-only navigation', () => {
    const { steps } = buildTourSteps({});
    expect(steps[0].popover?.showButtons).toEqual(['next']);
  });

  it('makes interaction-gated steps buttonless', () => {
    const { steps } = buildTourSteps({});

    // Pull-to-refresh, menu, hide-all, show-all, toggle, center
    expect(steps[1].popover?.showButtons).toEqual([]);
    expect(steps[2].popover?.showButtons).toEqual([]);
    expect(steps[3].popover?.showButtons).toEqual([]);
    expect(steps[4].popover?.showButtons).toEqual([]);
    expect(steps[5].popover?.showButtons).toEqual([]);
    expect(steps[6].popover?.showButtons).toEqual([]);
  });

  it('uses updated pull-to-refresh wording', () => {
    const { steps } = buildTourSteps({});
    expect(steps[1].popover?.title).toBe('Pull down and refresh');
  });

  it('positions toggle step popover below the project row', () => {
    const { steps } = buildTourSteps({});
    expect(steps[5].popover?.side).toBe('bottom');
    expect(steps[5].popover?.align).toBe('end');
  });

  it('provides completion callback on final step', () => {
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

  it('invokes menu, pull, and bulk hooks on step lifecycle', () => {
    const onEnterPullToRefresh = vi.fn();
    const onExitPullToRefresh = vi.fn();
    const onEnterMenuStep = vi.fn();
    const onExitMenuStep = vi.fn();
    const onEnterHideAllStep = vi.fn();
    const onExitHideAllStep = vi.fn();
    const onEnterShowAllStep = vi.fn();
    const onExitShowAllStep = vi.fn();

    const { steps } = buildTourSteps({
      onEnterPullToRefresh,
      onExitPullToRefresh,
      onEnterMenuStep,
      onExitMenuStep,
      onEnterHideAllStep,
      onExitHideAllStep,
      onEnterShowAllStep,
      onExitShowAllStep,
    });

    steps[1].onHighlightStarted?.(undefined, steps[1], {} as never);
    steps[1].onDeselected?.(undefined, steps[1], {} as never);
    steps[2].onHighlightStarted?.(undefined, steps[2], {} as never);
    steps[2].onDeselected?.(undefined, steps[2], {} as never);
    steps[3].onHighlightStarted?.(undefined, steps[3], {} as never);
    steps[3].onDeselected?.(undefined, steps[3], {} as never);
    steps[4].onHighlightStarted?.(undefined, steps[4], {} as never);
    steps[4].onDeselected?.(undefined, steps[4], {} as never);
    steps[5].onHighlightStarted?.(undefined, steps[5], {} as never);
    steps[5].onDeselected?.(undefined, steps[5], {} as never);

    expect(onEnterPullToRefresh).toHaveBeenCalledOnce();
    expect(onExitPullToRefresh).toHaveBeenCalledOnce();
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
