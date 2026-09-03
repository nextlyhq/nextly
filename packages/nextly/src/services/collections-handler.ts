import * as path from "path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getHookRegistry } from "@nextly/hooks/hook-registry";

import type { AuthenticatedScope } from "../auth/authenticated-scope";
import type { RequestActor } from "../auth/request-actor";
import type { FieldConfig } from "../collections/fields/types";
import { container } from "../di/container";
import type { ResolvedAuditRetentionConfig } from "../domains/audit/retention-config";
import type { PermissionSeedService } from "../domains/auth/services/permission-seed-service";
import type { RBACAccessControlService } from "../domains/auth/services/rbac-access-control-service";
import { DynamicCollectionService } from "../domains/dynamic-collections";
import type { ResolvedEmailRetentionConfig } from "../domains/email/retention-config";
import type { SanitizedLocalizationConfig } from "../domains/i18n/config/types";
import { releaseVisibilityFor } from "../domains/releases/release-visibility";
import { MetaRetentionGate } from "../domains/retention/gate";
import {
  buildRetentionRunner,
  retentionPoliciesFrom,
} from "../domains/retention/passes";
import {
  draftSplitResponseFields,
  schemaDraftSplit,
} from "../domains/versions/draft-split-eligibility";
import type { WebhookFastDrainScheduler } from "../domains/webhooks/after-drain";
import type { ResolvedWebhookRetentionConfig } from "../domains/webhooks/retention-config";
import type { RichTextOutputFormat } from "../lib/rich-text-html";
import type { CacheRevalidator } from "../revalidation/types";
import type { FieldDefinition } from "../schemas/dynamic-collections";
import type { DatabaseInstance } from "../types/database-operations";

import { AccessControlService } from "./access";
import { CollectionFileManager } from "./collection-file-manager";
import {
  CollectionEntryService,
  CollectionMetadataService,
  CollectionRelationshipService,
  type WhereFilter,
  type UserContext,
} from "./collections/index";
import type { TrustBound } from "./collections/trust-grant";
import type { FieldGroupDataService } from "./field-groups/field-group-data-service";
import type { FieldGroupRegistryService } from "./field-groups/field-group-registry-service";
import { consoleLogger } from "./shared";
import type { Logger } from "./shared";

/**
 * CollectionsHandler - Unified facade for collection operations.
 *
 * This handler provides a backward-compatible API that delegates to specialized services:
 * - CollectionMetadataService: Collection CRUD (create, list, get, update, delete)
 * - CollectionEntryService: Entry CRUD with hooks and permissions
 * - CollectionRelationshipService: Relationship expansion and junction table management
 *
 * For new code, consider using the specialized services directly for better separation of concerns.
 *
 * @example
 * ```typescript
 * // Using the facade (backward compatible)
 * const handler = new CollectionsHandler(db);
 * await handler.createCollection({ name: 'posts', ... });
 *
 * // Using specialized services directly (recommended for new code)
 * const metadataService = new CollectionMetadataService(db, fileManager, collectionService);
 * await metadataService.createCollection({ name: 'posts', ... });
 * ```
 */
export class CollectionsHandler {
  private readonly metadataService: CollectionMetadataService;
  private readonly entryService: CollectionEntryService;
  private readonly relationshipService: CollectionRelationshipService;

  private readonly collectionService: DynamicCollectionService;
  private readonly fileManager: CollectionFileManager;
  private readonly logger: Logger;

