/**
 * Version Diff API Route Handler for Next.js
 *
 * Compares two versions of one document and returns a typed diff.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/versions/[kind]/[slug]/[id]/diff/route.ts
 * export { GET } from 'nextly/api/versions-diff';
 * // GET .../diff?from=3&to=7[&modifiedOnly=1]
 * ```
 *
 * @module api/versions-diff
 */

import { NextlyError } from "../errors/nextly-error";
import type { VersionScopeKind } from "../schemas/versions/types";

import { respondDoc } from "./response-shapes";
import {
  assertDiffVersionPair,
  diffDocumentVersions,
  requireRouteVersionReadAccess,
} from "./versions-access";
import { withErrorHandler } from "./with-error-handler";

// Re-export the response types so a consumer of this endpoint (including the
// admin renderer) can import them through the published package rather than
// deep-importing an internal module.
export type {
  ComparableStatus,
  DiffStatus,
  FieldDiff,
  FieldDisplay,
  GroupFieldDiff,
  ListFieldDiff,
  ListItemDiff,
  RelationTarget,
  RichTextAttrChange,
  RichTextBlockDiff,
  RichTextFieldDiff,
  SetFieldDiff,
  SourceFieldDiff,
  SourceLineDiff,
  TextFieldDiff,
  TextSegment,
  UnknownFieldDiff,
  ValueFieldDiff,
  VersionDiff,
} from "../domains/versions/diff/types";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{
    kind: string;
    slug: string;
    id: string;
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
 * GET handler returning a typed diff of versions `from` and `to`.
 *
 * The version pair is validated before the access gate so malformed input fails
 * fast. The gate confirms the caller may read the live document, and each
 * snapshot is redacted for the caller inside the shared core before the diff is
 * computed, so a diff never reveals a field a normal read would hide.
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    const { kind, slug, id } = await context.params;
    const scopeKind = parseScopeKind(kind);

    const query = new URL(request.url).searchParams;
    const from = Number(query.get("from"));
    const to = Number(query.get("to"));
    const modifiedOnly =
      query.get("modifiedOnly") === "1" || query.get("modifiedOnly") === "true";
    assertDiffVersionPair(from, to);

    const { user, authenticatedScope } = await requireRouteVersionReadAccess(
      request,
      scopeKind,
      slug,
      id
    );

    const diff = await diffDocumentVersions({
      scopeKind,
      slug,
      entryId: id,
      user,
      from,
      to,
      modifiedOnly,
      authenticatedScope,
    });

    return respondDoc(diff);
  }
);
