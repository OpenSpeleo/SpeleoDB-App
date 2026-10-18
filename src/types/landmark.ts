import type { Landmark, LandmarkRequest, PatchedLandmarkRequest } from '@speleodb/api';

/**
 * Durable normalized landmark snapshot. Metadata and icon were absent in older
 * records; collection is normalized to a string by the storage admission layer.
 * These compatibility differences do not weaken the generated wire contract.
 */
type SnapshotMetadata = Pick<Landmark,
  'icon' | 'collection_name' | 'collection_color' | 'can_write' | 'can_delete'
  | 'created_by' | 'creation_date' | 'modified_date'
>;
export type LandmarkApiObject = Pick<Landmark,
  'id' | 'name' | 'description' | 'latitude' | 'longitude'
> & Partial<{ [K in keyof SnapshotMetadata]: NonNullable<SnapshotMetadata[K]> }> & {
  collection: string;
  is_personal_collection?: boolean;
};

export interface LandmarkCollection {
  id: string;
  name: string;
  color: string;
  isPersonal: boolean;
  canWrite: boolean;
}

// ==================== Mutation inputs ====================

/** UI and durable queue inputs normalize coordinate strings to numbers. */
export type LandmarkCreateInput = Omit<LandmarkRequest, 'latitude' | 'longitude'> & {
  latitude: number;
  longitude: number;
};
export type LandmarkUpdateInput = Omit<PatchedLandmarkRequest, 'latitude' | 'longitude'> & {
  latitude?: number;
  longitude?: number;
};

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
