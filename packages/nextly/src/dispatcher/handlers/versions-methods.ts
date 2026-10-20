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

import {
  type PaginationMeta,
  respondList,
  withSessionCacheHeaders,
} from "../../api/response-shapes";
import {
  parseSubjectEventsQuery,
  readSubjectEvents,
} from "../../api/subject-events";
import {
  assertComparisonRequest,
  assertHistoryLocalesReadable,
  assertVersionDocumentReadable,
  assertDocumentUpdatable,
  compareDocumentVersions,
  type ComparisonQuery,
  historyListLanguages,
  parseComparisonQuery,
  hydrateVersionSnapshot,
  readingPersonId,
  redactSnapshotForUser,
  resolveVersionsPolicy,
  tryResolveCurrentFields,
  withLastViewedMarks,
} from "../../api/versions-access";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { canReadEntity } from "../../auth/entity-read-access";
import { actorForWrite, type RequestActor } from "../../auth/request-actor";
import type { FieldConfig } from "../../collections/fields/types";
import { getService } from "../../di";
import { container } from "../../di/container";
import type { ContentEventSubject } from "../../domains/content-events/record";
import type { FieldGroupDataService } from "../../domains/field-groups/services/field-group-data-service";
import type { UserContext } from "../../domains/singles/types";
import {
  attachVersionAuthors,
  type VersionMetaWithAuthor,
} from "../../domains/versions/author-hydration";
import type { VersionDiff } from "../../domains/versions/diff";
import {
  discardWorkingDraft,
  type DiscardScopeKind,
} from "../../domains/versions/discard-working-draft";
import { lockDocument, lockPerson } from "../../domains/versions/history-locks";
import { restoreVersion } from "../../domains/versions/restore-version";
import {
  resolveComponentFieldMap,
  stripPasswordsThroughComponents,
} from "../../domains/versions/tag-component-types";
import { markVersionSeen } from "../../domains/versions/version-views";
import { VersionsRepository } from "../../domains/versions/versions-repository";
import type { VersionRow } from "../../domains/versions/versions-repository";
import { NextlyError } from "../../errors/nextly-error";
import type { VersionScopeKind } from "../../schemas/versions/types";
import { stripPasswordFieldValues } from "../../shared/lib/password-fields";
import { isUniqueViolation } from "../../shared/lib/unique-violation";
import {
  readAuthenticatedActor,
  readAuthenticatedScope,
} from "../helpers/authenticated-actor";
import { readAuthenticatedUser } from "../helpers/authenticated-user";
import type { Params } from "../types";

import { readAccessCallerForDispatch } from "./read-access-caller";

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

/**
 * Require the autosave body to be a JSON object.
 *
 * The CONTENTS stay unvalidated on purpose: an author part-way through a
 * required field still has work worth keeping, so a recovery point is allowed
 * to be incomplete. Whether a body arrived at all is a different question. An
 * absent one reaches the handler as `undefined`, which `JSON.stringify` turns
 * into `undefined` rather than a string, and the snapshot serializer then
 * raises an internal error -- answering a malformed request with a 500 instead
 * of telling the caller what was wrong.
 */
export function requireSnapshotBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "body",
          code: "INVALID_VALUE",
          message: "Autosave requires a JSON object body.",
        },
      ],
    });
  }
  return body as Record<string, unknown>;
}

/**
 * Whether any field in this schema references a component by slug, at any
 * depth. Used to decide whether an unavailable component registry is a problem
 * for THIS entity: a schema with no references has nothing unresolvable in it.
 */
