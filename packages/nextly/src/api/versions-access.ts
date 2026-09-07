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
import { container } from "../di/container";
import type { FieldGroupDataService } from "../domains/field-groups/services/field-group-data-service";
import {
  resolveSingleDocumentId,
  singleDocumentEditable,
  singleDocumentReadable,
} from "../domains/singles/services/single-document-access";
import type { UserContext } from "../domains/singles/types";
import { computeVersionDiff } from "../domains/versions/diff";
import type { VersionDiff } from "../domains/versions/diff";
import { hydrateDiffReferences } from "../domains/versions/diff-references";
import { hydrateSnapshotReferences } from "../domains/versions/snapshot-references";
import {
  resolveComponentFieldMap,
  stripPasswordsThroughComponents,
} from "../domains/versions/tag-component-types";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type {
  ResolvedVersionsConfig,
  VersionScopeKind,
} from "../schemas/versions/types";
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
): Promise<{ user: UserContext; authenticatedScope?: AuthenticatedScope }> {
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

  // For an API-key request the live-document read gate must judge the key's OWN
  // read grant, not the key owner's roles — otherwise a super-admin-owned key
  // scoped for read could see a document's history while bypassing its stored
  // owner-only/custom read rule (the dispatcher path does the same).
  const authenticatedScope: AuthenticatedScope | undefined =
    auth.authMethod === "api-key"
      ? { actorType: "apiKey", permissions: auth.permissions }
      : undefined;

  await assertVersionDocumentReadable(
    scopeKind,
    slug,
    entryId,
    user,
    authenticatedScope
  );

  return { user, authenticatedScope };
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
  const liveId = await resolveSingleDocumentId(slug);
  if (liveId === null || liveId !== entryId) return false;

  // The access evaluation itself is shared with draft preview, which authorizes
  // the same disclosure for the same reason. Only the identity comparison above
  // is this gate's own.
  return singleDocumentEditable(slug, {
    user,
    // A version-label edit is a route-authorized `update`, so the coarse gate
    // for the operation being probed here has already run.
    routeAuthorized: true,
    ...(authenticatedScope === undefined ? {} : { actor: authenticatedScope }),
  });
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

  // Shared with draft preview for the reason the update gate above gives.
  return singleDocumentReadable(slug, {
    user,
    // The version route gates on `read` before reaching here, so the coarse
    // read check has run and re-running it would reject a scoped API key by
    // resolving its creator's roles.
    routeAuthorized: true,
    ...(authenticatedScope === undefined ? {} : { actor: authenticatedScope }),
  });
}

/**
 * Re-exported from the Singles domain, where it now lives beside the read probe
 * it guards. A DOMAIN module needs the same resolution — the dashboard's
 * pending-edit cards must not materialize a Single while deciding what to show —
 * and `domains/` must not import from `api/`.
 */