  constructor(
    adapter: DrizzleAdapter,
    db: DatabaseInstance,
    logger: Logger = consoleLogger,
    consumerAppRoot?: string,
    /** Normalized localization config (i18n M4) — enables companion-aware reads. */
    private readonly localization?: SanitizedLocalizationConfig,
    /**
     * Resolved webhook retention policy. Content writes offer to run a pass so
     * the event ledger stays bounded in installs that never configure a webhook
     * and therefore never run the drain. Null or absent leaves the event ledger
     * unpruned; it no longer decides whether a runner exists at all, since the
     * audit policy below can call for one on its own.
     */
    webhookRetention?: ResolvedWebhookRetentionConfig | null,
    /**
     * Resolved audit-trail retention windows, forwarded for the same reason and
     * needed here in particular: this is the seam a dispatcher-driven install
     * writes through, so a policy that does not reach it is a trail that
     * install never prunes. Absent means the trails are kept in full.
     */
    auditRetention?: ResolvedAuditRetentionConfig,
    /**
     * Resolved delivery-log retention, forwarded for the same reason and most
     * consequential here of the three.
     *
     * `email_deliveries` was previously swept only by the SEND path, on the
     * reasoning that sends are what make it grow. True while an install is
     * sending, and useless the moment it stops: the last rows written are the
     * newest, and nothing ever offers another pass to remove them. They then
     * sit indefinitely — recipient digests, under a setting that reads as a
     * bounded window. Content writes continue after the final send, which is
     * exactly the property the send path lacks.
     */
    emailRetention?: ResolvedEmailRetentionConfig
  ) {
    this.logger = logger;
    // i18n: this handler is constructible outside DI and takes the
    // localization config itself, so hand the service that config's own
    // answers rather than letting it consult a container this instance may
    // never have registered against.
    this.collectionService = new DynamicCollectionService(
      adapter,
      logger,
      this.localization?.defaultLocale,
      // Affirmative only. `NextlyServices` builds this handler lazily with no
      // localization argument even in apps that registered one, so passing an
      // explicit `false` here would tell that instance localization is
      // unconfigured when the container knows better; undefined lets DI answer.
      this.localization != null ? true : undefined
    );

    // Built here because this is where the resolved policy arrives, but handed
    // to the entry service, which is the seam every write path runs through.
    const retentionRunner = buildRetentionRunner({
      adapter: adapter,
      // Derived from the same list every other call site spreads, so a domain
      // that gains retention later reaches this seam without anyone
      // remembering to add it here.
      // `undefined` when NOTHING was supplied, which is not the same as an
      // empty object: `retentionPoliciesFrom({})` resolves the DEFAULT email
      // window, and `ServiceContainer.collections` constructs this handler with
      // no policy arguments at all. That path would then prune the delivery log
      // on a default nobody configured. `null` is preserved as it is — that is
      // an explicitly disabled webhook policy, not an absent one.
      ...retentionPoliciesFrom(
        webhookRetention === undefined &&
          auditRetention === undefined &&
          emailRetention === undefined
          ? undefined
          : { webhookRetention, auditRetention, emailRetention }
      ),
      gate: new MetaRetentionGate(adapter),
      logger,
    });

    const hookRegistry = getHookRegistry();

    const appRoot = consumerAppRoot || process.cwd();
    this.fileManager = new CollectionFileManager(db, {
      schemasDir: path.join(appRoot, "src/db/schemas/dynamic"),
      migrationsDir: path.join(appRoot, "src/db/migrations/dynamic"),
    });

    // Set up the adapter and metadata fetcher for runtime schema generation
    // This allows UI-created collections to work without pre-compiled TypeScript schemas
    this.fileManager.setAdapter(adapter);
    this.fileManager.setMetadataFetcher(
      async (collectionName: string, executor?: unknown) => {
        try {
          // Runs on the caller's transaction connection when supplied so an
          // uncached runtime-schema load inside a transaction stays on it.
          const result = await adapter.selectOne<{
            fields: string;
            tableName: string;
            status: boolean | number | null;
            localized: boolean | number | null;
          }>(
            "dynamic_collections",
            {
              where: {
                and: [{ column: "slug", op: "=", value: collectionName }],
              },
            },
            executor
          );

          if (result) {
            const fields =
              typeof result.fields === "string"
                ? JSON.parse(result.fields)
                : result.fields;
            return {
              fields,
              tableName: result.tableName,
              // SQLite returns 0/1 for booleans; PG/MySQL return real booleans.
              status: result.status === true || result.status === 1,
              // i18n M4: forward the localized flag so loadCompanionSchema builds the companion.
              localized: result.localized === true || result.localized === 1,
            };
          }
        } catch (error) {
          console.error(
            "[CollectionsHandler] Failed to fetch collection metadata:",
            error
          );
        }
        return null;
      }
    );

    this.relationshipService = new CollectionRelationshipService(
      adapter,
      logger,
      this.fileManager,
      this.collectionService,
      releaseVisibilityFor(adapter)
    );

    this.metadataService = new CollectionMetadataService(
      adapter,
      logger,
      this.fileManager,
      this.collectionService
    );

    const accessControlService = new AccessControlService();

    const fieldGroupDataService = container.has("fieldGroupDataService")
      ? container.get<FieldGroupDataService>("fieldGroupDataService")
      : undefined;

    // Shared post-response drain fast path (registered by the webhook services),
    // handed to the entry service — the seam every write path runs through.
    const fastDrainScheduler = container.has("webhookFastDrainScheduler")
      ? container.get<WebhookFastDrainScheduler>("webhookFastDrainScheduler")
      : undefined;

    // Resolved lazily at flush time (not captured here) so a Next cache adapter
    // registered after this handler was constructed at boot is still honored.
    const resolveCacheRevalidator = () =>
      container.has("cacheRevalidator")
        ? container.get<CacheRevalidator>("cacheRevalidator")
        : undefined;

    // Late-inject relationshipService if fieldGroupDataService was created before it was available
    if (fieldGroupDataService) {
      fieldGroupDataService.setRelationshipService(this.relationshipService);
    }

    // The RBAC service the write gates evaluate `update`/`publish`/`unpublish`
    // against. Without it `checkCollectionAccess` has no permission store, so a
    // missing stored rule defaults to public — which for the publish gate means
    // an authenticated caller who cleared the route's `update` check could
    // publish without `publish-<slug>`. Resolved from the container (guarded so
    // a minimal boot without RBAC still constructs).
    const rbacAccessControlService = container.has("rbacAccessControlService")
      ? container.get<RBACAccessControlService>("rbacAccessControlService")
      : undefined;

    this.entryService = new CollectionEntryService(
      adapter,
      logger,
      this.fileManager,
      this.collectionService,
      this.relationshipService,
      hookRegistry,
      accessControlService,
      fieldGroupDataService,
      rbacAccessControlService,
      this.localization,
      retentionRunner,
      fastDrainScheduler,
      resolveCacheRevalidator
    );
  }

