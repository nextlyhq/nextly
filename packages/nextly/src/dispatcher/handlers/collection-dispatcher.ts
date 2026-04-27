/**
 * Collection-service dispatch handlers.
 *
 * Routes 14 collection operations to the DI-registered
 * `CollectionsHandler` (with fallback to the container's legacy
 * collections service). `listCollections` filters the results by the
 * caller's effective read permissions so non-super-admin users only see
 * collections they can actually read.
 */

import { createApplyDesiredSchema } from "../../domains/schema/pipeline/apply.js";
import {
  noopClassifier,
  noopMigrationJournal,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../../domains/schema/pipeline/pushschema-pipeline-stubs.js";
import { PushSchemaPipeline } from "../../domains/schema/pipeline/pushschema-pipeline.js";
import type {
  DesiredCollection,
  DesiredSchema,
} from "../../domains/schema/pipeline/types.js";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor.js";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import type { ServiceContainer } from "../../services";
import type { WhereFilter } from "../../services/collections/query-operators";
import type { CollectionsHandler } from "../../services/collections-handler";
import {
  isSuperAdmin,
  listEffectivePermissions,
} from "../../services/lib/permissions";
import {
  getAdapterFromDI,
  getCollectionRegistryFromDI,
  getCollectionsHandlerFromDI,
  getSchemaChangeServiceFromDI,
} from "../helpers/di";
import {
  parseRichTextFormat,
  parseSelectParam,
  parseWhereParam,
  requireBody,
  requireParam,
  toNumber,
} from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

// MySQL needs the database name extracted from DATABASE_URL.
// PG and SQLite ignore it.
function extractDatabaseNameFromUrl(
  url: string | undefined
): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, "");
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

type CollectionsHandlerType = CollectionsHandler;

const COLLECTIONS_METHODS: Record<
  string,
  MethodHandler<CollectionsHandlerType>
