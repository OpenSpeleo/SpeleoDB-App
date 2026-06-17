import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { History } from 'history'
import type { Location } from 'history'
import type { SpeleoDBController, SyncStatus } from '../controllers/SpeleoDBController'
import type { AuthState } from '../types'
import { destroyGuidedTour, startGuidedTour } from '../onboarding/guidedTour/runtime'

interface StartupUiState {
  isStartupValidationPending: boolean
  showConnectingBanner: boolean
  offlineModeAcknowledged: boolean
  allowOfflineModalDismiss: boolean
  showCompanionInfoModal: boolean
  allowCompanionInfoModalDismiss: boolean
  shouldOpenCompanionInfo: boolean
  pendingGuidedTourStart: boolean
  shouldAutostartGuidedTour: boolean
}

type StartupUiAction =
  | { type: 'show_connecting_banner' }
  | { type: 'startup_validation_finished' }
  | { type: 'acknowledge_offline_mode' }
  | { type: 'offline_modal_did_dismiss' }
  | { type: 'offline_lock_cleared' }
  | { type: 'auth_became_authenticated' }
  | { type: 'auth_became_unauthenticated' }
  | { type: 'open_companion_info' }
  | { type: 'start_exploring' }
  | { type: 'companion_modal_did_dismiss'; shouldScheduleGuidedTour: boolean }
  | { type: 'guided_tour_resolved' }

interface UseStartupUiCoordinatorOptions {
  authState: AuthState
  isOfflineLocked: boolean
  syncStatus: SyncStatus
  controller: Pick<SpeleoDBController, 'validateSession' | 'isAuthenticated'>
  history: Pick<History, 'replace'>
  location: Pick<Location, 'pathname'>
  getPreferences: () => {
    token?: string
    instance?: string
  }
  hideSplashScreenSafely: (reason: string) => void
}

export interface StartupUiCoordinatorResult {
  showConnectingBanner: boolean
  showOfflineModal: boolean
  showCompanionInfoModal: boolean
  allowOfflineModalDismiss: boolean
  allowCompanionInfoModalDismiss: boolean
  acknowledgeOfflineMode: () => void
  handleOfflineModalDidDismiss: () => void
  handleStartExploring: () => void
  handleCompanionModalDidDismiss: () => void
}

function createInitialState(hasStoredSession: boolean): StartupUiState {
  return {
    isStartupValidationPending: hasStoredSession,
    showConnectingBanner: false,
    offlineModeAcknowledged: false,
    allowOfflineModalDismiss: false,
    showCompanionInfoModal: false,
    allowCompanionInfoModalDismiss: false,
    shouldOpenCompanionInfo: false,
    pendingGuidedTourStart: false,
    shouldAutostartGuidedTour: false,
  }
}

function startupUiReducer(state: StartupUiState, action: StartupUiAction): StartupUiState {
  switch (action.type) {
    case 'show_connecting_banner':
      return {
        ...state,
        showConnectingBanner: true,
      }
    case 'startup_validation_finished':
      return {
        ...state,
        isStartupValidationPending: false,
        showConnectingBanner: false,
      }
    case 'acknowledge_offline_mode':
      return {
        ...state,
        offlineModeAcknowledged: true,
        allowOfflineModalDismiss: true,
      }
    case 'offline_modal_did_dismiss':
      return {
        ...state,
        allowOfflineModalDismiss: false,
      }
    case 'offline_lock_cleared':
      return {
        ...state,
        offlineModeAcknowledged: false,
      }
    case 'auth_became_authenticated':
      return {
        ...state,
        shouldOpenCompanionInfo: true,
      }
    case 'auth_became_unauthenticated':
      return {
        ...state,
        isStartupValidationPending: false,
        showConnectingBanner: false,
        shouldOpenCompanionInfo: false,
        showCompanionInfoModal: false,
        allowCompanionInfoModalDismiss: false,
        pendingGuidedTourStart: false,
        shouldAutostartGuidedTour: false,
      }
    case 'open_companion_info':
      return {
        ...state,
        shouldOpenCompanionInfo: false,
        showCompanionInfoModal: true,
        allowCompanionInfoModalDismiss: false,
      }
    case 'start_exploring':
      return {
        ...state,
        showCompanionInfoModal: false,
        allowCompanionInfoModalDismiss: true,
        shouldAutostartGuidedTour: true,
      }
    case 'companion_modal_did_dismiss':
      return {
        ...state,
        showCompanionInfoModal: false,
        allowCompanionInfoModalDismiss: false,
        pendingGuidedTourStart: action.shouldScheduleGuidedTour,
        shouldAutostartGuidedTour: false,
      }
    case 'guided_tour_resolved':
      return {
        ...state,
        pendingGuidedTourStart: false,
      }
    default:
      return state
  }
}

