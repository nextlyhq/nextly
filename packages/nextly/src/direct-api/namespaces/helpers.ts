/**
 * Direct API Namespace Helpers
 *
 * Pure utility functions shared by every namespace module. Contains config
 * merging, error conversion, ID/slug heuristics, and record-to-public-type
 * mappers. None of these helpers close over instance state — callers pass in
 * whatever they need (default config, raw record, etc.).
 *
 * @packageDocumentation
 */

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { errorFromServiceEnvelope } from "../../errors/from-service-envelope";
import { NextlyError } from "../../errors/nextly-error";
import type { RequestContext } from "../../shared/types/index";
import type {
  DirectAPIConfig,
  FieldGroupDefinition,
  ListResult,
  Permission,
  Role,
  SingleDefinition,
  UserContext,
} from "../types/index";

/**
 * Merge operation-specific config with the Direct API's default config.
 *
 * Operation-level options win; defaults fill in the rest (e.g. `overrideAccess`
 * defaults to `true` unless the call sets it to `false`).
 */
export function mergeConfig<T extends DirectAPIConfig>(
  defaultConfig: DirectAPIConfig,
  args: T
): T & DirectAPIConfig {
  return {
    ...defaultConfig,
    ...args,
  };
}

/**
 * Every field a service needs to decide whether this caller may see a row.
 */
export interface AccessOptions {
  user?: UserContext;
  overrideAccess?: boolean;
  authenticatedScope?: AuthenticatedScope;
}

/**
 * The access-bearing fields of a Direct API call, as one spreadable object.
 *
 * `user` says WHO is calling; `authenticatedScope` says what kind of caller and
 * which grants the API KEY itself carries, which is what stops an update-only
 * key from reading on the strength of its owner's permissions. The two travel
 * together because a service that receives one without the other judges a
 * scoped key by its owner — the exact leak this exists to close.
 *
 * Spread this rather than listing the fields inline: an operation that forwards
 * `user` but not `authenticatedScope` compiles, runs, and silently authorizes
 * the key as its owner. `access-options-seam.test.ts` fails the build if a
 * namespace hand-writes them instead.
 */
export function accessOptions(config: DirectAPIConfig): AccessOptions {
  return {
    user: config.user,
    overrideAccess: config.overrideAccess,
    authenticatedScope: config.actor,
  };
}

/**
 * Build a RequestContext for downstream services from a Direct API call.
 *
 * Maps the narrow `DirectAPIConfig.user` shape to the richer `RequestContext`
 * expected by service-layer methods, supplying safe defaults for fields that
 * aren't available in a Direct API context.
 */
export function createRequestContext(args: DirectAPIConfig): RequestContext {
  if (!args.user) {
    return { locale: args.locale };
  }

  return {
    user: {
      id: args.user.id,
      // Preserve the caller's real email so email-based access rules match.
      email: typeof args.user.email === "string" ? args.user.email : "",
      role: args.user.role ?? "user",
      permissions: [],
    },
    locale: args.locale,
  };
}

/**
 * Shape of a generic service result used by the Direct API error converter.
 */
export interface ServiceResultLike {
  success: boolean;
  statusCode: number;
  /**
   * Canonical `NextlyError` code carried by envelopes that originate from a
   * NextlyError. Preferred over the status-derived fallback because one
   * status can cover several codes (409 is both DUPLICATE and CONFLICT).
   */
  code?: string;
  message: string;
  /** Translation key for the public message, when the thrower set one. */
  messageKey?: string;
  /** The error's own public data -- a rate limit's retry interval, and such. */
  publicData?: unknown;
  data: unknown;
  errors?: Array<{ path: string; code: string; message: string }>;
}

/**
 * Convert a failed service-layer result into a `NextlyError`.
 */
export function createErrorFromResult(result: ServiceResultLike): NextlyError {
  // The shared converter, so a Direct API caller and a REST caller are handed
  // the same error for the same failure. Its code-keyed rebuild carries the
  // message key and public data that this boundary used to drop.
  //
  // The rebuilt error is right for the caller and blind for whoever debugs it:
  // the driver error underneath and the identifiers the thrower attached were
  // dropped on the way through the public envelope. The converter chains the
  // original back on as `cause` by reading it off the envelope, and the spread
  // below is what carries it there — it is an enumerable own property, so it
  // survives into the object handed over.
  return errorFromServiceEnvelope(result, {
    // The service's own text, kept for the operator. A code-less failure now
    // answers with a generic sentence, because its message may be a raw
    // exception's; withholding it from the caller is the point, and discarding
    // it as well would make exactly those failures undiagnosable.
    legacyMessage: result.message,
    ...(result.data !== undefined && result.data !== null
      ? { resultData: result.data }
      : {}),
  });
}

