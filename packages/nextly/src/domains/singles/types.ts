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

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { RequestActor } from "../../auth/request-actor";
import type { StatusOption } from "../../lib/status-filter";
import type { RevalidationIntent } from "../../revalidation/types";

/**
 * User context for Single operations.
 */
export interface UserContext {
  /** User ID */
  id: string;

  /** User email */
  email?: string;

  /** Singular authorized role (the Direct API forwards only this). */
  role?: string;

  /**
   * Full authorized role set. The route path forwards the caller's decoded
   * roles so stored Single access rules (role-based) and the super-admin
   * bypass evaluate against the real authorized scope.
   */
  roles?: string[];

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
   * Locale for localized fields. Translatable fields resolve to this language
   * (with fallback) from the companion `single_<slug>_locales` table.
   */
  locale?: string;

  /**
   * Fallback control (i18n). `false` / `"none"` disables fallback — an
   * untranslated field returns empty instead of the default-locale value (so
   * the admin editor can show blanks for a language that hasn't been
   * translated yet). Otherwise the configured fallback chain + default locale
   * is used. Mirrors the collection read path.
   */
  fallbackLocale?: string | false;

  /**
   * When true, attach a per-locale `_translations` map (translated + status)
   * to the document for the admin's per-language status pills. No-op when the
   * Single isn't localized. Mirrors the collection read path.
   */
  translationStatus?: boolean;

  /** User context for access control and hooks. */
  user?: UserContext;

  /**
   * When true, bypass all RBAC access control checks.
   * @default true (when called via Direct API)
   */
  overrideAccess?: boolean;

  /**
   * Set by a route whose middleware already authenticated AND authorized the
   * caller. Skips only the redundant RBAC re-check, which resolves permissions
   * from the caller's stored roles and would otherwise reject an API key whose
   * scoped permissions differ from its creator's. Stored access rules still run.
   */
  routeAuthorized?: boolean;

  /**
   * The caller's authenticated scope. A scoped API key is judged on its OWN
   * read grant rather than the key owner's permissions, so a super-admin-owned
   * key does not skip a stored read rule.
   */
  authenticatedScope?: AuthenticatedScope;

  /**
   * Draft/Published filter override. Only effective when single.status === true.
   * - 'published' (default for public/untrusted callers): only return the
   *   document when its status is 'published'; otherwise return 404 (so a
   *   draft Single is invisible until published).
   * - 'draft': only return when status is 'draft'.
   * - 'all': return regardless of status.
   * Trusted callers (overrideAccess: true) default to 'all' if unset.
   */
  status?: StatusOption;

  /** Arbitrary data passed to hooks via context. */
  context?: Record<string, unknown>;
}

/**
 * Options for updating a Single document.
 */
export interface UpdateSingleOptions {
  /**
   * Set when this write restores an earlier version, recording which one on the
   * version it captures. Lineage cannot be inferred afterwards: a restore is an
   * ordinary write that happens to reproduce an earlier state.
   */
  sourceVersionNo?: number;
  /**
   * Locale for localized fields.
   * Reserved for future i18n support.
   */
  locale?: string;

  /** User context for access control and hooks. */
  user?: UserContext;

  /**
   * Who performed the write, for webhook/audit attribution. The transport
   * boundary resolves it (distinguishing a signed-in user from an API key
   * acting on their behalf); when absent the recorder falls back to `user`.
   * Parity with the collection write path's actor.
   */
  actor?: RequestActor;

  /**
   * When true, bypass all RBAC access control checks.
   * @default true (when called via Direct API)
   */
  overrideAccess?: boolean;

  /**
   * Set by the REST dispatcher: route-level auth already ran, so `overrideAccess`
   * is used to skip the RBAC re-check — but this is NOT a trusted-server read,
   * so the response is still redacted to what the user may read.
   */
  routeAuthorized?: boolean;

  /** Arbitrary data passed to hooks via context. */
  context?: Record<string, unknown>;

  /**
   * The caller's authenticated scope. For a scoped API-key REST write, the
   * publish/unpublish transition gate judges the key's OWN grants rather than
   * the key owner's RBAC.
   */
  authenticatedScope?: AuthenticatedScope;
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

  /**
   * Whether this write appended a durable outbox event, independent of
   * `success`. The update records the event inside its transaction, then runs
   * post-commit steps (afterChange/afterUpdate hooks, response expansion): if
   * one of those throws, the write is already committed but `success` is
   * reported `false`. Post-write side effects (the webhook fast-drain and
   * retention pass) key off this flag, not `success`, so a committed-but-
   * hook-failed write still gets its immediate delivery while a write that
   * recorded nothing (validation/access failure) does not. Mirrors
   * `CollectionServiceResult.eventRecorded`.
   */
  eventRecorded?: boolean;
  /**
   * The cache tags this write invalidates (`nextly:single:{slug}` plus any
   * configured extra tags), flushed post-commit through the registered
   * revalidator. Absent when the write recorded nothing or revalidation is
   * disabled for the single.
   */
  revalidationIntent?: RevalidationIntent;
}