export function useStartupUiCoordinator({
  authState,
  isOfflineLocked,
  syncStatus,
  controller,
  history,
  location,
  getPreferences,
  hideSplashScreenSafely,
}: UseStartupUiCoordinatorOptions): StartupUiCoordinatorResult {
  const initialPathnameRef = useRef(location.pathname)
  const mountedRef = useRef(true)
  const startupValidationStartedRef = useRef(false)
  const startupBannerTimerRef = useRef<number | null>(null)
  const latestAuthenticatedRef = useRef(authState.isAuthenticated)
  const prevAuthenticatedRef = useRef(authState.isAuthenticated)
  const [state, dispatch] = useReducer(
    startupUiReducer,
    createInitialState(Boolean(getPreferences().token?.trim() && getPreferences().instance?.trim())),
  )

  useEffect(() => {
    latestAuthenticatedRef.current = authState.isAuthenticated
  }, [authState.isAuthenticated])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (startupBannerTimerRef.current !== null) {
        window.clearTimeout(startupBannerTimerRef.current)
        startupBannerTimerRef.current = null
      }
      destroyGuidedTour()
    }
  }, [])

  useEffect(() => {
    const wasAuthenticated = prevAuthenticatedRef.current
    prevAuthenticatedRef.current = authState.isAuthenticated

    if (!wasAuthenticated && authState.isAuthenticated) {
      dispatch({ type: 'auth_became_authenticated' })
      return
    }

    if (wasAuthenticated && !authState.isAuthenticated) {
      if (startupBannerTimerRef.current !== null) {
        window.clearTimeout(startupBannerTimerRef.current)
        startupBannerTimerRef.current = null
      }
      dispatch({ type: 'auth_became_unauthenticated' })
    }
  }, [authState.isAuthenticated])

  useEffect(() => {
    if (isOfflineLocked || !state.offlineModeAcknowledged) return

    queueMicrotask(() => {
      if (!mountedRef.current) return
      dispatch({ type: 'offline_lock_cleared' })
    })
  }, [isOfflineLocked, state.offlineModeAcknowledged])

  useEffect(() => {
    if (!state.shouldOpenCompanionInfo) return
    if (!authState.isAuthenticated) return
    if (location.pathname !== '/dashboard') return

    queueMicrotask(() => {
      if (!mountedRef.current) return
      dispatch({ type: 'open_companion_info' })
    })
  }, [authState.isAuthenticated, location.pathname, state.shouldOpenCompanionInfo])

  useEffect(() => {
    if (startupValidationStartedRef.current) return
    startupValidationStartedRef.current = true

    const prefs = getPreferences()
    const hasStoredSession = Boolean(prefs.token?.trim() && prefs.instance?.trim())
    if (!hasStoredSession) {
      hideSplashScreenSafely('no stored credentials')
      return
    }

    const pathname = initialPathnameRef.current
    if (pathname === '/' || pathname === '/login') {
      history.replace('/dashboard')
    }

    startupBannerTimerRef.current = window.setTimeout(() => {
      startupBannerTimerRef.current = null
      if (!mountedRef.current || !latestAuthenticatedRef.current) return
      dispatch({ type: 'show_connecting_banner' })
      hideSplashScreenSafely('connecting banner shown')
    }, 1000)

    void controller.validateSession()
      .then((result) => {
        if (!mountedRef.current) return
        if (result === 'unauthorized') {
          history.replace('/login')
          return
        }
        if (result === 'network_error' && !controller.isAuthenticated()) {
          history.replace('/login')
        }
      })
      .finally(() => {
        if (startupBannerTimerRef.current !== null) {
          window.clearTimeout(startupBannerTimerRef.current)
          startupBannerTimerRef.current = null
        }
        if (!mountedRef.current) return
        dispatch({ type: 'startup_validation_finished' })
        hideSplashScreenSafely('session validation finished')
      })
  }, [controller, getPreferences, hideSplashScreenSafely, history])

  useEffect(() => {
    if (!authState.isAuthenticated) {
      destroyGuidedTour()
    }
  }, [authState.isAuthenticated])

  useEffect(() => {
    if (!state.pendingGuidedTourStart) return
    if (syncStatus === 'idle' || syncStatus === 'syncing') return
    if (!authState.isAuthenticated || location.pathname !== '/dashboard') return

    void startGuidedTour()
      .catch((error) => {
        console.error('Failed to start guided tour:', error)
      })
      .finally(() => {
        if (!mountedRef.current) return
        dispatch({ type: 'guided_tour_resolved' })
      })
  }, [
    authState.isAuthenticated,
    location.pathname,
    state.pendingGuidedTourStart,
    syncStatus,
  ])

  const showOfflineModal =
    authState.isAuthenticated &&
    isOfflineLocked &&
    !state.offlineModeAcknowledged &&
    !state.isStartupValidationPending

  const acknowledgeOfflineMode = useCallback(() => {
    dispatch({ type: 'acknowledge_offline_mode' })
  }, [])

  const handleOfflineModalDidDismiss = useCallback(() => {
    dispatch({ type: 'offline_modal_did_dismiss' })
  }, [])

  const handleStartExploring = useCallback(() => {
    dispatch({ type: 'start_exploring' })
  }, [])

  const handleCompanionModalDidDismiss = useCallback(() => {
    dispatch({
      type: 'companion_modal_did_dismiss',
      shouldScheduleGuidedTour:
        state.shouldAutostartGuidedTour &&
        authState.isAuthenticated &&
        location.pathname === '/dashboard',
    })
  }, [
    authState.isAuthenticated,
    location.pathname,
    state.shouldAutostartGuidedTour,
  ])

  return {
    showConnectingBanner: state.showConnectingBanner,
    showOfflineModal,
    showCompanionInfoModal: state.showCompanionInfoModal,
    allowOfflineModalDismiss: state.allowOfflineModalDismiss,
    allowCompanionInfoModalDismiss: state.allowCompanionInfoModalDismiss,
    acknowledgeOfflineMode,
    handleOfflineModalDidDismiss,
    handleStartExploring,
    handleCompanionModalDidDismiss,
  }
}
