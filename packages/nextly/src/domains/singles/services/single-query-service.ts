/**
 * Single Query Service
 *
 * Read-path service for Single documents. Handles:
 *
 * - Registry lookup via SingleRegistryService
 * - RBAC access evaluation (`read` operation)
 * - Before/after read hooks
 * - Auto-creation of the underlying document on first access
 * - JSON field deserialization
 * - Upload field expansion with full media metadata
 * - Relationship field expansion via CollectionRelationshipService
 * - Component field population via FieldGroupDataService
 *
 *
 * @module domains/singles/services/single-query-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { inArray, type AnyColumn } from "drizzle-orm";

import {
  apiKeyWriteAllowed,
  type AuthenticatedScope,
} from "../../../auth/authenticated-scope";
import type { FieldConfig } from "../../../collections/fields/types";
import { getDialectTables } from "../../../database";
import { container } from "../../../di/container";
import type { Nextly as NextlyDirectAPI } from "../../../direct-api/nextly";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import { NextlyError } from "../../../errors/nextly-error";
import {
  buildContext,
  type BuildContextOptions,
} from "../../../hooks/context-builder";
import type { HookRegistry } from "../../../hooks/hook-registry";
import {
  resolveRequestFacts,
  type ResolvedRequestFacts,
} from "../../../hooks/request-facts";
import type { HookContext } from "../../../hooks/types";
import { keysToCamelCase, keysToSnakeCase } from "../../../lib/case-conversion";
import { absolutizeMediaUrls } from "../../../lib/media-variant";
import {
  expansionStatusScope,
  resolveStatusFilter,
  type StatusFilter,
} from "../../../lib/status-filter";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import { isSuperAdminContext } from "../../../services/access";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import type { RelatedRowReadContext } from "../../../services/collections/related-row-read-context";
import {
  applyMediaTrustBound,
  expansionAccess,
} from "../../../services/collections/trust-bound";
import type { TrustBound } from "../../../services/collections/trust-grant";
import {
  TRUSTS_EVERY_COLLECTION,
  assumedBound,
  narrows,
} from "../../../services/collections/trust-grant";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { BaseService } from "../../../shared/base-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import { cloneDefault } from "../../../shared/lib/field-defaults";
import {
  applyFieldReadAccess,
  runFieldHooks,
} from "../../../shared/lib/field-level-registry";
import { coerceDateFieldsToDate } from "../../../shared/lib/field-transform";
import {
  hasPasswordField,
  stripPasswordFieldValues,
} from "../../../shared/lib/password-fields";
import type { Logger } from "../../../shared/types";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { COMPANION_UPDATED_AT_COLUMN } from "../../i18n/companion-columns";
import {
  populateCompanionFields,
  populateTranslationStatus,
} from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import { resolveLocaleChain } from "../../i18n/resolve-locale";
import {
  buildCompanionSchema,
  splitLocalizedWrite,
  upsertCompanionRow,
} from "../../i18n/runtime/companion-io";
import {
  isCompanionReady,
  resolveCompanionColumn,
  resolveCompanionSchemaReadiness,
} from "../../i18n/runtime/companion-readiness";
import {
  NO_RELEASE_VISIBILITY,
  type ReleaseVisibility,
} from "../../releases/release-visibility";
import {
  getColumnDescriptor,
  isTextStorageKind,
} from "../../schema/services/field-column-descriptor";
import { captureInTx } from "../../versions/capture-in-tx";
import {
  draftDocumentFacts,
  resolveDraftOverlay,
} from "../../versions/draft-overlay";
import type { ComponentSchemas } from "../../versions/restore-snapshot";
import { resolveComponentSchemas } from "../../versions/restore-version";
import { shapeDraftSnapshot } from "../../versions/shape-draft-snapshot";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { withVersionConflictRetry } from "../../versions/version-conflict";
import { VersionsRepository } from "../../versions/versions-repository";
import type {
  GetSingleOptions,
  SingleDocument,
  SingleResult,
  UserContext,
} from "../types";

import { resolveSingleForRequest } from "./ensure-runtime-table";
import { applyReadShape } from "./single-read-shape";
import type { SingleRegistryService } from "./single-registry-service";
import {
  assertNoPasswordDefault,
  assertValidPluginDefault,
  buildSingleErrorResult,
  collectAllMediaIds,
  deserializeJsonFields,
  expandMediaInData,
  getDefaultValue,
  shouldTreatAsJson,
} from "./single-utils";

/**
 * Reserved system identity field names every Single carries as columns (the
 * `title`/`slug` auto-injected by `defineSingle`, seeded from label/slug). Their
 * default seeding is handled specially so a same-named user field never strands
 * the system column or receives a wrong-typed default.
 */
const SINGLE_IDENTITY_FIELDS = new Set(["title", "slug"]);

/**
 * A Single's default document, built but not yet written. The read path judges
 * it before deciding whether the read may create the Single, then hands the
 * same draft to the insert so the row written is the one that was judged.
 */
type DefaultDocumentDraft = {
  document: SingleDocument;
  insertValues: Record<string, unknown>;
  localizedDefaults: Record<string, unknown>;
};

/**
 * Relationship depth an unqualified read expands to. Named here because the
 * authorization view has to reason about it: a rule must not see less than a
 * default read would show, whatever depth the caller asked for.
 */
const DEFAULT_READ_DEPTH = 2;

/** Whether these fields hold a relationship, optionally looking inside containers. */
function containsRelationField(
  fields: FieldConfig[],
  includeNested: boolean
): boolean {
  return fields.some(field => {
    if (!("name" in field) || !field.name) return false;
    const type = field.type as string;
    if (type === "relationship" || type === "relation") return true;
    if (!includeNested || (type !== "group" && type !== "repeater")) {
      return false;
    }
    const nested = "fields" in field ? (field.fields as FieldConfig[]) : [];
    return Array.isArray(nested) && containsRelationField(nested, true);
  });
}

/** Hook namespace prefix for Singles. */
export const SINGLE_HOOK_NAMESPACE = "single";

/**
 * Get the hook collection name for a Single.
 * Uses the `single:` prefix to distinguish from collections.
 */
export function getSingleHookCollection(slug: string): string {
  return `${SINGLE_HOOK_NAMESPACE}:${slug}`;
}

/**
 * Resolve the Nextly Direct API instance from DI container for hook contexts.
 * Returns undefined if not yet initialized (safe for early service usage).
 */
export function resolveNextlyForHooks(): NextlyDirectAPI | undefined {
  if (!container.has("nextlyDirectAPI")) {
    return undefined;
  }
  try {
    return container.get<NextlyDirectAPI>("nextlyDirectAPI");
  } catch {
    return undefined;
  }
}

/**
 * Build a HookContext with the Nextly Direct API instance injected into `req.nextly`.
 *
 * `req` is required for the reason the collection builder's is: a Single's
 * hooks run on browser traffic through the admin, so a path that has a request
 * and forgets to pass it tells them a person's edit was server-side work.
 */
export function buildSingleHookContext<T>(
  options: BuildContextOptions<T> & { req: ResolvedRequestFacts }
): HookContext<T> {
  return buildContext({
    ...options,
    req: {
      ...options.req,
      nextly: resolveNextlyForHooks(),
    },
  });
}

/**
 * Check access for a Single operation.
 *
 * Evaluation order:
 * 1. `overrideAccess` bypass → null (allow)
 * 2. Super-admin (by authorized role) bypass → null (allow)
 * 3. `routeAuthorized` with a verified user → null: the route middleware
 *    already ran the RBAC gate, so skip that redundant re-check.
 * 4. Anonymous publish/unpublish → 403, whatever any rule says.
 * 5. No user → the Single's own code-defined rule decides, handed a real
 *    anonymous context; a rule that names nothing lets the request through
 *    to the public default. The DB-permission half needs a user and does not
 *    run. Mirrors the collection gate, so one rule gives one answer.
 * 6. No RBAC service → null (skip)
 * 7. RBAC check (super-admin → code-defined → DB permissions)
 * 8. Fail-secure on unexpected errors
 *
 * @returns `null` if access is allowed, `SingleResult` if denied
 */