  /**
   * Ensure params have a `user` object for hook contexts.
   *
   * The API dispatcher passes `userId` (from the authenticated session) but
   * the entry service expects `user: { id }`. This bridges the gap so that
   * activity-log hooks receive a valid user and are not silently skipped.
   *
   * `routeAuthorized: true` marks that the route middleware
   * (`requireCollectionAccess`) already performed the coarse RBAC / code-access
   * gate, so the entry service skips re-running only THAT check. It is NOT a
   * trusted-server context: `overrideAccess` stays `false` so the stored
   * collection access rules (owner-only / role-based / authenticated / custom)
   * and field-level write access are still enforced with the real user — the
   * route pre-check authorizes the operation, not access to every record or
   * field. Trusted-server bypass is a separate, explicit `overrideAccess: true`
   * (seeds, plugin `as:'system'`), never inferred from route auth.
   */
  /**
   * Whether this user may update the entry, without performing the update.
   *
   * Routed through the handler for the same reason the version read gate is:
   * this is the instance that actually serves collection writes, so a decision
   * taken here is the decision the write would take.
   */
  async canUpdateEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    routeAuthorized?: boolean;
    /** API-key scope; judges the update gate on the key's own grant. */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<boolean> {
    return this.entryService.canUpdateEntry(params);
  }

  private resolveUserParam<
    T extends {
      userId?: string;
      userName?: string;
      userEmail?: string;
      userRoles?: string[];
      user?: UserContext;
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows, and never admits a target's drafts.
       */
      trusted?: TrustBound;
      routeAuthorized?: boolean;
    },
  >(params: T): Omit<T, "userName" | "userEmail" | "userRoles"> {
    const { userName, userEmail, userRoles, ...rest } = params;
    if (!rest.user && rest.userId) {
      return {
        ...rest,
        user: {
          id: rest.userId,
          name: userName,
          email: userEmail,
          // Carry the authenticated role set so role-based access rules and
          // field-level access.read evaluate against the real user.
          roles: userRoles,
          // Also expose a singular `role` so field-level access callbacks that
          // read the documented `req.user.role` (rather than the role set) see
          // an authorized value instead of stripping fields for a legitimate
          // caller. A representative slug; role-set-aware rules use `roles`.
          role: userRoles?.[0],
        },
        // Default the bridged route caller to enforced access, but never
        // clobber an explicit trusted-server override (overrideAccess: true)
        // if one was passed alongside the userId.
        overrideAccess: rest.overrideAccess ?? false,
        // Route authorization is NEVER inferred from a userId being present:
        // the RBAC/database-permission gate may only be skipped when the caller
        // explicitly attests the route middleware already ran it (the REST
        // dispatcher passes `routeAuthorized: true`). Any other caller that
        // merely attributes a userId for hooks/audit gets `false`, so the gate
        // still runs and a rule-less collection is not mutated without the
        // permission check. A trusted override forces it false regardless, so
        // it never defeats the response redaction guard
        // (`overrideAccess && !routeAuthorized`).
        routeAuthorized:
          !(rest.overrideAccess ?? false) && !!rest.routeAuthorized,
      };
    }
    return rest;
  }

  /**
   * Wire the PermissionSeedService into the internal CollectionMetadataService.
   * Must be called after construction so that collection creation auto-seeds
   * CRUD permissions for newly created collections.
   */
  setPermissionSeedService(service: PermissionSeedService): void {
    this.metadataService.setPermissionSeedService(service);
  }

  // Push a freshly-generated Drizzle table object into the FileManager's
  // schema cache for `slug`. Both caches (FileManager for SELECT/query
  // builders, SchemaRegistry for adapter CRUD) must be updated together
  // after an admin schema apply; this method handles the FileManager side.
  // The caller (collection-dispatcher.ts) handles SchemaRegistry directly.
  refreshCollectionSchema(tableName: string, freshTable: unknown): void {
    this.fileManager.refreshSchema(tableName, freshTable);
  }

  /**
   * Register dynamic schemas with the file manager.
   * @param schemas - Map of schema names to schema objects
   */
  registerDynamicSchemas(schemas: Record<string, unknown>): void {
    this.metadataService.registerDynamicSchemas(schemas);
  }