function declaresComponentReference(fields: FieldConfig[]): boolean {
  for (const field of fields) {
    // Either spelling declares a reference: a migrated definition whose keys
    // went unread would skip the registry-unavailable guard entirely.
    if (typeof (field as { component?: unknown }).component === "string") {
      return true;
    }
    if (typeof (field as { fieldGroup?: unknown }).fieldGroup === "string") {
      return true;
    }
    if (Array.isArray((field as { components?: unknown }).components)) {
      return true;
    }
    if (Array.isArray((field as { fieldGroups?: unknown }).fieldGroups)) {
      return true;
    }
    const children = (field as { fields?: unknown }).fields;
    if (
      Array.isArray(children) &&
      declaresComponentReference(children as FieldConfig[])
    ) {
      return true;
    }
  }
  return false;
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
  /** Scope the history listing to one locale's versions. */
  locale?: string;
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
  // The languages this caller may read the history in: the one asked for, or
  // every one they may read.
  const languages = await historyListLanguages(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    args.authenticatedScope,
    args.locale
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
      // An empty `?locale=` reaches the dispatcher as "" (the route parser keeps
      // it); `historyListLanguages` treats that as absent, so both list surfaces
      // list every readable locale rather than matching a non-existent
      // empty-string locale and returning nothing.
      ...languages,
    }
  );
  const hasNext = window.length > limit;
  const items = hasNext ? window.slice(0, limit) : window;

  // Keyset pagination: page/totalPages are not meaningful for a cursor walk,
  // so the meta describes the returned window.
  return {
    // Rows record only an author id; a history list shows a person. For a
    // person, each part's "You last looked here" row is marked; reading the
    // list records nothing.
    items: await withLastViewedMarks(await attachVersionAuthors(items), {
      ref: {
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
      },
      user: args.user,
      authenticatedScope: args.authenticatedScope,
    }),
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
 * A history page as the dispatcher answers it: paging read from the params,
 * and private to the caller, since the page marks where they last looked.
 * Both entity kinds answer through this, so they cannot drift apart.
 */
export async function respondVersionPage(
  document: { scopeKind: VersionScopeKind; slug: string; entryId: string },
  p: Params
): Promise<Response> {
  const result = await listVersionsForDocument({
    ...document,
    user: userFromParams(p),
    authenticatedScope: readAuthenticatedScope(p),
    limit: p.limit !== undefined ? Number(p.limit) : undefined,
    cursor: p.cursor !== undefined ? Number(p.cursor) : undefined,
    locale: p.locale !== undefined ? String(p.locale) : undefined,
  });
  return withSessionCacheHeaders(respondList(result.items, result.meta));
}

/**
 * A document's events as the dispatcher answers them: the read's query from
 * the params, the caller the route resolved, and private to that caller, as a
 * history page is. Collections and Singles answer through this.
 *
 * @experimental
 */
export async function respondSubjectEvents(
  subject: Exclude<ContentEventSubject, { kind: "release" }>,
  p: Params
): Promise<Response> {
  // The caller as every REST collection operation reads it, verified claims
  // included, so a document's hooks judge the same caller here.
  const user = readAuthenticatedUser(p);
  const result = await readSubjectEvents(subject, parseSubjectEventsQuery(p), {
    ...(user === undefined ? {} : { user }),
    authenticatedScope: readAuthenticatedScope(p),
  });
  return withSessionCacheHeaders(respondList(result.items, result.meta));
}

/** One version, including its snapshot, redacted for the caller. */
export async function getVersionForDocument(
  args: VersionMethodArgs & { versionNo: number }
): Promise<
  VersionRow & {
    /** Fields the read rules withheld: top-level keys and dotted paths. */
    withheld: string[];
  }
> {
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
  // The version is of the language it records, asked about before any of it
  // is returned.
  await assertHistoryLocalesReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    args.authenticatedScope,
    {},
    [row.locale]
  );

  // What the read rules withheld is named beside the snapshot, so a reader is
  // told a value is held back rather than shown a version that lacks it.
  const withheld = await redactSnapshotForUser(
    row.snapshot,
    args.scopeKind,
    args.slug,
    args.user,
    args.authenticatedScope
  );

  // Resolve relationship and upload ids in the snapshot to display labels
  // through the access-checked path, so a preview renders labels rather than
  // ids. Runs after redaction, so a dropped field is never resolved.
  await hydrateVersionSnapshot(
    row.snapshot,
    args.scopeKind,
    args.slug,
    args.user,
    args.authenticatedScope,
    row.locale
  );

  return { ...row, withheld: [...withheld] };
}