/**
 * Shape of a failed single-entry service result.
 */
export interface SingleResultLike {
  success: boolean;
  statusCode: number;
  /** Canonical `NextlyError` code, when the envelope came from one. */
  code?: string;
  message?: string;
  /** Translation key for the public message. */
  messageKey?: string;
  /** The error's own public data -- a rate limit's retry interval, and such. */
  publicData?: unknown;
  errors?: Array<{ field?: string; code?: string; message: string }>;
}

/**
 * Convert a failed single-entry service result into a `NextlyError`.
 */
export function createErrorFromSingleResult(
  result: SingleResultLike
): NextlyError {
  const message =
    result.message ||
    result.errors?.map(e => e.message).join(", ") ||
    "Operation failed";

  // The shared converter, so a Single failure reaches a Direct API caller as
  // the same error a REST caller gets. Rebuilding from status alone dropped the
  // message key and the public data -- a rate limit's retry interval among it.
  return errorFromServiceEnvelope(
    {
      ...result,
      message,
      // Normalised to the canonical shape; SingleResult still emits `{field}`.
      errors: result.errors?.map(e => ({
        path: e.field,
        // The per-field reason travels with the issue; dropping it here would
        // have the converter substitute a generic one.
        code: e.code,
        message: e.message,
      })),
    },
    // The NORMALISED message, not `result.message`. A Single failure may omit
    // the top-level one and carry per-field `errors` instead, in which case the
    // text above is synthesised from them -- and that synthesised text is what
    // the converter replaces with a generic sentence for a non-validation
    // status. Logging the raw field would record `undefined` in exactly the
    // case where the caller's text was withheld.
    { legacyMessage: message }
  );
}

/**
 * Returns `true` when the thrown value represents a "not found" outcome.
 *
 * Used to honor the `disableErrors` flag on find operations so callers get
 * `null` instead of an exception. Uses the canonical type guard so the check
 * survives package-boundary identity issues (when one consumer's NextlyError
 * is a different module instance from ours, instanceof returns false).
 */
export function isNotFoundError(error: unknown): boolean {
  return NextlyError.isNotFound(error);
}

/**
 * Heuristic test: does this string look like an ID (UUID, numeric, or CUID)
 * rather than a slug? Used by forms to decide whether to resolve by slug first.
 */
export function looksLikeId(value: string): boolean {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    return true;
  }

  if (/^\d+$/.test(value)) {
    return true;
  }

  if (/^c[a-z0-9]{24,}$/i.test(value)) {
    return true;
  }

  return false;
}

/**
 * Shape of a raw role record as returned by the service layer.
 *
 * SQLite stores booleans as `0`/`1`, so `isSystem` can be either `boolean` or
 * `number`; the mapper normalizes it to `boolean`.
 */
export interface RawRoleRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  level: number;
  isSystem: boolean | number;
}

/**
 * Normalize a raw role record from the service layer into the public `Role` type.
 */
export function mapRole(role: RawRoleRecord): Role {
  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description ?? null,
    level: role.level,
    isSystem: Boolean(role.isSystem),
  };
}

/**
 * Shape of a raw permission record as returned by the service layer.
 */
export interface RawPermissionRecord {
  id: string;
  name: string;
  slug: string;
  action: string;
  resource: string;
  description?: string | null;
}

/**
 * Normalize a raw permission record from the service layer into the public
 * `Permission` type.
 */
export function mapPermission(perm: RawPermissionRecord): Permission {
  return {
    id: perm.id,
    name: perm.name,
    slug: perm.slug,
    action: perm.action,
    resource: perm.resource,
    description: perm.description ?? null,
  };
}

/**
 * Shape of a raw field group record as returned by the registry service.
 */