  /**
   * Create a new collection.
   * @param data - Collection creation data
   */
  async createCollection(data: {
    name: string;
    label: string;
    description?: string;
    icon?: string;
    group?: string;
    order?: number;
    sidebarGroup?: string;
    /** Whether the collection has Draft/Published enabled. */
    status?: boolean;
    /** i18n: whether the collection is localized (translatable fields + companion table). */
    localized?: boolean;
    /** Whether writes bust cache tags. Default on; false opts the collection out. */
    revalidate?: boolean;
    /**
     * Whether writes are recorded to the webhook outbox. Default on; false
     * keeps this collection's content out of the outbox and every delivery.
     */
    webhooks?: boolean;
    fields: FieldDefinition[];
    createdBy?: string;
  }) {
    return this.metadataService.createCollection(data);
  }

  /**
   * List collections with pagination, search, and sorting.
   * @param options - Pagination, search, and sort options
   */
  async listCollections(options?: {
    page?: number;
    limit?: number;
    search?: string;
    // "name" is the admin/API alias for "slug" — both sort on the slug column.
    sortBy?: "name" | "slug" | "createdAt" | "updatedAt";
    sortOrder?: "asc" | "desc";
    includeSchema?: boolean;
    /**
     * Restrict results to these slugs. Carried through to the registry's WHERE
     * clause, so the `total` and `totalPages` this returns count only rows the
     * caller may see.
     */
    slugAllowlist?: string[];
  }) {
    return this.metadataService.listCollections(options);
  }

  /**
   * Get a single collection by name.
   * Enriches component fields with inline schemas for Admin UI rendering.
   * @param params - Parameters containing collection name
   */
  async getCollection(params: { collectionName: string }) {
    const result = await this.metadataService.getCollection(params);

    // Enrich component fields with inline schemas for Admin UI so that
    // form rendering works without extra API calls per component.
    const data = result.data as Record<string, unknown> | null;
    if (result.success && data?.fields) {
      // The ORIGINAL fields, captured before enrichment replaces them: the
      // working-draft eligibility below needs the un-enriched shape (the enriched
      // one drops the component localized/resolved markers it inspects).
      const originalFields = data.fields as unknown as FieldConfig[];
      try {
        const hasComponentRegistry = container.has("fieldGroupRegistryService");
        if (hasComponentRegistry) {
          const componentRegistry = container.get<FieldGroupRegistryService>(
            "fieldGroupRegistryService"
          );

          const enrichedFields =
            await componentRegistry.enrichFieldsWithComponentSchemas(
              data.fields as unknown as Record<string, unknown>[]
            );

          data.fields = enrichedFields;
          if (data.schemaDefinition) {
            (data.schemaDefinition as Record<string, unknown>).fields =
              enrichedFields;
          }
        }
      } catch (enrichError) {
        console.error(
          "[CollectionsHandler.getCollection] Failed to enrich component fields:",
          enrichError instanceof Error
            ? enrichError.message
            : String(enrichError)
        );
      }

      // Surface whether the draft/published working-draft split will run for this
      // collection so the admin editor offers the matching Save / Publish /
      // Discard affordances. This is the dispatcher path the built-in admin
      // actually fetches through, and it derives the flag from the SAME predicate
      // the mutation service gates on, so the editor can never present a
      // status-less save as a pending draft while the server writes the live row.
      //
      // A failure to resolve component eligibility is propagated, not defaulted
      // to false: the only path that throws is a drafts-configured collection
      // whose components could not be resolved (a transient registry/database
      // error), and false is the DESTRUCTIVE answer there — the admin would send
      // an explicit published save that overwrites the live row instead of the
      // status-less save that stores a working draft. Failing the read keeps the
      // editor from acting on an unknown verdict; it is retryable, and mirrors
      // resolveComponentSchemas, which is fail-closed for the same reason.
      const draftSplit = await schemaDraftSplit({
        status: data.status as boolean | undefined,
        versions: data.versions as
          | { drafts?: { enabled?: boolean } }
          | null
          | undefined,
        fields: originalFields,
        slug: data.slug as string | undefined,
      });
      Object.assign(data, draftSplitResponseFields(draftSplit));
    }

    return result;
  }

  /**
   * Update a collection's metadata and/or schema.
   * @param params - Parameters containing collection name
   * @param body - Update data
   */
  async updateCollection(
    params: { collectionName: string },
    body: {
      label?: string;
      description?: string;
      icon?: string;
      group?: string;
      order?: number;
      sidebarGroup?: string;
      useAsTitle?: string;
      hidden?: boolean;
      /** Toggle cache revalidation. Honoured when defined; undefined leaves it unchanged. */
      revalidate?: boolean;
      /** Toggle webhook recording. Honoured when defined; undefined leaves it unchanged. */
      webhooks?: boolean;
      fields?: FieldDefinition[];
    }
  ) {
    return this.metadataService.updateCollection(params, body);
  }

