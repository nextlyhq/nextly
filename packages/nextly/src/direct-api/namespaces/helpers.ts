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

import { NextlyError } from "../../errors/nextly-error";
import type { RequestContext } from "../../shared/types/index";
import type {
  ComponentDefinition,
  DirectAPIConfig,
  Permission,
  Role,
  SingleDefinition,
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
      email: "",
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
  message: string;
  data: unknown;
}

/**
 * Convert a failed service-layer result into a `NextlyError`.
 */
export function createErrorFromResult(result: ServiceResultLike): NextlyError {
  return new NextlyError({
    code: statusCodeToErrorCode(result.statusCode),
    publicMessage: result.message,
    statusCode: result.statusCode,
    logContext:
      result.data !== undefined && result.data !== null
        ? { resultData: result.data }
        : undefined,
  });
}

/**
 * Shape of a failed single-entry service result.
 */
export interface SingleResultLike {
  success: boolean;
  statusCode: number;
  message?: string;
  errors?: Array<{ field?: string; message: string }>;
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

  if (result.statusCode === 400 && result.errors && result.errors.length > 0) {
    return NextlyError.validation({
      errors: result.errors.map(e => ({
        path: e.field ?? "",
        code: "VALIDATION_ERROR",
        message: e.message,
      })),
    });
  }

  return new NextlyError({
    code: statusCodeToErrorCode(result.statusCode),
    publicMessage: message,
    statusCode: result.statusCode,
  });
}

/**
 * Map an HTTP status code to a canonical `NextlyErrorCode` string.
 */
export function statusCodeToErrorCode(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "AUTH_REQUIRED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    default:
      return "INTERNAL_ERROR";
  }
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
 * Shape of a raw component record as returned by the component registry service.
 */
export interface RawComponentRecord {
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
 * Normalize a raw component record into the public `ComponentDefinition` type.
 */
export function mapComponentRecord(
  record: RawComponentRecord
): ComponentDefinition {
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
    admin: record.admin as ComponentDefinition["admin"],
    source: record.source as "code" | "ui",
    locked: record.locked,
    configPath: record.configPath ?? undefined,
    schemaHash: record.schemaHash,
    schemaVersion: record.schemaVersion,
    migrationStatus:
      record.migrationStatus as ComponentDefinition["migrationStatus"],
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
 * Map a service-layer `{ data, pagination }` tuple into the Direct API
 * `PaginatedResponse` shape.
 *
 * Extracted to eliminate the duplicated hand-rolled mapping across the users,
 * media, emailProviders, emailTemplates, and userFields namespaces.
 */
export function toPaginatedResponse<T>(
  result: PaginatedServiceResult<T>,
  limit: number,
  page: number
): import("../types/index").PaginatedResponse<T> {
  const totalDocs = result.pagination.total;
  const totalPages = Math.ceil(totalDocs / limit);

  return {
    docs: result.data,
    totalDocs,
    limit,
    page,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    nextPage: page < totalPages ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
    pagingCounter: (page - 1) * limit + 1,
  };
}

/**
 * Map an in-memory array into a Direct API `PaginatedResponse`, slicing
 * according to the requested `limit` / `page`.
 *
 * Used by namespaces whose service layer does not natively paginate
 * (emailProviders, emailTemplates, userFields).
 */
export function slicePaginatedResponse<T>(
  items: T[],
  limit: number | undefined,
  page: number | undefined
): import("../types/index").PaginatedResponse<T> {
  const effectiveLimit = limit ?? items.length;
  const effectivePage = page ?? 1;
  const start = (effectivePage - 1) * effectiveLimit;
  const paged = items.slice(start, start + effectiveLimit);
  const totalDocs = items.length;
  const totalPages =
    effectiveLimit > 0 ? Math.ceil(totalDocs / effectiveLimit) : 1;

  return {
    docs: paged,
    totalDocs,
    limit: effectiveLimit,
    page: effectivePage,
    totalPages,
    hasNextPage: effectivePage < totalPages,
    hasPrevPage: effectivePage > 1,
    nextPage: effectivePage < totalPages ? effectivePage + 1 : null,
    prevPage: effectivePage > 1 ? effectivePage - 1 : null,
    pagingCounter: start + 1,
  };
}
