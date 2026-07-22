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
 * - Component field population via ComponentDataService
 *
 *
 * @module domains/singles/services/single-query-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import {
  apiKeyWriteAllowed,
  type AuthenticatedScope,
} from "../../../auth/authenticated-scope";
import type { FieldConfig } from "../../../collections/fields/types";
import { container } from "../../../di/container";
import type { Nextly as NextlyDirectAPI } from "../../../direct-api/nextly";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import {
  buildContext,
  type BuildContextOptions,
} from "../../../hooks/context-builder";
import type { HookRegistry } from "../../../hooks/hook-registry";
import type { HookContext } from "../../../hooks/types";
import { keysToCamelCase, keysToSnakeCase } from "../../../lib/case-conversion";
import { resolveStatusFilter } from "../../../lib/status-filter";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import type {
  AccessControlService,
  CollectionAccessRules,
} from "../../../services/access";
import { isSuperAdminContext } from "../../../services/access";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { ComponentDataService } from "../../../services/components/component-data-service";
import { BaseService } from "../../../shared/base-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import {
  applyFieldReadAccess,
  runFieldHooks,
} from "../../../shared/lib/field-level-registry";
import {
  hasPasswordField,
  stripPasswordFieldValues,
  stripSystemOwnerField,
} from "../../../shared/lib/password-fields";
import type { Logger } from "../../../shared/types";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
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
import { buildCompanionSchema } from "../../i18n/runtime/companion-io";
import { captureInTx } from "../../versions/capture-in-tx";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { withVersionConflictRetry } from "../../versions/version-conflict";
import type {
  GetSingleOptions,
  SingleDocument,
  SingleResult,
  UserContext,
} from "../types";