/**
 * Record that a signed-in person was shown one version, for "the version you
 * last looked at" (see `domains/versions/version-views`). The admin calls this
 * when it actually shows a version or a comparison; no read records anything.
 *
 * People only: an API key, a principal or the system is refused, so nothing
 * but a person's own screen moves their marker. The caller must be able to
 * read the document, and the version must exist; its part (a language, or
 * none) is the version's own, never the request's. Idempotent within a visit.
 */
export async function markVersionSeenForDocument(
  args: VersionMethodArgs & { versionNo: number }
): Promise<{ versionNo: number; locale: string | null }> {
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
  const userId = readingPersonId(args.user, args.authenticatedScope);
  if (userId === null) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "mark-seen-not-a-person",
        actorType: args.authenticatedScope?.actorType,
      },
    });
  }

  await assertVersionDocumentReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    args.authenticatedScope
  );

  const ref = {
    scopeKind: args.scopeKind,
    scopeSlug: args.slug,
    entryId: args.entryId,
  };
  const notFound = (reason: string) =>
    NextlyError.notFound({
      logContext: { reason, ...ref, versionNo: args.versionNo },
    });
  // The version's language is asked about before anything is written. A
  // version's language never changes, so the mark below records the part
  // judged here.
  const versionPart = await getService("versionsService").partOfVersion(
    ref,
    args.versionNo
  );
  if (versionPart === undefined) throw notFound("mark-seen-version-missing");
  await assertHistoryLocalesReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    args.authenticatedScope,
    {},
    [versionPart]
  );
  // One transaction holding the locks the sweeps of markers take: the
  // person's account row (account deletion), then the entity's registry row
  // and the document's row (entity and document deletion). A mark either
  // commits first and is swept, or waits and finds what it marks gone.
  const mark = () =>
    getService("adapter").transaction(async tx => {
      if (!(await lockPerson(tx, userId)))
        throw notFound("mark-seen-person-gone");
      if (!(await lockDocument(tx, ref)))
        throw notFound("mark-seen-document-gone");
      const part = await new VersionsRepository(tx).findPartOfVersion(
        ref,
        args.versionNo
      );
      if (part === undefined) throw notFound("mark-seen-version-missing");
      await markVersionSeen(tx, { userId, ref, part }, args.versionNo);
      return part;
    });
  let locale: string | null;
  try {
    locale = await mark();
  } catch (error) {
    // Two first marks of one marker raced, and this one lost the insert: the
    // row now exists, so once more updates it.
    if (!isUniqueViolation(error)) throw error;
    locale = await mark();
  }
  return { versionNo: args.versionNo, locale };
}

/**
 * A comparison request's query from the params the route handler stamped on,
 * parsed by the one parser every comparing surface uses.
 */
export function readComparisonParams(p: Params): ComparisonQuery {
  return parseComparisonQuery(p);
}

/**
 * A typed diff of two versions of one document over the dispatcher, gated
 * exactly like a single-version read.
 *
 * Either an explicit pair (`from` and `to`), or a target and a baseline the
 * server resolves (`to` and `baseline`, each optional; see
 * `resolveComparisonPair` for the defaults). Naming both a `from` and a
 * `baseline` is refused: they are two answers to one question.
 */