  /**
   * Delete a collection.
   * @param params - Parameters containing collection name
   */
  async deleteCollection(params: { collectionName: string }) {
    return this.metadataService.deleteCollection(params);
  }

  /**
   * List entries in a collection with pagination.
   * @param params - Collection name, pagination options, and query filters
   */
  async listEntries(params: {
    collectionName: string;
    /** Page number (1-indexed, default: 1) */
    page?: number;
    /** Number of documents per page (default: 10, max: 500) */
    limit?: number;
    /** Search query to filter entries by searchable fields */
    search?: string;
    /** Depth for relationship population */
    depth?: number;
    /** Select specific fields to include */
    select?: Record<string, boolean>;
    /** Where clause for filtering */
    where?: WhereFilter;
    /**
     * Output format for rich text fields.
     * - "json" (default): Return Lexical JSON structure only
     * - "html": Return HTML string only
     * - "both": Return object with both { json, html } properties
     */
    richTextFormat?: RichTextOutputFormat;
    /**
     * Sort order for results.
     * Prefix with `-` for descending.
     * @example '-createdAt' for descending, 'title' for ascending
     */
    sort?: string;
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * This `where` was built by the framework from a route, not received from
     * a request. Forwarded to the filterable-fields guard; per-operation only,
     * so a nested call cannot inherit it.
     */
    frameworkFilter?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * The route already ran the coarse RBAC gate, so skip only that redundant
     * re-check while the stored read rules (owner-only scoping, role-based,
     * custom) still run. The query service folds an owner-only rule into the SQL
     * predicate rather than filtering rows afterwards, so pagination and totals
     * stay correct.
     */
    routeAuthorized?: boolean;
    /**
     * The caller's authenticated scope. A scoped API key is judged on its own
     * read grant rather than on the permissions of the user that owns it, so a
     * super-admin-owned key stays bound by a stored owner-only read rule.
     */
    authenticatedScope?: AuthenticatedScope;
    /**
     * Draft/Published filter override (only effective when collection.status
     * === true). Public callers default to 'published'; trusted callers can
     * pass 'all' to see drafts too. Forwarded to query service as-is.
     */
    status?: "published" | "draft" | "all";
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    /** i18n M7: attach a per-locale `_translations` overview map to each row. */
    translationStatus?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }) {
    return this.entryService.listEntries(params);
  }

  /**
   * Create a new entry in a collection.
   * @param params - Collection name, optional user ID, and optional depth for relationship population
   * @param body - Entry data
   */
  async createEntry(
    params: {
      collectionName: string;
      userId?: string;
      userName?: string;
      userEmail?: string;
      /** Authenticated role set, forwarded to role-based access rules. */
      userRoles?: string[];
      /** Depth for relationship population in response (0-5) */
      depth?: number;
      /** User context for access control */
      user?: UserContext;
      /** Who performed the write, recorded on the outbox event. */
      actor?: RequestActor;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows, and never admits a target's drafts.
       */
      trusted?: TrustBound;
      /** Write locale (i18n M5) — translatable values stored for this language. */
      locale?: string;
      /**
       * Set by the REST dispatcher to attest the route middleware already ran
       * the RBAC/code-access gate, so the entry service skips only that
       * redundant re-check. Never inferred from a userId.
       */
      routeAuthorized?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
      /**
       * The caller's authenticated scope. For a scoped API-key REST create the
       * publish transition gate (create-as-published) judges the key's OWN grants.
       */
      authenticatedScope?: AuthenticatedScope;
      /** Skip cache revalidation for this write (the outbox drain still runs). */
      disableRevalidate?: boolean;
    },
    body: Record<string, unknown>
  ) {
    return this.entryService.createEntry(
      {
        ...this.resolveUserParam(params),
        locale: params.locale,
        actor: params.actor,
        // Named explicitly (like updateEntry) so the API-key scope survives the
        // field-by-field rebuild rather than only via resolveUserParam's rest.
        authenticatedScope: params.authenticatedScope,
        disableRevalidate: params.disableRevalidate,
      },
      body,
      params.depth
    );
  }

