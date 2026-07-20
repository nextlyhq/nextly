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

import type { FieldConfig } from "../collections/fields/types";
import { getService } from "../di";
import type { UserContext } from "../domains/singles/types";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { VersionScopeKind } from "../schemas/versions/types";
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
export async function requireVersionReadAccess(
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

  const readable = await canReadLiveDocument(scopeKind, slug, entryId, user);
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

  return user;
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
  user: UserContext
): Promise<boolean> {
  if (scopeKind === "single") {
    return canReadLiveSingle(slug, entryId, user);
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
  user: UserContext
): Promise<boolean> {
  const registry = getService("singleRegistryService");
  const record = await registry.getSingleBySlug(slug);
  if (!record?.tableName) return false;

  const adapter = getService("adapter");
  const row = await adapter.selectOne<{ id?: unknown }>(record.tableName, {});
  // Not materialized yet, or the live document is a different one than the
  // requested history belongs to.
  if (!row || row.id !== entryId) return false;

  const singles = getService("singleEntryService");
  const result = await singles.get(slug, {
    user,
    overrideAccess: false,
    routeAuthorized: true,
    status: "all",
  });
  return interpretReadResult(result.success, result.statusCode);
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