export async function getVersionDiffForDocument(
  args: VersionMethodArgs & {
    from?: number;
    to?: number;
    /** @experimental A registered comparison baseline's name. */
    baseline?: string;
    modifiedOnly?: boolean;
  }
): Promise<VersionDiff> {
  const query: ComparisonQuery = {
    from: args.from,
    to: args.to,
    baseline: args.baseline,
    locale: args.locale,
    modifiedOnly: args.modifiedOnly === true,
  };
  assertComparisonRequest(query);

  // The read gate runs before anything about the document's history is read.
  await assertVersionDocumentReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    args.authenticatedScope
  );

  return compareDocumentVersions({
    scopeKind: args.scopeKind,
    slug: args.slug,
    entryId: args.entryId,
    user: args.user,
    authenticatedScope: args.authenticatedScope,
    query,
  });
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

  const caller = readAccessCallerForDispatch(args.params, args.user);

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
  await assertDocumentUpdatable(
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
  // tell a no-op from a rename by its status. A name given is recorded in the
  // document's history in the same transaction; clearing one records nothing.
  const row = provided
    ? await versions.setLabel(ref, args.versionNo, label, {
        actor: actorForWrite(readAuthenticatedActor(args.params), args.user),
        personName: args.user.name ?? null,
      })
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
    /** The HTTP request behind the restore, when one produced it. */
    request?: Request;
  }
): Promise<{ restoredFrom: number; droppedFields: string[] }> {
  const caller = readAccessCallerForDispatch(args.params, args.user);

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
    request: args.request,
  });
}

/**
 * Discard a collection entry's pending working draft (draft/published split),
 * reverting the editor to the live published row.
 *
 * The sidecar is deleted; the document's durable history is never touched, so
 * this reverts unpublished edits rather than writing a version. It is authorized
 * as an update — a caller who may not update the document may not throw away its
 * pending edits either — after read access is established, so a caller who cannot
 * see the document gets a 404 rather than a 403 that would confirm it exists.
 *
 * Returns the published document as a plain read would, so the editor can reset
 * to the live values without a second request. A no-op that still returns the
 * live row when no working draft exists.
 *
 * A localized document holds one pending change per language, so the request
 * names the language it discards; the others are left alone.
 */
export async function discardWorkingDraftForDocument(
  args: Omit<VersionMethodArgs, "locale" | "scopeKind"> & {
    /**
     * Narrower than the shared `VersionMethodArgs` scope, because a discard is
     * implemented for these two kinds only — see `DiscardScopeKind`.
     */
    scopeKind: DiscardScopeKind;
    params: Params;
    /**
     * Which language's pending change to discard. Absent (or null) means the
     * request named none, which a localized document resolves to its default
     * language — the admin omits `?locale=` when editing that one.
     */
    locale?: string | null;
  }
): Promise<unknown> {
  const caller = readAccessCallerForDispatch(args.params, args.user);

  // Read gate first: the route authorized this as an update, not a read, so a
  // caller who cannot read the document is refused here — as "not found" so the
  // refusal does not confirm it exists. Mirrors restoreVersionForDocument.
  if (!(await canReadEntity(args.slug, caller))) {
    throw NextlyError.notFound({
      logContext: {
        reason: "discard-working-draft-read-denied",
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
        userId: args.user.id,
      },
    });
  }

  const authenticatedScope = readAuthenticatedScope(args.params);

  // Per-document read (404 when the row is gone or hidden by an owner-only rule)
  // then the update gate (403): the coarse update-<slug> permission ran at the
  // route, but a per-document rule can still refuse THIS document, and discarding
  // its pending edits owes the same rules as any other update to it.
  await assertVersionDocumentReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    authenticatedScope
  );
  await assertDocumentUpdatable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    authenticatedScope
  );

  return discardWorkingDraft({
    scopeKind: args.scopeKind,
    slug: args.slug,
    entryId: args.entryId,
    user: args.user,
    locale: args.locale ?? null,
    authenticatedScope,
    actor: readAuthenticatedActor(args.params),
  });
}

/**
 * Record the caller's rolling recovery point for one document.
 *
 * Writes the autosave row and nothing else. The live row and the working draft
 * are both untouched, so this cannot change what a reader sees or what publish
 * would promote — which is what makes it safe to run on a timer while somebody
 * is still typing, and why the snapshot is allowed to be incomplete.
 *
 * Authorization is the same chain a discard runs, and for the same reason: a
 * recovery point holds the document's content, so storing one owes every rule
 * that reading and updating the document owe. The coarse `update-<slug>`
 * permission ran at the route; a per-document rule can still refuse THIS
 * document, and a read refusal is reported as "not found" so it does not
 * confirm the document exists.
 */
