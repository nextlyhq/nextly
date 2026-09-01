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
import { isFieldGroupField } from "../../../collections/fields/guards";
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
import type { HookContext } from "../../../hooks/types";
import { keysToCamelCase, keysToSnakeCase } from "../../../lib/case-conversion";
import { DEFAULT_WORKFLOW, isPublicState } from "../../../lib/content-states";
import { absolutizeMediaUrls } from "../../../lib/media-variant";
import {
  expansionStatusScope,
  resolveStatusFilter,
  type StatusFilterValue,
} from "../../../lib/status-filter";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import type { CollectionAccessRules } from "../../../services/access";
import {
  AccessControlService,
  isSuperAdminContext,
} from "../../../services/access";
import { GENERIC_DEFAULT_OWNER_FIELD } from "../../../services/access/types";
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
import { detachData } from "../../../shared/lib/detach";
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
import { relationKey } from "../../collections/services/collection-relationship-service";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import { COMPANION_UPDATED_AT_COLUMN } from "../../i18n/companion-columns";
import {
  populateCompanionFields,
  populateTranslationStatus,
} from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import {
  isValidLocale,
  resolveFallbackChain,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
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

/**
 * A relationship field's configured population limit, when it declares one.
 * `0` means the reference is meant to stay a reference.
 */
function relationshipMaxDepth(field: FieldConfig): number | undefined {
  const config = field as {
    maxDepth?: number;
    options?: { maxDepth?: number };
  };
  return config.options?.maxDepth ?? config.maxDepth;
}

/** Marks a stored value whose JSON could not be read. */
const UNREADABLE_CONTAINER = Symbol("unreadable-container");

/**
 * Parse a group or repeater that may still be a JSON string (SQLite's shape).
 *
 * A string here is always meant to be JSON, so failing to read it is not the
 * same as holding nothing: it hides whatever the container held, and treating
 * it as empty would walk past every relationship inside it.
 */
function parseContainer(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return UNREADABLE_CONTAINER;
  }
}

/**
 * Parse a relationship or upload value that may hold one reference or a list.
 *
 * Unlike a container, a bare string here is an ordinary id rather than JSON, so
 * only a value that announces itself as a list is parsed — and only that case
 * can be unreadable.
 */
function parseReferenceValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!value.trimStart().startsWith("[")) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return UNREADABLE_CONTAINER;
  }
}

/** The rows of a group (one) or repeater (many), whatever form they arrive in. */
/**
 * Whether a stored container holds something other than the shape its field
 * declares — a group arriving as a list, say, or as a scalar.
 *
 * Read as zero rows, such a value walks the check past every relationship
 * inside it, which is the same blind spot as JSON that would not parse. An
 * absent container is not this: nothing was stored, so there is nothing to
 * miss.
 */
function isMisshapenContainer(
  value: unknown,
  type: "group" | "repeater"
): boolean {
  if (value === null || value === undefined || value === "") return false;
  const parsed = parseContainer(value);
  if (parsed === UNREADABLE_CONTAINER) return true;
  if (parsed === null || parsed === undefined) return false;
  if (type !== "repeater") {
    return typeof parsed !== "object" || Array.isArray(parsed);
  }
  if (!Array.isArray(parsed)) return true;
  // A row that is not an object is as unreadable as the whole container being
  // the wrong shape: it becomes no row at all, and the walk steps over every
  // relationship it was supposed to hold. An absent row is not this — nothing
  // was stored there.
  return parsed.some(
    row =>
      row !== null &&
      row !== undefined &&
      (typeof row !== "object" || Array.isArray(row))
  );
}

