/**
 * Shared access gate for the version-history routes.
 *
 * Version rows carry a full snapshot of a document, so reading them must be at
 * least as restricted as reading the document itself. A coarse `read-<slug>`
 * permission is not sufficient: collections can additionally apply owner-only
 * rules, draft/published filtering, and field-level `access.read` redaction,
 * none of which the version table knows about.
 *
 * The gate therefore resolves the caller, then reads the LIVE document through
 * the same service a normal read uses. If that read denies or finds nothing,
 * the caller may not see this document's history either. Snapshots returned
 * afterwards are additionally passed through field-level read redaction.
 *
 * @module api/versions-access
 */

import type { AuthenticatedScope } from "../auth/authenticated-scope";
import type { FieldConfig } from "../collections/fields/types";
import { getService } from "../di";
import { checkSingleAccess } from "../domains/singles";
import type { UserContext } from "../domains/singles/types";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { VersionScopeKind } from "../schemas/versions/types";
import { AccessControlService } from "../services/access/access-control-service";
import { resolveRoleSlugs } from "../services/lib/permissions";
import { applyFieldReadAccess } from "../shared/lib/field-level-registry";
import { stripPasswordFieldValues } from "../shared/lib/password-fields";

import { requireRouteCollectionAccess } from "./route-auth";

/**
 * Boot services, authenticate, and confirm the caller may read the live
 * document behind `scopeKind`/`slug`/`entryId`.
 *
 * Services are initialized BEFORE the access check: on a cold process the
 * permission lookup itself needs the adapter and RBAC services registered, so
 * gating first would make the first request to a fresh process fail instead of
 * auto-initializing.
 *
 * @returns The resolved caller, for redacting whatever is returned next.
 */
export async function requireRouteVersionReadAccess(
  request: Request,
  scopeKind: VersionScopeKind,
  slug: string,
  entryId: string
): Promise<UserContext> {
  await getCachedNextly();

  const auth = await requireRouteCollectionAccess(request, "read", slug);

  // Resolved role slugs so field-level `access.read` evaluates against the
  // caller's roles (session auth carries role ids; API-key auth carries slugs).
  const roles = await resolveRoleSlugs(auth);
  const user: UserContext = {
    id: auth.userId,
    name: auth.userName,
    email: auth.userEmail,
    roles,
    // A representative singular `role`, so callbacks reading `user.role` see an
    // authorized value rather than stripping fields for a legitimate caller.
    role: roles?.[0],
  };

  await assertVersionDocumentReadable(scopeKind, slug, entryId, user);

  return user;
}

/**
 * Confirm a caller may see this document's history, assuming they are already
 * authenticated and coarsely authorized.
 *
 * The dispatcher authorizes centrally before dispatching, so it needs the
 * document-level half of the gate on its own — owner-only rules,
 * draft/published visibility, and (for Singles) the live-id match. Keeping this
 * separate from {@link requireRouteVersionReadAccess} means those rules are defined
 * once instead of drifting between the two entry points.
 *
 * @throws NextlyError.notFound when the caller may not see the document.
 */
export async function assertVersionDocumentReadable(
  scopeKind: VersionScopeKind,
  slug: string,
  entryId: string,
  user: UserContext,
  // The caller's authenticated scope. Version history is a read of the live
  // document, so a scoped API key is judged on its OWN read grant here — a
  // super-admin-owned key does not skip the document's stored owner-only/custom
  // read rules before its snapshots are exposed.
  authenticatedScope?: AuthenticatedScope
): Promise<void> {
  const readable = await canReadLiveDocument(
    scopeKind,
    slug,
    entryId,
    user,
    authenticatedScope
  );
  if (!readable) {
    // Deliberately "not found" rather than "forbidden": a distinct 403 would
    // confirm the document exists to a caller not allowed to know that.
    throw NextlyError.notFound({
      logContext: {
        reason: "version-document-not-readable",
        scopeKind,
        scopeSlug: slug,
        entryId,
        userId: user.id,
      },
    });
  }
}

/**
 * Confirm the caller may UPDATE the live document, for writes to its history.
 *
 * Renaming or otherwise editing a version changes a record of the document, so
 * it owes the document's own update rules. The route-level `update-<slug>`
 * permission is coarse: it says the caller may update documents of this kind,
 * not that they may update THIS one. A collection or Single carrying an
 * owner-only or role-based per-document rule refuses the document itself while
 * that coarse permission still stands, and without this gate the history would
 * stay editable.
 *
 * Read access is assumed to have been established already. That is why a
 * refusal here is 403 rather than the read gate's 404: the caller has proven
 * they can see this document, so concealing its existence protects nothing and
 * only makes the refusal harder to act on.
 *
 * Both entity kinds are covered deliberately. A gate that reached only one
 * would read as complete and would not be.
 */
