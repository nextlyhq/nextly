/**
 * Singles Domain Types
 *
 * Shared type definitions used by SingleEntryService, SingleQueryService,
 * SingleMutationService, and SingleRegistryService. Extracted here so the
 * split services can reference the same interfaces without circular imports.
 *
 * @module domains/singles/types
 * @since 1.0.0
 */

/**
 * User context for Single operations.
 */
export interface UserContext {
  /** User ID */
  id: string;

  /** User email */
  email?: string;

  /** Additional user properties */
  [key: string]: unknown;
}

/**
 * Options for getting a Single document.
 */
export interface GetSingleOptions {
  /**
   * Depth for relationship expansion.
   * @default 2
   */
  depth?: number;

  /**
   * Locale for localized fields.
   * Reserved for future i18n support.
   */
  locale?: string;

  /** User context for access control and hooks. */
  user?: UserContext;

  /**
   * When true, bypass all RBAC access control checks.
   * @default true (when called via Direct API)
   */
  overrideAccess?: boolean;

  /** Arbitrary data passed to hooks via context. */
  context?: Record<string, unknown>;
}

/**
 * Options for updating a Single document.
 */
export interface UpdateSingleOptions {
  /**
   * Locale for localized fields.
   * Reserved for future i18n support.
   */
  locale?: string;

  /** User context for access control and hooks. */
  user?: UserContext;

  /**
   * When true, bypass all RBAC access control checks.
   * @default true (when called via Direct API)
   */
  overrideAccess?: boolean;

  /** Arbitrary data passed to hooks via context. */
  context?: Record<string, unknown>;
}

/**
 * Single document shape. All Singles have at least an id and updatedAt.
 */
export interface SingleDocument {
  /** Document ID (UUID) */
  id: string;

  /** Last update timestamp */
  updatedAt: Date | string;

  /** Additional fields defined by the Single schema */
  [key: string]: unknown;
}

/**
 * Result of a Single operation.
 */
export interface SingleResult<T = SingleDocument> {
  /** Whether the operation succeeded */
  success: boolean;

  /** HTTP status code */
  statusCode: number;

  /** The Single document data (on success) */
  data?: T;

  /** Error message (on failure) */
  message?: string;

  /** Error details (on failure) */
  errors?: Array<{ field?: string; message: string }>;
}
