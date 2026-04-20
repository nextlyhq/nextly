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
 * Extracted from the monolithic SingleEntryService as part of Plan 23
 * Phase 8. The mutation-path logic lives in SingleMutationService.
 *
 * @module domains/singles/services/single-query-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import type { FieldConfig } from "../../../collections/fields/types";
import { container } from "../../../di/container";
import type { Nextly as NextlyDirectAPI } from "../../../direct-api/nextly";
import {
  buildContext,
  type BuildContextOptions,
} from "../../../hooks/context-builder";
import type { HookRegistry } from "../../../hooks/hook-registry";
import type { HookContext } from "../../../hooks/types";
import { keysToCamelCase, keysToSnakeCase } from "../../../lib/case-conversion";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import type { RBACAccessControlService } from "../../../services/auth/rbac-access-control-service";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { ComponentDataService } from "../../../services/components/component-data-service";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";
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
 * Check RBAC access for a Single operation.
 *
 * Evaluation order:
 * 1. `overrideAccess` bypass → null (allow)
 * 2. No RBAC service or no user → null (skip)
 * 3. RBAC check (super-admin → code-defined → DB permissions)
 * 4. Fail-secure on unexpected errors
 *
 * @returns `null` if access is allowed, `SingleResult` if denied
 */
export async function checkSingleAccess(params: {
  slug: string;
  operation: "read" | "update";
  user?: UserContext;
  overrideAccess?: boolean;
  rbacAccessControlService?: RBACAccessControlService;
  logger: Logger;
}): Promise<SingleResult | null> {
  const {
    slug,
    operation,
    user,
    overrideAccess,
    rbacAccessControlService,
    logger,
  } = params;

  if (overrideAccess) {
    return null;
  }

  if (!rbacAccessControlService || !user) {
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
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly singleRegistryService: SingleRegistryService,
    private readonly hookRegistry: HookRegistry,
    private readonly componentDataService?: ComponentDataService,
    private readonly rbacAccessControlService?: RBACAccessControlService
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

      // 1.5. RBAC access check (after metadata, before hooks/DB operations)
      const accessDenied = await checkSingleAccess({
        slug,
        operation: "read",
        user: options.user,
        overrideAccess: options.overrideAccess,
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

      // 6. Auto-create if document doesn't exist
      if (!doc) {
        this.logger.info("Auto-creating Single document", { slug });
        doc = await this.createDefaultDocument(singleMeta);
      }

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
          fields: singleMeta.fields as FieldConfig[],
          depth: options.depth,
        })) as SingleDocument;
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
          doc = transformedData as SingleDocument;
        }
      }

      this.logger.debug("Single document retrieved", { slug, id: doc.id });

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

  // ============================================================
  // Helpers shared with SingleMutationService
  // ============================================================

  /**
   * Create a default document for a Single.
   *
   * Applies default values from field configurations. Always includes
   * the system columns (id, title, slug, created_at, updated_at) that
   * the schema generator adds to every Single table.
   */
  async createDefaultDocument(
    singleMeta: DynamicSingleRecord
  ): Promise<SingleDocument> {
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

    for (const field of singleMeta.fields) {
      if (!("name" in field) || !field.name) continue;

      if ("defaultValue" in field && field.defaultValue !== undefined) {
        if (shouldTreatAsJson(field as FieldConfig)) {
          defaults[field.name] =
            typeof field.defaultValue === "object"
              ? JSON.stringify(field.defaultValue)
              : field.defaultValue;
        } else {
          defaults[field.name] = field.defaultValue;
        }
      } else if ("required" in field && field.required) {
        defaults[field.name] = getDefaultValue(field as FieldConfig);
      }
    }

    const snakeCaseDefaults = keysToSnakeCase(defaults) as Record<
      string,
      unknown
    >;
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