  /**
   * Get a single entry by ID.
   * @param params - Collection name, entry ID, and optional user ID
   */
  async getEntry(params: {
    collectionName: string;
    entryId: string;
    userId?: string;
    /** Depth for relationship population (0-5) */
    depth?: number;
    /** Select specific fields to include */
    select?: Record<string, boolean>;
    /**
     * Output format for rich text fields.
     * - "json" (default): Return Lexical JSON structure only
     * - "html": Return HTML string only
     * - "both": Return object with both { json, html } properties
     */
    richTextFormat?: RichTextOutputFormat;
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * Draft/Published filter override (only effective when collection.status
     * === true). Public callers default to 'published'; trusted callers can
     * pass 'all' to see drafts too. Forwarded to query service as-is.
     */
    status?: "published" | "draft" | "all";
    /**
     * Opt in to the working-draft overlay (draft/published split): a trusted
     * editor read returns the pending working draft in place of the live row.
     * Forwarded wholesale to the entry/query service, which gates it on an
     * update-capability probe, so a read-only caller passing it still sees the
     * live row.
     */
    includeWorkingDraft?: boolean;
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    /** i18n M7: attach a per-locale `_translations` overview map to the entry. */
    translationStatus?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /**
     * Set by a route that already authenticated and authorized the caller.
     * Skips the redundant RBAC re-check (which resolves the caller's stored
     * roles and would reject a scoped API key) while leaving owner-only and
     * other document-level rules in force.
     */
    routeAuthorized?: boolean;
    /**
     * The caller's authenticated scope. A scoped API key is judged on its OWN
     * read grant, so a super-admin-owned key does not skip the collection's
     * stored owner-only/custom read rule.
     */
    authenticatedScope?: AuthenticatedScope;
  }) {
    return this.entryService.getEntry(params);
  }

  /**
   * Remove a document's pending working-draft sidecar under the same parent-row
   * lock a draft save takes. Serializing the discard with concurrent draft saves
   * keeps it from deleting a draft another editor committed after this request's
   * authorization checks. The discard handler authorizes read and update first.
   */
  async discardWorkingDraft(
    params: Parameters<CollectionEntryService["discardWorkingDraft"]>[0]
  ): Promise<void> {
    return this.entryService.discardWorkingDraft(params);
  }

  /**
   * Count entries in a collection.
   * @param params - Collection name and optional filters
   */
  async countEntries(params: {
    collectionName: string;
    /** Search query to filter entries by searchable fields */
    search?: string;
    /** Where clause for filtering */
    where?: WhereFilter;
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * This `where` was built by the framework from a route, not received from
     * a request. Forwarded to the filterable-fields guard; per-operation only,
     * so a nested call cannot inherit it.
     */
    frameworkFilter?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * The route already ran the coarse RBAC gate, so skip only that redundant
     * re-check while the stored read rules (owner-only scoping, role-based,
     * custom) still run. Forwarded to the query service, which counts under the
     * same constraint listEntries filters by, so a total can never describe rows
     * the caller may not read.
     */
    routeAuthorized?: boolean;
    /**
     * The caller's authenticated scope, mirroring listEntries so a scoped key's
     * count matches the rows it can list.
     */
    authenticatedScope?: AuthenticatedScope;
    /**
     * Draft/Published filter override (only effective when collection.status
     * === true). Same semantics as listEntries.
     */
    status?: "published" | "draft" | "all";
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }) {
    return this.entryService.countEntries(params);
  }

