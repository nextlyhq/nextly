/**
 * Single Version API Route Handler for Next.js
 *
 * Returns one version including its snapshot.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/versions/[kind]/[slug]/[id]/[versionNo]/route.ts
 * export { GET } from 'nextly/api/versions-detail';
 * ```
 *
 * @module api/versions-detail
 */

import { getService } from "../di";
import { NextlyError } from "../errors/nextly-error";
import type { VersionScopeKind } from "../schemas/versions/types";

import { respondDoc } from "./response-shapes";
import {
  redactSnapshotForUser,
  requireRouteVersionReadAccess,
} from "./versions-access";
import { withErrorHandler } from "./with-error-handler";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{
    kind: string;
    slug: string;
    id: string;
    versionNo: string;
  }>;
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

/**
 * GET handler returning one version with its snapshot.
 *
 * Both path parameters are validated before the access gate so malformed input
 * fails fast. The gate confirms the caller may read the live document (which is
 * what applies owner-only rules and status filtering), and the snapshot is then
 * passed through field-level read redaction — a stored snapshot must never
 * reveal a field a normal read would hide.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    const { kind, slug, id, versionNo } = await context.params;
    const scopeKind = parseScopeKind(kind);

    const parsed = Number(versionNo);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw NextlyError.validation({
        errors: [
          {
            path: "versionNo",
            code: "INVALID_VALUE",
            message: "Version number must be a positive integer.",
          },
        ],
      });
    }

    const user = await requireRouteVersionReadAccess(
      request,
      scopeKind,
      slug,
      id
    );

    const versions = getService("versionsService");
    const row = await versions.get(
      { scopeKind, scopeSlug: slug, entryId: id },
      parsed
    );

    await redactSnapshotForUser(row.snapshot, scopeKind, slug, user);

    return respondDoc(row);
  }
);
