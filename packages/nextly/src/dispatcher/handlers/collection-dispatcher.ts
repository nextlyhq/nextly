/**
 * Collection-service dispatch handlers.
 *
 * Routes 14 collection operations to the DI-registered
 * `CollectionsHandler` (with fallback to the container's legacy
 * collections service). `listCollections` filters the results by the
 * caller's effective read permissions so non-super-admin users only see
 * collections they can actually read.
 *
 * Phase 4 Task 8: every non-bulk handler returns a Response built via
 * the respondX helpers in `../../api/response-shapes.ts`. The
 * dispatcher passes the Response through unchanged. See spec section 5.1 for
 * the canonical shape contract.
 *
 * Phase 4.5: bulk operations (`bulkDeleteEntries`, `bulkUpdateEntries`,
 * `bulkUpdateByQuery`) now emit canonical `respondBulk` envelopes
 * (`{ message, items, errors }`). Per-item failures decompose to
 * `{ id, code, message }` keyed by canonical NextlyErrorCode. The
 * service-layer BulkOperationResult was reshaped to carry these directly,
 * so the dispatcher hands service output to respondBulk without per-call
 * translation.
 */

import {
  respondAction,
  respondBulk,
  respondCount,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "../../api/response-shapes";
import { translatePipelinePreviewToLegacy } from "../../domains/schema/legacy-preview/translate";
import { createApplyDesiredSchema } from "../../domains/schema/pipeline/apply";
import { RealClassifier } from "../../domains/schema/pipeline/classifier/classifier";
import { extractDatabaseNameFromUrl } from "../../domains/schema/pipeline/database-url";
import { RealPreCleanupExecutor } from "../../domains/schema/pipeline/pre-cleanup/executor";
import { previewDesiredSchema } from "../../domains/schema/pipeline/preview";
import {
  BrowserPromptDispatcher,
  type BrowserRenameResolution,
} from "../../domains/schema/pipeline/prompt-dispatcher/browser";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "../../domains/schema/pipeline/pushschema-pipeline-stubs";
import { PushSchemaPipeline } from "../../domains/schema/pipeline/pushschema-pipeline";
import { RegexRenameDetector } from "../../domains/schema/pipeline/rename-detector";
import { getProductionNotifier } from "../../runtime/notifications/index";
import type { Resolution } from "../../domains/schema/pipeline/resolution/types";
import type {
  DesiredCollection,
  DesiredSchema,
} from "../../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import { generateRuntimeSchema } from "../../domains/schema/services/runtime-schema-generator";
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
  getMigrationJournalFromDI,
  getSchemaRegistryFromDI,
} from "../helpers/di";
import { buildFullDesiredSchema } from "../helpers/desired-schema";
// Phase 4.9: shared dispatcher helpers. Previously this file kept local
// copies of toPaginationMeta / paginatedResponseToMeta / unwrapServiceResult
// because Phase 4 was migrating dispatchers in parallel; with Phase 4
// merged we import the canonical versions from one module.
import {
  paginatedResponseToMeta,
  toPaginationMeta,
  unwrapServiceResult,
} from "../helpers/service-envelope";
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

// F14 v1: decides whether the apply payload carries actionable rename
// hints we should log a debug receipt for. Pulled out as a pure helper
// so tests can pin the "non-empty renames map only" semantics without
// mocking the entire applySchemaChanges path.
//
// v1 always returns false-or-logs; v2 will replace the body to feed
// hints into the rename detector. Keeping the pure helper here means
// the v2 swap is one-file.
function shouldLogF14HintReceipt(hints: unknown): boolean {
  if (!hints || typeof hints !== "object") return false;
  const renames = (hints as { renames?: unknown }).renames;
  if (!renames || typeof renames !== "object") return false;
  return Object.keys(renames as Record<string, unknown>).length > 0;
}

