/**
 * Shared type definitions for the SpeleoDB application.
 * All layers (services, controllers, context, pages) import from here.
 */

// ==================== User ====================

export interface User {
  id: string;
  email: string;
  name: string;
  country?: string;
}

// ==================== Auth ====================

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
  instance: string;
}

export interface OAuthTokenCredentials {
  token: string;
  instance: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  user?: User;
  token?: string;
}

/**
 * Shape returned by the Django auth-token endpoint.
 */
export interface AuthTokenResponse {
  user: string;
  token: string;
}

export type {
  MapOverlayDefinition,
  MapOverlayGeoJsonRecord,
  MapOverlayId,
  MapOverlayLegendItem,
} from './mapOverlay';

export { MAP_OVERLAY_IDS } from './mapOverlay';

export type {
  ProjectGeoJSONAnalysis,
  ProjectGeoJSONBounds,
  ProjectGeoJSONCacheRecord,
  ProjectGeoJSONFailureReason,
  ProjectGeoJSONMapData,
  ProjectGeoJSONWarning,
} from './projectGeoJSON';
