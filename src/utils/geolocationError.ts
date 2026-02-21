export interface GeolocationErrorInfo {
  title: string;
  description: string;
  instructions: string;
  iconColor: 'amber' | 'blue' | 'red';
}

/**
 * Capacitor geolocation plugin error codes (OS-PLUG-GLOC-XXXX).
 * Codes are shared across iOS and Android with a few platform-specific ones.
 */
const PERMISSION_DENIED_CODES = new Set(['0003', '0008']);
const LOCATION_DISABLED_CODES = new Set(['0007', '0009', '0016', '0017']);
const TIMEOUT_CODES = new Set(['0010']);
const PLAY_SERVICES_CODES = new Set(['0014', '0015']);

function extractCode(err: unknown): string | undefined {
  if (err == null) return undefined;
  if (typeof err === 'object' && 'code' in err) {
    const raw = String((err as Record<string, unknown>).code);
    const match = raw.match(/(\d{4})$/);
    return match ? match[1] : raw;
  }
  if (typeof err === 'string') {
    const match = err.match(/(\d{4})$/);
    return match ? match[1] : undefined;
  }
  return undefined;
}

function permissionDenied(platform: string): GeolocationErrorInfo {
  let instructions: string;
  if (platform === 'ios') {
    instructions =
      'Open Settings \u203a Privacy & Security \u203a Location Services \u203a SpeleoDB and select \u201cWhile Using the App\u201d.';
  } else if (platform === 'android') {
    instructions =
      'Open Settings \u203a Apps \u203a SpeleoDB \u203a Permissions \u203a Location and enable it.';
  } else {
    instructions = 'Allow location access in your browser when prompted.';
  }
  return {
    title: 'Location Permission Required',
    description:
      'SpeleoDB needs location permission to show your position on the map.',
    instructions,
    iconColor: 'amber',
  };
}

function locationDisabled(platform: string): GeolocationErrorInfo {
  let instructions: string;
  if (platform === 'ios') {
    instructions =
      'Open Settings \u203a Privacy & Security \u203a Location Services and turn it on.';
  } else if (platform === 'android') {
    instructions = 'Open Settings \u203a Location and turn it on.';
  } else {
    instructions =
      'Enable location services in your operating system settings.';
  }
  return {
    title: 'Location Services Disabled',
    description:
      "Your device\u2019s location services are turned off. The app cannot determine your position without them.",
    instructions,
    iconColor: 'amber',
  };
}

function timeout(): GeolocationErrorInfo {
  return {
    title: 'Could Not Determine Location',
    description:
      "The app couldn\u2019t get your position in time. This often happens indoors or in areas with poor GPS coverage.",
    instructions:
      'Try again outdoors or in an area with a clear view of the sky.',
    iconColor: 'blue',
  };
}

function playServices(): GeolocationErrorInfo {
  return {
    title: 'Google Play Services Required',
    description:
      'Location on this device requires Google Play Services, which is missing or outdated.',
    instructions:
      'Open the Google Play Store, search for \u201cGoogle Play Services\u201d, and update it. Then try again.',
    iconColor: 'red',
  };
}

function positionUnavailable(): GeolocationErrorInfo {
  return {
    title: 'Location Unavailable',
    description:
      'Something went wrong while trying to get your location.',
    instructions:
      'Make sure location is enabled and permissions are granted, then try again.',
    iconColor: 'red',
  };
}

/**
 * Sentinel value that callers can pass instead of fabricating a plugin Error
 * when `requestPermissions()` resolves with a non-granted status.
 */
export const PERMISSION_DENIED_SENTINEL = 'permission-denied' as const;

export function parseGeolocationError(
  err: unknown,
  platform: string,
): GeolocationErrorInfo {
  if (err === PERMISSION_DENIED_SENTINEL) return permissionDenied(platform);

  const code = extractCode(err);

  if (code && PERMISSION_DENIED_CODES.has(code)) return permissionDenied(platform);
  if (code && LOCATION_DISABLED_CODES.has(code)) return locationDisabled(platform);
  if (code && TIMEOUT_CODES.has(code)) return timeout();
  if (code && PLAY_SERVICES_CODES.has(code)) return playServices();

  return positionUnavailable();
}