// F10 PR 6: render a per-change-kind summary as a toast-friendly
// phrase. The admin Save handler concatenates this with the
// collection name like "Posts schema updated. 1 field added".
//
// Pure helper. Mirrors the admin-side `formatJournalSummary` from
// `packages/admin/.../formatters.ts` so server-rendered + admin-
// rendered text stay consistent. Kept server-side too because the
// dispatcher needs to send the string in the apply response.
function formatToastSummary(summary: {
  added: number;
  removed: number;
  renamed: number;
  changed: number;
}): string {
  const parts: string[] = [];
  if (summary.added) {
    parts.push(
      `${summary.added} field${summary.added === 1 ? "" : "s"} added`
    );
  }
  if (summary.renamed) parts.push(`${summary.renamed} renamed`);
  if (summary.changed) parts.push(`${summary.changed} changed`);
  if (summary.removed) parts.push(`${summary.removed} removed`);
  return parts.length > 0 ? parts.join(", ") : "no changes";
}

const COLLECTIONS_METHODS: Record<
  string,
  MethodHandler<CollectionsHandlerType>
> = {
  createCollection: {
    // Phase 4: respondMutation 201. The metadata service still returns
    // the legacy CollectionServiceResult envelope; we unwrap it and
    // pass the legacy success message through as the toast string so
    // existing admin UIs see the same copy ("Collection created!
    // Restart the app...").
    execute: async (svc, _, body) => {
      const result = await svc.createCollection(
        requireBody(body, "Collection data is required")
      );
      const collection = unwrapServiceResult(result);
      return respondMutation(
        result.message ?? "Collection created.",
        collection,
        { status: 201 }
      );
    },
  },
  listCollections: {
    // Phase 4: respondList. Translates the legacy CollectionServiceResult
    // `{ data, meta }` envelope to the canonical `{ items, meta }` body.
    // Permission filtering (non-super-admins only see collections they
    // can read) runs after unwrap so the meta we ship reflects the
    // FILTERED counts, not the pre-filter totals.
    execute: async (svc, p) => {
      const result = await svc.listCollections({
        page: toNumber(p.page),
        limit: toNumber(p.limit),
        search: p.search,
        sortBy: p.sortBy as "slug" | "createdAt" | "updatedAt" | undefined,
        sortOrder: p.sortOrder as "asc" | "desc" | undefined,
      });
      // Service returns legacy { success, data, meta }. Unwrap throws on
      // failure (which the dispatcher converts to a NextlyError response).
      const data = unwrapServiceResult<unknown>(result);
      const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];

      // Service meta now uses limit/total/totalPages (Phase 4.8 rename);
      // toPaginationMeta below adds the canonical hasNext/hasPrev fields.
      const serviceMeta = result.meta as
        | {
            total?: number;
            page?: number;
            limit?: number;
            totalPages?: number;
          }
        | undefined;
      const baseMeta = {
        total: typeof serviceMeta?.total === "number" ? serviceMeta.total : items.length,
        page: typeof serviceMeta?.page === "number" ? serviceMeta.page : 1,
        limit:
          typeof serviceMeta?.limit === "number"
            ? serviceMeta.limit
            : items.length,
        totalPages:
          typeof serviceMeta?.totalPages === "number" ? serviceMeta.totalPages : 1,
      };

      const userId = p._authenticatedUserId
        ? String(p._authenticatedUserId)
        : undefined;
      if (!userId) {
        return respondList(items, toPaginationMeta(baseMeta));
      }

      const superAdmin = await isSuperAdmin(userId);
      if (superAdmin) {
        return respondList(items, toPaginationMeta(baseMeta));
      }

      // Non-super-admin: filter the page to collections this user can
      // actually read. We rebuild total + totalPages on the filtered
      // array so the admin's pagination footer matches what the user
      // actually sees.
      const permissionPairs = await listEffectivePermissions(userId);
      const readableResources = new Set(
        permissionPairs
          .filter(pair => pair.endsWith(":read"))
          .map(pair => pair.split(":")[0])
      );

      type CollectionItem = { slug?: string; name?: string };
      const filtered = (items as CollectionItem[]).filter(collection => {
        const slug = collection?.slug ?? collection?.name;
        return slug ? readableResources.has(String(slug)) : false;
      });

      const filteredMeta = {
        total: filtered.length,
        page: baseMeta.page,
        limit: baseMeta.limit,
        totalPages:
          baseMeta.limit > 0
            ? Math.max(1, Math.ceil(filtered.length / baseMeta.limit))
            : 1,
      };

      return respondList(filtered, toPaginationMeta(filteredMeta));
    },
  },
  getCollection: {
    // Phase 4: respondDoc. Bare doc body (no { data } wrapper).
    execute: async (svc, p) => {
      requireParam(p, "collectionName");
      const result = await svc.getCollection({ collectionName: p.collectionName });
      const collection = unwrapServiceResult(result, {
        slug: p.collectionName,
      });
      return respondDoc(collection);
    },
  },
  updateCollection: {
    // Phase 4: respondMutation 200. Pass the legacy success message
    // through so existing toast copy ("Collection updated successfully")
    // is preserved.
    execute: async (svc, p, body) => {
      if (!p.collectionName || !body)
        throw new Error("collectionName and update data are required");
      const result = await svc.updateCollection(
        { collectionName: p.collectionName },
        body
      );
      const collection = unwrapServiceResult(result, {
        slug: p.collectionName,
      });
      return respondMutation(
        result.message ?? "Collection updated.",
        collection
      );
    },
  },
  deleteCollection: {
    // Phase 4: respondMutation 200. The deleted record is the `item`.
    execute: async (svc, p) => {
      requireParam(p, "collectionName");
      const result = await svc.deleteCollection({
        collectionName: p.collectionName,
      });
      const collection = unwrapServiceResult(result, {
        slug: p.collectionName,
      });
      return respondMutation(
        result.message ?? "Collection deleted.",
        collection
      );
    },
  },
  // Preview schema changes (dry-run diff with row-count impact)
  previewSchemaChanges: {
    execute: async (_svc, p, body) => {
      requireParam(p, "collectionName");
      // F8 PR 3: pipeline preview + legacy-shape translator. Replaces
      // SchemaChangeService.preview(). The translator emits the legacy
      // 3-option resolution set so the admin SchemaChangeDialog renders
      // unchanged. Task 22 tracks the dialog upgrade to consume
      // ClassifierEvent[] directly (and reach the 4th `delete_nonconforming`
      // option that the pipeline emits but the legacy shape can't carry).
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
      const { fields } = body as { fields: unknown[] };
      if (!fields) throw new Error("fields is required in request body");
      // collection comes from getCollectionBySlug typed as DynamicCollectionRecord,
      // which has tableName, fields: FieldConfig[], and schemaVersion: number.
      // FieldConfig is structurally compatible with FieldDefinition; cast
      // through unknown for the type system.
      const currentFields = (collection.fields ??
        []) as unknown as FieldDefinition[];
      const tableName = collection.tableName;

      const adapter = getAdapterFromDI();
      if (!adapter) throw new Error("Database adapter not initialized");
      const dialect = adapter.dialect;
      const db = adapter.getDrizzle();

      // Build a full DesiredSchema so drizzle-kit sees all managed tables.
      // Without this, singles/components in the live DB are absent from the
      // desired snapshot and drizzle-kit offers them as rename candidates.
      const desired = await buildFullDesiredSchema();
      desired.collections[p.collectionName] = {
        slug: p.collectionName,
        tableName,
        fields: fields as DesiredCollection["fields"],
      };

      const pipelinePreview = await previewDesiredSchema({
        desired,
        db,
        dialect,
      });

      const legacyShape = await translatePipelinePreviewToLegacy(
        pipelinePreview,
        {
          tableName,
          currentFields,
          newFields: fields as FieldDefinition[],
          db,
          dialect,
        }
      );

      // Forward rename candidates from the same pipeline preview run
      // (the F4 Option E PR 5 `computeRenameCandidatesForPreview`
      // helper is now redundant — pipeline already detected them).
      const renamed = pipelinePreview.candidates.map(c => ({
        table: c.tableName,
        from: c.fromColumn,
        to: c.toColumn,
        fromType: c.fromType,
        toType: c.toType,
        typesCompatible: c.typesCompatible,
        defaultSuggestion: c.defaultSuggestion,
      }));

      // Phase 4: respondData. previewSchemaChanges returns a custom
      // preview payload (legacyShape + renamed + schemaVersion) with no
      // CRUD analog (respondData ships the bare object as the body).
      // We spread legacyShape into a new object so the resulting body
      // has at least the renamed/schemaVersion fields, never empty.
      // Cast through `unknown` because SchemaPreviewResult is a sealed
      // shape with no string index signature; respondData's generic
      // requires a Record<string, unknown> for spread compatibility.
      const legacyAsRecord = legacyShape as unknown as Record<string, unknown>;
      return respondData({
        ...legacyAsRecord,
        renamed,
        schemaVersion: collection.schemaVersion,
      });
    },
  },
  // Apply confirmed schema changes via the in-process schema service.
  //
  // F1 PR 3: single-process model. drizzle-kit/api is loaded lazily via
  // drizzle-kit-lazy.ts (webpackIgnore + turbopackIgnore magic comments
  // keep it out of the handler bundle), so DDL runs cleanly in the same
  // process serving requests. No more wrapper-mode IPC routing.
  //
  // F8 PR 3: bumpSchemaVersion is called directly here after a
  // successful pipeline apply (was previously wired via
  // SchemaChangeService.setOnApplySuccess in di/register.ts; that
  // service + its DI registration are gone).
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
        hints,
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
        // F14 v1 — RESERVED FIELD. v1 accepts and IGNORES this. v2 will
        // implement client-side rename hint tracking + server-side
        // auto-confirm so the SchemaChangeDialog stops asking the
        // admin to re-confirm renames they already clicked once.
        // Reserved here so v2 can ship as a pure additive change
        // without breaking older admin clients.
        // See plans/specs/F10-notifications-and-audit-design.md §6.6.
        hints?: {
          renames?: Record<string, string>;
        };
      };
      if (!confirmed) {
        throw new Error("Schema changes must be confirmed");
      }
      if (!fields) throw new Error("fields is required in request body");

      // F14 v1: log a debug line when hints arrive so we can track
      // adoption without surprising operators with errors. v1 ignores
      // the field entirely; v2 will pipe it into the rename detector.
      if (shouldLogF14HintReceipt(hints)) {
        // eslint-disable-next-line no-console -- intentional debug log; v1 reservation only
        console.debug?.(
          `[F14] hints received but not processed (v1); see plans/specs/F10-notifications-and-audit-design.md §6.6`
        );
      }

      const currentVersion = collection.schemaVersion;
      const tableName = collection.tableName;

      // F5 PR 6: legacy F1 per-field resolutions get translated to typed
      // Resolution[] inside BrowserPromptDispatcher.dispatch() once the
      // pipeline emits events. Until admin dialogs ship the new
      // `eventResolutions` contract, this translator keeps existing UIs
      // working end-to-end through the new pipeline. F8 will delete the
      // legacy shape entirely when the dialog ships the new contract.
      const legacyBundle = resolutions
        ? { tableName, byFieldName: resolutions }
        : undefined;

      // F3: route through the PushSchemaPipeline via the F2 contract.
      // Build the FULL DesiredSchema (collections + singles + components)
      // so drizzle-kit sees every managed table. Without this, tables of
      // other entity types in the live DB are absent from the desired
      // snapshot and drizzle-kit offers them as rename candidates for the
      // new collection being saved.
      const desired = await buildFullDesiredSchema();

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
        eventResolutions ?? [],
        legacyBundle
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
          // F8 PR 5: real journal from DI (with noop fallback so tests
          // that bypass DI keep working).
          const migrationJournal =
            getMigrationJournalFromDI() ?? noopMigrationJournal;
          const pipeline = new PushSchemaPipeline({
            executor: new DrizzleStatementExecutor(dialect, db),
            renameDetector: new RegexRenameDetector(),
            classifier: new RealClassifier(),
            promptDispatcher,
            preRenameExecutor: noopPreRenameExecutor,
            preCleanupExecutor: new RealPreCleanupExecutor(),
            migrationJournal,
            // F10 PR 3: admin-save applies print a terminal box +
            // write the NDJSON line. Same singleton across UI saves.
            notifier: getProductionNotifier(),
          });
          return pipeline.apply({
            desired: desiredArg,
            db,
            dialect,
            source: sourceArg,
            promptChannel: channelArg,
            databaseName,
            // F10 PR 2: tag the journal row with the collection slug
            // the user is editing so the admin NotificationCenter can
            // render "Posts schema updated" instead of generic "global".
            uiTargetSlug: p.collectionName,
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

      // Phase 6 follow-up (2026-05-01): pipeline.apply mutated the live
      // DB (renamed/added/dropped columns) but does NOT persist the
      // updated `fields` JSON on `dynamic_collections`. Without this
      // post-apply write, subsequent admin queries (entry list, entry
      // create form, etc.) build their column references from the STALE
      // metadata and fail with `no such column: <oldName>`. End-user
      // symptom: rename succeeds in the DB but the collection looks
      // empty in the admin UI because every list query 500s.
      //
      // Use `adapter.update` directly (not `registry.updateCollection`)
      // because the registry helper auto-bumps `schema_version` and
      // resets `migration_status` to `"pending"` on any `fields` change
      // — both wrong here. The pipeline already bumped the schema
      // version (see bumpSchemaVersion below + the journal record),
      // and the migration status is now `applied`, not `pending`.
      // Surgical write of just the `fields` column keeps invariants
      // intact.
      try {
        await adapter.update(
          "dynamic_collections",
          {
            fields: JSON.stringify(fields),
            updated_at: new Date(),
          },
          { and: [{ column: "slug", op: "=", value: p.collectionName }] }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Non-fatal: the schema apply itself already succeeded. If the
        // metadata write fails, the actual DB column was already
        // renamed and the collection is in a good state structurally;
        // only the admin's view of the field name is stale. Log so an
        // operator can diagnose, but don't block the response.
        // eslint-disable-next-line no-console -- intentional operator-visible warning
        console.warn(
          `[applySchemaChanges] Post-apply metadata write failed for ` +
            `'${p.collectionName}': ${msg}. Live DB schema is correct ` +
            `but admin UI may show stale field names until next reload.`
        );
      }

      // After a schema apply (rename, add, drop) two independent in-memory
      // caches hold Drizzle table objects that are now stale:
      //
      //   1. CollectionFileManager.schemaRegistry — used by query-service
      //      SELECT / JOIN builders (loadDynamicSchema path).
      //   2. SchemaRegistry.dynamicSchemas — used by adapter.insert /
      //      update / delete / select (getTableObject path).
      //
      // Both must be refreshed with the same freshly-generated table built
      // from the apply payload's `fields`. Replacing in-place (rather than
      // invalidate + lazy-rebuild) avoids the race where a concurrent
      // request could arrive between the invalidation and the DB write of
      // the new `dynamic_collections.fields`, picking up the stale schema.
      try {
        const { table: freshTable } = generateRuntimeSchema(
          tableName,
          fields as FieldDefinition[],
          dialect
        );
        getCollectionsHandlerFromDI()?.refreshCollectionSchema(
          tableName,
          freshTable
        );
        getSchemaRegistryFromDI()?.registerDynamicSchema(tableName, freshTable);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console -- intentional operator-visible warning
        console.warn(
          `[applySchemaChanges] In-memory schema refresh failed for ` +
            `'${p.collectionName}': ${msg}. Entry queries may reference ` +
            `old column names until next server restart.`
        );
      }

      // F8 PR 3: bumpSchemaVersion was previously wired via
      // SchemaChangeService.setOnApplySuccess in di/register.ts. With the
      // legacy service gone, the dispatcher fires it directly after a
      // successful pipeline apply. The bump only matters for UI-first
      // applies (sets the X-Schema-Version response header so admin
      // tabs know to refetch); HMR + boot paths don't need it.
      try {
        const { bumpSchemaVersion } = await import("../../routeHandler");
        bumpSchemaVersion();
      } catch {
        // routeHandler may be unavailable in non-server contexts (tests).
      }

      // Phase 4: respondAction. applySchemaChanges is a non-CRUD
      // mutation: there's no "item" to surface. The action result
      // carries the new schema version (so the admin can update its
      // X-Schema-Version header probe) and a toast summary string.
      // toastSummary may be undefined when the pipeline didn't emit
      // diff counts; respondAction silently drops undefined fields
      // because we use a conditional spread.
      return respondAction(`Schema applied for '${p.collectionName}'`, {
        newSchemaVersion:
          result.newSchemaVersions[p.collectionName] ?? currentVersion + 1,
        ...(result.summary
          ? { toastSummary: formatToastSummary(result.summary) }
          : {}),
      });
    },
  },
  listEntries: {
    // Phase 4: respondList. The entry-query service wraps a
    // PaginatedResponse (`{ docs, totalDocs, limit, page, totalPages,
    // hasNextPage, hasPrevPage, ... }`) in CollectionServiceResult; we
    // unwrap it and translate to canonical PaginationMeta via
    // paginatedResponseToMeta.
    execute: async (svc, p) => {
      requireParam(p, "collectionName");

      // Build sort parameter from sortBy and sortOrder.
      // Frontend sends: sortBy=createdAt&sortOrder=desc
      // Backend expects: sort=-createdAt (desc) or sort=createdAt (asc).
      let sort = p.sort;
      if (!sort && p.sortBy) {
        const sortOrder = p.sortOrder === "desc" ? "desc" : "asc";
        sort = sortOrder === "desc" ? `-${p.sortBy}` : String(p.sortBy);
      }

      const rawLimit = p.limit;

      const result = await svc.listEntries({
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

      type PaginatedShape = {
        docs: unknown[];
        totalDocs: number;
        limit: number;
        page: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
      };
      const paginated = unwrapServiceResult<PaginatedShape>(result, {
        collectionName: p.collectionName,
      });
      return respondList(paginated.docs, paginatedResponseToMeta(paginated));
    },
  },
  countEntries: {
    // Phase 4: respondCount. Wire shape canonicalises on `{ total }`
    // (legacy services returned `{ totalDocs }`, and frontend code that
    // reads `body.totalDocs` is being migrated alongside this task).
    execute: async (svc, p) => {
      requireParam(p, "collectionName");
      const result = await svc.countEntries({
        collectionName: p.collectionName,
        search: p.search,
        where: parseWhereParam(p.where),
      });
      const data = unwrapServiceResult<{ totalDocs: number }>(result, {
        collectionName: p.collectionName,
      });
      return respondCount(data.totalDocs);
    },
  },
  createEntry: {
    // Phase 4: respondMutation 201.
    execute: async (svc, p, body) => {
      if (!p.collectionName || !body)
        throw new Error("collectionName and entry data are required");
      const result = await svc.createEntry(
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
      const entry = unwrapServiceResult(result, {
        collectionName: p.collectionName,
      });
      return respondMutation(result.message ?? "Entry created.", entry, {
        status: 201,
      });
    },
  },
  getEntry: {
    // Phase 4: respondDoc.
    execute: async (svc, p) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      const result = await svc.getEntry({
        collectionName: p.collectionName,
        entryId: p.entryId,
        depth:
          p.depth !== undefined ? parseInt(String(p.depth), 10) : undefined,
        select: parseSelectParam(p.select),
        richTextFormat: parseRichTextFormat(p.richTextFormat),
      });
      const entry = unwrapServiceResult(result, {
        collectionName: p.collectionName,
        entryId: p.entryId,
      });
      return respondDoc(entry);
    },
  },
  updateEntry: {
    // Phase 4: respondMutation 200.
    execute: async (svc, p, body) => {
      if (!p.collectionName || !p.entryId || !body) {
        throw new Error(
          "collectionName, entryId, and update data are required"
        );
      }
      const result = await svc.updateEntry(
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
      const entry = unwrapServiceResult(result, {
        collectionName: p.collectionName,
        entryId: p.entryId,
      });
      return respondMutation(result.message ?? "Entry updated.", entry);
    },
  },
  deleteEntry: {
    // Phase 4: respondMutation 200. The deleted record is the `item`.
    execute: async (svc, p) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      const result = await svc.deleteEntry({
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
      const entry = unwrapServiceResult(result, {
        collectionName: p.collectionName,
        entryId: p.entryId,
      });
      return respondMutation(result.message ?? "Entry deleted.", entry);
    },
  },
  // Phase 4.5: bulk delete by ids. Service returns BulkOperationResult
  // with structured per-item failures; the dispatcher hands successes +
  // failures straight to respondBulk. HTTP 200 for partial success
  // (per-item failures are first-class data in the body's `errors`
  // array, not server errors). Malformed-request validation (missing
  // collectionName, empty ids) raises in the service envelope path
  // upstream; the legacy `throw new Error("...")` lines below stay as
  // pre-existing baseline per Phase 4.5 scope.
  bulkDeleteEntries: {
    execute: async (svc, p, body) => {
      const b = body as { ids?: string[] } | undefined;
      if (!p.collectionName) {
        throw new Error("collectionName parameter is required");
      }
      if (!b?.ids || !Array.isArray(b.ids) || b.ids.length === 0) {
        throw new Error("ids must be a non-empty array");
      }
      const result = await svc.bulkDeleteEntries({
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
      // Compose a server-authored toast string. Total here is the
      // request's id count, not just the success count, so the message
      // accurately conveys partial-success when failures.length > 0.
      const message =
        result.failures.length === 0
          ? `Deleted ${result.successCount} ${
              result.successCount === 1 ? "entry" : "entries"
            }.`
          : `Deleted ${result.successCount} of ${result.total} entries.`;
      return respondBulk(message, result.successes, result.failures);
    },
  },
  // Phase 4.5: bulk update by ids. Successes carry full mutated records
  // so the admin client can refresh its cache without a re-fetch.
  bulkUpdateEntries: {
    execute: async (svc, p, body) => {
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
      const result = await svc.bulkUpdateEntries({
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
      const message =
        result.failures.length === 0
          ? `Updated ${result.successCount} ${
              result.successCount === 1 ? "entry" : "entries"
            }.`
          : `Updated ${result.successCount} of ${result.total} entries.`;
      return respondBulk(message, result.successes, result.failures);
    },
  },
  // Phase 4.5: bulk update by query. The service throws NextlyError on
  // request-level failures (collection-wide forbidden, limit exceeded,
  // failed match-list query), which the dispatcher's catch path turns
  // into the canonical error envelope. Per-entry failures during the
  // update phase land in result.failures and are surfaced via respondBulk.
  bulkUpdateByQuery: {
    execute: async (svc, p, body) => {
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
      const result = await svc.bulkUpdateByQuery(
        {
          collectionName: p.collectionName,
          where: b.where as WhereFilter,
          data: b.data,
        },
        { limit: b.limit }
      );
      const message =
        result.failures.length === 0
          ? `Updated ${result.successCount} ${
              result.successCount === 1 ? "entry" : "entries"
            }.`
          : `Updated ${result.successCount} of ${result.total} entries.`;
      return respondBulk(message, result.successes, result.failures);
    },
  },
  duplicateEntry: {
    // Phase 4: respondMutation 201. duplicateEntry is fundamentally a
    // create: it produces a new row. The bulk-service implementation
    // delegates to mutationService.createEntry which already returns
    // statusCode 201, so the wire status matches end-to-end.
    execute: async (svc, p, body) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      const b = body as { overrides?: Record<string, unknown> } | undefined;
      const result = await svc.duplicateEntry({
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
      const entry = unwrapServiceResult(result, {
        collectionName: p.collectionName,
        sourceEntryId: p.entryId,
      });
      return respondMutation(result.message ?? "Entry duplicated.", entry, {
        status: 201,
      });
    },
  },
};

// F8 PR 3 deleted `computeRenameCandidatesForPreview` (and its helper
// imports `introspectLiveSnapshot`, `buildDesiredTableFromFields`,
// `diffSnapshots`). Rename candidates now flow out of the same
// `previewDesiredSchema()` call that produces the rest of the preview
// response — no second introspect+diff round-trip needed.

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

// F10 PR 6: test seam — the helper is module-private but pure, and
// re-exporting under a verbose name keeps the public surface honest
// while letting unit tests pin its behaviour.
export const formatToastSummaryForTest = formatToastSummary;

// F14 v1: same test-seam pattern for the hint-receipt decision
// helper. v1's only behavioural contract is "non-empty renames map →
// log; everything else → silent"; the tests pin that.
export const shouldLogF14HintReceiptForTest = shouldLogF14HintReceipt;