function containerRows(
  value: unknown,
  type: "group" | "repeater"
): (Record<string, unknown> | undefined)[] {
  const parsed = parseContainer(value);
  if (parsed === UNREADABLE_CONTAINER) return [];
  if (type === "repeater") {
    return Array.isArray(parsed)
      ? parsed.map(row =>
          row && typeof row === "object"
            ? (row as Record<string, unknown>)
            : undefined
        )
      : [];
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? [parsed as Record<string, unknown>]
    : [];
}

/** Whether a field holds nothing at all. */
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Whether a value is an expanded document rather than a reference to one.
 *
 * The `id` is what distinguishes them. A polymorphic reference is stored as
 * `{ relationTo, value }` — an object, and so indistinguishable from a row by
 * shape alone, which would let an unexpanded reference pass for evidence.
 */
function isExpandedRow(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  // Tested before the wrapper shape, not after: a row carries an id and a
  // wrapper never does, while a row from a collection that happens to define
  // fields called `relationTo` and `value` looks exactly like one. Unwrapping
  // such a row would judge one of its own field values instead of the row.
  if ("id" in value) return true;
  // A reference that names its own collection keeps that shape when it is
  // populated, with the row under `value` — so the row is what has to be
  // judged. Unpopulated, `value` is still the bare id and fails the same test.
  if ("relationTo" in value && "value" in value) {
    return isExpandedRow((value as Record<string, unknown>).value);
  }
  return false;
}

/**
 * Whether a relationship arrived as documents rather than references.
 *
 * Judged on the ASSEMBLED value first, because that is the only place a
 * localized reference appears at all: it lives in the companion table and is
 * overlaid after the main row is read, so comparing against the stored row
 * would skip the field entirely.
 *
 * Cardinality is the second half: a `hasMany` expansion drops the entries it
 * could not fetch, so a shorter list — or an empty one — is evidence that went
 * missing rather than evidence that says nothing is there.
 */
/** The id a stored reference points at, in either shape it is stored in. */
function referenceId(reference: unknown): string {
  if (typeof reference === "string") return reference;
  if (reference !== null && typeof reference === "object") {
    const { value, id } = reference as Record<string, unknown>;
    if (typeof value === "string") return value;
    if (typeof id === "string") return id;
  }
  return "";
}

/**
 * The collection a stored reference points at.
 *
 * A field naming several targets records the collection on the value itself;
 * anything else belongs to the field's declared target. Needed because a
 * withheld row is recorded per collection — an id alone is only unique within
 * one, so a refusal in one target would otherwise excuse a lost row in another.
 */
/** A relationship field's declared target, in either shape it is declared in. */
function singleFieldTarget(field: FieldConfig): string {
  const config = field as {
    relationTo?: unknown;
    options?: { target?: unknown };
  };
  if (typeof config.relationTo === "string") return config.relationTo;
  if (Array.isArray(config.relationTo)) return "";
  const target = config.options?.target;
  return typeof target === "string" ? target : "";
}

function referenceCollection(
  reference: unknown,
  fallbackCollection: string
): string {
  if (reference !== null && typeof reference === "object") {
    const { relationTo } = reference as Record<string, unknown>;
    if (typeof relationTo === "string") return relationTo;
  }
  return fallbackCollection;
}

function referencesExpanded(
  stored: unknown,
  assembled: unknown,
  /**
   * Ids the target collection's own rules refused this caller.
   *
   * Such a reference is absent on purpose. Counting it as evidence that went
   * missing would refuse a document the caller may read because something it
   * points at is something they may not.
   */
  withheldByAccess?: Set<string>,
  /** The field's declared target, for references that do not name their own. */
  fieldTarget = ""
): boolean {
  const parsedStored = parseReferenceValue(stored);
  if (parsedStored === UNREADABLE_CONTAINER) return false;
  const storedList = parsedStored;
  // References the target's own rules refused are absent on purpose, so they
  // are removed from what has to have arrived. A `hasMany` holding both
  // readable and refused rows therefore compares the shortened list against
  // the references that were actually expandable, rather than against every
  // reference the row stored.
  const withheld = (ref: unknown): boolean =>
    Boolean(
      withheldByAccess?.has(
        relationKey(referenceCollection(ref, fieldTarget), referenceId(ref))
      )
    );
  const expectable = (ref: unknown): boolean => !withheld(ref);
  if (withheldByAccess?.size) {
    const refusedEveryReference = (
      Array.isArray(storedList) ? storedList : [storedList]
    )
      .filter(ref => !isEmptyValue(ref))
      .every(ref => withheld(ref));
    if (refusedEveryReference) return true;
  }
  const storedRefs = Array.isArray(storedList)
    ? storedList.filter(id => !isEmptyValue(id)).filter(expectable)
    : undefined;

  if (Array.isArray(assembled)) {
    if (!assembled.every(isExpandedRow)) return false;
    return storedRefs === undefined || assembled.length === storedRefs.length;
  }

  // Nothing in the view is only honest when nothing was referenced.
  if (isEmptyValue(assembled)) {
    return storedRefs !== undefined
      ? storedRefs.length === 0
      : isEmptyValue(stored);
  }

  return isExpandedRow(assembled);
}

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
 */
export function buildSingleHookContext<T>(
  options: BuildContextOptions<T>
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
 * 3. Stored access rules (`accessRules[operation]`: public / authenticated /
 *    role-based / owner-only / custom) — denies with 403 when they fail. UI
 *    Singles persist these, so they must be enforced on every transport, not
 *    just the coarse RBAC permission.
 * 4. `routeAuthorized` with a verified user → null: the route middleware
 *    already ran the RBAC gate, so skip only that redundant re-check (the
 *    stored rules above still ran).
 * 5. No RBAC service or no user → null (skip)
 * 6. RBAC check (super-admin → code-defined → DB permissions)
 * 7. Fail-secure on unexpected errors
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
  /** Evaluator for the Single's stored access rules. */
  accessControlService?: AccessControlService;
  /** The Single's stored access rules (from the registry metadata). */
  accessRules?: CollectionAccessRules;
  /**
   * The current Single document, when loaded. Owner-only rules need it to
   * compare ownership; without it they allow (deferring to the DB-level check).
   */
  document?: Record<string, unknown>;
  /**
   * Skip the stored-rule evaluation and return after only the RBAC/permission
   * gate. The publish-transition pre-resolve sets this when the operation's
   * stored rule is document-dependent (owner-only/custom), so that rule is NOT
   * judged against the pre-transaction document here — it is re-evaluated against
   * the row-locked document inside the write transaction instead (see
   * `evaluateTransitionDocumentRule` on the mutation service). Non-dependent
   * rules (public/authenticated/role-based) are fully decidable without the row,
   * so callers leave this false and let them run here.
   */
  deferStoredRuleEval?: boolean;
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
    accessControlService,
    accessRules,
    document,
    deferStoredRuleEval,
    logger,
  } = params;

  if (overrideAccess) {
    return null;
  }

  // Super-admins bypass the stored rules on every transport — EXCEPT via a
  // scoped API key. The bypass belongs to the session path: a key is
  // authoritative on its OWN stamped scope, never on the owner's roles, so a
  // read/update-only key issued by an admin is not equivalent to their full
  // account (mirrors canReadEntity). Otherwise a super-admin-owned, update-only
  // key could publish.
  if (authenticatedScope?.actorType !== "apiKey" && isSuperAdminContext(user)) {
    return null;
  }

  // Evaluate the Single's stored access rules (owner-only is degenerate for a
  // single global document; public / authenticated / role-based / custom all
  // apply). This runs for both route-authorized and Direct API callers so a
  // caller holding the coarse `update-<single>` permission but failing a
  // stored rule is still denied. Skipped when `deferStoredRuleEval` is set: the
  // transition pre-resolve defers a document-dependent (owner-only/custom) rule
  // to the under-lock re-check so it is not judged against a stale document.
  if (accessControlService && accessRules && !deferStoredRuleEval) {
    // Owner-only with no loaded document: ownership cannot be evaluated (there
    // is nothing to compare against), and evaluateOwnerAccess would otherwise
    // ALLOW the write for lack of a document — letting a caller with only the
    // coarse permission perform the first PATCH to an owner-only Single without
    // any ownership check. Fail closed; a legitimate first write goes through a
    // trusted `overrideAccess` seed.
    if (accessRules[operation]?.type === "owner-only" && !document) {
      return {
        success: false,
        statusCode: 403,
        message: `Access denied: ${operation} on single "${slug}" requires an existing owned document`,
      };
    }
    // A stored `custom` rule may key on the document id, so forward it (from
    // the loaded document) alongside the document itself.
    const documentId =
      typeof document?.id === "string" ? document.id : undefined;
    const result = await accessControlService.evaluateAccess(
      accessRules,
      operation,
      {
        // Spread rather than rebuild: a `custom` rule may decide on a claim
        // this framework does not know about, and copying named fields drops
        // every one of them.
        user: user ? { ...user } : undefined,
      },
      documentId,
      document
    );
    if (!result.allowed) {
      return {
        success: false,
        statusCode: 403,
        message:
          result.reason ??
          `Access denied: ${operation} on single "${slug}" is not permitted`,
      };
    }
  }

  // The route middleware already ran this exact RBAC gate; skip the redundant
  // re-check — but only when a verified user is present, so a caller that sets
  // routeAuthorized without authenticating cannot silently allow an anonymous
  // write. The stored rules above already ran; field-level write access still
  // applies downstream (overrideAccess is false).
  if (routeAuthorized && user) {
    return null;
  }

  // Secure-by-default publish gate (Option A): publishing/unpublishing changes a
  // document's privileged published state, so an anonymous caller may do it ONLY
  // when an explicit rule grants it. With no explicit publish/unpublish rule the
  // operation would otherwise fall through to the rule-less public default below
  // (`!user` → allow), letting an unauthenticated caller publish a
  // publicly-writable Single. An explicit stored rule was evaluated above and
  // allowed if we reach here, so a developer who deliberately opened publishing
  // (e.g. a public `publish` rule) is respected; only the implicit default denies.
  if (
    !user &&
    (operation === "publish" || operation === "unpublish") &&
    !accessRules?.[operation]
  ) {
    return {
      success: false,
      statusCode: 403,
      message: `Access denied: ${operation} on single "${slug}" requires an authenticated user`,
    };
  }

  if (!user) {
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
    statusFilter: { value: StatusFilterValue };
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
    const matchesStatus = input.storedStatus === input.statusFilter.value;
    // The workflow decides what "published" means; see `lib/content-states`.
    if (!isPublicState(input.statusFilter.value, DEFAULT_WORKFLOW)) {
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
    accessControlService?: AccessControlService,
    /**
     * What a due release makes visible.
     *
     * A null object by default, so a construction site without releases wired
     * needs no special case and cannot narrow a read by forgetting one.
     */
    private readonly releaseVisibility: ReleaseVisibility = NO_RELEASE_VISIBILITY
  ) {
    super(adapter, logger);
    // Evaluates the Single's stored access rules. Defaulted rather than
    // required so every existing construction site keeps working, mirroring
    // how the mutation service resolves the same dependency: without one the
    // read gate would silently skip the stored rules it is handed.
    this.accessControlService =
      accessControlService ?? new AccessControlService();
  }

  /** Resolves stored `accessRules` for the read gate. */
  private readonly accessControlService: AccessControlService;

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
      accessRules: singleMeta.accessRules,
      user: options.user,
      overrideAccess: false,
      routeAuthorized: false,
      rbacAccessControlService: this.rbacAccessControlService,
      accessControlService: this.accessControlService,
      authenticatedScope: options.authenticatedScope,
      logger: this.logger,
    });
    return !updateDenied;
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
  }): Promise<SingleDocument> {
    const { slug, singleMeta, doc, options } = params;

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
    overlaid = await this.expandRelationshipFields(
      overlaid,
      singleMeta.fields,
      options.depth,
      expansionAccess(options)
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
    statusFilterValue: string | undefined;
    /**
     * Whether to apply the TARGET collection's field rules to related rows.
     * Off for the copy an access rule is judged on: redaction removes the very
     * values a rule may be written to inspect, and a rule shown `undefined`
     * where the document holds something reads that absence as permission.
     */
    enforceRelatedFieldAccess: boolean;
    /** Skip the companion overlay for a draft that carries its defaults inline. */
    skipLocalizedOverlay?: boolean;
    /**
     * Called with the document once translations are overlaid and JSON is
     * decoded, but before anything is expanded — the point at which every
     * reference the read will try to resolve is visible, and the only place a
     * LOCALIZED reference appears at all.
     */
    captureReferences?: (doc: SingleDocument) => void;
    /**
     * Fail rather than degrade. The response assembly is best-effort by design
     * — a relationship that cannot be expanded is returned unexpanded, and a
     * component table that cannot be read yields empty values. Neither is safe
     * for a document an access rule is about to be judged on.
     */
    strict?: boolean;
    /**
     * Collects references a target collection refused, so the completeness
     * check can tell a refusal from a load that failed.
     */
    withheldByAccess?: Set<string>;
  }): Promise<SingleDocument> {
    const {
      slug,
      singleMeta,
      options,
      statusFilterValue,
      enforceRelatedFieldAccess,
      strict = false,
    } = params;
    let doc = params.doc;

    // i18n: resolve translatable fields from the companion `_locales` table for the
    // requested locale (with fallback) BEFORE deserialization and upload/relationship/component
    // expansion — the companion stores JSON/upload/relationship values in their raw storage form,
    // so the overlay must land before those transforms run (matching the collection read path).
    // No-op when localization is off or the single isn't localized.
    if (!params.skipLocalizedOverlay) {
      try {
        await this.populateLocalized(
          slug,
          singleMeta,
          doc,
          options.locale,
          options.fallbackLocale,
          statusFilterValue
        );
      } catch (error) {
        // Normalized whether or not the caller is judging an access rule on the result. A
        // companion read failure propagates, and the result builder puts a bare Error's own
        // message on the wire — the failed query, with companion table and column names in it.
        throw NextlyError.is(error)
          ? error
          : NextlyError.internal({
              cause: error instanceof Error ? error : undefined,
              logContext: {
                single: slug,
                reason: strict
                  ? "translation-load-failed-during-authorization"
                  : "translation-load-failed",
              },
            });
      }
    }

    doc = this.deserializeJsonFields(doc, singleMeta.fields);
    params.captureReferences?.(doc);
    doc = await this.expandUploadFields(
      doc,
      singleMeta.fields,
      expansionAccess(options)
    );
    // The language this read resolved to, shared by both expansions below so a
    // related row and a related row inside a component are judged alike.
    const readLocale = this.resolveLocaleChain(
      options.locale,
      options.fallbackLocale
    )?.[0];
    doc = await this.expandRelationshipFields(
      doc,
      singleMeta.fields,
      options.depth,
      {
        enforceFieldAccess: enforceRelatedFieldAccess,
        // Beside the flag, never folded into `user`: a preview judges a related
        // row's fields as the sharer while every hook goes on seeing the
        // anonymous visitor who is actually asking.
        fieldAccessUser: options.fieldAccessUser,
        // Always on, unlike field redaction: the authorization view must not be
        // shown a related row the response is going to withhold, or its rule
        // approves the document and the read's side effects run before the
        // final check discovers the row is gone.
        enforceCollectionAccess: true,
        user: options.user,
        overrideAccess: options.overrideAccess,
        // Narrows that bypass per RELATED collection. Absent means unchanged;
        // dropping it here would silently restore the full bypass.
        trusted: assumedBound(options.trusted),
        authenticatedScope: options.authenticatedScope,
        // Collects the references a target collection refused, so the
        // completeness check below reads them as absent on purpose.
        withheldByAccess: params.withheldByAccess,
        // A target collection's read rule may filter on one of its own
        // localized fields, which is a companion lookup rather than a column.
        locale: readLocale,
        // Only "read everything" propagates, and only when asked for: the
        // admin sends it on every read, a public caller never does.
        status: expansionStatusScope({
          status: options.status,
          overrideAccess: options.overrideAccess,
          bounded: narrows(options.trusted),
        }),
      },
      strict,
      // The read path threads a caller, so the target collection's field rules
      // can be evaluated for the rows this pulls in.
      true
    );

    // A strict pass is the authorization view, and its whole contract is that a
    // rule is judged on complete data or not at all. Field-group values live in
    // their own tables, so without the service that loads them the rule reads
    // the fields as empty — the same "absence looks like permission" failure the
    // depth floor and the relationship completeness check exist to prevent, and
    // it would silently admit callers a rule inspecting those values refuses.
    // Only a Single that actually declares field-group fields is affected; the
    // service is always wired in the DI graph, so this guards the seam rather
    // than a reachable configuration.
    if (!this.fieldGroupDataService && strict) {
      const declaresFieldGroups = singleMeta.fields.some(field =>
        isFieldGroupField(field)
      );
      if (declaresFieldGroups) {
        throw NextlyError.internal({
          logContext: {
            single: slug,
            reason: "field-group-data-service-unavailable-during-authorization",
          },
        });
      }
    }

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
            // A relationship inside a component is populated by the same
            // service, so a refusal there has to reach the completeness check
            // too, and the rows of one population share a policy cache.
            withheldByAccess: params.withheldByAccess,
            targetPolicies: new Map(),
            targetCompanions: new Map(),
            authenticatedScope: options.authenticatedScope,
            locale: readLocale,
            status: expansionStatusScope({
              status: options.status,
              overrideAccess: options.overrideAccess,
              bounded: narrows(options.trusted),
            }),
          },
          // Read errors otherwise become empty component values, which reads to a
          // rule exactly like a component that holds nothing.
          strict,
        })) as SingleDocument;
      } catch (error) {
        // Only strict asks for a throw, and the result builder puts a bare
        // Error's own message on the wire — component table and column names
        // the caller has no business seeing.
        if (!strict) throw error;
        throw NextlyError.is(error)
          ? error
          : NextlyError.internal({
              cause: error instanceof Error ? error : undefined,
              logContext: {
                single: slug,
                reason: "component-population-failed-during-authorization",
              },
            });
      }
    }

    return doc;
  }

  /**
   * Build the copy of a document that an access rule is judged on.
   *
   * Two things separate it from the response. Related rows keep the fields the
   * target collection would hide from this caller, because a rule reading one
   * must see the stored value rather than the hole redaction leaves — the same
   * "absence means allowed" reading that admits a caller the rule exists to
   * refuse. And it is detached, so a rule that writes to its `data` argument
   * changes nothing the caller receives: a rule is a decision, not a
   * transformation.
   */
  /**
   * Refuse an authorization view whose relationship evidence is incomplete.
   *
   * Expansion is best-effort several layers down: a related table that cannot
   * be read is logged and yields nothing, so the field comes back as the bare
   * id it started as, and a `hasMany` list quietly loses the entries that could
   * not be fetched. That is a fine response and a dangerous thing to judge — a
   * rule reading into a related row sees nothing there, and an absence-tolerant
   * one reads that as permission. Rather than thread a strict flag through a
   * service shared with the collection paths, the property that actually
   * matters is checked directly: every stored reference that should have become
   * a row did, and none went missing on the way.
   *
   * Many-to-many relations are not covered, having no id on the main row to
   * compare against.
   */
  private assertRelationshipsExpanded(
    slug: string,
    fields: FieldConfig[],
    stored: Record<string, unknown> | undefined,
    assembled: Record<string, unknown> | undefined,
    /**
     * Whether relationships were expanded for this document at all. A read at
     * `depth: 0` asks for references and gets them, so requiring documents
     * there refuses a response that is exactly what was requested. Uploads are
     * unaffected: they populate whatever depth is asked for.
     */
    expandsRelationships = true,
    path = "",
    /**
     * Ids a target collection's rules refused this caller, so an absence they
     * caused is not read as evidence that failed to load.
     */
    withheldByAccess?: Set<string>
  ): void {
    if (!assembled) return;

    for (const field of fields) {
      if (!("name" in field) || !field.name) continue;
      const name = field.name;
      const type = field.type as string;
      // `stored` may not carry the field at all: a localized value lives in the
      // companion table and only reaches the document once it is overlaid.
      const before = stored?.[name];
      const after = assembled[name];
      if (isEmptyValue(before) && isEmptyValue(after)) continue;
      const where = path ? `${path}.${name}` : name;

      // `relation` is deliberately absent: the relationship service matches
      // `relationship` only, so a field declared with the legacy alias is never
      // expanded for anyone, and requiring a document for it would refuse every
      // read of a Single that uses one. A rule reading into such a field sees
      // the reference — a limitation of the alias, not of this check.
      if (type === "relationship" || type === "upload") {
        if (type !== "upload" && !expandsRelationships) continue;
        // `maxDepth: 0` asks for the reference itself, so an unexpanded id is
        // the configured outcome rather than a failure to expand. Uploads are
        // populated whatever depth is configured, so the same exemption would
        // skip their only check.
        if (type !== "upload" && relationshipMaxDepth(field) === 0) continue;
        if (
          !referencesExpanded(
            before,
            after,
            withheldByAccess,
            singleFieldTarget(field)
          )
        ) {
          this.logger.error(
            "Refusing a single read: relationship evidence could not be assembled",
            { single: slug, field: where }
          );
          throw NextlyError.internal({
            logContext: {
              single: slug,
              field: where,
              reason: "incomplete-authorization-view",
            },
          });
        }
        continue;
      }

      // A relationship nested in a container is expanded too, so the same
      // guarantee has to reach it.
      if (type !== "group" && type !== "repeater") continue;
      const nested = "fields" in field ? (field.fields as FieldConfig[]) : [];
      if (!nested || nested.length === 0) continue;

      // A container that cannot be read, or that holds the wrong shape, is not
      // a container that holds nothing. Its relationships are unreachable
      // either way, so the walk below would step over them and the document
      // would be judged on what it could not see.
      if (
        isMisshapenContainer(before, type) ||
        isMisshapenContainer(after, type)
      ) {
        this.logger.error(
          "Refusing a single read: a container could not be read while authorizing",
          { single: slug, field: where }
        );
        throw NextlyError.internal({
          logContext: {
            single: slug,
            field: where,
            reason: "unreadable-container-during-authorization",
          },
        });
      }

      const storedRows = containerRows(before, type);
      const assembledRows = containerRows(after, type);
      // Bounded by the longer side: a localized container reaches the document
      // only through the overlay, so the reference snapshot may hold rows the
      // stored row never had — and the reverse for one that failed to load.
      const rowCount = Math.max(storedRows.length, assembledRows.length);
      for (let index = 0; index < rowCount; index += 1) {
        this.assertRelationshipsExpanded(
          slug,
          nested,
          storedRows[index],
          assembledRows[index],
          expandsRelationships,
          type === "repeater" ? `${where}[${index}]` : where,
          withheldByAccess
        );
      }
    }
  }

  private async buildAuthorizationView(params: {
    slug: string;
    singleMeta: DynamicSingleRecord;
    doc: SingleDocument;
    options: GetSingleOptions;
    statusFilterValue: string | undefined;
    skipLocalizedOverlay?: boolean;
  }): Promise<SingleDocument> {
    let references: SingleDocument | undefined;
    // Rows the targets' own rules refused while assembling this view.
    const viewWithheld = new Set<string>();
    const assembled = await this.assembleStoredDocument({
      ...params,
      // Every reference the read will resolve, including the localized ones the
      // stored row never carries. Detached so later stages cannot rewrite the
      // record of what was supposed to be there.
      captureReferences: doc => {
        references = detachData(doc);
      },
      // Assembled from a copy of the row: the transforms mutate what they are
      // given, and the response is assembled from the same row afterwards.
      doc: { ...params.doc },
      enforceRelatedFieldAccess: false,
      // Depth is the caller's preference about the SHAPE of the response, and
      // must not be able to shrink the evidence a rule is judged on: at
      // `depth: 0` a relationship stays an id, and a rule reading into the
      // related row would be handed nothing and read that as permission. The
      // view expands at least as far as an unqualified read would, and further
      // when the caller asked for more. It does NOT expand without limit — a
      // rule reaching past the requested depth is not covered, and cannot be
      // without paying an unbounded fan-out on every restricted read.
      options: {
        ...params.options,
        depth: Math.max(params.options.depth ?? 0, DEFAULT_READ_DEPTH),
      },
      // Judged on complete data or not at all.
      strict: true,
      // The view withholds a target this caller may not read, exactly as the
      // response will, so the check below has to know which absences that
      // accounts for — otherwise the refusal it was asked to make reads back to
      // it as evidence that failed to load.
      withheldByAccess: viewWithheld,
    });
    this.assertRelationshipsExpanded(
      params.slug,
      params.singleMeta.fields,
      references ?? params.doc,
      assembled,
      true,
      "",
      viewWithheld
    );
    // The response carries the per-locale overview when it is asked for, so a
    // rule deciding on translation state has to see it here too, or the two
    // decisions are made about documents that differ in what the rule reads.
    if (params.options.translationStatus) {
      await this.attachTranslationOverview(
        params.slug,
        params.singleMeta,
        assembled,
        true
      );
    }
    return detachData(assembled);
  }

  /**
   * Decide a `custom` read rule before the read causes anything to happen.
   *
   * The rule is shown the document a caller would receive, assembled from the
   * stored row: a rule reading `data` decides on translations and component
   * values that the bare main-table row does not carry, so judging the row alone
   * refuses callers the rule admits and admits callers it refuses. Assembling
   * first costs a second pass over the read-only stages, and buys a decision
   * made on the same evidence the caller would get.
   *
   * Deciding here, rather than only on the way out, is what keeps a refused
   * caller from reaching user hooks or from materializing a Single that has
   * never been written — both permanent effects of a read that is about to be
   * denied.
   *
   * A rule that answers with a query constraint is refused. A constraint
   * narrows a result set, and a Single's document is assembled from several
   * tables, so no single row remains for the database to test the predicate
   * against; approximating it in memory would mean a second evaluator drifting
   * from the one collection lists compile.
   */
  private async evaluateCustomRead(params: {
    slug: string;
    singleMeta: DynamicSingleRecord;
    accessRules: CollectionAccessRules | undefined;
    options: GetSingleOptions;
    statusFilterValue: string | undefined;
    /** The stored row, already loaded and already screened for visibility. */
    row: SingleDocument | null;
  }): Promise<{
    denied?: SingleResult;
    /**
     * The document this read would create, when the Single has no row yet. The
     * caller hands it back to the insert so the row that gets written is the one
     * the rule was shown, down to its id.
     */
    prospective?: DefaultDocumentDraft;
  }> {
    const { slug, singleMeta, accessRules, options, statusFilterValue, row } =
      params;
    if (!accessRules) return {};

    const denied: SingleResult = {
      success: false,
      statusCode: 403,
      message: `Access denied: read on single "${slug}" is not permitted`,
    };

    // A Single that has never been written still has the document this read
    // would create: its declared field defaults. Judging those is what keeps a
    // rule such as `data.secret !== true` from admitting the read that
    // materializes a document the rule refuses — a permanent write (the row, its
    // first version, its localized defaults) driven by a caller about to be
    // denied. Built in memory; nothing is persisted here, and the row the read
    // goes on to create is judged again on the way out.
    const prospective = row
      ? undefined
      : await this.buildDefaultDocument(singleMeta);
    // Either way the rule is shown the document as the read would render it.
    // A draft's stored form is not that: `buildDefaultDocument` leaves group,
    // repeater and JSON defaults in their serialized form, so a rule reading
    // `data.settings.private` would be handed a string. Its localized defaults
    // are already inline, which is why the companion overlay is skipped.
    const document = await this.buildAuthorizationView({
      slug,
      singleMeta,
      doc: row ?? prospective!.document,
      options,
      statusFilterValue,
      skipLocalizedOverlay: !row,
    });

    const result = await this.accessControlService.evaluateAccess(
      accessRules,
      "read",
      {
        // Spread rather than rebuild: `UserContext` carries arbitrary extra
        // claims, and a rule reading one (a tenant id, a plan) sees undefined
        // if the object is reconstructed from the canonical fields alone,
        // which can allow a caller it was written to deny.
        user: options.user ? { ...options.user } : undefined,
        // Part of the documented rule context: a rule keyed on the requested
        // language sees `undefined` without them, which can turn an
        // absence-tolerant check into an unintended allow.
        locale: options.locale,
        fallbackLocale: options.fallbackLocale,
      },
      // The same identity the rule sees in `data`: the stored row's id, or the
      // one the prospective insert will carry.
      typeof document.id === "string" ? document.id : undefined,
      document
    );

    if (!result.allowed) {
      return {
        denied: { ...denied, message: result.reason ?? denied.message },
      };
    }
    if (result.query !== undefined && result.query !== null) {
      this.logger.warn("Refused a constraint returned for a single", { slug });
      return { denied };
    }
    return { prospective };
  }

  /**
   * The authoritative read decision, made on the fully assembled document.
   *
   * A document-dependent rule is only as good as the data it is shown. The
   * earlier gate necessarily runs on the bare main-table row, because it has to
   * refuse a caller BEFORE the stages that would materialize, translate and
   * populate the document on their behalf. Those stages then change what `data`
   * contains, so the rule is asked again here, about the object the caller would
   * actually receive.
   *
   * A constraint returned at this point cannot be handed to the database — the
   * document has already been assembled from several tables and no longer
   * corresponds to a single row — so a constraint is refused rather than
   * approximated in memory.
   *
   * Only a `custom` rule is asked again. Ownership is settled once, against the
   * stored row: none of the assembly stages can transfer a document to a
   * different owner, while a hook is free to drop or rewrite the owner value in
   * the response — so asking again here could only refuse the caller the first
   * check already recognised as the owner.
   */
  private async judgeAssembledDocument(params: {
    slug: string;
    accessRules: CollectionAccessRules | undefined;
    user?: UserContext;
    locale?: string;
    fallbackLocale?: string | false;
    document: SingleDocument;
  }): Promise<SingleResult | null> {
    const { slug, accessRules, user, locale, fallbackLocale, document } =
      params;
    if (!accessRules) return null;

    const denied: SingleResult = {
      success: false,
      statusCode: 403,
      message: `Access denied: read on single "${slug}" is not permitted`,
    };

    const result = await this.accessControlService.evaluateAccess(
      accessRules,
      "read",
      { user: user ? { ...user } : undefined, locale, fallbackLocale },
      typeof document.id === "string" ? document.id : undefined,
      document
    );
    if (!result.allowed) {
      return { ...denied, message: result.reason ?? denied.message };
    }
    if (result.query !== undefined && result.query !== null) {
      // The assembled document spans several tables, so there is no single row
      // for the database to re-check this against.
      this.logger.warn(
        "Refused a constraint returned for an assembled single",
        {
          single: slug,
        }
      );
      return denied;
    }
    return null;
  }

  /**
   * Decide an `owner-only` read against the loaded row.
   *
   * `checkSingleAccess` runs before the row is fetched and fails an owner-only
   * rule closed for lack of a document, so the rule is skipped there and
   * settled here — the same split the mutation service uses for publish
   * transitions.
   *
   * Ownership is compared directly rather than through the access service. For
   * a read that service does not decide at all: it reports `allowed: true` for
   * any authenticated caller and returns the predicate a LIST would have
   * filtered by, which one document has no query to apply. Comparing the owner
   * column here keeps the check to the one thing owner-only actually asserts,
   * with no filter grammar to re-implement.
   */
  private evaluateOwnerOnlyRead(params: {
    slug: string;
    rule: { ownerField?: string } | undefined;
    user?: UserContext;
    document: Record<string, unknown> | null;
  }): SingleResult | null {
    const { slug, rule, user, document } = params;
    const denied: SingleResult = {
      success: false,
      statusCode: 403,
      message: `Access denied: read on single "${slug}" is not permitted`,
    };

    // Ownership presupposes an identity.
    if (!user?.id) return denied;

    // No row means ownership cannot be established. Denying also stops
    // auto-create from materializing an unowned document for a caller who may
    // not be entitled to it — a write triggered by a read about to be refused.
    if (!document) return denied;

    // Singles default the owner column to camelCase `createdBy` while the row
    // may carry the snake_case column the database stores, so both spellings of
    // the same column are accepted rather than denying the real owner.
    const ownerField = rule?.ownerField ?? GENERIC_DEFAULT_OWNER_FIELD;
    const camel = ownerField.replace(/_([a-z])/g, (_m: string, c: string) =>
      c.toUpperCase()
    );
    const snake = ownerField.replace(
      /[A-Z]/g,
      (c: string) => `_${c.toLowerCase()}`
    );
    const owner = document[ownerField] ?? document[camel] ?? document[snake];

    return owner === user.id ? null : denied;
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
      // The Single's stored read rule is evaluated here against the caller the
      // route forwards. It is the same rule the admin configures and the same
      // one the write paths already honor, so a `read: authenticated` or
      // role-based rule now holds over HTTP instead of only inside the Direct
      // API.
      // An owner-only or custom read rule can only be judged against the row,
      // and the row is not loaded yet. Defer those to the re-check below: the
      // gate fails an owner-only rule closed when it has no document, which
      // would deny every non-super-admin read of an owner-only Single.
      const readRule = (singleMeta.accessRules as CollectionAccessRules)
        ?.read as { type?: string } | undefined;
      const isSuperAdminSession =
        isSuperAdminContext(options.user) &&
        options.authenticatedScope?.actorType !== "apiKey";
      // Both kinds are skipped at the gate, which has no row to judge them
      // against, and each is settled below: an owner-only rule by comparing the
      // owner column on the stored row, a custom rule by judging the document
      // that row assembles into.
      const skipRuleAtGate =
        !isSuperAdminSession &&
        (readRule?.type === "owner-only" || readRule?.type === "custom");
      const deferDocumentRule =
        !isSuperAdminSession && readRule?.type === "owner-only";
      const deferCustomRule =
        !isSuperAdminSession && readRule?.type === "custom";

      const accessDenied = await checkSingleAccess({
        slug,
        operation: "read",
        accessRules: singleMeta.accessRules,
        deferStoredRuleEval: skipRuleAtGate,
        user: options.user,
        overrideAccess: options.overrideAccess,
        routeAuthorized: options.routeAuthorized,
        rbacAccessControlService: this.rbacAccessControlService,
        // Without this the gate has rules but nothing to evaluate them with, and
        // silently skips them.
        accessControlService: this.accessControlService,
        // A scoped API key is judged on its OWN read grant, so a super-admin-owned
        // key does not skip the read gate via the owner's roles.
        authenticatedScope: options.authenticatedScope,
        logger: this.logger,
      });
      if (accessDenied) {
        return accessDenied;
      }

      // The draft/published filter is resolved here rather than after the read
      // because a deferred rule is judged on the assembled document, and the
      // translation overlay it runs needs the same status the response will be
      // built under.
      const statusFilter = resolveStatusFilter({
        collectionHasStatus:
          (singleMeta as { status?: boolean }).status === true,
        overrideAccess: options.overrideAccess === true,
        explicit: options.status,
      });

      // 1.55. Load the row once for whichever deferred rule needs it, and screen
      // it for visibility first. A draft Single answers 404 to an untrusted
      // caller so its existence stays hidden; deciding a stored rule before that
      // would answer 403 instead, which tells the caller both that the row is
      // there and what the rule made of them.
      let storedRow: SingleDocument | null = null;
      if ((deferDocumentRule || deferCustomRule) && !options.overrideAccess) {
        storedRow = await this.adapter.selectOne<SingleDocument>(
          singleMeta.tableName,
          {}
        );
        if (
          storedRow &&
          statusFilter &&
          !(await this.isSingleVisible({
            slug,
            documentId: (storedRow as { id?: unknown }).id,
            storedStatus: (storedRow as { status?: string }).status,
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
      }

      // 1.6. Settle a deferred document rule BEFORE any read side effect. Hooks
      // are user code and auto-create permanently materializes the document
      // (with its first version and localized defaults), so a caller the rule
      // denies must not reach either by issuing a read it is not allowed to
      // make.
      if (deferDocumentRule && !options.overrideAccess) {
        // Ownership lives on the stored row, so the bare row settles it; none of
        // the stages that assemble the document can move a Single to a different
        // owner.
        const documentRuleDenied = this.evaluateOwnerOnlyRead({
          slug,
          rule: readRule as { ownerField?: string } | undefined,
          user: options.user,
          document: storedRow,
        });
        if (documentRuleDenied) return documentRuleDenied;
      }

      // 1.7. Settle a custom rule the same way, and before the same side
      // effects.
      let prospectiveDefault: DefaultDocumentDraft | undefined;
      if (deferCustomRule && !options.overrideAccess) {
        const custom = await this.evaluateCustomRead({
          slug,
          singleMeta,
          accessRules: singleMeta.accessRules,
          options,
          statusFilterValue: statusFilter ? statusFilter.value : undefined,
          row: storedRow,
        });
        if (custom.denied) return custom.denied;
        prospectiveDefault = custom.prospective;
      }

      // 2. Build shared context for hooks (seed with caller-provided context)
      const sharedContext: Record<string, unknown> = { ...options.context };
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

      // 5.5. Ownership was established on the row loaded before the hooks, and
      // this is a different read of it. A `beforeRead` hook may write, and
      // another writer may reassign the owner column between the two, so the row
      // actually being returned is checked as well. This judges the stored row,
      // not the response: hooks and field rules transform the owner value on the
      // way out, and a check made after them refuses the real owner.
      if (deferDocumentRule && !options.overrideAccess) {
        const ownershipLapsed = this.evaluateOwnerOnlyRead({
          slug,
          rule: readRule as { ownerField?: string } | undefined,
          user: options.user,
          document: doc,
        });
        if (ownershipLapsed) return ownershipLapsed;
      }

      // 6. Auto-create if document doesn't exist. Capture the initial version
      // when the Single is versioned so a first-read materialization still
      // starts a history (the mutation path records its own first version).
      if (!doc) {
        // The row that was authorized is gone — a `beforeRead` hook or another
        // writer removed it between the two fetches — so what would be created
        // here is a default document no rule has seen. Judge it before writing
        // it, the same way a first read of a Single that never existed is
        // judged, rather than persisting the row, its localized defaults and
        // its first version and refusing afterwards.
        if (deferCustomRule && !options.overrideAccess && !prospectiveDefault) {
          const lateDraft = await this.evaluateCustomRead({
            slug,
            singleMeta,
            accessRules: singleMeta.accessRules,
            options,
            statusFilterValue: statusFilter ? statusFilter.value : undefined,
            row: null,
          });
          if (lateDraft.denied) return lateDraft.denied;
          prospectiveDefault = lateDraft.prospective;
        }
        this.logger.info("Auto-creating Single document", { slug });
        doc = await this.createDefaultDocument(singleMeta, {
          captureInitialVersion: true,
          // The draft an access decision already judged, so the row written is
          // the one the rule was shown. Building a second one would give the
          // final check a different id than the rule was asked about.
          draft: prospectiveDefault,
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
      // Related rows are redacted HERE rather than after the decision below,
      // unlike this Single's own fields. A related row's chosen label is a copy
      // of one of its field values, derived while the row is expanded, so
      // redacting afterwards would leave a withheld value standing in the label
      // it was copied into. The rule still sees related fields unredacted: the
      // decision that governs them is the one made before any of this ran, on
      // an unredacted assembly of the stored row.
      // Whether a stored rule will be judged on what this assembly produces.
      const judgedRead = deferCustomRule && !options.overrideAccess;
      let responseReferences: SingleDocument | undefined;
      // References a target collection refuses this caller. Collected during
      // the response assembly so the completeness check can tell an absence
      // the rules caused from one a failed load caused.
      const responseWithheld = new Set<string>();
      doc = await this.assembleStoredDocument({
        slug,
        singleMeta,
        doc,
        options,
        statusFilterValue: statusFilter ? statusFilter.value : undefined,
        enforceRelatedFieldAccess: true,
        // An ordinary read is still served when a companion query fails, but a
        // read about to be judged cannot be: the rule would decide on values
        // the failure removed rather than on what is stored.
        strict: judgedRead,
        // Recorded only so the decision below can be held to the same
        // completeness bar as the earlier one; the response itself stays
        // best-effort.
        captureReferences: captured => {
          responseReferences = detachData(captured);
        },
        withheldByAccess: responseWithheld,
      });

      // The response assembly is best-effort, and the decision below is made on
      // what it produced, so it is held to the same completeness bar as the
      // authorization view: expansion that succeeded for that earlier pass can
      // fail here after a hook writes or another writer moves the data.
      //
      // Checked HERE, before any response-shaping hook. A hook may legitimately
      // drop or replace a relationship, and nothing distinguishes that from an
      // expansion that failed — so a later check would read a deliberate
      // transformation as a fault and refuse a read that is fine.
      if (deferCustomRule && !options.overrideAccess) {
        this.assertRelationshipsExpanded(
          slug,
          singleMeta.fields,
          responseReferences ?? doc,
          doc,
          // The response honours the caller's depth, and `0` means "give me
          // references". The authorization view has already judged the same
          // relationships at the full read depth.
          (options.depth ?? DEFAULT_READ_DEPTH) > 0,
          "",
          // A relationship the target's own rules refused is absent because the
          // caller may not read it, not because the read failed. Refusing the
          // document over it would deny a Single they are allowed to see.
          responseWithheld
        );
      }

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
      });

      // attach the per-locale `_translations` overview for the admin's language pills
      // (opt-in via `?translation-status=1`). No-op for non-localized singles / public reads.
      if (options.translationStatus) {
        await this.attachTranslationOverview(slug, singleMeta, doc, judgedRead);
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

      // 9. Judge the document being RETURNED, not the row the read started
      // from. A document-dependent rule reads `data`, and `data` is assembled in
      // stages after the earlier gate: defaults on auto-create, translations
      // from the companion table, component rows from their own tables, and
      // whatever a hook changed. A rule such as `data?.secret !== true` sees
      // none of that on the bare main-table row and admits a caller the
      // assembled document denies. The earlier gate stays because it refuses
      // callers before those stages run any side effects; this is the decision
      // that governs what is handed back.
      if (deferCustomRule && !options.overrideAccess) {
        const finalDenial = await this.judgeAssembledDocument({
          slug,
          accessRules: singleMeta.accessRules,
          user: options.user,
          locale: options.locale,
          fallbackLocale: options.fallbackLocale,
          // A detached copy, so the rule decides rather than edits. `data` is
          // handed to user code, and passing the response object itself would
          // let a rule that assigns to it rewrite what the caller receives —
          // including putting back a value a later stage is meant to withhold.
          // Deep, because a shallow copy still shares every nested component,
          // repeater and expanded relation with the response.
          document: detachData(doc),
        });
        if (finalDenial) return finalDenial;
      }

      // 10. Redact fields the caller may not read, AFTER the document-level
      // decision. Redaction removes values a rule may be written to inspect, so
      // running it first lets a rule guarding a companion- or component-backed
      // field see that field absent — the same "missing means allowed" reading
      // that admits a caller the rule exists to refuse. Access decides on the
      // document as assembled; the response is narrowed once it is decided.
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
    statusFilterValue: string | undefined
  ): Promise<void> {
    const localeChain = this.resolveLocaleChain(locale, fallbackLocale);
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
      statusValue:
        companion.hasStatus && statusFilterValue
          ? statusFilterValue
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
    doc: Record<string, unknown>,
    strict: boolean
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
              reason: strict
                ? "translation-overview-failed-during-authorization"
                : "translation-overview-failed",
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

  /**
   * Build the requested→fallback locale chain, or `null` when localization is off. A per-request
   * `fallbackLocale === false | "none"` disables fallback (chain = just the requested locale, so an
   * untranslated field reads empty); a per-request string re-enables the chain even when the global
   * flag is off; otherwise the global `fallback` flag decides. Mirrors the collection read path.
   */
  private resolveLocaleChain(
    locale: string | undefined,
    fallbackLocale: string | false | undefined
  ): string[] | null {
    if (!this.localization || locale === "all") return null;
    const requested = resolveRequestedLocale(this.localization, locale);
    // Per-request disable wins — the admin editor passes this so untranslated fields show blank.
    if (fallbackLocale === false || fallbackLocale === "none") {
      return [requested];
    }
    // A concrete per-request fallback locale overrides the configured chain: the requested
    // locale first, then the NAMED fallback's own chain (deduped) — not the requested locale's
    // chain. Mirrors the collection read path so `?locale=de&fallback-locale=en` falls back to en.
    if (
      typeof fallbackLocale === "string" &&
      isValidLocale(this.localization, fallbackLocale)
    ) {
      const seen = new Set<string>();
      return [
        requested,
        ...resolveFallbackChain(this.localization, fallbackLocale),
      ].filter(code => (seen.has(code) ? false : (seen.add(code), true)));
    }
    if (this.localization.fallback === false) return [requested];
    return resolveFallbackChain(this.localization, requested);
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
   * stored rules: a trusted read that bounded its bypass has refused this
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
     * Propagate expansion failures instead of returning the document
     * unexpanded. A response is better served incomplete than not at all, but a
     * document being judged is not: an access rule reading a related value that
     * a transient failure removed decides on its absence, and an
     * absence-tolerant rule reads that as permission.
     */
    strict = false,
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
      if (strict) {
        // Wrapped rather than rethrown: the result builder puts a bare Error's
        // own message on the wire, which for a driver failure is schema detail
        // the caller has no business seeing.
        throw NextlyError.is(error)
          ? error
          : NextlyError.internal({
              cause: error instanceof Error ? error : undefined,
              logContext: {
                reason: "relationship-expansion-failed-during-authorization",
              },
            });
      }
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
