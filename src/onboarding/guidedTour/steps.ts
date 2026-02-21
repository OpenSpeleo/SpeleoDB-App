import type { DriveStep } from 'driver.js';
import { TOUR_SELECTORS } from './selectors';

export const GUIDED_TOUR_STAGE_PADDING_DEFAULT = 8;
export const GUIDED_TOUR_STAGE_PADDING_MENU = 14;

export type GuidedTourStepId =
  | 'openProjectPanel'
  | 'hideAllProjects'
  | 'showAllProjects'
  | 'toggleProject'
  | 'centerProject'
  | 'completion';

export interface GuidedTourStepHooks {
  onEnterMenuStep?: () => void;
  onExitMenuStep?: () => void;
  onEnterHideAllStep?: () => void;
  onExitHideAllStep?: () => void;
  onEnterShowAllStep?: () => void;
  onExitShowAllStep?: () => void;
  onEnterCenterProject?: () => void;
  onExitCenterProject?: () => void;
  onCompletionNext?: () => void;
}

export type BuildGuidedTourStepsOptions = GuidedTourStepHooks;

export interface BuildGuidedTourStepsResult {
  stepIds: GuidedTourStepId[];
  steps: DriveStep[];
}

export function buildTourSteps(
  options: BuildGuidedTourStepsOptions,
): BuildGuidedTourStepsResult {
  const stepIds: GuidedTourStepId[] = [
    'openProjectPanel',
    'hideAllProjects',
    'showAllProjects',
    'toggleProject',
    'centerProject',
  ];

  const steps: DriveStep[] = [
    {
      element: TOUR_SELECTORS.menuToggle,
      onHighlightStarted: () => {
        options.onEnterMenuStep?.();
      },
      onDeselected: () => {
        options.onExitMenuStep?.();
      },
      popover: {
        title: 'Open the project panel',
        description: 'Tap the Projects button to open the project panel.',
        side: 'top',
        align: 'start',
        showButtons: ['close'],
      },
    },
  ];

  steps.push(
    {
      element: TOUR_SELECTORS.hideAllAction,
      onHighlightStarted: () => {
        options.onEnterHideAllStep?.();
      },
      onDeselected: () => {
        options.onExitHideAllStep?.();
      },
      popover: {
        title: 'Hide all projects',
        description: 'Tap "Hide all" to temporarily hide every project layer.',
        side: 'bottom',
        align: 'center',
        showButtons: ['close'],
      },
    },
    {
      element: TOUR_SELECTORS.showAllAction,
      onHighlightStarted: () => {
        options.onEnterShowAllStep?.();
      },
      onDeselected: () => {
        options.onExitShowAllStep?.();
      },
      popover: {
        title: 'Show all projects',
        description: 'Now tap "Show all" to bring every project layer back.',
        side: 'bottom',
        align: 'center',
        showButtons: ['close'],
      },
    },
    {
      element: TOUR_SELECTORS.projectToggle,
      popover: {
        title: 'Toggle one project',
        description: 'Use this switch to hide or show an individual project layer.',
        side: 'bottom',
        align: 'end',
        showButtons: ['close'],
      },
    },
    {
      element: TOUR_SELECTORS.projectName,
      onHighlightStarted: () => {
        options.onEnterCenterProject?.();
      },
      onDeselected: () => {
        options.onExitCenterProject?.();
      },
      popover: {
        title: 'Center on a project',
        description: 'Tap the project name to zoom directly to that project on the map.',
        side: 'bottom',
        align: 'center',
        showButtons: ['close'],
      },
    },
  );

  stepIds.push('completion');
  steps.push({
    popover: {
      title: 'Tour complete',
      description: 'You are ready to explore. Tap Finish to continue.',
      side: 'over',
      align: 'center',
      showButtons: ['next'],
      nextBtnText: 'Finish',
      onNextClick: () => {
        options.onCompletionNext?.();
      },
    },
  });

  return { stepIds, steps };
}
