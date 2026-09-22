import type { DriveStep } from 'driver.js';
import { TOUR_SELECTORS } from './selectors';

export const GUIDED_TOUR_STAGE_PADDING_DEFAULT = 8;
export const GUIDED_TOUR_STAGE_PADDING_MENU = 14;

export type GuidedTourStepId =
  | 'openProjectPanel'
  | 'goToSettings'
  | 'settingsColorMode'
  | 'settingsMapVisibility'
  | 'settingsMeasurementUnit'
  | 'completion';

export interface GuidedTourStepHooks {
  onEnterMenuStep?: () => void;
  onExitMenuStep?: () => void;
  onEnterSettingsTabStep?: () => void;
  onExitSettingsTabStep?: () => void;
  onEnterSettingsContentStep?: () => void;
  onExitSettingsContentStep?: () => void;
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
    'goToSettings',
    'settingsColorMode',
    'settingsMeasurementUnit',
    'settingsMapVisibility',
    'completion',
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
    {
      element: TOUR_SELECTORS.settingsTab,
      onHighlightStarted: () => {
        options.onEnterSettingsTabStep?.();
      },
      onDeselected: () => {
        options.onExitSettingsTabStep?.();
      },
      popover: {
        title: 'Open Settings',
        description: 'Tap Settings to customize your map.',
        side: 'top',
        align: 'end',
        showButtons: ['close'],
      },
    },
    {
      element: TOUR_SELECTORS.settingsColorMode,
      onHighlightStarted: () => {
        options.onEnterSettingsContentStep?.();
      },
      onDeselected: () => {
        options.onExitSettingsContentStep?.();
      },
      popover: {
        title: 'Color mode',
        description: 'Color surveys by project, by depth, or by shot. Shots without a color use their project color.',
        side: 'bottom',
        align: 'center',
        showButtons: ['next', 'close'],
      },
    },
    {
      element: TOUR_SELECTORS.settingsMeasurementUnit,
      onHighlightStarted: () => {
        options.onEnterSettingsContentStep?.();
      },
      onDeselected: () => {
        options.onExitSettingsContentStep?.();
      },
      popover: {
        title: 'Map unit',
        description: 'Switch between meters and feet for distances and depths.',
        side: 'bottom',
        align: 'center',
        showButtons: ['next', 'close'],
      },
    },
    {
      element: TOUR_SELECTORS.settingsMapVisibility,
      onHighlightStarted: () => {
        options.onEnterSettingsContentStep?.();
      },
      onDeselected: () => {
        options.onExitSettingsContentStep?.();
      },
      popover: {
        title: 'Map visibility',
        description: 'Choose which markers appear on your map. Your individual project and item selections are preserved.',
        side: 'bottom',
        align: 'center',
        showButtons: ['next', 'close'],
      },
    },
    {
      popover: {
        title: 'Tour complete',
        description: 'You are ready to explore. Tap Finish to continue.',
        align: 'center',
        showButtons: ['next'],
        nextBtnText: 'Finish',
        onNextClick: () => {
          options.onCompletionNext?.();
        },
      },
    },
  ];

  return { stepIds, steps };
}