export async function assertVersionDocumentUpdatable(
  scopeKind: VersionScopeKind,
  slug: string,
  entryId: string,
  user: UserContext,
  // The caller's authenticated scope. A version-label edit is a route-authorized
  // `update`, so a scoped API key is judged on its OWN update grant here and a
  // super-admin-owned key does not skip stored owner/role update rules.
  authenticatedScope?: AuthenticatedScope
): Promise<void> {
  const allowed =
    scopeKind === "single"
      ? await canUpdateLiveSingle(slug, entryId, user, authenticatedScope)
      : await getService("collectionsHandler").canUpdateEntry({
          collectionName: slug,
          entryId,
          user,
          // As the read gate does: route authorization already ran, so skip
          // only the redundant coarse re-check. The stored per-document rules
          // this gate exists for still run.
          routeAuthorized: true,
          authenticatedScope,
        });

  if (!allowed) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "version-document-not-updatable",
        scopeKind,
        scopeSlug: slug,
        entryId,
        userId: user.id,
      },
    });
  }
}

/**
 * Single variant of the update gate.
 *
 * Reads the row directly rather than through `SingleEntryService`, which
 * materializes a missing Single. The live id is compared with the requested
 * one for the same reason the read gate compares it: version rows outlive the
 * document they came from, so a Single recreated under a new id must not have
 * the previous document's history edited through it.
 */
async function canUpdateLiveSingle(
  slug: string,
  entryId: string,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope
): Promise<boolean> {
  const registry = getService("singleRegistryService");
  const record = await registry.getSingleBySlug(slug);
  if (!record?.tableName) return false;

  const liveId = await resolveSingleDocumentId(slug);
  if (liveId === null || liveId !== entryId) return false;

  const adapter = getService("adapter");
  // Loaded because an owner-only rule compares against the stored row, and
  // `checkSingleAccess` refuses outright when such a rule has no document.
  const document = await adapter.selectOne<Record<string, unknown>>(
    record.tableName,
    {}
  );
  if (!document) return false;

  const denied = await checkSingleAccess({
    slug,
    operation: "update",
    user,
    overrideAccess: false,
    routeAuthorized: true,
    rbacAccessControlService: getService("rbacAccessControlService"),
    // Stateless evaluator for the Single's stored rules; it holds no
    // per-request state, so constructing one here matches the write path.
    accessControlService: new AccessControlService(),
    accessRules: record.accessRules,
    document,
    // A scoped API key is judged on its own update grant, so a super-admin-owned
    // key does not skip stored owner/role rules on a version-label edit.
    authenticatedScope,
    logger: getService("logger"),
  });
  return denied === null;
}

/**
 * Whether the caller can read the live document, using the same service the
 * normal read path uses so owner-only rules and stored access rules apply
 * identically.
 *
 * A denial (403) and a missing document (404) both mean "no history for you".
 * Any other failure is a real server-side fault — a component/relationship load
 * error, a throwing afterRead hook — and is re-thrown so the route reports it
 * as a 5xx instead of disguising an outage as missing content.
 */
async function canReadLiveDocument(
  scopeKind: VersionScopeKind,
  slug: string,
  entryId: string,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope
): Promise<boolean> {
  if (scopeKind === "single") {
    return canReadLiveSingle(slug, entryId, user, authenticatedScope);
  }

  const collections = getService("collectionsHandler");
  const result = await collections.getEntry({
    collectionName: slug,
    entryId,
    user,
    overrideAccess: false,
    // The route already authenticated and authorized the caller, so skip only
    // the redundant RBAC re-check (which would reject a scoped API key by
    // resolving its creator's stored roles). Document-level rules still run.
    routeAuthorized: true,
    // A scoped API key is judged on its OWN read grant, so a super-admin-owned
    // key does not skip the collection's stored owner-only/custom read rule.
    authenticatedScope,
    // Match the authenticated read path: without this, a status-enabled
    // collection filters to published only, and a draft would report no
    // history — exactly when an author needs it most.
    status: "all",
  });
  return interpretReadResult(result.success, result.statusCode);
}

