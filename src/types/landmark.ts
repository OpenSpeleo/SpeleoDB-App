/**
 * Type definitions for landmark CRUD against the SpeleoDB backend.
 *
 * - `LandmarkApiObject` mirrors the `{ landmark: {...} }` payload returned by
 *   POST /api/v2/landmarks/ and PATCH /api/v2/landmarks/<id>/.
 * - `LandmarkCollection` mirrors an entry from GET /api/v2/landmark-collections/.
 *
 * See docs/landmark-crud.md.
 */

// ==================== API objects ====================

export interface LandmarkApiObject {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  collection: string;
  collection_name?: string;
  collection_color?: string;
  is_personal_collection?: boolean;
  can_write?: boolean;
  can_delete?: boolean;
  created_by?: string;
  creation_date?: string;
  modified_date?: string;
}

export interface LandmarkCollection {
  id: string;
  name: string;
  color: string;
  isPersonal: boolean;
  canWrite: boolean;
}

// ==================== Mutation inputs ====================

export interface LandmarkCreateInput {
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  /** Omit or set null to use the user's personal collection. */
  collection?: string | null;
}

export interface LandmarkUpdateInput {
  name?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  collection?: string | null;
}

// ==================== Errors ====================

/** Why a CRUD attempt failed, mapped to a user-facing message kind. */
export type LandmarkMutationErrorKind =
  | 'offline'
  | 'validation'
  | 'duplicate'
  | 'permission'
  | 'not_found'
  | 'network'
  | 'unknown';

export class LandmarkMutationError extends Error {
  readonly kind: LandmarkMutationErrorKind;
  /** Per-field validation messages, when the backend returned `{ errors }`. */
  readonly fieldErrors?: Record<string, string[]>;
  readonly status?: number;

  constructor(
    kind: LandmarkMutationErrorKind,
    message: string,
    options?: { fieldErrors?: Record<string, string[]>; status?: number },
  ) {
    super(message);
    this.name = 'LandmarkMutationError';
    this.kind = kind;
    this.fieldErrors = options?.fieldErrors;
    this.status = options?.status;
  }
}