export async function autosaveForDocument(
  args: Omit<VersionMethodArgs, "locale"> & {
    params: Params;
    snapshot: unknown;
    /**
     * Null and undefined are the SAME here, unlike on a listing where absent
     * means "every locale" and a value narrows. A snapshot belongs to exactly
     * one locale or to an unlocalized document, so both spellings of "none"
     * mean the unlocalized row.
     */
    locale?: string | null;
  }
): Promise<unknown> {
  const caller = readAccessCallerForDispatch(args.params, args.user);

  if (!(await canReadEntity(args.slug, caller))) {
    throw NextlyError.notFound({
      logContext: {
        reason: "autosave-read-denied",
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
        userId: args.user.id,
      },
    });
  }

  const authenticatedScope = readAuthenticatedScope(args.params);

  await assertVersionDocumentReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    authenticatedScope
  );
  await assertDocumentUpdatable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    authenticatedScope
  );

  // The owner's setting is enforced HERE, not in whichever editor happens to
  // be calling. A REST or plugin client holding update access can reach this
  // endpoint directly, so a client-side check would be a suggestion rather
  // than a rule -- and storing unpublished content for an entity whose owner
  // switched autosave off, or which records no versions at all, is exactly
  // what the setting exists to prevent.
  if (args.scopeKind === "collection" || args.scopeKind === "single") {
    const policy = await resolveVersionsPolicy(args.scopeKind, args.slug);
    if (!policy?.drafts?.autosave?.enabled) {
      throw NextlyError.forbidden({
        logContext: {
          reason: "autosave-not-enabled",
          scopeKind: args.scopeKind,
          scopeSlug: args.slug,
        },
      });
    }
  }

  // The snapshot arrives straight from the editor, so it carries whatever the
  // author has typed -- including a NEW password, in plaintext, which no write
  // has hashed yet. Durable capture never faces this: it snapshots the stored
  // row, where the value is already hashed or absent. Strip before persisting,
  // with the same schema-driven recursive helper the version reads use, so a
  // credential never reaches the snapshot column at all.
  const snapshot = args.snapshot;
  if (
    snapshot &&
    typeof snapshot === "object" &&
    !Array.isArray(snapshot) &&
    // `page` scopes hold block documents rather than user-defined fields, and
    // field resolution has no answer for them.
    (args.scopeKind === "collection" || args.scopeKind === "single")
  ) {
    // Fail CLOSED on a failed LOOKUP, which is what `null` means here. An
    // empty list is a different answer: a valid entity can have no
    // user-defined fields at all (a freshly created Single, whose identity
    // columns alone form a document), and there is genuinely nothing to strip
    // from one. Treating those alike would refuse every autosave for such an
    // entity, while treating a failed lookup as "nothing to strip" would write
    // whatever the editor sent, credentials included, exactly when the lookup
    // meant to find them had broken.
    const fields = await tryResolveCurrentFields(args.scopeKind, args.slug);
    if (fields === null) {
      throw NextlyError.internal({
        logContext: {
          reason: "autosave-field-resolution-failed",
          scopeKind: args.scopeKind,
          scopeSlug: args.slug,
        },
      });
    }
    if (fields.length > 0) {
      // A `component` field is a REFERENCE: its schema lives under another
      // slug, so the stripper sees `{ type: "component" }` and has nothing to
      // descend into. A password declared inside a referenced component would
      // survive in the snapshot. Resolve those schemas, rewrite the references
      // into the container shapes the stripper already walks, and strip once.
      const dataService = container.has("fieldGroupDataService")
        ? container.get<FieldGroupDataService>("fieldGroupDataService")
        : null;
      // No executor: autosave runs outside any transaction by design, and the
      // parameter exists so an in-transaction caller can read on its own
      // connection rather than take a second one.
      const componentFields = dataService
        ? await resolveComponentFieldMap(fields, slug =>
            dataService.getComponentFields(slug)
          )
        : new Map<string, FieldConfig[]>();

      // Fail CLOSED where a reference cannot be resolved. `resolveComponentFieldMap`
      // propagates a lookup error rather than reporting the component absent,
      // so an unresolvable schema arrives here as a thrown error and refuses
      // the write; what this guards is the other case, a registry that is not
      // wired at all while the schema still declares references.
      if (!dataService && declaresComponentReference(fields)) {
        throw NextlyError.internal({
          logContext: {
            reason: "autosave-component-schema-unavailable",
            scopeKind: args.scopeKind,
            scopeSlug: args.slug,
          },
        });
      }

      // Walks the SNAPSHOT rather than an expanded schema. A component may
      // reference itself, so a schema-side expansion has to stop at some
      // depth, and everything below that cut-off would keep its passwords.
      // The data is finite, so this terminates on its own and strips every
      // level that actually exists.
      stripPasswordsThroughComponents(
        snapshot,
        fields,
        componentFields,
        stripPasswordFieldValues
      );
    }
  }

  return getService("versionsService").autosave({
    ref: {
      scopeKind: args.scopeKind,
      scopeSlug: args.slug,
      entryId: args.entryId,
    },
    // A recovery point always describes unpublished work: it is what the author
    // has, not what the site serves. Recording it as published would put an
    // unfinished edit into surfaces that filter on status.
    status: "draft",
    snapshot,
    locale: args.locale ?? null,
    // An empty id is this context's unauthenticated shape, and it is normalized
    // so the column holds one spelling of "no author" rather than two. It does
    // NOT separate anonymous authors from each other: `autosaveWhere` matches a
    // null author with `IS NULL`, so they would share one row. Nothing reaches
    // here anonymously today, because the read gate above refuses a caller with
    // no id, and relaxing that gate would need a real per-caller key first.
    createdBy: args.user.id || null,
  });
}

