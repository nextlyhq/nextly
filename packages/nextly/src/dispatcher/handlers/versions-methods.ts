/**
 * Version-history reads for the dispatcher.
 *
 * The admin talks to the catch-all handler rather than the standalone route
 * exports, so version history needs a dispatcher surface too. Both surfaces
 * share the document gate and the redaction step from `api/versions-access`, so
 * the access rules have exactly one definition.
 *
 * @module dispatcher/handlers/versions-methods
 */

import type { PaginationMeta } from "../../api/response-shapes";
import {
  assertVersionDocumentReadable,
  assertVersionDocumentUpdatable,
  redactSnapshotForUser,
} from "../../api/versions-access";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import {
  canReadEntity,
  type ReadAccessCaller,
} from "../../auth/entity-read-access";
import type { RequestActor } from "../../auth/request-actor";
import { getService } from "../../di";
import type { UserContext } from "../../domains/singles/types";
import {
  attachVersionAuthors,
  type VersionMetaWithAuthor,
} from "../../domains/versions/author-hydration";
import { restoreVersion } from "../../domains/versions/restore-version";
import type { VersionRow } from "../../domains/versions/versions-repository";
import { NextlyError } from "../../errors/nextly-error";
import type { VersionScopeKind } from "../../schemas/versions/types";
import { readAuthenticatedScope } from "../helpers/authenticated-actor";
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
  // The caller's authenticated scope, so the live-document read gate judges a
  // scoped API key on its OWN read grant rather than the key owner's roles.
  authenticatedScope?: AuthenticatedScope;
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
    args.user,
    args.authenticatedScope
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

/** One version, including its snapshot, redacted for the caller. */
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
    args.user,
    args.authenticatedScope
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

  await redactSnapshotForUser(
    row.snapshot,
    args.scopeKind,
    args.slug,
    args.user
  );

  return row;
}

/**
 * The resolved identity, as the shared read decision needs it.
 *
 * An API key's own scoped grants arrive on the params; a session caller has
 * none there, and `canReadEntity` resolves theirs from the database.
 */
function readAccessCallerFromParams(
  p: Params,
  user: UserContext
): ReadAccessCaller {
  const isApiKey = p._authenticatedActorType === "apiKey";

  let permissions: string[] = [];
  if (isApiKey && p._authenticatedPermissions) {
    try {
      const parsed: unknown = JSON.parse(String(p._authenticatedPermissions));
      if (Array.isArray(parsed)) permissions = parsed as string[];
    } catch {
      // A corrupt value must not read as a broader grant than the key holds;
      // an empty list denies, which is the safe direction.
      permissions = [];
    }
  }

  return {
    userId: user.id,
    authMethod: isApiKey ? "api-key" : "session",
    permissions,
    roles: user.roles ?? [],
  };
}

/**
 * Longest label a version may carry.
 *
 * No dialect caps the column — all three store `text` — so the bound has to be
 * enforced here or not at all. A label renders inside a narrow history row, and
 * 100 characters is generous for the naming people actually do ("before the
 * redesign", "Q1 launch copy") while stopping a row becoming a paragraph.
 */
const MAX_LABEL_LENGTH = 100;

/**
 * Normalize a submitted label into what gets stored.
 *
 * Trims first, so "clear it" and "type three spaces" mean the same thing rather
 * than leaving an invisible name behind. The client trims too, by this
 * codebase's convention, but a REST API has callers that are not the client.
 *
 * `null` clears. Anything that is neither a string nor null is a malformed
 * request rather than a clear, and is rejected instead of quietly wiping a name.
 */
/**
 * What the request asks for: whether a label was named at all, and what it
 * normalizes to.
 *
 * PATCH is a partial update, so an omitted key means "leave this alone" and
 * only an explicit null clears. Collapsing the two would make `PATCH {}` erase
 * a name nobody asked to remove.
 */
function readLabelFromBody(body: unknown): {
  provided: boolean;
  label: string | null;
} {
  const provided = typeof body === "object" && body !== null && "label" in body;

  return {
    provided,
    label: provided ? normalizeLabel(body.label, "label") : null,
  };
}

/**
 * Reject a malformed label request before anything is looked up.
 *
 * Exported for the Singles handler, which resolves the live document id before
 * it can call the core — a lookup that would otherwise make the same bad
 * request answer 404 for an unmaterialized Single and 400 for a materialized
 * one. The core validates again; this only moves the rejection earlier.
 */
export function assertLabelRequestValid(
  versionNo: number,
  body: unknown
): void {
  assertPositiveInteger(versionNo, "versionNo");
  readLabelFromBody(body);
}

