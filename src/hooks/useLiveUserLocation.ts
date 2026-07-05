import { useCallback, useEffect, useRef, useState } from 'react';
import { GPS } from '../constants';
import type { LocationWatcher } from '../services/GeolocationWatcher';
import type { UserMapLocation } from '../types/userLocation';
import { PERMISSION_DENIED_SENTINEL } from '../utils/geolocationError';
import { toUserMapLocation } from '../utils/userLocation';

export interface LiveUserLocationOptions {
  runtimeActive: boolean;
  watcher: LocationWatcher;
  onFirstFix: (location: UserMapLocation) => void;
}

export interface LiveUserLocationState {
  location: UserMapLocation | null;
  locationModeActive: boolean;
  isLocating: boolean;
  error: unknown;
  toggleLocationMode: () => void;
  dismissError: () => void;
}

export function useLiveUserLocation({
  runtimeActive,
  watcher,
  onFirstFix,
}: LiveUserLocationOptions): LiveUserLocationState {
  const [location, setLocation] = useState<UserMapLocation | null>(null);
  const [locationModeActive, setLocationModeActive] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const enabledRef = useRef(false);
  const activationPendingRef = useRef(false);
  const runtimeActiveRef = useRef(runtimeActive);
  const runningRef = useRef(false);
  const centerNextFixRef = useRef(false);
  const activationGenerationRef = useRef(0);
  const watchGenerationRef = useRef(0);
  const firstFixCallbackRef = useRef(onFirstFix);

  useEffect(() => {
    firstFixCallbackRef.current = onFirstFix;
    runtimeActiveRef.current = runtimeActive;
  }, [onFirstFix, runtimeActive]);

  const stopWatch = useCallback(() => {
    watchGenerationRef.current += 1;
    runningRef.current = false;
    void watcher.stop();
  }, [watcher]);

  const fail = useCallback((nextError: unknown) => {
    activationGenerationRef.current += 1;
    watchGenerationRef.current += 1;
    activationPendingRef.current = false;
    enabledRef.current = false;
    runningRef.current = false;
    centerNextFixRef.current = false;
    setLocationModeActive(false);
    setIsLocating(false);
    setLocation(null);
    setError(nextError);
    void watcher.stop();
  }, [watcher]);

  const startWatch = useCallback(() => {
    if (runningRef.current || !enabledRef.current || !runtimeActiveRef.current) return;
    runningRef.current = true;
    const generation = ++watchGenerationRef.current;
    if (centerNextFixRef.current) setIsLocating(true);

    void watcher.start(
      { ...GPS.LIVE_LOCATION_WATCH_OPTIONS },
      (point) => {
        if (
          generation !== watchGenerationRef.current ||
          !enabledRef.current ||
          !runtimeActiveRef.current
        ) return;
        const nextLocation = toUserMapLocation(point.longitude, point.latitude);
        if (!nextLocation) return;
        setLocation(nextLocation);
        if (centerNextFixRef.current) {
          centerNextFixRef.current = false;
          setIsLocating(false);
          firstFixCallbackRef.current(nextLocation);
        }
      },
      (watchError) => {
        if (generation === watchGenerationRef.current) fail(watchError);
      },
    ).catch((watchError: unknown) => {
      if (generation === watchGenerationRef.current) fail(watchError);
    });
  }, [fail, watcher]);

  const deactivate = useCallback(() => {
    activationGenerationRef.current += 1;
    activationPendingRef.current = false;
    enabledRef.current = false;
    centerNextFixRef.current = false;
    setLocationModeActive(false);
    setIsLocating(false);
    setLocation(null);
    stopWatch();
  }, [stopWatch]);

  const activate = useCallback(() => {
    const generation = ++activationGenerationRef.current;
    activationPendingRef.current = true;
    centerNextFixRef.current = true;
    setError(null);
    setIsLocating(true);

    void watcher.requestPermissions().then((permission) => {
      if (
        generation !== activationGenerationRef.current ||
        !activationPendingRef.current
      ) return;
      activationPendingRef.current = false;
      if (permission !== 'granted') {
        fail(PERMISSION_DENIED_SENTINEL);
        return;
      }
      enabledRef.current = true;
      setLocationModeActive(true);
      if (!runtimeActiveRef.current) setIsLocating(false);
      else startWatch();
    }).catch((permissionError: unknown) => {
      if (generation === activationGenerationRef.current) fail(permissionError);
    });
  }, [fail, startWatch, watcher]);

  const toggleLocationMode = useCallback(() => {
    if (enabledRef.current || activationPendingRef.current) deactivate();
    else activate();
  }, [activate, deactivate]);

  useEffect(() => {
    if (!locationModeActive) return;
    if (runtimeActive) startWatch();
    else stopWatch();
  }, [locationModeActive, runtimeActive, startWatch, stopWatch]);

  useEffect(() => () => {
    activationGenerationRef.current += 1;
    enabledRef.current = false;
    stopWatch();
  }, [stopWatch]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    location,
    locationModeActive,
    isLocating,
    error,
    toggleLocationMode,
    dismissError,
  };
}