/**
 * Single variant. Reads the backing row directly first, because
 * `SingleEntryService.get` MATERIALIZES a missing Single (creating the default
 * document, and for a versioned Single capturing an initial version). A version
 * request is a read, so it must never write; skipping straight to 404 when no
 * row exists is also correct, since an unmaterialized Single has no history.
 *
 * The row's id is then compared with the requested `entryId`: version rows
 * outlive the document they came from, so a Single recreated under a new id
 * must not expose the previous document's snapshots.
 */
async function canReadLiveSingle(
  slug: string,
  entryId: string,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope
): Promise<boolean> {
  const registry = getService("singleRegistryService");
  const record = await registry.getSingleBySlug(slug);
  if (!record?.tableName) return false;

  // Not materialized yet, or the live document is a different one than the
  // requested history belongs to.
  const liveId = await resolveSingleDocumentId(slug);
  if (liveId === null || liveId !== entryId) return false;

  const singles = getService("singleEntryService");
  const result = await singles.get(slug, {
    user,
    overrideAccess: false,
    routeAuthorized: true,
    // A scoped API key is judged on its OWN read grant, mirroring the collection
    // read gate above.
    authenticatedScope,
    status: "all",
  });
  return interpretReadResult(result.success, result.statusCode);
}

/**
 * The id of a Single's live document, or `null` when it has not been
 * materialized yet.
 *
 * A Single's URL carries no entry id (there is only ever one document), so
 * callers must resolve it from the backing row rather than trusting a
 * client-supplied value — otherwise the id check that stops a recreated Single
 * exposing its predecessor's snapshots could simply be bypassed. Reads the row
 * directly instead of going through `SingleEntryService.get`, which would
 * materialize a missing Single as a side effect of a read.
 */
export async function resolveSingleDocumentId(
  slug: string
): Promise<string | null> {
  const registry = getService("singleRegistryService");
  const record = await registry.getSingleBySlug(slug);
  if (!record?.tableName) return null;

  const adapter = getService("adapter");
  const row = await adapter.selectOne<{ id?: unknown }>(record.tableName, {});
  return typeof row?.id === "string" ? row.id : null;
}

/**
 * Collapse a live-read result into "may the caller see this document".
 * Only 403/404 mean no; anything else non-successful is a genuine fault.
 */
function interpretReadResult(success: boolean, statusCode: number): boolean {
  if (success) return true;
  if (statusCode === 403 || statusCode === 404) return false;
  throw NextlyError.internal({
    logContext: {
      reason: "version-live-read-failed",
      statusCode,
    },
  });
}

/**
 * Strip fields the caller may not read from a stored snapshot, using the same
 * field-level `access.read` rules a normal read applies. Mutates in place.
 *
 * Snapshots are stored as opaque JSON, so a non-object snapshot (or one written
 * before a field gained an access rule) is left alone rather than throwing —
 * the surrounding gate has already established the caller may read the
 * document, and redaction is a narrowing pass on top of that.
 */
export async function redactSnapshotForUser(
  snapshot: unknown,
  scopeKind: VersionScopeKind,
  slug: string,
  user: UserContext
): Promise<void> {
  if (typeof snapshot !== "object" || snapshot === null) return;
  if (scopeKind !== "collection" && scopeKind !== "single") return;

  const entry = snapshot as Record<string, unknown>;

  // Strip anything the CURRENT schema marks as a password, mirroring the normal
  // read path. Capture already strips password values, but a field converted to
  // `password` after a snapshot was written — or history imported from before
  // that rule existed — would otherwise hand back a value the live read hides.
  const fields = await resolveFieldsForRedaction(scopeKind, slug);
  if (fields.length > 0) {
    stripPasswordFieldValues(entry, fields);
  }

  await applyFieldReadAccess({
    kind: scopeKind,
    slug,
    entry,
    user,
    overrideAccess: false,
  });
}

/**
 * Current field configs for an entity, used to decide what to strip. A lookup
 * failure yields an empty list: redaction then falls back to field-level access
 * alone rather than failing the request.
 */
async function resolveFieldsForRedaction(
  scopeKind: "collection" | "single",
  slug: string
): Promise<FieldConfig[]> {
  try {
    if (scopeKind === "single") {
      const registry = getService("singleRegistryService");
      const record = await registry.getSingleBySlug(slug);
      return record?.fields ?? [];
    }
    const collections = getService("collectionService");
    // Metadata lookup only; the context carries no user because the access
    // decision was already made above and this is just a field-shape read.
    const collection = await collections.getCollection(slug, {});
    return ((collection as { fields?: unknown[] } | null)?.fields ??
      []) as FieldConfig[];
  } catch {
    return [];
  }
}