export { resolveSingleDocumentId };

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
  // The STRICT resolver: `null` means the lookup failed, which is different
  // from an entity that genuinely has no user-defined fields. Collapsing the
  // two would skip redaction entirely on a transient failure and hand back a
  // value the live read hides -- an assertion satisfied by absence, in the one
  // place where absence must stop the read.
  const fields = await tryResolveCurrentFields(scopeKind, slug);
  if (fields === null) {
    throw NextlyError.internal({
      logContext: {
        reason: "version-redaction-field-resolution-failed",
        scopeKind,
        scopeSlug: slug,
      },
    });
  }
  if (fields.length > 0) {
    // Through component REFERENCES as well. A `component` field carries only a
    // slug, so a walker given the top-level list alone sees a leaf: a password
    // declared inside a referenced component would be handed back even though
    // the live read hides it. Same reasoning as the field converted to
    // `password` after the fact -- the CURRENT schema decides, wherever the
    // field is declared.
    const dataService = container.has("fieldGroupDataService")
      ? container.get<FieldGroupDataService>("fieldGroupDataService")
      : null;
    const componentFields = dataService
      ? await resolveComponentFieldMap(fields, componentSlug =>
          dataService.getComponentFields(componentSlug)
        )
      : new Map<string, FieldConfig[]>();

    stripPasswordsThroughComponents(
      entry,
      fields,
      componentFields,
      stripPasswordFieldValues
    );
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
 * Current field configs for an entity. Used by redaction to decide what to
 * strip, and by the diff orchestration as the schema to walk. A lookup failure
 * yields an empty list rather than failing the request (redaction then falls
 * back to field-level access alone; a diff falls back to raw-key comparison).
 */
/**
 * The entity's stored versioning policy, as the registry persisted it.
 *
 * Deliberately NOT wrapped in a catch. `tryResolveCurrentFields` flattens a
 * failed lookup because its callers can degrade safely; a policy check cannot.
 * "I could not read the setting" and "the setting permits this" must never be
 * the same answer on a path that decides whether to store unpublished content,
 * so a lookup failure propagates and the caller refuses.
 *
 * Returns `null` for an entity that records no versions at all, which is a
 * definite answer rather than missing information: the registry writes the
 * property and sets it to null when versioning is off.
 */
export async function resolveVersionsPolicy(
  scopeKind: "collection" | "single",
  slug: string
): Promise<ResolvedVersionsConfig | null> {
  if (scopeKind === "single") {
    const registry = getService("singleRegistryService");
    const record = await registry.getSingleBySlug(slug);
    return (
      (record as { versions?: ResolvedVersionsConfig | null } | null)
        ?.versions ?? null
    );
  }
  const collections = getService("collectionService");
  const collection = await collections.getCollection(slug, {});
  return (
    (collection as { versions?: ResolvedVersionsConfig | null } | null)
      ?.versions ?? null
  );
}

/**
 * Current fields, or `null` when the lookup itself failed.
 *
 * Separated from `resolveCurrentFields` because the two answers are different:
 * a valid entity can legitimately have NO user-defined fields (a freshly
 * created Single whose identity columns alone form a document), and collapsing
 * that into the same empty array as a failed lookup forces every caller to
 * guess which happened. Callers that must fail closed read this one.
 */
export async function tryResolveCurrentFields(
  scopeKind: "collection" | "single",
  slug: string
): Promise<FieldConfig[] | null> {
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
    return null;
  }
}

/**
 * Current fields, with a failed lookup flattened to an empty list.
 *
 * Kept for the redaction paths, where "no fields" and "could not look" lead to
 * the same conservative behaviour. Derived from the strict form above rather
 * than repeating the lookups.
 */
export async function resolveCurrentFields(
  scopeKind: "collection" | "single",
  slug: string
): Promise<FieldConfig[]> {
  return (await tryResolveCurrentFields(scopeKind, slug)) ?? [];
}

/**
 * Current fields enriched with resolved component sub-schemas, so the diff
 * engine can walk into component fields. `enrichFieldsWithComponentSchemas`
 * takes and returns a `Record`-based shape; the enriched result is a structural
 * superset of `FieldConfig` (the same fields plus attached sub-schemas), which
 * the engine reads structurally. The casts are isolated here rather than at the
 * call site, matching the enrichment idiom the schema-detail routes use.
 */
async function resolveEnrichedFields(
  scopeKind: "collection" | "single",
  slug: string
): Promise<FieldConfig[]> {
  const rawFields = await resolveCurrentFields(scopeKind, slug);
  const fieldGroupRegistry = getService("fieldGroupRegistryService");
  const enriched = await fieldGroupRegistry.enrichFieldsWithComponentSchemas(
    rawFields as unknown as Record<string, unknown>[]
  );
  return enriched as unknown as FieldConfig[];
}

/** A stored snapshot as a plain object, or an empty object if it is not one. */
function snapshotObject(snapshot: unknown): Record<string, unknown> {
  return snapshot !== null &&
    typeof snapshot === "object" &&
    !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : {};
}