export async function checkSingleAccess(params: {
  slug: string;
  operation: "read" | "update" | "publish" | "unpublish";
  user?: UserContext;
  overrideAccess?: boolean;
  /**
   * Which collections a trusted read may reach as relationships are expanded,
   * asked per RELATED collection. Absent means every populated target inherits
   * the caller's trust. Evaluated as `overrideAccess && trusted(target)`, so it
   * can only ever narrow. See {@link RelatedRowReadContext.trusted}.
   */
  trusted?: TrustBound;
  routeAuthorized?: boolean;
  rbacAccessControlService?: RBACAccessControlService;
  // The caller's authenticated scope. A scoped API key is judged on its OWN
  // stamped grants for the publish/unpublish transition, not the owner's RBAC.
  authenticatedScope?: AuthenticatedScope;
  logger: Logger;
}): Promise<SingleResult | null> {
  const {
    slug,
    operation,
    user,
    overrideAccess,
    routeAuthorized,
    rbacAccessControlService,
    authenticatedScope,
    logger,
  } = params;

  if (overrideAccess) {
    return null;
  }

  // Super-admins bypass the RBAC gate on every transport — EXCEPT via a
  // scoped API key. The bypass belongs to the session path: a key is
  // authoritative on its OWN stamped scope, never on the owner's roles, so a
  // read/update-only key issued by an admin is not equivalent to their full
  // account (mirrors canReadEntity). Otherwise a super-admin-owned, update-only
  // key could publish.
  if (authenticatedScope?.actorType !== "apiKey" && isSuperAdminContext(user)) {
    return null;
  }

  // The route middleware already ran this exact RBAC gate; skip the redundant
  // re-check — but only when a verified user is present, so a caller that sets
  // routeAuthorized without authenticating cannot silently allow an anonymous
  // write. Field-level write access still applies downstream (overrideAccess is
  // false).
  if (routeAuthorized && user) {
    return null;
  }

  // Secure-by-default publish gate: publishing/unpublishing changes a document's
  // privileged published state, so an anonymous caller may never do it. Without
  // this the operation falls through to the permission-less public default below
  // (`!user` → allow), letting an unauthenticated caller publish a
  // publicly-writable Single.
  if (!user && (operation === "publish" || operation === "unpublish")) {
    return {
      success: false,
      statusCode: 403,
      message: `Access denied: ${operation} on single "${slug}" requires an authenticated user`,
    };
  }

  if (!user) {
    // A caller with NO session, judged against the Single's own code-defined
    // rule. Everything below resolves roles and permissions from a user id, so
    // without one the DB-permission half has nothing to check — but the rule
    // reads nothing off the caller, and `read: false` or
    // `read: ({ user }) => !!user` on a Single describes this caller most
    // clearly of all. Left unasked here, the same rule refused an anonymous
    // reader on a collection and admitted one on a Single.
    //
    // `undefined` means no code-defined rule governs the operation, and the
    // request falls through to the public default. A boolean is the verdict.
    const allowed = await rbacAccessControlService?.checkAnonymousCodeAccess({
      operation,
      resource: slug,
    });
    if (allowed === false) {
      return {
        success: false,
        statusCode: 403,
        message: `Access denied: insufficient permissions for ${operation} on single "${slug}"`,
      };
    }
    return null;
  }

  // A scoped API key is authorized on its OWN stamped grants, not the key
  // owner's: the route only checked `update` against the key's scope, so this
  // publish/unpublish re-check must consult the key's own permission list AND
  // the code-defined access rule against that scope. `apiKeyWriteAllowed`
  // returns null for a non-API-key caller, falling through to the owner/session
  // RBAC path below.
  const scopeDecision = await apiKeyWriteAllowed(
    authenticatedScope,
    operation,
    slug,
    user,
    rbacAccessControlService
  );
  if (scopeDecision !== null) {
    return scopeDecision
      ? null
      : {
          success: false,
          statusCode: 403,
          message: `Access denied: insufficient permissions for ${operation} on single "${slug}"`,
        };
  }

  if (!rbacAccessControlService) {
    return null;
  }

  try {
    const allowed = await rbacAccessControlService.checkAccess({
      userId: user.id,
      operation,
      resource: slug,
    });
    if (!allowed) {
      return {
        success: false,
        statusCode: 403,
        message: `Access denied: insufficient permissions for ${operation} on single "${slug}"`,
      };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("RBAC access check failed for Single", {
      slug,
      operation,
      userId: user.id,
      error: message,
    });
    return {
      success: false,
      statusCode: 500,
      message: "Failed to verify RBAC permissions",
    };
  }

  return null;
}

// ============================================================
// Service Implementation
// ============================================================

/**
 * SingleQueryService
 *
 * Handles the read-path for Single documents. Also owns the helpers
 * that are needed by SingleMutationService for auto-creation,
 * deserialization, and media/relationship expansion on the returned
 * document — those are exposed as public methods so that the mutation
 * service can reuse them without duplication.
 */
export class SingleQueryService extends BaseService {
  /** Persists version snapshots; used when a versioned Single is auto-created. */
  private readonly versionCapture = new VersionCaptureService();

  /**
   * Whether this Single is visible to a lifecycle-bounded read, releases
   * included.
   *
   * A collection read filters rows in SQL, so a release widens the filter.
   * A Single is one row per slug and is never filtered — it is loaded and then
   * REFUSED with a 404 when its status is not what the caller may see. So here
   * the release has to reach the refusal rather than the query.
   *
   * The WHOLE rule lives here, not just the release half, because two call
   * sites apply it and a rule split between a helper and its callers drifts:
   * one of them would learn about withdrawals and the other would not, and a
   * Single would be gone from one entry point and present from the other.
   *
   * Only the release lookup is skipped for a non-published read: an unbounded
   * or draft-only view has nothing for a release to reveal, and asking anyway
   * would spend the lookup on a question whose answer cannot change the
   * outcome.
   */
  private async isSingleVisible(input: {
    slug: string;
    documentId: unknown;
    storedStatus: string | undefined;
    statusFilter: StatusFilter;
    /**
     * The instant this READ resolves releases against.
     *
     * One `get` asks this twice — once to screen the stored row before a
     * deferred rule runs, once on the document it finally returns. Taking a
     * fresh clock reading in each would let a release become due between them:
     * the first admits the row and lets `beforeOperation`/`beforeRead` hooks
     * and rule assembly run, and the second then 404s, so a request that was
     * ultimately refused has already caused its read side effects.
     */
    now: Date;
  }): Promise<boolean> {
    // Membership, not equality: a read bounded to "not yet public" covers every
    // state the workflow does not publish, and comparing against one of them
    // would hide a Single sitting in any of the others.
    const matchesStatus =
      input.storedStatus !== undefined &&
      input.statusFilter.values.includes(input.storedStatus);
    // Read off the filter rather than re-derived. Only a public read is widened
    // by a due release; a read of pending work has nothing for one to reveal.
    if (!input.statusFilter.isPublicRead) {
      return matchesStatus;
    }
    if (typeof input.documentId !== "string") return matchesStatus;

    const decisions = await this.releaseVisibility.decisions({
      scopeKind: "single",
      scopeSlug: input.slug,
      now: input.now,
    });
    // A withdrawal outranks the stored status: the row still says published,
    // and that is precisely what the release is undoing. Checked BEFORE the
    // stored status, so a due takedown 404s a Single that is published today.
    if (decisions.hide.includes(input.documentId)) return false;
    return matchesStatus || decisions.reveal.includes(input.documentId);
  }

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly singleRegistryService: SingleRegistryService,
    private readonly hookRegistry: HookRegistry,
    private readonly fieldGroupDataService?: FieldGroupDataService,
    private readonly rbacAccessControlService?: RBACAccessControlService,
    // i18n: when set and the single is localized, reads resolve translatable fields
    // from the companion `single_<slug>_locales` table for the requested locale.
    private readonly localization?: SanitizedLocalizationConfig,
    /**
     * What a due release makes visible.
     *
     * A null object by default, so a construction site without releases wired
     * needs no special case and cannot narrow a read by forgetting one.
     */
    private readonly releaseVisibility: ReleaseVisibility = NO_RELEASE_VISIBILITY
  ) {
    super(adapter, logger);
  }

  /**
   * Build the document a caller would receive from a stored row.
   *
   * Covers only the stages that read: the companion translation overlay, JSON
   * deserialization, and upload, relationship and component expansion. No hook
   * runs and nothing is written, so this is safe to perform for a caller who may
   * still be refused.
   */
  /**
   * Replace the assembled live document with this Single's pending change, when
   * the caller asked for it and may edit the document.
   *
   * Returns the document unchanged whenever no overlay applies, so the caller
   * reads as one statement rather than a branch.
   */
  /**
   * Whether this read shows the Single's pending change, and what it needs to
   * fetch it — or `null` when it does not.
   *
   * Separated from the application below because they answer different
   * questions and fail for different reasons: this one is entirely about
   * eligibility and trust, and returns nothing the caller has to interpret.
   */
  private async resolveWorkingDraftView(params: {
    slug: string;
    singleMeta: DynamicSingleRecord;
    options: GetSingleOptions;
  }): Promise<{
    draftLocale: string | null;
    componentSchemas: ComponentSchemas;
  } | null> {
    const { slug, singleMeta, options } = params;

    const overlayInput = {
      ...draftDocumentFacts(singleMeta),
      fields: singleMeta.fields,
      includeWorkingDraft: options.includeWorkingDraft === true,
      requestedStatus: options.status,
      requestLocale: options.locale ?? null,
      defaultLocale: this.localization?.defaultLocale ?? null,
    };

    // The CHEAP half: component schemas unresolved, so the registry reads stay
    // off the common read path. With no schemas the eligibility test can only be
    // more permissive, so a `false` here is final.
    if (
      !resolveDraftOverlay({
        ...overlayInput,
        componentSchemas: null,
        callerMayEdit: true,
      }).overlay
    ) {
      return null;
    }

    if (!(await this.callerMayEditSingle(slug, singleMeta, options))) {
      return null;
    }

    const componentSchemas = await resolveComponentSchemas(singleMeta.fields);
    const decision = resolveDraftOverlay({
      ...overlayInput,
      componentSchemas,
      callerMayEdit: true,
    });
    return decision.overlay
      ? { draftLocale: decision.draftLocale, componentSchemas }
      : null;
  }

  /**
   * Whether this caller may EDIT the Single, which is what a pending change is
   * shown to.
   *
   * `routeAuthorized` is deliberately not consulted: on the read path it attests
   * that a READ was authorized, so trusting it would hand one author's
   * unpublished work to any authenticated reader.
   */
  private async callerMayEditSingle(
    slug: string,
    singleMeta: DynamicSingleRecord,
    options: GetSingleOptions
  ): Promise<boolean> {
    if (options.overrideAccess === true) return true;
    if (options.user === undefined) return false;

    const updateDenied = await checkSingleAccess({
      slug,
      operation: "update",
      user: options.user,
      overrideAccess: false,
      routeAuthorized: false,
      rbacAccessControlService: this.rbacAccessControlService,
      authenticatedScope: options.authenticatedScope,
      logger: this.logger,
    });
    return !updateDenied;
  }

  /**
   * The access context a related row is read under on this Single's read path.
   *
   * ONE builder for every expansion the read performs — the live document and
   * the working-draft overlay that replaces it — because the two used to
   * assemble their own contexts and the overlay's set neither enforcement
   * flag. An incomplete context is a VALID one describing a different caller,
   * so the overlay silently read every target fully trusted: a relationship in
   * a pending draft exposed rows from a target whose rule refuses this caller,
   * while the live relationship and a direct read of the target withheld them.
   */
  private relatedRowAccess(
    options: GetSingleOptions,
    enforceRelatedFieldAccess: boolean,
    readLocale: string | undefined
  ): RelatedRowReadContext {
    return {
      enforceFieldAccess: enforceRelatedFieldAccess,
      // Beside the flag, never folded into `user`: a preview judges a related
      // row's fields as the sharer while every hook goes on seeing the
      // anonymous visitor who is actually asking.
      fieldAccessUser: options.fieldAccessUser,
      // Always on, unlike field redaction: a related row the target collection
      // refuses this caller must not reach the response.
      enforceCollectionAccess: true,
      user: options.user,
      overrideAccess: options.overrideAccess,
      // Narrows that bypass per RELATED collection. Absent means unchanged;
      // dropping it here would silently restore the full bypass.
      trusted: assumedBound(options.trusted),
      authenticatedScope: options.authenticatedScope,
      locale: readLocale,
      // Only "read everything" propagates, and only when asked for: the
      // admin sends it on every read, a public caller never does.
      status: expansionStatusScope({
        status: options.status,
        overrideAccess: options.overrideAccess,
        bounded: narrows(options.trusted),
      }),
    };
  }

  /**
   * Replace the assembled live document with this Single's pending change, when
   * one applies.
   *
   * Returns the document unchanged whenever no overlay applies, so the caller
   * reads as one statement rather than a branch.
   */
  private async overlayWorkingDraft(params: {
    slug: string;
    singleMeta: DynamicSingleRecord;
    doc: SingleDocument;
    options: GetSingleOptions;
    /** As handed to the live assembly this overlay replaces. */
    enforceRelatedFieldAccess: boolean;
  }): Promise<SingleDocument> {
    const { slug, singleMeta, doc, options, enforceRelatedFieldAccess } =
      params;

    const entryId = (doc as { id?: string }).id;
    if (entryId === undefined) return doc;

    const view = await this.resolveWorkingDraftView({
      slug,
      singleMeta,
      options,
    });
    if (view === null) return doc;

    const workingDraft = await new VersionsRepository(
      this.adapter
    ).findWorkingDraft(
      { scopeKind: "single", scopeSlug: slug, entryId },
      view.draftLocale
    );
    if (!workingDraft) return doc;

    const shaped = shapeDraftSnapshot({
      snapshot: workingDraft.snapshot as Record<string, unknown>,
      fields: singleMeta.fields,
      componentSchemas: view.componentSchemas,
      hasSlug: singleMeta.fields.some(f => f.name === "slug"),
      hasTitle: singleMeta.fields.some(f => f.name === "title"),
      // A Single's live read normalizes its system timestamps to strings, so
      // rehydrating them here would make a drafted Single disagree with a
      // published one — the opposite of the parity this shaping exists for.
      rehydrateSystemTimestampsToDate: false,
    }) as unknown as SingleDocument;

    // The snapshot REPLACES the assembled document, so every response-shaping
    // stage the live read applied has to be applied to it too — otherwise a
    // drafted Single comes back in a different shape from a published one, and
    // an afterRead hook receives a serialized string where it expects an object.
    // The snapshot stores JSON-backed fields serialized and relations as ids,
    // exactly as the live row does, so the same stages restore both.
    let overlaid = this.deserializeJsonFields(shaped, singleMeta.fields);
    overlaid = await this.expandUploadFields(
      overlaid,
      singleMeta.fields,
      expansionAccess(options)
    );
    // The SAME context the live document's relationships were read under,
    // so a related row is judged identically whether it arrived through the
    // live row or through the draft that replaces it.
    overlaid = await this.expandRelationshipFields(
      overlaid,
      singleMeta.fields,
      options.depth,
      this.relatedRowAccess(
        options,
        enforceRelatedFieldAccess,
        resolveLocaleChain(
          this.localization,
          options.locale,
          options.fallbackLocale
        )?.[0]
      ),
      // As the live read does: the caller is threaded, so nested targets can
      // be judged too.
      true
    );
    // Component POPULATION is deliberately NOT re-run, mirroring the collection
    // overlay. The snapshot already carries the draft's own component values;
    // re-reading them from their tables would replace the pending edits with
    // live content, which is the one thing an overlay must not do.

    // The flag the editor reads to show "Changed" and offer Discard. Set only
    // when a draft was actually overlaid, so a read of a language with no
    // pending change reports nothing — which is what makes it per-language.
    (overlaid as Record<string, unknown>)._isWorkingDraft = true;
    return overlaid;
  }

  private async assembleStoredDocument(params: {
    slug: string;
    singleMeta: DynamicSingleRecord;
    doc: SingleDocument;
    options: GetSingleOptions;
    statusFilterValues: readonly string[] | undefined;
    /**
     * Whether to apply the TARGET collection's field rules to related rows.
     * Off for the copy an access rule is judged on: redaction removes the very
     * values a rule may be written to inspect, and a rule shown `undefined`
     * where the document holds something reads that absence as permission.
     */
    enforceRelatedFieldAccess: boolean;
  }): Promise<SingleDocument> {
    const {
      slug,
      singleMeta,
      options,
      statusFilterValues,
      enforceRelatedFieldAccess,
    } = params;
    let doc = params.doc;

    // i18n: resolve translatable fields from the companion `_locales` table for the
    // requested locale (with fallback) BEFORE deserialization and upload/relationship/component
    // expansion — the companion stores JSON/upload/relationship values in their raw storage form,
    // so the overlay must land before those transforms run (matching the collection read path).
    // No-op when localization is off or the single isn't localized.
    try {
      await this.populateLocalized(
        slug,
        singleMeta,
        doc,
        options.locale,
        options.fallbackLocale,
        statusFilterValues
      );
    } catch (error) {
      // A companion read failure propagates, and the result builder puts a bare
      // Error's own message on the wire — the failed query, with companion table
      // and column names in it.
      throw NextlyError.is(error)
        ? error
        : NextlyError.internal({
            cause: error instanceof Error ? error : undefined,
            logContext: {
              single: slug,
              reason: "translation-load-failed",
            },
          });
    }

    doc = this.deserializeJsonFields(doc, singleMeta.fields);
    doc = await this.expandUploadFields(
      doc,
      singleMeta.fields,
      expansionAccess(options)
    );
    // The language this read resolved to, shared by both expansions below so a
    // related row and a related row inside a component are judged alike.
    const readLocale = resolveLocaleChain(
      this.localization,
      options.locale,
      options.fallbackLocale
    )?.[0];
    doc = await this.expandRelationshipFields(
      doc,
      singleMeta.fields,
      options.depth,
      this.relatedRowAccess(options, enforceRelatedFieldAccess, readLocale),
      // The read path threads a caller, so the target collection's field rules
      // can be evaluated for the rows this pulls in.
      true
    );

    if (this.fieldGroupDataService) {
      try {
        doc = (await this.fieldGroupDataService.populateComponentData({
          entry: doc,
          parentTable: singleMeta.tableName,
          fields: singleMeta.fields,
          depth: options.depth,
          // i18n: thread the read locale so an embedded localized component resolves
          // its translatable fields per language, and forward fallback control so a
          // no-fallback read (`?fallback-locale=none`) leaves untranslated embedded
          // fields blank instead of showing default-language text.
          locale: options.locale,
          fallbackLocale: options.fallbackLocale,
          // A component's relationship fields copy whole rows out of the target
          // collection, which a Single's field list never describes — so the
          // caller travels down to reach the related row's own rules.
          access: {
            enforceFieldAccess: enforceRelatedFieldAccess,
            // Beside the flag, never folded into `user`: a preview judges a related
            // row's fields as the sharer while every hook goes on seeing the
            // anonymous visitor who is actually asking.
            fieldAccessUser: options.fieldAccessUser,
            enforceCollectionAccess: true,
            user: options.user as Record<string, unknown> | undefined,
            overrideAccess: options.overrideAccess,
            // Narrows that bypass per RELATED collection. Absent means unchanged;
            // dropping it here would silently restore the full bypass.
            trusted: assumedBound(options.trusted),
            // The rows of one population share a policy cache.
            targetPolicies: new Map(),
            targetCompanions: new Map(),
            targetVerdicts: new Map(),
            authenticatedScope: options.authenticatedScope,
            locale: readLocale,
            status: expansionStatusScope({
              status: options.status,
              overrideAccess: options.overrideAccess,
              bounded: narrows(options.trusted),
            }),
          },
        })) as SingleDocument;
      } catch (error) {
        // The result builder puts a bare Error's own message on the wire —
        // component table and column names the caller has no business seeing.
        throw NextlyError.is(error)
          ? error
          : NextlyError.internal({
              cause: error instanceof Error ? error : undefined,
              logContext: {
                single: slug,
                reason: "component-population-failed",
              },
            });
      }
    }

    return doc;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Get a Single document by slug.
   *
   * Auto-creates the document with default field values if it does
   * not yet exist.
   */
  async get(
    slug: string,
    options: GetSingleOptions = {}
  ): Promise<SingleResult> {
    this.logger.debug("Getting Single document", { slug, options });

    // ONE instant for this read. Both visibility checks below resolve releases
    // against it, so a release becoming due between them cannot admit the row
    // for the deferred-rule screen and then 404 the document it returns.
    const readNow = new Date();

    try {
      // 1. Get Single metadata from registry
      const singleMeta = await resolveSingleForRequest(
        this.adapter,
        this.singleRegistryService,
        slug,
        this.logger
      );
      if (!singleMeta) {
        return {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" not found`,
        };
      }

      // 1.5. Access check (RBAC) after metadata, before hooks/DB operations.
      const accessDenied = await checkSingleAccess({
        slug,
        operation: "read",
        user: options.user,
        overrideAccess: options.overrideAccess,
        routeAuthorized: options.routeAuthorized,
        rbacAccessControlService: this.rbacAccessControlService,
        // A scoped API key is judged on its OWN read grant, so a super-admin-owned
        // key does not skip the read gate via the owner's roles.
        authenticatedScope: options.authenticatedScope,
        logger: this.logger,
      });
      if (accessDenied) {
        return accessDenied;
      }

      const statusFilter = resolveStatusFilter({
        collectionHasStatus:
          (singleMeta as { status?: boolean }).status === true,
        overrideAccess: options.overrideAccess === true,
        explicit: options.status,
      });

      // 2. Build shared context for hooks (seed with caller-provided context)
      const sharedContext: Record<string, unknown> = { ...options.context };
      // Resolved once for the whole operation, so every hook phase is told the
      // same thing about the caller.
      const requestFacts = resolveRequestFacts(options.request);
      const hookCollection = getSingleHookCollection(slug);

      // 3. Execute beforeOperation hook
      if (this.hookRegistry.hasHooks("beforeOperation", hookCollection)) {
        await this.hookRegistry.executeBeforeOperation({
          collection: hookCollection,
          operation: "read",
          args: {},
          user: options.user ?? undefined,
          context: sharedContext,
          req: {
            ...requestFacts,
            nextly: resolveNextlyForHooks(),
          },
        });
      }

      // 4. Execute beforeRead hooks
      if (this.hookRegistry.hasHooks("beforeRead", hookCollection)) {
        const beforeContext = buildSingleHookContext({
          collection: hookCollection,
          operation: "read",
          data: { slug },
          user: options.user ?? undefined,
          context: sharedContext,
          req: requestFacts,
        });
        await this.hookRegistry.execute("beforeRead", beforeContext);
      }

      // 5. Fetch document from database. Read after the hooks rather than
      // reusing the row an access decision loaded before them: a `beforeRead`
      // hook may write, and a response built from the earlier snapshot would
      // report values the read no longer finds.
      let doc = await this.adapter.selectOne<SingleDocument>(
        singleMeta.tableName,
        {}
      );

      // 6. Auto-create if document doesn't exist. Capture the initial version
      // when the Single is versioned so a first-read materialization still
      // starts a history (the mutation path records its own first version).
      if (!doc) {
        this.logger.info("Auto-creating Single document", { slug });
        doc = await this.createDefaultDocument(singleMeta, {
          captureInitialVersion: true,
        });
      }

      // 6.5. Apply Draft/Published auto-filter. For Singles the rule is
      // identical to Collections: when status is enabled, public callers see
      // only published; trusted callers see all. A draft Single returns 404
      // so its existence is invisible to public callers — same response shape
      // as a not-yet-created Single.
      if (
        statusFilter &&
        !(await this.isSingleVisible({
          slug,
          documentId: (doc as { id?: unknown }).id,
          storedStatus: (doc as { status?: string }).status,
          statusFilter,
          now: readNow,
        }))
      ) {
        return {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" not found`,
        };
      }

      // 6.9 - 7.7. Resolve translations and expand uploads, relationships and
      // components into the document.
      //
      // Related rows are redacted HERE rather than after the response is built,
      // unlike this Single's own fields. A related row's chosen label is a copy
      // of one of its field values, derived while the row is expanded, so
      // redacting afterwards would leave a withheld value standing in the label
      // it was copied into.
      doc = await this.assembleStoredDocument({
        slug,
        singleMeta,
        doc,
        options,
        statusFilterValues: statusFilter ? statusFilter.values : undefined,
        enforceRelatedFieldAccess: true,
      });

      // On a trusted draft-view read, surface this Single's pending change in
      // place of the live document. Placed AFTER the live assembly, so
      // re-reading live companion values by the same id cannot clobber the
      // draft's, and BEFORE the password strip, the afterRead hooks and the
      // field-level read access below, so a snapshot is redacted and judged
      // exactly like any other read.
      //
      // The decision comes from the same rule the WRITE uses. A read that
      // decided this for itself is how a held edit becomes invisible: the write
      // reports success and the read returns the old content.
      doc = await this.overlayWorkingDraft({
        slug,
        singleMeta,
        doc,
        options,
        enforceRelatedFieldAccess: true,
      });

      // attach the per-locale `_translations` overview for the admin's language pills
      // (opt-in via `?translation-status=1`). No-op for non-localized singles / public reads.
      if (options.translationStatus) {
        await this.attachTranslationOverview(slug, singleMeta, doc);
      }

      // Redact password hashes BEFORE any afterRead hook runs (a hook could
      // copy the hash elsewhere); the final redaction below is defense in
      // depth.
      const singleHasPassword = hasPasswordField(singleMeta.fields);
      if (singleHasPassword) {
        stripPasswordFieldValues(doc, singleMeta.fields);
      }

      // 8. Execute afterRead hooks
      if (this.hookRegistry.hasHooks("afterRead", hookCollection)) {
        const afterContext = buildSingleHookContext({
          collection: hookCollection,
          operation: "read",
          data: doc,
          user: options.user ?? undefined,
          context: sharedContext,
          req: requestFacts,
        });
        const transformedData = await this.hookRegistry.execute(
          "afterRead",
          afterContext
        );
        if (transformedData !== undefined) {
          doc = transformedData;
        }
      }

      this.logger.debug("Single document retrieved", { slug, id: doc.id });

      // Field-level afterRead hooks (functions resolved via the field-level
      // registry). Field read access runs further down, once the document-level
      // decision has been made.
      await runFieldHooks({
        kind: "single",
        slug,
        phase: "afterRead",
        data: doc,
        operation: "read",
        user: options.user,
      });

      // 9. Redact fields the caller may not read.
      // Document trust and FIELD trust are separate questions and this read may
      // answer them differently. `overrideAccess` alone means both; a caller
      // that asked for field rules to be enforced keeps its document bypass and
      // gives up only the field one. Mirrors the collection read path.
      await applyFieldReadAccess({
        kind: "single",
        slug,
        entry: doc,
        // The field-access identity, never the hook one. A preview judges these
        // fields as the sharer while the hooks above go on seeing the anonymous
        // bearer who is actually asking.
        user: options.fieldAccessUser ?? options.user,
        overrideAccess:
          options.enforceFieldAccess === true ? false : options.overrideAccess,
      });

      // Defense in depth, after every user callback on this document: hooks,
      // access rules and field rules are all app code, and this is the last
      // point at which a password value could still be put back.
      if (singleHasPassword) {
        stripPasswordFieldValues(doc, singleMeta.fields);
      }

      return {
        success: true,
        statusCode: 200,
        data: doc,
      };
    } catch (error) {
      this.logger.error("Failed to get Single document", { slug, error });
      return buildSingleErrorResult(error, "Failed to get Single document");
    }
  }

  /**
   * i18n: overlay a localized single's translatable fields from its companion
   * `single_<slug>_locales` row for the resolved locale chain. No-op when localization is
   * off, the single isn't localized, or it has no translatable fields.
   */
  private async populateLocalized(
    slug: string,
    singleMeta: DynamicSingleRecord,
    doc: Record<string, unknown>,
    locale: string | undefined,
    fallbackLocale: string | false | undefined,
    statusFilterValues: readonly string[] | undefined
  ): Promise<void> {
    const localeChain = resolveLocaleChain(
      this.localization,
      locale,
      fallbackLocale
    );
    if (!localeChain) return;
    // Gate on THIS single's flag: a non-localized single has no companion table, and
    // buildCompanionSchema would otherwise classify its text fields as translatable and query a
    // `single_<slug>_locales` table that doesn't exist. (The read swallows that, but skip it.)
    if (singleMeta.localized !== true) return;
    const companion = buildCompanionSchema({
      slug,
      tableName: singleMeta.tableName,
      fields: singleMeta.fields as { name: string; type: string }[],
      dialect: this.adapter.dialect,
      status: (singleMeta as { status?: boolean }).status === true,
    });
    if (!companion) return;
    await populateCompanionFields({
      db: this.adapter.getDrizzle(),
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      rows: [doc],
      localeChain,
      idKey: "id",
      // Public reads pass the published filter so a draft translation never leaks;
      // admin/status=all passes undefined (no filter). Only meaningful when the
      // companion carries a per-locale `_status`.
      statusValues:
        companion.hasStatus && statusFilterValues
          ? statusFilterValues
          : undefined,
      // A pooled read, so this may resolve rather than only read what is remembered.
      readiness: await resolveCompanionSchemaReadiness(this.adapter, companion),
    });
  }

  /**
   * Attach a per-locale `_translations` map (which languages are translated + each
   * one's draft/published status) to the document, for the admin editor's per-language status
   * pills. No-op when localization is off or the single isn't localized. Mirrors the collection
   * read path's `populateTranslationMeta`.
   */
  /**
   * Attach the per-locale overview, converting a strict failure into the
   * canonical internal error.
   *
   * The overview read only throws for a caller that will judge on it, and the
   * result builder puts a bare Error's own message on the wire — companion
   * table and column names the caller has no business seeing.
   */
  private async attachTranslationOverview(
    slug: string,
    singleMeta: DynamicSingleRecord,
    doc: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.populateTranslationMeta(slug, singleMeta, doc);
    } catch (error) {
      // Same reasoning as the overlay above: a failed overview read reaches here, and is
      // normalized rather than handed to the wire as the driver wrote it.
      throw NextlyError.is(error)
        ? error
        : NextlyError.internal({
            cause: error instanceof Error ? error : undefined,
            logContext: {
              single: slug,
              reason: "translation-overview-failed",
            },
          });
    }
  }

  private async populateTranslationMeta(
    slug: string,
    singleMeta: DynamicSingleRecord,
    doc: Record<string, unknown>
  ): Promise<void> {
    // Gate on THIS single's flag, not just app-level localization — a non-localized single has
    // no companion, so there is no per-locale translation status to attach.
    if (!this.localization || singleMeta.localized !== true) return;
    const companion = buildCompanionSchema({
      slug,
      tableName: singleMeta.tableName,
      fields: singleMeta.fields as { name: string; type: string }[],
      dialect: this.adapter.dialect,
      status: (singleMeta as { status?: boolean }).status === true,
    });
    if (!companion) return;
    // Which languages hold a pending change. One document here, but the same
    // batched lookup the collection read uses, so both overviews answer the
    // question the same way.
    const docId = (doc as { id?: unknown }).id;
    const pendingChangeLocales =
      typeof docId === "string"
        ? await new VersionsRepository(this.adapter).findPendingChangeLocales(
            "single",
            slug,
            [docId]
          )
        : undefined;
    // Resolved once and read twice — see the collection path for why probing a companion that is
    // not `ready` costs an introspection for an answer that is discarded.
    const readiness = await resolveCompanionSchemaReadiness(
      this.adapter,
      companion
    );
    await populateTranslationStatus({
      db: this.adapter.getDrizzle(),
      companionTable: companion.table,
      pendingChangeLocales,
      localizedFields: companion.localizedFields,
      rows: [doc],
      locales: this.localization.locales.map(l => l.code),
      defaultLocale: this.localization.defaultLocale,
      hasStatus: companion.hasStatus,
      // The Single's own row id keys the companion `_parent`, same as the collection path.
      idKey: "id",
      readiness,
      // 🔴 Singles carry the signal too, and the same physical check gates it. Every companion
      // write is stamped whatever the entity, so a Single's languages accumulate truthful
      // timestamps and the comparison is as valid here as on a collection.
      //
      // What a Single does NOT get is the history back-fill — `versionScopeForEntityKind` returns
      // nothing for it by scope, not by structure. That leaves languages written before this
      // shipped with no stamp, and no stamp is absent from the answer rather than reported fresh.
      // So a Single reports staleness for what it can vouch for and stays silent about the rest,
      // which is the same conservative direction the whole feature takes.
      staleness:
        readiness === "ready" &&
        (await resolveCompanionColumn(
          this.adapter,
          companion.companionTableName,
          COMPANION_UPDATED_AT_COLUMN
        ))
          ? {
              companionTableName: companion.companionTableName,
              dialect: this.adapter.dialect,
            }
          : undefined,
    });
  }

  // ============================================================
  // Helpers shared with SingleMutationService
  // ============================================================

  /**
   * Create a default document for a Single.
   *
   * Applies default values from field configurations. Always includes
   * the system columns (id, title, slug, created_at, updated_at) that
   * the schema generator adds to every Single table.
   *
   * `captureInitialVersion` records the materialized default as the Single's
   * first version snapshot (v1), atomically with the insert. The read path opts
   * in so a versioned Single that is auto-created on first read still starts a
   * history; the mutation path does NOT, because its subsequent update records
   * the first version itself (opting in there would double-version a first edit).
   */
  /**
   * Build the default document for a Single in memory, WITHOUT inserting it.
   *
   * Returns both the document (system columns + resolved field defaults) and the
   * snake_cased row ready for an insert. The write path uses this to run its
   * hook/validation/authorization pipeline against a would-be default before
   * committing it, so a first write that is refused (for example a publish
   * without the publish permission) never persists a row it would then have to
   * delete — a delete that could clobber a concurrent writer's row.
   */
  async buildDefaultDocument(singleMeta: DynamicSingleRecord): Promise<{
    document: SingleDocument;
    insertValues: Record<string, unknown>;
    /**
     * Default values for the single's TRANSLATABLE fields, keyed by field name
     * (includes localized `title`/`slug`). These belong on the default-locale
     * companion row, not the main table; the auto-create path persists them
     * there so a localized field's default is not stranded as null until it is
     * first written.
     */
    localizedDefaults: Record<string, unknown>;
  }> {
    const now = new Date();
    const id = crypto.randomUUID();

    // Always include system columns that the schema generator adds.
    const defaults: Record<string, unknown> = {
      id,
      title: singleMeta.label || singleMeta.slug,
      slug: singleMeta.slug,
      created_at: now,
      updated_at: now,
    };

    // Surface the status column's DB default ("draft") on the in-memory default
    // too. The write path runs first-update hooks against this document BEFORE
    // the auto-create insert, so without this a hook branching on the initial
    // draft state would see `undefined` where the persisted row (and the old
    // insert-first path) has "draft". Only when the Single has a lifecycle.
    if ((singleMeta as { status?: boolean }).status === true) {
      defaults.status = "draft";
    }

    // i18n: a localized single's main table omits translatable columns (they live in the
    // companion `single_<slug>_locales`). Their defaults are still resolved here (onto the
    // in-memory `document` and the returned `localizedDefaults`) but are kept OFF the main
    // insert below — inserting one would target a column that only exists on the companion.
    const localizedNames = new Set(
      singleMeta.localized === true
        ? resolveLocalizedFieldNames(
            singleMeta.fields as { name: string; type: string }[],
            true
          )
        : []
    );

    // A field's `defaultValue` (a function, or a structured value) does not
    // survive serialization to `dynamic_singles.fields`, so it is absent from
    // `singleMeta.fields`. Resolve defaults from the live code-first config when
    // the Single has one; UI-created singles have none and keep the serialized
    // fields (which can only carry primitive defaults). Keyed by field name.
    const codeFirstFields = this.singleRegistryService.getCodeFirstFields(
      singleMeta.slug
    );
    const codeFirstFieldByName = codeFirstFields
      ? new Map(
          codeFirstFields
            .filter(field => "name" in field && field.name)
            .map(field => [(field as { name: string }).name, field])
        )
      : undefined;

    // A logical view of the document as it is built, holding structured values as
    // real objects. Function defaults receive THIS, not `defaults`: `defaults`
    // stores json-backed values as JSON strings for the DB insert, so a dependent
    // default reading an earlier group/repeater/JSON field would otherwise see a
    // string instead of the object.
    const logicalDefaults: Record<string, unknown> = { ...defaults };

    // The logical form of a DB-ready default value: a json-backed field's type
    // default (e.g. `getDefaultValue` returning "{}"/"[]") is a string for the
    // insert, but a later dependent default must see the decoded object/array.
    const toLogical = (
      field: Parameters<typeof shouldTreatAsJson>[0],
      dbValue: unknown
    ): unknown => {
      if (shouldTreatAsJson(field) && typeof dbValue === "string") {
        try {
          return JSON.parse(dbValue);
        } catch {
          return dbValue;
        }
      }
      return dbValue;
    };

    for (const field of singleMeta.fields) {
      if (!("name" in field) || !field.name) continue;

      // Prefer the live code-first field for the declared default: the
      // serialized `field` has lost any `defaultValue` function/structured value.
      const defaultSource = codeFirstFieldByName?.get(field.name) ?? field;

      // Resolve the field's default (explicit defaultValue, else a required
      // field's type-default) once, regardless of whether it is localized — a
      // localized field's default must reach the companion just the same.
      if (
        "defaultValue" in defaultSource &&
        defaultSource.defaultValue !== undefined
      ) {
        // `defaultValue` may be a function `(data) => value`; evaluate it against
        // the document built so far so the stored default is a real value, not a
        // function object. A raw function would be bound as an SQL parameter for
        // the companion/main upsert and fail or persist its stringified form —
        // localized fields now flow through this block, so it must be resolved.
        const resolved =
          typeof defaultSource.defaultValue === "function"
            ? defaultSource.defaultValue(logicalDefaults)
            : defaultSource.defaultValue;
        // Same direct-insert reasoning for passwords: this path never runs
        // `hashPasswordFieldValues`, so a resolved password default would persist
        // in plaintext. Refuse it (a password must be set explicitly to be hashed).
        assertNoPasswordDefault(field, singleMeta.slug);
        // A contributed type's own rules over the resolved value. This row is
        // inserted directly on first read, so nothing downstream would catch a
        // value the field's own type rejects — and a contributed control may be
        // read-only, leaving the stored value uncorrectable from the UI.
        await assertValidPluginDefault(field, resolved, singleMeta.slug);
        // Clone before exposing: a live STATIC structured default is the object
        // stored on the config, so handing that reference to later dependent
        // defaults (which may sort/mutate it) would corrupt the config itself.
        const cloned = cloneDefault(resolved);
        // Keep the value on the logical view for later dependent defaults, and
        // JSON-encode it for the DB insert when the column is json-backed. Encode
        // EVERY defined value, not only objects: a json-backed column stores text
        // (SQLite especially), so a primitive default like `() => true` must be
        // "true", not a raw boolean that better-sqlite3 cannot bind.
        logicalDefaults[field.name] = cloned;
        defaults[field.name] =
          shouldTreatAsJson(field) && cloned !== undefined
            ? JSON.stringify(cloned)
            : cloned;
        continue;
      }

      // `title`/`slug` are reserved system identity keys, pre-seeded above with
      // the Single's label/slug string. That seed is valid ONLY for a text
      // identity column — or a same-named field that emits no column of its own
      // (a component named `title` does not suppress the system text column,
      // which still needs the label). When a Single redefines `title`/`slug` as a
      // NON-text column, the string seed is invalid regardless of whether the
      // field is required: use its type default when required, otherwise drop the
      // seed so it is never inserted/seeded into (e.g.) a numeric column.
      if (SINGLE_IDENTITY_FIELDS.has(field.name)) {
        // A Single's table is built by the same service that builds collections. The question
        // asked here — does this kind store text — is answered the same way whatever built the
        // table, so the builtBy cannot change the outcome; it is stated rather than defaulted so
        // this call site cannot drift if that ever stops being true.
        const desc = getColumnDescriptor(
          field as unknown as FieldDefinition,
          this.adapter.dialect,
          "collection"
        );
        // Keep the seeded label/slug whenever the column stores text. The descriptor answers that
        // rather than a list of kind names kept here: a list restated locally judged a kind added
        // later as non-text, replacing a Single's seeded identity with an empty default on the
        // first read that created it.
        if (!desc || isTextStorageKind(desc.kind)) {
          continue;
        }
        if ("required" in field && field.required) {
          defaults[field.name] = getDefaultValue(field);
          logicalDefaults[field.name] = toLogical(field, defaults[field.name]);
        } else {
          delete defaults[field.name];
          delete logicalDefaults[field.name];
        }
        continue;
      }

      if ("required" in field && field.required) {
        defaults[field.name] = getDefaultValue(field);
        logicalDefaults[field.name] = toLogical(field, defaults[field.name]);
      }
    }

    // A date default resolves to a string (e.g. `() => new Date().toISOString()`),
    // but a timestamp column needs a `Date` — the ordinary write path coerces via
    // `coerceDateFieldsToDate`, and this direct-insert path must do the same or
    // SQLite stores the string in an integer column and reads back an invalid
    // date. Idempotent: an existing `Date` passes through untouched.
    coerceDateFieldsToDate(defaults, singleMeta.fields);

    // A field can be translatable/required yet emit NO storage column — a
    // component or other layout-only ("skip") field type. Its default has nowhere
    // to live: routing it to the main insert or the companion seed would target a
    // column that does not exist and fail the auto-create upsert. Collect those
    // field names so the split drops them from both buckets. System-seeded keys
    // (id/title/slug/timestamps/status) are not user fields, so they are never in
    // this set and always route to the main insert below.
    const noColumnFieldNames = new Set<string>();
    for (const field of singleMeta.fields) {
      if (!("name" in field) || !field.name) continue;
      // Reserved identity keys are backed by the system text column even when a
      // same-named field emits none, so their seed must never be dropped here.
      if (SINGLE_IDENTITY_FIELDS.has(field.name)) continue;
      if (
        // Only whether the field occupies a column at all, which no builtBy changes.
        getColumnDescriptor(
          field as unknown as FieldDefinition,
          this.adapter.dialect,
          "collection"
        ) == null
      ) {
        noColumnFieldNames.add(field.name);
      }
    }

    // Split the resolved defaults: translatable ones (including localized
    // title/slug) go to `localizedDefaults` for the companion; everything else
    // is inserted on the main table. A localized column on the main insert would
    // target a non-existent column and fail the auto-create.
    const localizedDefaults: Record<string, unknown> = {};
    const insertDefaults: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (noColumnFieldNames.has(key)) continue;
      if (localizedNames.has(key)) {
        localizedDefaults[key] = value;
      } else {
        insertDefaults[key] = value;
      }
    }

    const snakeCaseDefaults = keysToSnakeCase(insertDefaults) as Record<
      string,
      unknown
    >;

    return {
      document: defaults as SingleDocument,
      insertValues: snakeCaseDefaults,
      localizedDefaults,
    };
  }

  /**
   * The companion schema for a localized single's default seeding, or null when
   * seeding does not apply (localization off, not localized, no translatable
   * defaults, or no companion). Shared by the pre-transaction existence probe
   * and the in-transaction write so both agree on the same table.
   */
  private companionForDefaultsSeed(
    singleMeta: DynamicSingleRecord,
    localizedDefaults: Record<string, unknown>
  ) {
    if (!this.localization || singleMeta.localized !== true) return null;
    if (Object.keys(localizedDefaults).length === 0) return null;
    return buildCompanionSchema({
      slug: singleMeta.slug,
      tableName: singleMeta.tableName,
      fields: singleMeta.fields as { name: string; type: string }[],
      dialect: this.adapter.dialect,
      status: (singleMeta as { status?: boolean }).status === true,
    });
  }

  /**
   * Whether the default-locale companion should be seeded AND its `_locales`
   * table physically exists. MUST be called BEFORE the write transaction opens:
   * it probes on the pooled connection, and on a `max: 1` pool a probe issued
   * while the transaction holds the only connection would deadlock until the
   * pool timeout and then be misread as "table missing". A missing table (for
   * example dev-before-migrate) reads as false so the seed is skipped rather
   * than throwing and rolling the main-row insert back.
   */
  async localizedDefaultsCompanionExists(
    singleMeta: DynamicSingleRecord,
    localizedDefaults: Record<string, unknown>
  ): Promise<boolean> {
    const companion = this.companionForDefaultsSeed(
      singleMeta,
      localizedDefaults
    );
    if (!companion) return false;
    // Only `ready` matters here — a seed either goes into the companion or does not — so this
    // takes the cheap form rather than paying an introspection to learn why it might not be.
    return isCompanionReady(this.adapter, companion.companionTableName);
  }

  /**
   * Seed a localized single's DEFAULT-locale companion row with its translatable
   * field defaults on auto-create, so a localized field's default (including a
   * localized `title`/`slug`) resolves to that default instead of null until it
   * is first written. Runs on the caller's transaction (`tx.execute`) so the
   * companion seed commits atomically with the main-row insert.
   *
   * `companionExists` MUST be resolved by the caller via
   * `localizedDefaultsCompanionExists` BEFORE the transaction opens (see that
   * method for why the probe cannot happen here). No-op when it is false or when
   * seeding does not apply. The default-locale companion `_status` is seeded to
   * the main row's status so the two agree from the start.
   */
  async seedLocalizedDefaultsCompanion(
    tx: {
      execute<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
    },
    singleMeta: DynamicSingleRecord,
    parentId: string,
    localizedDefaults: Record<string, unknown>,
    status: string | undefined,
    companionExists: boolean
  ): Promise<void> {
    if (!companionExists || !this.localization) return;
    const companion = this.companionForDefaultsSeed(
      singleMeta,
      localizedDefaults
    );
    if (!companion) return;

    const { companion: companionData } = splitLocalizedWrite(
      localizedDefaults,
      companion.localizedFields
    );
    const companionStatus = companion.hasStatus
      ? (status ?? "draft")
      : undefined;
    const writeAdapter = {
      dialect: this.adapter.dialect,
      executeQuery: <T = unknown>(sql: string, params?: unknown[]) =>
        tx.execute<T>(sql, params),
    };
    await upsertCompanionRow(
      writeAdapter,
      companion.companionTableName,
      parentId,
      this.localization.defaultLocale,
      companionData,
      companionStatus
    );
  }

  async createDefaultDocument(
    singleMeta: DynamicSingleRecord,
    options?: { captureInitialVersion?: boolean; draft?: DefaultDocumentDraft }
  ): Promise<SingleDocument> {
    const {
      insertValues: snakeCaseDefaults,
      document,
      localizedDefaults,
    } = options?.draft ?? (await this.buildDefaultDocument(singleMeta));
    const id = snakeCaseDefaults.id as string;
    const status = (document as { status?: string }).status;

    const versionsConfig = singleMeta.versions;
    const shouldCapture =
      options?.captureInitialVersion === true &&
      versionsConfig?.enabled === true;

    // A localized single needs its translatable defaults seeded onto the
    // default-locale companion, which must commit atomically with the main
    // insert — so this forces the transactional path even when versioning is off.
    const needsCompanionSeed =
      !!this.localization &&
      singleMeta.localized === true &&
      Object.keys(localizedDefaults).length > 0;
    // Probe companion existence BEFORE opening the transaction (a probe issued
    // while the tx holds a max:1-pool connection would deadlock); the seed calls
    // below are gated on this rather than probing inside the transaction.
    const companionExists = needsCompanionSeed
      ? await this.localizedDefaultsCompanionExists(
          singleMeta,
          localizedDefaults
        )
      : false;
    // The seed only persists the localized defaults when the companion `_locales`
    // table physically exists; when it does not (dev-before-migrate) the seed
    // no-ops. The initial version snapshot must therefore record those defaults
    // ONLY when the seed actually ran — otherwise v1 carries translations that
    // were never persisted or visible, and restoring it resurrects phantom
    // defaults. Both the snapshot overlay and its default-locale tag are gated on
    // this, so a version tagged to the default locale always matches real content.
    const seedApplied = needsCompanionSeed && companionExists;
    const seedLocale = seedApplied
      ? (this.localization?.defaultLocale ?? null)
      : null;

    if (!shouldCapture && !needsCompanionSeed) {
      const inserted = await this.adapter.insert<SingleDocument>(
        singleMeta.tableName,
        snakeCaseDefaults,
        { returning: "*" }
      );
      this.logger.debug("Created default Single document", {
        slug: singleMeta.slug,
        id,
      });
      return inserted;
    }

    // Non-versioned but localized: insert the main row and seed the companion in
    // one transaction, so a failed companion seed rolls the insert back rather
    // than leaving a main row without its localized defaults.
    if (!shouldCapture) {
      const inserted = await this.adapter.transaction(async tx => {
        const row = await tx.insert<SingleDocument>(
          singleMeta.tableName,
          snakeCaseDefaults,
          { returning: "*" }
        );
        await this.seedLocalizedDefaultsCompanion(
          tx,
          singleMeta,
          id,
          localizedDefaults,
          status,
          companionExists
        );
        return row;
      });
      this.logger.debug("Created default Single document", {
        slug: singleMeta.slug,
        id,
      });
      return inserted;
    }

    // Versioned Single: insert the default row and record its v1 snapshot in one
    // transaction, so the Single never ends up with a live row but no history.
    // Retry on a version_no allocation race, mirroring the write paths.
    const inserted = await withVersionConflictRetry(() =>
      this.adapter.transaction(async tx => {
        const row = await tx.insert<SingleDocument>(
          singleMeta.tableName,
          snakeCaseDefaults,
          { returning: "*" }
        );
        // Match the read shape: keep user field keys (which may contain
        // underscores like `site_title`) exactly, converting only the timestamp
        // columns; strip password hashes and the system owner column so history
        // never retains them; parse JSON-backed fields (stored as strings on
        // SQLite) so a restore equals a normal read. A freshly materialized
        // default has no component subtrees yet, so components is empty.
        const parentRow = convertTimestampsToCamelCase({
          ...(row as Record<string, unknown>),
        });
        // Overlay the seeded localized defaults (keyed by field name) onto the
        // snapshot so v1 carries the default locale's content, mirroring how a
        // normal localized write overlays its companion values before capturing.
        // Without this, restoring v1 could not bring back the seeded defaults
        // (including a localized title/slug), since they live on the companion.
        // Gated on `seedApplied`: when the companion table does not yet exist the
        // seed no-ops, so overlaying here would record defaults that were never
        // persisted.
        if (seedApplied) {
          for (const [name, value] of Object.entries(localizedDefaults)) {
            parentRow[name] = value;
          }
        }
        applyReadShape(parentRow, singleMeta.fields);
        await captureInTx(tx, this.versionCapture, {
          ref: {
            scopeKind: "single",
            scopeSlug: singleMeta.slug,
            entryId: (row as { id: string }).id,
          },
          contentStatus: (parentRow as { status?: unknown }).status,
          // System-materialized default: no authoring user.
          parts: { parentRow, components: {} },
          createdBy: null,
          // Tagged with the default locale when the snapshot carries seeded
          // translatable defaults; null for a non-localized single (main row only).
          locale: seedLocale,
          maxPerDoc: versionsConfig.maxPerDoc,
        });
        // Seed the default-locale companion with the localized defaults in the
        // same transaction as the insert and version snapshot.
        await this.seedLocalizedDefaultsCompanion(
          tx,
          singleMeta,
          id,
          localizedDefaults,
          status,
          companionExists
        );
        return row;
      })
    );

    this.logger.debug("Created default Single document", {
      slug: singleMeta.slug,
      id,
    });
    return inserted;
  }

  /**
   * Deserialize JSON fields from database format to in-memory objects.
   * Also normalizes snake_case timestamp columns to camelCase.
   */
  deserializeJsonFields(
    doc: SingleDocument,
    fields: FieldConfig[]
  ): SingleDocument {
    return deserializeJsonFields(doc, fields, this.logger, value =>
      this.normalizeDbTimestamp(value)
    );
  }

  /**
   * Expand upload fields with full media data.
   * Recursively handles upload fields nested inside repeater and group fields.
   *
   * The caller travels with the fetch because media is a system table with no
   * collection config: a trusted read that bounded its bypass has refused this
   * target like any other, and only the caller can say what it may still see.
   * Required rather than defaulted — a default here is indistinguishable from
   * a caller that forgot, and the two want opposite outcomes, so the omission
   * is worth a compile error. Build it with `expansionAccess`.
   */
  async expandUploadFields(
    doc: SingleDocument,
    fields: FieldConfig[],
    access: RelatedRowReadContext
  ): Promise<SingleDocument> {
    const allMediaIds = collectAllMediaIds(doc, fields);
    if (allMediaIds.length === 0) {
      return doc;
    }

    const uniqueMediaIds = [...new Set(allMediaIds)];
    const mediaRecords = await applyMediaTrustBound(
      await this.fetchMediaByIds(uniqueMediaIds),
      access
    );

    const mediaMap = new Map<string, Record<string, unknown>>();
    for (const media of mediaRecords) {
      const id = media.id;
      if (id !== undefined && id !== null) {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        mediaMap.set(String(id), media);
      }
    }

    return expandMediaInData(doc, fields, mediaMap) as SingleDocument;
  }

  /**
   * Expand relationship fields with full related entry data via
   * CollectionRelationshipService (lazily resolved from DI).
   */
  async expandRelationshipFields(
    doc: SingleDocument,
    fields: FieldConfig[],
    depth?: number,
    // The caller a related row's own field rules are evaluated against, and
    // whether to evaluate them at all. Expansion copies whole related rows into
    // this document, and a Single's field list never describes a related
    // collection's fields. Enforcement is opt-in because a caller that has not
    // supplied a user is indistinguishable from an anonymous one here, and
    // enforcing for the former strips protected fields from everybody.
    access: RelatedRowReadContext = { trusted: TRUSTS_EVERY_COLLECTION },
    /**
     * Whether to expand relationships nested inside a group or repeater.
     *
     * Off by default, and deliberately: expansion copies whole related rows in,
     * and a caller that threads no user cannot have the target collection's
     * field rules evaluated for them — so widening what gets expanded would
     * hand those rows to a response that has no way to redact them. The read
     * path, which does thread a caller, opts in.
     */
    expandNested = false
  ): Promise<SingleDocument> {
    const relationshipService = this.resolveRelationshipService();
    if (!relationshipService) {
      // Not an error in itself: a Single with no relationship fields has
      // nothing to expand, and the caller checks separately that every stored
      // reference the rule may read actually became a row.
      return doc;
    }

    // FieldConfig uses "relationship"; FieldDefinition (UI-created) uses "relation".
    // Nested relationships count only for callers that asked for them:
    // expansion reaches into groups and repeaters, so a Single whose only
    // relationships live inside one would otherwise be returned with its
    // references unexpanded.
    if (!containsRelationField(fields, expandNested)) {
      return doc;
    }

    try {
      // FieldConfig and FieldDefinition are structurally compatible for the
      // properties that CollectionRelationshipService checks.
      const expandedDoc = await relationshipService.expandRelationships(
        doc,
        "", // Singles don't belong to a collection
        fields as unknown as FieldDefinition[],
        {
          depth: depth ?? DEFAULT_READ_DEPTH,
          // Set by the read path, which forwards a real caller. The mutation
          // path does not, so its response keeps the fields it already returned
          // rather than having them stripped as if nobody were asking.
          enforceFieldAccess: access.enforceFieldAccess,
          enforceCollectionAccess: access.enforceCollectionAccess,
          user: access.user,
          // Beside `user`, never folded into it. Dropped here, every top-level
          // relationship — live and working-draft alike — is judged as the
          // anonymous bearer while the document above it is judged as the
          // sharer, which is the disclosure the identity exists to close.
          fieldAccessUser: access.fieldAccessUser,
          overrideAccess: access.overrideAccess,
          // Narrows that bypass per RELATED collection. Absent means unchanged;
          // dropping it here would silently restore the full bypass.
          trusted: access.trusted,
          authenticatedScope: access.authenticatedScope,
          withheldByAccess: access.withheldByAccess,
          locale: access.locale,
          status: access.status,
        }
      );
      return expandedDoc as SingleDocument;
    } catch (error) {
      this.logger.error("Failed to expand relationship fields for Single", {
        error,
      });
      // A response is better served incomplete than not at all: one relationship
      // that could not be expanded is returned as its stored reference.
      return doc;
    }
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Resolve the CollectionRelationshipService lazily from the DI container.
   * Returns null if not available (safe for early service usage).
   */
  private resolveRelationshipService(): CollectionRelationshipService | null {
    if (!container.has("collectionsHandler")) {
      return null;
    }
    try {
      const handler = container.get<CollectionsHandler>("collectionsHandler");
      return handler.getRelationshipService();
    } catch {
      return null;
    }
  }

  /**
   * Fetch media records by IDs.
   *
   * Uses Drizzle's typed query builder against the dialect's registered media
   * table rather than a raw `db.execute(sql...)`: better-sqlite3 doesn't
   * expose `.execute()` on its Drizzle handle, so the raw form threw
   * `db.execute is not a function` on SQLite and every upload field silently
   * expanded to null. Mirrors CollectionRelationshipService.fetchMediaByIds so
   * singles and collections resolve media identically (including absolutizing
   * relative local-storage URLs).
   */
  private async fetchMediaByIds(
    ids: string[]
  ): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];

    try {
      const tables = getDialectTables(
        this.adapter.dialect
      ) as unknown as Record<string, { id: AnyColumn } | undefined>;
      const mediaTable = tables.media;
      if (!mediaTable) {
        throw NextlyError.internal({
          logContext: {
            op: "fetchMediaByIds",
            detail: "media table schema not registered for dialect",
            dialect: this.adapter.dialect,
          },
        });
      }

      // Structural cast: this.db is the cross-dialect Drizzle union, whose
      // select() overloads don't unify over a dynamically-resolved table.
      // Every dialect's handle supports this exact builder chain.
      const db = this.db as unknown as {
        select: () => {
          from: (table: unknown) => {
            where: (condition: unknown) => Promise<Record<string, unknown>[]>;
          };
        };
      };
      const rows = await db
        .select()
        .from(mediaTable)
        .where(inArray(mediaTable.id, ids));

      return rows.map(row => {
        const camel = keysToCamelCase(row) as Record<string, unknown>;
        // Local storage stores relative URLs (`/uploads/...`); cloud adapters
        // store absolute ones. Prefix the relative form so expanded media in
        // API responses is reachable by external clients.
        return absolutizeMediaUrls(camel);
      });
    } catch (error) {
      // Raised, not swallowed. Returning [] here degrades a failed fetch into
      // an upload field that reads back as null, which is indistinguishable
      // from "this document references no media" — the symptom that hid a
      // broken media fetch on SQLite until a user reported vanishing images.
      // Expansion failing is not a normal outcome, so the read fails loudly.
      throw NextlyError.internal({
        cause: error instanceof Error ? error : undefined,
        logContext: {
          op: "fetchMediaByIds",
          dialect: this.adapter.dialect,
          mediaIds: ids.length,
        },
      });
    }
  }
}