import type { SingleRegistryService } from "./single-registry-service";
import {
  buildSingleErrorResult,
  collectAllMediaIds,
  deserializeJsonFields,
  expandMediaInData,
  getDefaultValue,
  shouldTreatAsJson,
} from "./single-utils";

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
    logger,
  } = params;

  if (overrideAccess) {
    return null;
  }

  // Super-admins bypass the stored rules on every transport, keyed on the
  // authorized role set (never the account id).
  if (isSuperAdminContext(user)) {
    return null;
  }

  // Evaluate the Single's stored access rules (owner-only is degenerate for a
  // single global document; public / authenticated / role-based / custom all
  // apply). This runs for both route-authorized and Direct API callers so a
  // caller holding the coarse `update-<single>` permission but failing a
  // stored rule is still denied.
  if (accessControlService && accessRules) {
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
        user: user
          ? {
              id: user.id,
              role: user.role,
              roles: user.roles,
              email: user.email,
            }
          : undefined,
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

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly singleRegistryService: SingleRegistryService,
    private readonly hookRegistry: HookRegistry,
    private readonly componentDataService?: ComponentDataService,
    private readonly rbacAccessControlService?: RBACAccessControlService,
    // i18n: when set and the single is localized, reads resolve translatable fields
    // from the companion `single_<slug>_locales` table for the requested locale.
    private readonly localization?: SanitizedLocalizationConfig
  ) {
    super(adapter, logger);
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

    try {
      // 1. Get Single metadata from registry
      const singleMeta = await this.singleRegistryService.getSingleBySlug(slug);
      if (!singleMeta) {
        return {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" not found`,
        };
      }

      // 1.5. Access check (RBAC) after metadata, before hooks/DB operations.
      // Stored read-rule enforcement is intentionally NOT wired here yet: the
      // REST read handlers do not forward the authenticated user, so evaluating
      // a `read: authenticated` / role-based rule would reject every REST caller
      // as anonymous. It lands with read-path user forwarding in the follow-up
      // read PR (hence no `accessRules` passed).
      const accessDenied = await checkSingleAccess({
        slug,
        operation: "read",
        user: options.user,
        overrideAccess: options.overrideAccess,
        routeAuthorized: options.routeAuthorized,
        rbacAccessControlService: this.rbacAccessControlService,
        logger: this.logger,
      });
      if (accessDenied) {
        return accessDenied;
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

      // 5. Fetch document from database
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
      const statusFilter = resolveStatusFilter({
        collectionHasStatus:
          (singleMeta as { status?: boolean }).status === true,
        overrideAccess: options.overrideAccess === true,
        explicit: options.status,
      });
      if (
        statusFilter &&
        (doc as { status?: string }).status !== statusFilter.value
      ) {
        return {
          success: false,
          statusCode: 404,
          message: `Single "${slug}" not found`,
        };
      }

      // 6.9. i18n: resolve translatable fields from the companion `_locales` table for the
      // requested locale (with fallback) BEFORE deserialization and upload/relationship/component
      // expansion — the companion stores JSON/upload/relationship values in their raw storage form,
      // so the overlay must land before those transforms run (matching the collection read path).
      // No-op when localization is off or the single isn't localized.
      await this.populateLocalized(
        slug,
        singleMeta,
        doc,
        options.locale,
        options.fallbackLocale,
        statusFilter ? statusFilter.value : undefined
      );

      // 7. Deserialize JSON fields
      doc = this.deserializeJsonFields(doc, singleMeta.fields);

      // 7.5. Expand upload fields with full media data
      doc = await this.expandUploadFields(doc, singleMeta.fields);

      // 7.6. Expand relationship fields with full related entry data
      doc = await this.expandRelationshipFields(
        doc,
        singleMeta.fields,
        options.depth
      );

      // 7.7. Populate component field data from comp_{slug} tables
      if (this.componentDataService) {
        doc = (await this.componentDataService.populateComponentData({
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
        })) as SingleDocument;
      }

      // attach the per-locale `_translations` overview for the admin's language pills
      // (opt-in via `?translation-status=1`). No-op for non-localized singles / public reads.
      if (options.translationStatus) {
        await this.populateTranslationMeta(slug, singleMeta, doc);
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

      // Field-level afterRead hooks + read access (functions resolved via
      // the field-level registry).
      await runFieldHooks({
        kind: "single",
        slug,
        phase: "afterRead",
        data: doc,
        operation: "read",
        user: options.user,
      });
      await applyFieldReadAccess({
        kind: "single",
        slug,
        entry: doc,
        user: options.user,
        overrideAccess: options.overrideAccess,
      });

      // Defense in depth: re-strip after hooks in case a hook re-introduced
      // a password value under its declared key.
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
    });
  }

  /**
   * Attach a per-locale `_translations` map (which languages are translated + each
   * one's draft/published status) to the document, for the admin editor's per-language status
   * pills. No-op when localization is off or the single isn't localized. Mirrors the collection
   * read path's `populateTranslationMeta`.
   */
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
    await populateTranslationStatus({
      db: this.adapter.getDrizzle(),
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      rows: [doc],
      locales: this.localization.locales.map(l => l.code),
      defaultLocale: this.localization.defaultLocale,
      hasStatus: companion.hasStatus,
      // The Single's own row id keys the companion `_parent`, same as the collection path.
      idKey: "id",
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
  buildDefaultDocument(singleMeta: DynamicSingleRecord): {
    document: SingleDocument;
    insertValues: Record<string, unknown>;
  } {
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

    // i18n: a localized single's main table omits translatable columns (they live in the
    // companion `single_<slug>_locales`), so a required/defaulted translatable value must
    // not be inserted here — it would target a column that only exists on the companion and
    // fail the auto-create insert.
    const localizedNames = new Set(
      singleMeta.localized === true
        ? resolveLocalizedFieldNames(
            singleMeta.fields as { name: string; type: string }[],
            true
          )
        : []
    );

    for (const field of singleMeta.fields) {
      if (!("name" in field) || !field.name) continue;
      if (localizedNames.has(field.name)) continue;

      if ("defaultValue" in field && field.defaultValue !== undefined) {
        if (shouldTreatAsJson(field)) {
          defaults[field.name] =
            typeof field.defaultValue === "object"
              ? JSON.stringify(field.defaultValue)
              : field.defaultValue;
        } else {
          defaults[field.name] = field.defaultValue;
        }
      } else if ("required" in field && field.required) {
        defaults[field.name] = getDefaultValue(field);
      }
    }

    const snakeCaseDefaults = keysToSnakeCase(defaults) as Record<
      string,
      unknown
    >;

    return {
      document: defaults as SingleDocument,
      insertValues: snakeCaseDefaults,
    };
  }

  async createDefaultDocument(
    singleMeta: DynamicSingleRecord,
    options?: { captureInitialVersion?: boolean }
  ): Promise<SingleDocument> {
    const { insertValues: snakeCaseDefaults } =
      this.buildDefaultDocument(singleMeta);
    const id = snakeCaseDefaults.id as string;

    const versionsConfig = singleMeta.versions;
    const shouldCapture =
      options?.captureInitialVersion === true &&
      versionsConfig?.enabled === true;

    if (!shouldCapture) {
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
        stripPasswordFieldValues(parentRow, singleMeta.fields);
        stripSystemOwnerField(parentRow);
        for (const field of singleMeta.fields) {
          if (!("name" in field) || !field.name) continue;
          const value = parentRow[field.name];
          if (shouldTreatAsJson(field) && typeof value === "string") {
            try {
              parentRow[field.name] = JSON.parse(value);
            } catch {
              // Not valid JSON — keep the raw string.
            }
          }
        }
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
          // Left unlabelled: this snapshot is the main row alone, and a
          // localized Single keeps its translatable values in the companion, so
          // it holds no locale's content to claim.
          locale: null,
          maxPerDoc: versionsConfig.maxPerDoc,
        });
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
   */
  async expandUploadFields(
    doc: SingleDocument,
    fields: FieldConfig[]
  ): Promise<SingleDocument> {
    const allMediaIds = collectAllMediaIds(doc, fields);
    if (allMediaIds.length === 0) {
      return doc;
    }

    const uniqueMediaIds = [...new Set(allMediaIds)];
    const mediaRecords = await this.fetchMediaByIds(uniqueMediaIds);

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
    depth?: number
  ): Promise<SingleDocument> {
    const relationshipService = this.resolveRelationshipService();
    if (!relationshipService) {
      return doc;
    }

    // FieldConfig uses "relationship"; FieldDefinition (UI-created) uses "relation".
    const hasRelationFields = fields.some(
      f =>
        "name" in f &&
        f.name &&
        ((f.type as string) === "relationship" ||
          (f.type as string) === "relation")
    );
    if (!hasRelationFields) {
      return doc;
    }

    try {
      // FieldConfig and FieldDefinition are structurally compatible for the
      // properties that CollectionRelationshipService checks.
      const expandedDoc = await relationshipService.expandRelationships(
        doc,
        "", // Singles don't belong to a collection
        fields as unknown as FieldDefinition[],
        { depth: depth ?? 2 }
      );
      return expandedDoc as SingleDocument;
    } catch (error) {
      this.logger.error("Failed to expand relationship fields for Single", {
        error,
      });
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
   */
  private async fetchMediaByIds(
    ids: string[]
  ): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];

    try {
      const idPlaceholders = sql.join(
        ids.map(id => sql`${id}`),
        sql`, `
      );

      const mediaQuery = sql`
        SELECT * FROM media
        WHERE id IN (${idPlaceholders})
      `;

      const db = this.db as unknown as {
        execute: (query: unknown) => Promise<unknown>;
      };
      const results = await db.execute(mediaQuery);

      let rows: unknown[];
      if (Array.isArray(results)) {
        rows = results;
      } else if (
        results &&
        typeof results === "object" &&
        "rows" in results &&
        Array.isArray((results as { rows: unknown[] }).rows)
      ) {
        rows = (results as { rows: unknown[] }).rows;
      } else {
        rows = [];
      }

      return rows.map(
        row =>
          keysToCamelCase(row as Record<string, unknown>) as Record<
            string,
            unknown
          >
      );
    } catch (error) {
      this.logger.error("Failed to fetch media by IDs", { error });
      return [];
    }
  }
}