> = {
  createCollection: {
    execute: (svc, _, body) =>
      svc.createCollection(requireBody(body, "Collection data is required")),
  },
  listCollections: {
    execute: async (svc, p) => {
      const result = await svc.listCollections({
        page: toNumber(p.page),
        pageSize: toNumber(p.pageSize),
        search: p.search,
        sortBy: p.sortBy as "slug" | "createdAt" | "updatedAt" | undefined,
        sortOrder: p.sortOrder as "asc" | "desc" | undefined,
      });

      const userId = p._authenticatedUserId
        ? String(p._authenticatedUserId)
        : undefined;
      if (!userId) return result;

      const superAdmin = await isSuperAdmin(userId);
      if (superAdmin) return result;

      const permissionPairs = await listEffectivePermissions(userId);
      const readableResources = new Set(
        permissionPairs
          .filter(pair => pair.endsWith(":read"))
          .map(pair => pair.split(":")[0])
      );

      type ListResult = {
        data?: unknown;
        meta?: Record<string, unknown>;
      } & Record<string, unknown>;

      const typedResult = result as unknown as ListResult;
      if (
        !typedResult ||
        typeof typedResult !== "object" ||
        !("data" in typedResult)
      ) {
        return result;
      }

      type CollectionItem = { slug?: string; name?: string };
      const data = Array.isArray(typedResult.data)
        ? (typedResult.data as CollectionItem[])
        : [];

      const filtered = data.filter(collection => {
        const slug = collection?.slug ?? collection?.name;
        return slug ? readableResources.has(String(slug)) : false;
      });

      const meta =
        typedResult.meta && typeof typedResult.meta === "object"
          ? { ...typedResult.meta }
          : undefined;

      if (meta) {
        meta.total = filtered.length;
        if (typeof meta.pageSize === "number" && meta.pageSize > 0) {
          meta.totalPages = Math.max(
            1,
            Math.ceil(filtered.length / meta.pageSize)
          );
        }
      }

      return {
        ...typedResult,
        data: filtered,
        ...(meta && { meta }),
      };
    },
  },
  getCollection: {
    execute: (svc, p) => {
      requireParam(p, "collectionName");
      return svc.getCollection({ collectionName: p.collectionName });
    },
  },
  updateCollection: {
    execute: (svc, p, body) => {
      if (!p.collectionName || !body)
        throw new Error("collectionName and update data are required");
      return svc.updateCollection({ collectionName: p.collectionName }, body);
    },
  },
  deleteCollection: {
    execute: (svc, p) => {
      requireParam(p, "collectionName");
      return svc.deleteCollection({ collectionName: p.collectionName });
    },
  },
  // Preview schema changes (dry-run diff with row-count impact)
  previewSchemaChanges: {
    execute: async (_svc, p, body) => {
      requireParam(p, "collectionName");
      const schemaChangeService = getSchemaChangeServiceFromDI();
      const registry = getCollectionRegistryFromDI();
      if (!schemaChangeService || !registry) {
        throw new Error("Schema change service not initialized");
      }
      const collection = await registry.getCollectionBySlug(p.collectionName);
      if (!collection) throw new Error("Collection not found");
      if (collection.locked) {
        throw new Error(
          "This collection is managed via code and cannot be modified in the UI"
        );
      }
      const { fields } = body as { fields: unknown[] };
      if (!fields) throw new Error("fields is required in request body");
      // collection comes from getCollectionBySlug typed as DynamicCollectionRecord,
      // which has tableName, fields: FieldConfig[], and schemaVersion: number.
      // FieldConfig is structurally compatible with FieldDefinition (the schema
      // service's input type), so we cast through unknown for the type system
      // even though the runtime values are interchangeable.
      const currentFields = (collection.fields ??
        []) as unknown as FieldDefinition[];
      const tableName = collection.tableName;
      const preview = await schemaChangeService.preview(
        tableName,
        currentFields,
        fields as FieldDefinition[]
      );
      return {
        ...preview,
        schemaVersion: collection.schemaVersion,
      };
    },
  },
  // Apply confirmed schema changes via the in-process schema service.
  //
  // F1 PR 3: single-process model. drizzle-kit/api is loaded lazily by the
  // schema service via drizzle-kit-lazy.ts (PR 1's webpackIgnore +
  // turbopackIgnore magic comments keep it out of the handler bundle), so
  // DDL runs cleanly in the same process serving requests. No more
  // wrapper-mode IPC routing. bumpSchemaVersion fires automatically on
  // success via SchemaChangeService.setOnApplySuccess (registered in
  // di/register.ts:355-356).
  applySchemaChanges: {
    execute: async (_svc, p, body) => {
      requireParam(p, "collectionName");
      const schemaChangeService = getSchemaChangeServiceFromDI();
      const registry = getCollectionRegistryFromDI();
      if (!schemaChangeService || !registry) {
        throw new Error("Schema change service not initialized");
      }
      const collection = await registry.getCollectionBySlug(p.collectionName);
      if (!collection) throw new Error("Collection not found");
      if (collection.locked) {
        throw new Error(
          "This collection is managed via code and cannot be modified in the UI"
        );
      }
      const { fields, confirmed, schemaVersion, resolutions } = body as {
        fields: unknown[];
        confirmed: boolean;
        schemaVersion?: number;
        resolutions?: Record<string, FieldResolution>;
      };
      if (!confirmed) {
        throw new Error("Schema changes must be confirmed");
      }
      if (!fields) throw new Error("fields is required in request body");

      const currentVersion = collection.schemaVersion;
      const tableName = collection.tableName;

      // F3: route through the PushSchemaPipeline via the F2 contract.
      // Critical: must build the FULL DesiredSchema snapshot (all
      // managed collections, not just the one being saved). pushSchema
      // sees any managed table in the live DB but missing from the
      // desired snapshot as "to be dropped" — without sibling
      // collections in the snapshot, drizzle-kit would emit DROP TABLE
      // for them. The post-pushSchema filter strips DROPs for
      // non-managed tables, but managed siblings need to be present
      // explicitly so they aren't even considered for drop.
      const desired: DesiredSchema = {
        collections: {},
        singles: {},
        components: {},
      };

      // Add all OTHER managed collections from the registry first.
      const allCollections =
        typeof registry.getAllCollections === "function"
          ? await registry.getAllCollections()
          : [];
      for (const c of allCollections) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry returns Record<string, unknown>
        const ca = c as any;
        if (!ca.slug || ca.slug === p.collectionName) continue;
        desired.collections[ca.slug] = {
          slug: ca.slug,
          tableName: ca.tableName ?? `dc_${ca.slug}`,
          fields: ca.fields ?? [],
        };
      }

      // Splice in the user's changes for THIS collection (overwrites
      // any registry entry for the same slug).
      desired.collections[p.collectionName] = {
        slug: p.collectionName,
        tableName,
        fields: fields as DesiredCollection["fields"],
      };

      // Resolve adapter for the F3 pipeline construction.
      const adapter = getAdapterFromDI();
      if (!adapter) {
        throw new Error("Database adapter not initialized");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter API not strictly typed
      const dialect = (adapter as any).getDialect() as
        | "postgresql"
        | "mysql"
        | "sqlite";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter Drizzle accessor
      const db = (adapter as any).getDrizzle();
      const databaseName =
        dialect === "mysql"
          ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
          : undefined;

      // Per-call factory (not the DI-bound applyDesiredSchema in
      // pipeline/index.ts) so we can thread MySQL databaseName + the
      // resolved adapter into the F3 PushSchemaPipeline at this site.
      // Today this also drops the `resolutions` forwarding — F8's
      // PromptDispatcher reintroduces resolution handling. For now
      // safe deltas pass through, destructive deltas would need to
      // be confirmed via the (existing) admin SchemaChangeDialog
      // resolutions UI which still works because the existing code
      // path didn't re-wire prompts (F8 wires them properly).
      // Note: see plans/specs/F3-pushschema-pipeline-design.md §11.
      const apply = createApplyDesiredSchema({
        applyPipeline: (desiredArg, sourceArg, channelArg) => {
          const pipeline = new PushSchemaPipeline({
            executor: new DrizzleStatementExecutor(dialect, db),
            renameDetector: noopRenameDetector,
            classifier: noopClassifier,
            promptDispatcher: noopPromptDispatcher,
            preRenameExecutor: noopPreRenameExecutor,
            migrationJournal: noopMigrationJournal,
          });
          return pipeline.apply({
            desired: desiredArg,
            db,
            dialect,
            source: sourceArg,
            promptChannel: channelArg,
            databaseName,
          });
        },
        // Optimistic-lock: only the slug being saved has a known
        // currentVersion (we pre-fetched it above). For sibling
        // collections in the snapshot, return null = no version check
        // needed (caller didn't pass schemaVersions for them either).
        readSchemaVersionForSlug: (slug: string) =>
          Promise.resolve(slug === p.collectionName ? currentVersion : null),
        // Read post-apply versions for the saved slug from the registry.
        // F8 will provide a richer signal via the migration journal.
        readNewSchemaVersionsForSlugs: async (slugs: string[]) => {
          const out: Record<string, number> = {};
          for (const slug of slugs) {
            const r = await registry.getCollectionBySlug(slug);
            const v = r?.schemaVersion;
            if (typeof v === "number") out[slug] = v;
          }
          return out;
        },
      });

      // Resolutions are accepted on the request body for API
      // compatibility but no longer forwarded to SchemaChangeService.
      // F2's shim used to forward them; F3's pipeline path doesn't
      // (yet — F8's PromptDispatcher absorbs resolution handling).
      // Safe deltas don't need resolutions; destructive ones currently
      // require the admin's existing SchemaChangeDialog flow which
      // still works because the dispatcher only saves "confirmed"
      // changes and the legacy preview/dialog UX is unchanged.
      void resolutions;

      const schemaVersionsCtx: Record<string, number> = {};
      if (schemaVersion !== undefined) {
        schemaVersionsCtx[p.collectionName] = schemaVersion;
      }

      const result = await apply(desired, "ui", {
        schemaVersions: schemaVersionsCtx,
        promptChannel: "auto",
      });

      if (!result.success) {
        if (result.error.code === "SCHEMA_VERSION_CONFLICT") {
          throw new Error(
            "Schema was modified by another session. Please refresh."
          );
        }
        throw new Error(result.error.message);
      }

      return {
        success: true,
        message: `Schema applied for '${p.collectionName}'`,
        // Pipeline result's bumped version; fall back to inferred bump
        // if the readNewSchemaVersionsForSlugs callback didn't surface
        // the slug (e.g., registry cache missed).
        newSchemaVersion:
          result.newSchemaVersions[p.collectionName] ?? currentVersion + 1,
      };
    },
  },
  listEntries: {
    execute: (svc, p) => {
      requireParam(p, "collectionName");

      // Build sort parameter from sortBy and sortOrder.
      // Frontend sends: sortBy=createdAt&sortOrder=desc
      // Backend expects: sort=-createdAt (desc) or sort=createdAt (asc).
      let sort = p.sort;
      if (!sort && p.sortBy) {
        const sortOrder = p.sortOrder === "desc" ? "desc" : "asc";
        sort = sortOrder === "desc" ? `-${p.sortBy}` : String(p.sortBy);
      }

      // Accept both `limit` (standard API param) and `pageSize` (legacy/admin).
      const rawLimit = p.limit ?? p.pageSize;

      return svc.listEntries({
        collectionName: p.collectionName,
        page: p.page !== undefined ? parseInt(String(p.page), 10) : undefined,
        limit:
          rawLimit !== undefined ? parseInt(String(rawLimit), 10) : undefined,
        search: p.search,
        depth:
          p.depth !== undefined ? parseInt(String(p.depth), 10) : undefined,
        select: parseSelectParam(p.select),
        where: parseWhereParam(p.where),
        richTextFormat: parseRichTextFormat(p.richTextFormat),
        sort,
      });
    },
  },
  countEntries: {
    execute: async (svc, p) => {
      requireParam(p, "collectionName");
      const result = await svc.countEntries({
        collectionName: p.collectionName,
        search: p.search,
        where: parseWhereParam(p.where),
      });
      // Return simple { totalDocs } format expected by the frontend.
      // The entryApi.count() frontend method expects this format.
      if (result.success && result.data) {
        return result.data;
      }
      throw new Error(result.message || "Failed to count entries");
    },
  },
  createEntry: {
    execute: (svc, p, body) => {
      if (!p.collectionName || !body)
        throw new Error("collectionName and entry data are required");
      return svc.createEntry(
        {
          collectionName: p.collectionName,
          depth:
            p.depth !== undefined ? parseInt(String(p.depth), 10) : undefined,
          userId: p._authenticatedUserId
            ? String(p._authenticatedUserId)
            : undefined,
          userName: p._authenticatedUserName
            ? String(p._authenticatedUserName)
            : undefined,
          userEmail: p._authenticatedUserEmail
            ? String(p._authenticatedUserEmail)
            : undefined,
        },
        body as Record<string, unknown>
      );
    },
  },
  getEntry: {
    execute: (svc, p) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      return svc.getEntry({
        collectionName: p.collectionName,
        entryId: p.entryId,
        depth:
          p.depth !== undefined ? parseInt(String(p.depth), 10) : undefined,
        select: parseSelectParam(p.select),
        richTextFormat: parseRichTextFormat(p.richTextFormat),
      });
    },
  },
  updateEntry: {
    execute: (svc, p, body) => {
      if (!p.collectionName || !p.entryId || !body) {
        throw new Error(
          "collectionName, entryId, and update data are required"
        );
      }
      return svc.updateEntry(
        {
          collectionName: p.collectionName,
          entryId: p.entryId,
          depth:
            p.depth !== undefined ? parseInt(String(p.depth), 10) : undefined,
          userId: p._authenticatedUserId
            ? String(p._authenticatedUserId)
            : undefined,
          userName: p._authenticatedUserName
            ? String(p._authenticatedUserName)
            : undefined,
          userEmail: p._authenticatedUserEmail
            ? String(p._authenticatedUserEmail)
            : undefined,
        },
        body as Record<string, unknown>
      );
    },
  },
  deleteEntry: {
    execute: (svc, p) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      return svc.deleteEntry({
        collectionName: p.collectionName,
        entryId: p.entryId,
        userId: p._authenticatedUserId
          ? String(p._authenticatedUserId)
          : undefined,
        userName: p._authenticatedUserName
          ? String(p._authenticatedUserName)
          : undefined,
        userEmail: p._authenticatedUserEmail
          ? String(p._authenticatedUserEmail)
          : undefined,
      });
    },
  },
  bulkDeleteEntries: {
    execute: (svc, p, body) => {
      const b = body as { ids?: string[] } | undefined;
      if (!p.collectionName) {
        throw new Error("collectionName parameter is required");
      }
      if (!b?.ids || !Array.isArray(b.ids) || b.ids.length === 0) {
        throw new Error("ids must be a non-empty array");
      }
      return svc.bulkDeleteEntries({
        collectionName: p.collectionName,
        ids: b.ids,
        userId: p._authenticatedUserId
          ? String(p._authenticatedUserId)
          : undefined,
        userName: p._authenticatedUserName
          ? String(p._authenticatedUserName)
          : undefined,
        userEmail: p._authenticatedUserEmail
          ? String(p._authenticatedUserEmail)
          : undefined,
      });
    },
  },
  bulkUpdateEntries: {
    execute: (svc, p, body) => {
      const b = body as
        | { ids?: string[]; data?: Record<string, unknown> }
        | undefined;
      if (!p.collectionName) {
        throw new Error("collectionName parameter is required");
      }
      if (!b?.ids || !Array.isArray(b.ids) || b.ids.length === 0) {
        throw new Error("ids must be a non-empty array");
      }
      if (!b?.data || typeof b.data !== "object") {
        throw new Error("data must be an object with update values");
      }
      return svc.bulkUpdateEntries({
        collectionName: p.collectionName,
        ids: b.ids,
        data: b.data,
        userId: p._authenticatedUserId
          ? String(p._authenticatedUserId)
          : undefined,
        userName: p._authenticatedUserName
          ? String(p._authenticatedUserName)
          : undefined,
        userEmail: p._authenticatedUserEmail
          ? String(p._authenticatedUserEmail)
          : undefined,
      });
    },
  },
  bulkUpdateByQuery: {
    execute: (svc, p, body) => {
      const b = body as
        | {
            where?: Record<string, unknown>;
            data?: Record<string, unknown>;
            limit?: number;
          }
        | undefined;
      if (!p.collectionName) {
        throw new Error("collectionName parameter is required");
      }
      if (!b?.where || typeof b.where !== "object") {
        throw new Error("where must be an object with query conditions");
      }
      if (!b?.data || typeof b.data !== "object") {
        throw new Error("data must be an object with update values");
      }
      return svc.bulkUpdateByQuery(
        {
          collectionName: p.collectionName,
          where: b.where as WhereFilter,
          data: b.data,
        },
        { limit: b.limit }
      );
    },
  },
  duplicateEntry: {
    execute: (svc, p, body) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      const b = body as { overrides?: Record<string, unknown> } | undefined;
      return svc.duplicateEntry({
        collectionName: p.collectionName,
        entryId: p.entryId,
        overrides: b?.overrides,
        userId: p._authenticatedUserId
          ? String(p._authenticatedUserId)
          : undefined,
        userName: p._authenticatedUserName
          ? String(p._authenticatedUserName)
          : undefined,
        userEmail: p._authenticatedUserEmail
          ? String(p._authenticatedUserEmail)
          : undefined,
      });
    },
  },
};

/**
 * Dispatch a collections method call. Prefers the DI-registered
 * `CollectionsHandler` (which has dynamic schemas wired up) and falls
 * back to the container's collections service if DI is unavailable.
 */
export function dispatchCollections(
  services: ServiceContainer,
  method: string,
  params: Params,
  body: unknown
): Promise<unknown> {
  const collectionsHandler =
    getCollectionsHandlerFromDI() ?? services.collections;
  const handler = COLLECTIONS_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute(collectionsHandler, params, body);
}