export interface RawFieldGroupRecord {
  id: string;
  slug: string;
  label: string;
  tableName: string;
  description?: string | null;
  fields: unknown;
  admin?: unknown;
  source: string;
  locked: boolean;
  configPath?: string | null;
  schemaHash: string;
  schemaVersion: number;
  migrationStatus: string;
  lastMigrationId?: string | null;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Normalize a raw field group record into the public `FieldGroupDefinition` type.
 */
export function mapFieldGroupRecord(
  record: RawFieldGroupRecord
): FieldGroupDefinition {
  return {
    id: record.id,
    slug: record.slug,
    label: record.label,
    tableName: record.tableName,
    description: record.description ?? undefined,
    fields: (Array.isArray(record.fields) ? record.fields : []) as Record<
      string,
      unknown
    >[],
    admin: record.admin as FieldGroupDefinition["admin"],
    source: record.source as "code" | "ui",
    locked: record.locked,
    configPath: record.configPath ?? undefined,
    schemaHash: record.schemaHash,
    schemaVersion: record.schemaVersion,
    migrationStatus:
      record.migrationStatus as FieldGroupDefinition["migrationStatus"],
    lastMigrationId: record.lastMigrationId ?? undefined,
    createdBy: record.createdBy ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Shape of a raw single (global) record as returned by the single registry.
 */
export interface RawSingleRecord {
  id: string;
  slug: string;
  label: string;
  tableName: string;
  fields: unknown;
  source: string;
  locked: boolean;
  configPath?: string | null;
  schemaHash: string;
  schemaVersion: number;
  migrationStatus: string;
  lastMigrationId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Normalize a raw single (global) record into the public `SingleDefinition` type.
 */
export function mapSingleRecord(record: RawSingleRecord): SingleDefinition {
  return {
    id: record.id,
    slug: record.slug,
    label: record.label,
    tableName: record.tableName,
    fields: (Array.isArray(record.fields) ? record.fields : []) as Record<
      string,
      unknown
    >[],
    source: record.source as "code" | "ui" | "built-in",
    locked: record.locked,
    configPath: record.configPath ?? undefined,
    schemaHash: record.schemaHash,
    schemaVersion: record.schemaVersion,
    migrationStatus:
      record.migrationStatus as SingleDefinition["migrationStatus"],
    lastMigrationId: record.lastMigrationId ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Shape of a service-layer paginated result used by several namespaces.
 */
export interface PaginatedServiceResult<T> {
  data: T[];
  pagination: { total: number };
}

/**
 * Map a service-layer `{ data, pagination }` tuple into the canonical
 * Direct API `ListResult<T>` shape (`{ items, meta }`).
 *
 * that returned Payload's `{ docs, totalDocs, ... }` shape. The service
 * layer's `pagination.total` maps to `meta.total`; `meta.limit` is the
 * caller-supplied page size, and `meta.totalPages` is recomputed here so
 * we never hand back `0` (clamps to 1 minimum, matching the wire-side
 * `respondList` calculation).
 */
export function toListResult<T>(
  result: PaginatedServiceResult<T>,
  limit: number,
  page: number
): ListResult<T> {
  const total = result.pagination.total;
  // Clamp totalPages to 1 minimum so an empty page-1 result still has a
  // sensible page count (matches wire-side `respondList` behavior).
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    items: result.data,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Map an in-memory array into a canonical `ListResult<T>` envelope,
 * slicing the array according to the requested `limit` / `page`.
 *
 * Used by namespaces whose service layer does not natively paginate
 * (emailProviders, emailTemplates, userFields).
 */
export function sliceListResult<T>(
  items: T[],
  limit: number | undefined,
  page: number | undefined
): ListResult<T> {
  const effectiveLimit = limit ?? items.length;
  const effectivePage = page ?? 1;
  const start = (effectivePage - 1) * effectiveLimit;
  const paged = items.slice(start, start + effectiveLimit);
  const total = items.length;
  const totalPages =
    effectiveLimit > 0 ? Math.max(1, Math.ceil(total / effectiveLimit)) : 1;

  return {
    items: paged,
    meta: {
      total,
      page: effectivePage,
      limit: effectiveLimit,
      totalPages,
      hasNext: effectivePage < totalPages,
      hasPrev: effectivePage > 1,
    },
  };
}

/**
 * Build a per-collection mutation message string (e.g. `"Posts created."`).
 * Centralized so every namespace that returns `MutationResult` produces a
 * consistent, capitalized, full-sentence value.
 */
export function buildMutationMessage(
  collection: string,
  verb: "created" | "updated" | "deleted" | "duplicated"
): string {
  const noun = collection.charAt(0).toUpperCase() + collection.slice(1);
  return `${noun} ${verb}.`;
}
