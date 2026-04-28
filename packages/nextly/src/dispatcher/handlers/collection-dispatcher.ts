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
import { RealClassifier } from "../../domains/schema/pipeline/classifier/classifier.js";
import { extractDatabaseNameFromUrl } from "../../domains/schema/pipeline/database-url.js";
import { buildDesiredTableFromFields } from "../../domains/schema/pipeline/diff/build-from-fields.js";
import { diffSnapshots } from "../../domains/schema/pipeline/diff/diff.js";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live.js";
import { RealPreCleanupExecutor } from "../../domains/schema/pipeline/pre-cleanup/executor.js";
import {
  BrowserPromptDispatcher,
  type BrowserRenameResolution,
} from "../../domains/schema/pipeline/prompt-dispatcher/browser.js";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "../../domains/schema/pipeline/pushschema-pipeline-stubs.js";
import { PushSchemaPipeline } from "../../domains/schema/pipeline/pushschema-pipeline.js";
import { RegexRenameDetector } from "../../domains/schema/pipeline/rename-detector.js";
import type { Resolution } from "../../domains/schema/pipeline/resolution/types.js";
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

      // F4 Option E PR 5: also surface rename candidates so the admin
      // SchemaChangeDialog can render rename radio buttons. Additive to
      // the existing F1 preview shape; the F1 added/removed/changed
      // sections still drive the rest of the dialog. Failure here is
      // non-fatal — the F1 preview is the load-bearing UX.
      const renamed = await computeRenameCandidatesForPreview(
        tableName,
        fields
      );

      return {
        ...preview,
        renamed,
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
      // F4 Option E PR 5: schemaChangeService is no longer consulted on
      // the apply path (the F3-era preview-and-throw block is gone).
      // Registry alone is sufficient as the DI-readiness probe.
      const registry = getCollectionRegistryFromDI();
      if (!registry) {
        throw new Error("Collection registry not initialized");
      }
      const collection = await registry.getCollectionBySlug(p.collectionName);
      if (!collection) throw new Error("Collection not found");
      if (collection.locked) {
        throw new Error(
          "This collection is managed via code and cannot be modified in the UI"
        );
      }
      const {
        fields,
        confirmed,
        schemaVersion,
        resolutions,
        renameResolutions,
        eventResolutions,
      } = body as {
        fields: unknown[];
        confirmed: boolean;
        schemaVersion?: number;
        // Legacy F1 admin UI shape (per-field, used by old SchemaChangeService
        // path). Kept alive until F8 deletes the legacy service entirely.
        resolutions?: Record<string, FieldResolution>;
        renameResolutions?: BrowserRenameResolution[];
        // F5 PR 6: typed Resolution[] from the new pipeline contract.
        // Optional — admin UIs that haven't been upgraded send only the
        // legacy `resolutions` map and the new pipeline emits no events
        // until the UI is updated to consume ClassifierEvents from preview.
        eventResolutions?: Resolution[];
      };
      if (!confirmed) {
        throw new Error("Schema changes must be confirmed");
      }
      if (!fields) throw new Error("fields is required in request body");

      const currentVersion = collection.schemaVersion;
      const tableName = collection.tableName;

      // F1 field-level resolutions (provide_default / mark_nullable / cancel)
      // are collected by the dialog but not yet wired through the pipeline.
      // F8/F12 will absorb that flow when the Classifier lands. Renames are
      // handled below via BrowserPromptDispatcher.
      void resolutions;

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
      // CollectionRegistryService.getAllCollections returns
      // DynamicCollectionRecord[] — slug + tableName are required
      // fields, no defensive guards needed.
      const allCollections = await registry.getAllCollections();
      for (const c of allCollections) {
        if (c.slug === p.collectionName) continue;
        desired.collections[c.slug] = {
          slug: c.slug,
          tableName: c.tableName,
          fields: c.fields ?? [],
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
      // dialect is an abstract readonly property on DrizzleAdapter — not
      // a method (a previous iteration mistakenly called .getDialect()
      // which would crash at runtime; tsc missed it because of `as any`).
      const dialect = adapter.dialect;
      const db = adapter.getDrizzle();
      const databaseName =
        dialect === "mysql"
          ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
          : undefined;

      // Per-call factory (not the DI-bound applyDesiredSchema in
      // pipeline/index.ts) so we can thread MySQL databaseName + the
      // resolved adapter into the F3 PushSchemaPipeline at this site.
      //
      // F4 Option E PR 5: BrowserPromptDispatcher takes pre-attached
      // rename resolutions from the request body (collected by the admin
      // SchemaChangeDialog before save) and translates them into
      // confirmedRenames inside the pipeline's Phase B. No SSE, no
      // mid-apply prompts — the dialog is the prompt UX.
      const promptDispatcher = new BrowserPromptDispatcher(
        renameResolutions ?? [],
        eventResolutions ?? []
      );
      const apply = createApplyDesiredSchema({
        applyPipeline: (desiredArg, sourceArg, channelArg) => {
          // F5 PR 6: real classifier + real pre-cleanup executor wired at
          // the UI-first save path. The admin's existing SchemaChangeDialog
          // continues to send the legacy `resolutions` map for the legacy
          // `SchemaChangeService` path; the new pipeline below ALSO emits
          // typed events that admin UIs can opt into via `eventResolutions`
          // (Resolution[]) once the dialog is updated. F8 will delete the
          // legacy service and the legacy `resolutions` field.
          const pipeline = new PushSchemaPipeline({
            executor: new DrizzleStatementExecutor(dialect, db),
            renameDetector: new RegexRenameDetector(),
            classifier: new RealClassifier(),
            promptDispatcher,
            preRenameExecutor: noopPreRenameExecutor,
            preCleanupExecutor: new RealPreCleanupExecutor(),
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

// Shape we surface in the preview response. Mirrors RenameCandidate but
// uses field-style names (`from`/`to`/`table`) to match the existing
// preview shape on the admin side.
interface PreviewRenameCandidate {
  table: string;
  from: string;
  to: string;
  fromType: string;
  toType: string;
  typesCompatible: boolean;
  defaultSuggestion: "rename" | "drop_and_add";
}

// Runs the Option E pipeline's diff + rename detector for a single
// collection so the admin SchemaChangeDialog can render rename radio
// buttons. Failure is non-fatal: the F1 added/removed/changed sections
// in the dialog still work without it.
async function computeRenameCandidatesForPreview(
  tableName: string,
  fields: unknown[]
): Promise<PreviewRenameCandidate[]> {
  const adapter = getAdapterFromDI();
  if (!adapter) return [];

  try {
    const dialect = adapter.dialect;
    const db = adapter.getDrizzle();
    const live = await introspectLiveSnapshot(db, dialect, [tableName]);
    const desiredTable = buildDesiredTableFromFields(
      tableName,
      fields as unknown as Parameters<typeof buildDesiredTableFromFields>[1],
      dialect
    );
    const operations = diffSnapshots(live, { tables: [desiredTable] });
    const detector = new RegexRenameDetector();
    return detector.detect(operations, dialect).map(c => ({
      table: c.tableName,
      from: c.fromColumn,
      to: c.toColumn,
      fromType: c.fromType,
      toType: c.toType,
      typesCompatible: c.typesCompatible,
      defaultSuggestion: c.defaultSuggestion,
    }));
  } catch (err) {
    console.warn(
      `[Schema Preview] Could not compute rename candidates for '${tableName}': ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

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
