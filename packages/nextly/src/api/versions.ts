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
import type { VersionScopeKind } from "../schemas/versions/types";

import { respondList } from "./response-shapes";
import { requireVersionReadAccess } from "./versions-access";
import { withErrorHandler } from "./with-error-handler";

/** Page size when the caller does not ask for one. */
const DEFAULT_LIMIT = 25;

/** Hard ceiling, so one request cannot serialize an unbounded history. */
const MAX_LIMIT = 100;

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
 * Path and query parameters are validated before the access gate so malformed
 * input fails fast. The gate then confirms the caller may read the live
 * document: history metadata (authors, timestamps, how often a document
 * changed) is itself disclosure, so it is restricted exactly as the document is.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    const { kind, slug, id } = await context.params;
    const scopeKind = parseScopeKind(kind);

    const url = new URL(request.url);
    const requestedLimit = parsePositiveInt(
      url.searchParams.get("limit"),
      "limit"
    );
    const cursor = parsePositiveInt(url.searchParams.get("cursor"), "cursor");

    // Always bounded: an unset limit still pages, and an oversized one is
    // clamped, so no single request can serialize an entire long history.
    const limit = Math.min(requestedLimit ?? DEFAULT_LIMIT, MAX_LIMIT);

    await requireVersionReadAccess(request, scopeKind, slug, id);

    const versions = getService("versionsService");
    const rows = await versions.list(
      { scopeKind, scopeSlug: slug, entryId: id },
      { limit, ...(cursor !== undefined ? { cursor } : {}) }
    );

    // Keyset pagination: page/totalPages are not meaningful for a cursor walk,
    // so the meta describes the returned window. A full page implies another
    // page may follow; a short page proves it does not.
    return respondList(rows, {
      total: rows.length,
      page: 1,
      limit,
      totalPages: 1,
      hasNext: rows.length === limit,
      hasPrev: cursor !== undefined,
    });
  }
);