/** Validate the version pair a diff compares before any read runs. */
export function assertDiffVersionPair(from: number, to: number): void {
  for (const [value, path] of [
    [from, "from"],
    [to, "to"],
  ] as const) {
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
  if (from === to) {
    throw NextlyError.validation({
      errors: [
        {
          path: "to",
          code: "INVALID_VALUE",
          message: "Cannot compare a version with itself.",
        },
      ],
    });
  }
}

/**
 * Resolve the relationship and upload references in a version snapshot to the
 * value kit's display shape, in place, for the caller.
 *
 * Runs AFTER redaction, on the same enriched schema the diff walks, so a
 * preview renders labels through the one value kit and a field the caller may
 * not read is dropped before its references are ever resolved. The dispatcher
 * read and the standalone route both call this, so the fields-resolution and
 * hydration are defined once rather than duplicated between them.
 */
export async function hydrateVersionSnapshot(
  snapshot: unknown,
  scopeKind: VersionScopeKind,
  slug: string,
  user: UserContext,
  authenticatedScope?: AuthenticatedScope,
  // The version's locale, so a localized display column on a referenced target
  // resolves in the language the snapshot was captured in.
  locale?: string | null
): Promise<void> {
  const lookupKind = scopeKind === "single" ? "single" : "collection";
  const fields = await resolveEnrichedFields(lookupKind, slug);
  await hydrateSnapshotReferences(
    snapshot,
    fields,
    user,
    authenticatedScope,
    locale
  );
}

/**
 * Compute a diff of two versions AFTER the caller has confirmed read access to
 * the document. The dispatcher method and the standalone route both call this,
 * so the get/redact/walk logic has exactly one definition and each surface
 * applies its own read gate (mirroring how both reuse `versions.get`).
 *
 * Both snapshots are redacted for the caller before the pure engine sees them,
 * so the diff can never surface a field the caller may not read. The two
 * versions must share a locale: each snapshot records one locale's values, so a
 * cross-locale comparison is meaningless. The schema is enriched with component
 * sub-schemas so nested component fields diff field-by-field.
 */
export async function diffDocumentVersions(args: {
  scopeKind: VersionScopeKind;
  slug: string;
  entryId: string;
  user: UserContext;
  from: number;
  to: number;
  modifiedOnly?: boolean;
  authenticatedScope?: AuthenticatedScope;
}): Promise<VersionDiff> {
  const versions = getService("versionsService");
  const ref = {
    scopeKind: args.scopeKind,
    scopeSlug: args.slug,
    entryId: args.entryId,
  };
  const [fromRow, toRow] = await Promise.all([
    versions.get(ref, args.from),
    versions.get(ref, args.to),
  ]);

  if (fromRow.locale !== toRow.locale) {
    throw NextlyError.validation({
      errors: [
        {
          path: "to",
          code: "LOCALE_MISMATCH",
          message: "The two versions belong to different locales.",
        },
      ],
      logContext: {
        reason: "version-diff-locale-mismatch",
        scopeKind: args.scopeKind,
        slug: args.slug,
        from: args.from,
        to: args.to,
      },
    });
  }

  // Redact each snapshot for the caller BEFORE diffing, so the diff can never
  // surface a field the caller may not read.
  await redactSnapshotForUser(
    fromRow.snapshot,
    args.scopeKind,
    args.slug,
    args.user
  );
  await redactSnapshotForUser(
    toRow.snapshot,
    args.scopeKind,
    args.slug,
    args.user
  );

  // Page scope has no HTTP diff surface; collection and single are the only
  // callers, so anything else resolves as a collection for field lookup.
  const lookupKind = args.scopeKind === "single" ? "single" : "collection";
  const fields = await resolveEnrichedFields(lookupKind, args.slug);

  const body = computeVersionDiff(
    snapshotObject(fromRow.snapshot),
    snapshotObject(toRow.snapshot),
    fields,
    { modifiedOnly: args.modifiedOnly }
  );

  // Resolve relationship and upload ids in the diff to display labels through
  // the same access-checked path a read uses: an unreadable target stays a bare
  // id. Labels attach beside the ids rather than replacing them, so the diff
  // wire stays id-stable for any non-admin consumer of this surface. Both
  // versions share a locale (asserted above), so the target reads resolve in
  // that language.
  await hydrateDiffReferences(
    body.fields,
    args.user,
    args.authenticatedScope,
    fromRow.locale
  );

  return {
    from: args.from,
    to: args.to,
    locale: fromRow.locale,
    hasChanges: body.hasChanges,
    fields: body.fields,
  };
}