function normalizeLabel(value: unknown, path: string): string | null {
  if (value === null) return null;

  if (typeof value !== "string") {
    throw NextlyError.validation({
      errors: [
        {
          path,
          code: "INVALID_VALUE",
          message: `${path} must be a string, or null to clear it.`,
        },
      ],
    });
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw NextlyError.validation({
      errors: [
        {
          path,
          code: "TOO_LONG",
          message: `${path} must be ${MAX_LABEL_LENGTH} characters or fewer.`,
        },
      ],
    });
  }

  return trimmed;
}

/**
 * Name a version, or clear its name.
 *
 * Gated exactly like a restore, and for the same reason: a label is written
 * onto history, so the caller must be allowed to see that history as well as to
 * change the document. The route marks this an update, which is what earns the
 * write permission; these two gates are the read half.
 */
export async function setVersionLabelForDocument(
  args: VersionMethodArgs & {
    versionNo: number;
    /**
     * The request body, not an extracted label. Whether the key is PRESENT is
     * part of the request's meaning, and reading it here rather than at each
     * dispatcher keeps that from being flattened on the way in — which is
     * exactly how an omitted label became an instruction to clear one.
     */
    body: unknown;
    params: Params;
  }
): Promise<VersionRow> {
  assertPositiveInteger(args.versionNo, "versionNo");
  const { provided, label } = readLabelFromBody(args.body);

  const caller = readAccessCallerFromParams(args.params, args.user);

  if (!(await canReadEntity(args.slug, caller))) {
    throw NextlyError.notFound({
      logContext: {
        reason: "version-label-read-denied",
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
        userId: args.user.id,
      },
    });
  }

  await assertVersionDocumentReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    readAuthenticatedScope(args.params)
  );

  // Renaming a version edits a record of the document, so it owes the
  // document's own update rules and not just the coarse `update-<slug>` the
  // route earned. Applied even when the request turns out to write nothing:
  // this is a write endpoint, and gating only the writing case would let the
  // no-op be used to discover what the caller is allowed to change.
  await assertVersionDocumentUpdatable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    // The route authorized `update` against the key's scope; judge the label
    // edit on the key's OWN grant so a super-admin-owned key does not skip
    // stored owner/role update rules.
    readAuthenticatedScope(args.params)
  );

  const versions = getService("versionsService");
  const ref = {
    scopeKind: args.scopeKind,
    scopeSlug: args.slug,
    entryId: args.entryId,
  };

  // Nothing was asked for, so nothing is written. The version is still read
  // back, so the response shape is the same either way and a caller cannot
  // tell a no-op from a rename by its status.
  const row = provided
    ? await versions.setLabel(ref, args.versionNo, label)
    : await versions.get(ref, args.versionNo);

  // The snapshot is not part of a label response: the caller asked to rename a
  // version, not to read its content, and returning it here would bypass the
  // redaction the version-detail endpoint applies.
  const { snapshot: _snapshot, ...meta } = row;

  // The same shape a history list returns, author included. Without this the
  // renamed row comes back carrying only an author id, and an admin that
  // renders the response directly would show the version losing its author the
  // moment it is named.
  const [withAuthor] = await attachVersionAuthors([meta]);
  return withAuthor as unknown as VersionRow;
}

/**
 * Put a document back to an earlier version.
 *
 * Two gates, because a restore both reads history and writes the document.
 * Reading it: the caller must hold read permission for the entity and must be
 * able to see this particular document, or they could recover a snapshot they
 * were never allowed to look at. Writing it: the update that follows enforces
 * access again on its own terms, so an update the caller may not make still
 * fails.
 */
export async function restoreVersionForDocument(
  args: VersionMethodArgs & {
    versionNo: number;
    actor?: RequestActor;
    /**
     * The dispatch params, so the caller's identity is assembled here rather
     * than at each dispatcher. Both entity kinds route through this function,
     * and building it twice is how the two drift.
     */
    params: Params;
  }
): Promise<{ restoredFrom: number; droppedFields: string[] }> {
  const caller = readAccessCallerFromParams(args.params, args.user);

  if (!(await canReadEntity(args.slug, caller))) {
    // "Not found" rather than "forbidden", matching the document gate below: a
    // distinct 403 would confirm the document exists to a caller not allowed to
    // know that.
    throw NextlyError.notFound({
      logContext: {
        reason: "restore-history-read-denied",
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
        userId: args.user.id,
      },
    });
  }

  await assertVersionDocumentReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    readAuthenticatedScope(args.params)
  );

  return restoreVersion({
    scopeKind: args.scopeKind,
    slug: args.slug,
    entryId: args.entryId,
    versionNo: args.versionNo,
    user: args.user,
    // Forwarded so an API-key restore is attributed to the key on the outbox
    // event rather than to the person who owns it.
    ...(args.actor ? { actor: args.actor } : {}),
    // The publish gate a restore-to-published triggers must judge the key's own
    // scope, not the owner's RBAC.
    authenticatedScope: readAuthenticatedScope(args.params),
  });
}