/**
 * The caller's own recovery point for one document, or null when none exists.
 *
 * Authorized as a READ of the document and scoped to the caller: an autosave is
 * unvalidated work in progress, so one author's must never be handed to
 * another. This is the only path by which a stored autosave can be read back,
 * since history listings exclude them and a version read addresses rows by a
 * sequence number a recovery point deliberately does not have.
 */
export async function getAutosaveForDocument(
  args: Omit<VersionMethodArgs, "locale"> & { params: Params }
): Promise<unknown> {
  const caller = readAccessCallerForDispatch(args.params, args.user);

  if (!(await canReadEntity(args.slug, caller))) {
    throw NextlyError.notFound({
      logContext: {
        reason: "autosave-read-denied",
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
        userId: args.user.id,
      },
    });
  }

  const authenticatedScope = readAuthenticatedScope(args.params);
  await assertVersionDocumentReadable(
    args.scopeKind,
    args.slug,
    args.entryId,
    args.user,
    authenticatedScope
  );

  const row = await getService("versionsService").getAutosave(
    {
      scopeKind: args.scopeKind,
      scopeSlug: args.slug,
      entryId: args.entryId,
    },
    args.user.id || null
  );
  // Null rather than a 404: having no recovery point is the ordinary state, not
  // a missing resource, and the editor asks on every open.
  if (!row) return null;

  // Same redaction a version read applies. Document-level access is not the
  // whole question: a field's `access.read` rule can deny this caller today
  // even though the snapshot was stored while they could see it, and handing
  // the row back verbatim would serve that field's old value from history.
  // The scope decoded above, the one the document gate judged: a direct
  // dispatch carries a key's scope in its params only.
  await redactSnapshotForUser(
    row.snapshot,
    args.scopeKind,
    args.slug,
    args.user,
    authenticatedScope
  );
  return row;
}
