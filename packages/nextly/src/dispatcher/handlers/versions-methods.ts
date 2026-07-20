/**
 * Version-history reads for the dispatcher.
 *
 * The admin talks to the catch-all handler rather than the standalone route
 * exports, so version history needs a dispatcher surface too. Both surfaces
 * share the document gate and the snapshot-preparation step from
 * `api/versions-access`, so the access rules have exactly one definition.
 *
 * @module dispatcher/handlers/versions-methods
 */

import type { PaginationMeta } from "../../api/response-shapes";
import {
  assertVersionDocumentReadable,
  prepareSnapshotForUser,
} from "../../api/versions-access";
import { getService } from "../../di";
import type { UserContext } from "../../domains/singles/types";
import {
  attachVersionAuthors,
  type VersionMetaWithAuthor,
} from "../../domains/versions/author-hydration";
import type { VersionRow } from "../../domains/versions/versions-repository";
import { NextlyError } from "../../errors/nextly-error";
import type { VersionScopeKind } from "../../schemas/versions/types";
import type { Params } from "../types";

/** Page size when the caller does not ask for one. */
const DEFAULT_LIMIT = 25;

/** Hard ceiling, so one request cannot serialize an unbounded history. */
const MAX_LIMIT = 100;

/**
 * Reject a pagination value that is not a positive integer.
 *
 * The dispatchers convert raw query strings with `Number(...)`, so `?limit=abc`
 * arrives as `NaN` and `?limit=-2` arrives negative. Neither is caught by the
 * clamp below: `Math.min(-2, MAX_LIMIT)` is still `-2`, and the repository then
 * receives `limit + 1 === -1`, which SQLite treats as *unbounded* — silently
 * defeating MAX_LIMIT. A `NaN` cursor would likewise produce a
 * `versionNo < NaN` predicate that matches nothing.
 */
function assertPositiveInteger(value: number, path: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw NextlyError.validation({
      errors: [
        {
          path,
          code: "INVALID_VALUE",
          message: `${path} must be a positive integer.`,
        },
      ],
    });
  }
}

/** What every version method needs to identify and authorize a document. */
export interface VersionMethodArgs {
  scopeKind: VersionScopeKind;
  slug: string;
  entryId: string;
  user: UserContext;
  limit?: number;
  cursor?: number;
}

/**
 * Rebuild the caller from the params the route handler stamped on.
 *
 * `setAuthenticatedRouteParams` writes the authenticated identity onto
 * `routeParams` as `_authenticatedUser*` values, so dispatcher methods recover
 * it from there rather than receiving a user object directly.
 */
export function userFromParams(p: Params): UserContext {
  let roles: string[] | undefined;
  if (p._authenticatedUserRoles) {
    try {
      const parsed: unknown = JSON.parse(String(p._authenticatedUserRoles));
      if (Array.isArray(parsed)) roles = parsed as string[];
    } catch {
      // A corrupt value must not turn a read into a server error; treat it as
      // no roles and let the access rules decide.
      roles = undefined;
    }
  }

  return {
    id: String(p._authenticatedUserId ?? ""),
    name: p._authenticatedUserName
      ? String(p._authenticatedUserName)
      : undefined,
    email: p._authenticatedUserEmail
      ? String(p._authenticatedUserEmail)
      : undefined,
    roles,
    // A representative singular role, matching what the standalone routes
    // pass, so a callback reading `user.role` sees an authorized value.
    role: roles?.[0],
  };
}

/**
 * Version metadata for one document, newest-first, each row carrying the
 * display identity of whoever wrote it. Snapshots are never included here — a
 * history list does not need them and they are large.
 */
export async function listVersionsForDocument(
  args: VersionMethodArgs
): Promise<{ items: VersionMetaWithAuthor[]; meta: PaginationMeta }> {
  // Validate before the gate so malformed pagination fails fast, and validate
  // here rather than per dispatcher so every caller of this core is covered.
  if (args.limit !== undefined) assertPositiveInteger(args.limit, "limit");
  if (args.cursor !== undefined) assertPositiveInteger(args.cursor, "cursor");

  await assertVersionDocumentReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user
  );

  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const versions = getService("versionsService");
  // Ask for one extra row: its presence is what proves another page exists.
  // Inferring from a full page would claim a next page whenever the history
  // length is an exact multiple of the page size.
  const window = await versions.list(
    {
      scopeKind: args.scopeKind,
      scopeSlug: args.slug,
      entryId: args.entryId,
    },
    {
      limit: limit + 1,
      ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
    }
  );
  const hasNext = window.length > limit;
  const items = hasNext ? window.slice(0, limit) : window;

  // Keyset pagination: page/totalPages are not meaningful for a cursor walk,
  // so the meta describes the returned window.
  return {
    // Rows record only an author id; a history list shows a person.
    items: await attachVersionAuthors(items),
    meta: {
      total: items.length,
      page: 1,
      limit,
      totalPages: 1,
      hasNext,
      hasPrev: args.cursor !== undefined,
    },
  };
}

/**
 * One version, including its snapshot, redacted for the caller and with its
 * relationship and upload ids resolved for display.
 */
export async function getVersionForDocument(
  args: VersionMethodArgs & { versionNo: number }
): Promise<VersionRow> {
  if (!Number.isInteger(args.versionNo) || args.versionNo < 1) {
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

  await assertVersionDocumentReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user
  );

  const versions = getService("versionsService");
  const row = await versions.get(
    {
      scopeKind: args.scopeKind,
      scopeSlug: args.slug,
      entryId: args.entryId,
    },
    args.versionNo
  );

  await prepareSnapshotForUser(
    row.snapshot,
    args.scopeKind,
    args.slug,
    args.user
  );

  return row;
}