  /**
   * Update an existing entry.
   * @param params - Collection name, entry ID, optional user ID, and optional depth for relationship population
   * @param body - Update data
   */
  async updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      userId?: string;
      userName?: string;
      userEmail?: string;
      /** Authenticated role set, forwarded to role-based access rules. */
      userRoles?: string[];
      /** Depth for relationship population in response (0-5) */
      depth?: number;
      /** User context for access control */
      user?: UserContext;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows, and never admits a target's drafts.
       */
      trusted?: TrustBound;
      /** Who performed the write, recorded on the outbox event. */
      actor?: RequestActor;
      /** Write locale (i18n M5) — translatable values updated for this language. */
      locale?: string;
      /**
       * Set by the REST dispatcher to attest the route middleware already ran
       * the RBAC/code-access gate, so the entry service skips only that
       * redundant re-check. Never inferred from a userId.
       */
      routeAuthorized?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
      /**
       * Set when this write restores an earlier version, recorded on the
       * version it captures.
       */
      sourceVersionNo?: number;
      /**
       * The caller's authenticated scope. For a scoped API-key REST write, the
       * publish/unpublish transition gate judges the key's OWN grants.
       */
      authenticatedScope?: AuthenticatedScope;
      /** Skip cache revalidation for this write (the outbox drain still runs). */
      disableRevalidate?: boolean;
    },
    body: Record<string, unknown>
  ) {
    return this.entryService.updateEntry(
      {
        ...this.resolveUserParam(params),
        locale: params.locale,
        actor: params.actor,
        disableRevalidate: params.disableRevalidate,
        // Named explicitly rather than left to the spread above, because this
        // facade rebuilds the params object field by field: anything not named
        // here survives only by passing through `resolveUserParam`'s rest, and
        // a silently dropped lineage marker would leave a restore
        // indistinguishable from an ordinary edit.
        sourceVersionNo: params.sourceVersionNo,
        // The API-key scope gates the publish transition; naming it explicitly
        // (like sourceVersionNo) keeps it from being silently dropped.
        authenticatedScope: params.authenticatedScope,
      },
      body,
      params.depth
    );
  }

  /**
   * i18n M7: publish every language of an entry at once (spec §10). Sets the main status and,
   * for localized+draft collections, every companion `_status` to published, atomically.
   */
  async publishAllLocales(params: {
    collectionName: string;
    entryId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran the
     * RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId.
     */
    routeAuthorized?: boolean;
    /** API-key scope; gates the unconditional publish check. */
    authenticatedScope?: AuthenticatedScope;
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
  }) {
    return this.entryService.publishAllLocales(this.resolveUserParam(params));
  }

  /**
   * Take every language of an entry down at once.
   *
   * Sets the main status and, for localized+draft collections, every companion
   * `_status` to draft, atomically — and refuses rather than half-performing
   * when the companion physically lacks the status column. See
   * `unpublishAllLocales` on the mutation service for why a takedown asks that
   * question when a publish does not.
   */
  async unpublishAllLocales(params: {
    collectionName: string;
    entryId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran the
     * RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId.
     */
    routeAuthorized?: boolean;
    /** API-key scope; gates the unconditional unpublish check. */
    authenticatedScope?: AuthenticatedScope;
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
  }) {
    return this.entryService.unpublishAllLocales(this.resolveUserParam(params));
  }

  /**
   * Delete an entry.
   * @param params - Collection name, entry ID, and optional user ID
   */
  async deleteEntry(params: {
    collectionName: string;
    entryId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    /** User context for access control */
    user?: UserContext;
    /** Who performed the delete, recorded on the outbox event. */
    actor?: RequestActor;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran
     * the RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId — a caller attributing a user for
     * hooks/audit must still pass the permission gate.
     */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /**
     * The caller's authenticated scope. A scoped API key is judged on its OWN
     * delete grant, so the session super-admin bypass does not apply to it.
     */
    authenticatedScope?: AuthenticatedScope;
    /** Skip cache revalidation for this delete (the outbox drain still runs). */
    disableRevalidate?: boolean;
  }) {
    return this.entryService.deleteEntry({
      ...this.resolveUserParam(params),
      // Named explicitly so the API-key scope survives the field-by-field
      // rebuild rather than only via resolveUserParam's rest.
      authenticatedScope: params.authenticatedScope,
      disableRevalidate: params.disableRevalidate,
    });
  }

  /**
   * Bulk delete multiple entries by IDs.
   * Uses partial success pattern - some entries may fail while others succeed.
   * @param params - Collection name and array of entry IDs to delete
   * @returns Bulk operation result with success/failed arrays and counts
   */
  async bulkDeleteEntries(params: {
    collectionName: string;
    ids: string[];
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    /** User context for access control */
    user?: UserContext;
    /** Who performed the delete, recorded on each entry's outbox event. */
    actor?: RequestActor;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran
     * the RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId — a caller attributing a user for
     * hooks/audit must still pass the permission gate.
     */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /**
     * The caller's authenticated scope. Each per-id delete is judged on a scoped
     * API key's OWN delete grant, not the key owner's.
     */
    authenticatedScope?: AuthenticatedScope;
    /** Skip cache revalidation for this bulk delete (the outbox drain still runs). */
    disableRevalidate?: boolean;
  }) {
    return this.entryService.bulkDeleteEntries({
      ...this.resolveUserParam(params),
      // Named explicitly so the API-key scope survives the field-by-field
      // rebuild rather than only via resolveUserParam's rest.
      authenticatedScope: params.authenticatedScope,
      disableRevalidate: params.disableRevalidate,
    });
  }

  /**
   * Bulk update multiple entries with the same data.
   * Uses partial success pattern - some entries may fail while others succeed.
   * @param params - Collection name, array of entry IDs, and update data
   * @returns Bulk operation result with success/failed arrays and counts
   */
  async bulkUpdateEntries(params: {
    collectionName: string;
    ids: string[];
    data: Record<string, unknown>;
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran
     * the RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId — a caller attributing a user for
     * hooks/audit must still pass the permission gate.
     */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
    /**
     * The caller's authenticated scope. For a scoped API-key bulk update each
     * per-id publish/unpublish transition is judged on the key's OWN grants.
     */
    authenticatedScope?: AuthenticatedScope;
    /** Skip cache revalidation for this bulk update (the outbox drain still runs). */
    disableRevalidate?: boolean;
  }) {
    return this.entryService.bulkUpdateEntries({
      ...this.resolveUserParam(params),
      // Named explicitly (like updateEntry) so the API-key scope survives the
      // field-by-field rebuild rather than only via resolveUserParam's rest.
      authenticatedScope: params.authenticatedScope,
      disableRevalidate: params.disableRevalidate,
    });
  }

  /**
   * Bulk update entries matching a where clause.
   * Uses partial success pattern - some entries may fail while others succeed.
   * @param params - Collection name, where clause, and update data
   * @param options - Optional limit for safety (default: 1000)
   * @returns Bulk operation result with success/failed arrays and counts
   */
  async bulkUpdateByQuery(
    params: {
      collectionName: string;
      where: WhereFilter;
      data: Record<string, unknown>;
      userId?: string;
      userName?: string;
      userEmail?: string;
      /** Authenticated role set, forwarded to role-based access rules. */
      userRoles?: string[];
      /** User context for access control */
      user?: UserContext;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows, and never admits a target's drafts.
       */
      trusted?: TrustBound;
      /** Route auth already ran; response is still redacted for this user */
      routeAuthorized?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
      /** Acting identity from the transport, forwarded to the recorded event. */
      actor?: RequestActor;
      /**
       * The caller's authenticated scope. Judges the collection-level gate and
       * each per-row transition on a scoped API key's OWN grants.
       */
      authenticatedScope?: AuthenticatedScope;
      /** Skip cache revalidation for this bulk update (the outbox drain still runs). */
      disableRevalidate?: boolean;
    },
    options?: { limit?: number }
  ) {
    // Resolve userId -> user and mark route-authorized, mirroring
    // bulkUpdateEntries so the query-based bulk update honors access control
    // and redaction instead of running as an anonymous caller.
    return this.entryService.bulkUpdateByQuery(
      {
        ...this.resolveUserParam(params),
        // Named explicitly so the API-key scope survives the field-by-field
        // rebuild rather than only via resolveUserParam's rest.
        authenticatedScope: params.authenticatedScope,
        disableRevalidate: params.disableRevalidate,
      },
      options
    );
  }

  /**
   * Bulk delete entries matching a where clause.
   * Uses partial success pattern - some entries may fail while others succeed.
   * @param params - Collection name, where clause, and optional access control options
   * @param options - Optional limit for safety (default: 1000)
   * @returns Bulk operation result with success/failed arrays and counts
   */
  async bulkDeleteByQuery(
    params: {
      collectionName: string;
      where: WhereFilter;
      /** User context for access control */
      user?: UserContext;
      /** Who performed the delete, recorded on each entry's outbox event. */
      actor?: RequestActor;
      /**
       * The caller's authenticated scope. A scoped API key is judged on its own
       * delete grant for the owner-predicate enumeration and each per-row delete.
       */
      authenticatedScope?: AuthenticatedScope;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows, and never admits a target's drafts.
       */
      trusted?: TrustBound;
      /**
       * Set by the REST dispatcher to attest the route middleware already ran
       * the RBAC/code-access gate, so the entry service skips only that
       * redundant re-check. Never inferred from a userId.
       */
      routeAuthorized?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
      /** Skip cache revalidation for this bulk delete (the outbox drain still runs). */
      disableRevalidate?: boolean;
    },
    options?: { limit?: number }
  ) {
    return this.entryService.bulkDeleteByQuery(params, options);
  }

  /**
   * Duplicate an existing entry.
   * Creates a new entry with the same field values as the source entry.
   * System fields (id, createdAt, updatedAt) are regenerated.
   * Title/name fields get " (Copy)" appended.
   * @param params - Collection name, entry ID to duplicate, and optional overrides
   * @returns The newly created duplicate entry
   */
  async duplicateEntry(params: {
    collectionName: string;
    entryId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    /** Optional field overrides to apply to the duplicated entry */
    overrides?: Record<string, unknown>;
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran
     * the RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId — a caller attributing a user for
     * hooks/audit must still pass the permission gate.
     */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
    /**
     * The caller's authenticated scope. A duplicate is a create, so a scoped
     * API key copying a published source is judged on the key's OWN grant.
     */
    authenticatedScope?: AuthenticatedScope;
    /** Skip cache revalidation for this duplicate (the outbox drain still runs). */
    disableRevalidate?: boolean;
  }) {
    return this.entryService.duplicateEntry({
      ...this.resolveUserParam(params),
      // Named explicitly so the API-key scope survives the field-by-field
      // rebuild rather than only via resolveUserParam's rest.
      authenticatedScope: params.authenticatedScope,
      disableRevalidate: params.disableRevalidate,
    });
  }

  /**
   * Get the underlying CollectionMetadataService for direct access.
   * Useful for advanced use cases requiring fine-grained control.
   */
  getMetadataService(): CollectionMetadataService {
    return this.metadataService;
  }

  /**
   * Get the underlying CollectionEntryService for direct access.
   * Useful for advanced use cases requiring fine-grained control.
   */
  getEntryService(): CollectionEntryService {
    return this.entryService;
  }

  /**
   * Get the underlying CollectionRelationshipService for direct access.
   * Useful for advanced use cases requiring fine-grained control.
   */
  getRelationshipService(): CollectionRelationshipService {
    return this.relationshipService;
  }
}
