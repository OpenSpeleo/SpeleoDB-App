import type { DriveStep } from 'driver.js';
import { TOUR_SELECTORS } from './selectors';

export const GUIDED_TOUR_STAGE_PADDING_DEFAULT = 8;
export const GUIDED_TOUR_STAGE_PADDING_MENU = 14;

export type GuidedTourStepId =
  | 'openProjectPanel'
  | 'goToSettings'
  | 'settingsColorMode'
  | 'settingsShowLandmarks'
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
    'settingsShowLandmarks',
    'settingsMeasurementUnit',
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
        description: 'Choose between coloring projects individually or by depth.',
        side: 'bottom',
        align: 'center',
        showButtons: ['next', 'close'],
      },
    },
    {
      element: TOUR_SELECTORS.settingsShowLandmarks,
      onHighlightStarted: () => {
        options.onEnterSettingsContentStep?.();
      },
      onDeselected: () => {
        options.onExitSettingsContentStep?.();
      },
      popover: {
        title: 'Show landmarks',
        description: 'Toggle map landmarks on or off.',
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
