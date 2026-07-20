/**
 * Version History API Route Handler for Next.js
 *
 * Lists version metadata for one document. Snapshots are never included; use
 * the detail route to fetch one.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/versions/[kind]/[slug]/[id]/route.ts
 * export { GET } from 'nextly/api/versions';
 * ```
 *
 * @module api/versions
 */

import { getService } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { VersionScopeKind } from "../schemas/versions/types";

import { respondList } from "./response-shapes";
import { requireRouteCollectionAccess } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ kind: string; slug: string; id: string }>;
}

/**
 * Narrow the path segment to a routable scope kind. `page` exists in the
 * version scope union but has no HTTP surface yet, so it is rejected here
 * rather than reaching the service.
 */
function parseScopeKind(kind: string): VersionScopeKind {
  if (kind === "collection" || kind === "single") return kind;
  throw NextlyError.validation({
    errors: [
      {
        path: "kind",
        code: "INVALID_VALUE",
        message: 'Version scope must be "collection" or "single".',
      },
    ],
  });
}

/** Parse an optional positive-integer query parameter, rejecting junk. */
function parsePositiveInt(
  raw: string | null,
  name: string
): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw NextlyError.validation({
      errors: [
        {
          path: name,
          code: "INVALID_VALUE",
          message: `${name} must be a positive integer.`,
        },
      ],
    });
  }
  return value;
}

/**
 * GET handler listing version metadata, newest-first.
 *
 * Reading history requires only read access on the document: the list exposes
 * no content, just metadata. Path and query parameters are validated before the
 * access check so malformed input fails fast without an auth round-trip.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    const { kind, slug, id } = await context.params;
    const scopeKind = parseScopeKind(kind);

    const url = new URL(request.url);
    const limit = parsePositiveInt(url.searchParams.get("limit"), "limit");
    const cursor = parsePositiveInt(url.searchParams.get("cursor"), "cursor");

    await requireRouteCollectionAccess(request, "read", slug);

    await getCachedNextly();
    const versions = getService("versionsService");

    const rows = await versions.list(
      { scopeKind, scopeSlug: slug, entryId: id },
      {
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      }
    );

    // Keyset pagination: page/totalPages are not meaningful for a cursor walk,
    // so the meta reports the returned window and whether another page may
    // follow (a full page implies there may be more).
    const pageSize = limit ?? rows.length;
    return respondList(rows, {
      total: rows.length,
      page: 1,
      limit: pageSize,
      totalPages: 1,
      hasNext: pageSize > 0 && rows.length === pageSize,
      hasPrev: cursor !== undefined,
    });
  }
);
