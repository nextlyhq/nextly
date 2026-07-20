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

import { getService } from "../di";
import type { UserContext } from "../domains/singles/types";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { VersionScopeKind } from "../schemas/versions/types";
import { resolveRoleSlugs } from "../services/lib/permissions";
import { applyFieldReadAccess } from "../shared/lib/field-level-registry";

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
 * normal read path uses so owner-only rules, status filtering, and RBAC all
 * apply identically.
 */
async function canReadLiveDocument(
  scopeKind: VersionScopeKind,
  slug: string,
  entryId: string,
  user: UserContext
): Promise<boolean> {
  if (scopeKind === "single") {
    const singles = getService("singleEntryService");
    const result = await singles.get(slug, {
      user,
      overrideAccess: false,
    });
    return result.success === true;
  }

  const collections = getService("collectionsHandler");
  const result = await collections.getEntry({
    collectionName: slug,
    entryId,
    user,
    overrideAccess: false,
  });
  return result.success === true;
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

  await applyFieldReadAccess({
    kind: scopeKind,
    slug,
    entry: snapshot as Record<string, unknown>,
    user,
    overrideAccess: false,
  });
}
