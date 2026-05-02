/**
 * Collection-service dispatch handlers.
 *
 * Routes 14 collection operations to the DI-registered
 * `CollectionsHandler` (with fallback to the container's legacy
 * collections service). `listCollections` filters the results by the
 * caller's effective read permissions so non-super-admin users only see
 * collections they can actually read.
 */

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

      // Build a single-collection DesiredSchema for the pipeline preview.
      // Singles + components buckets stay empty: the dispatcher's preview
      // endpoint is collection-scoped today (admin Schema Builder posts
      // per-collection).
      const desired: DesiredSchema = {
        collections: {
          [p.collectionName]: {
            slug: p.collectionName,
            tableName,
            fields: fields as DesiredCollection["fields"],
          },
        },
        singles: {},
        components: {},
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

      return {
        ...legacyShape,
        renamed,
        schemaVersion: collection.schemaVersion,
      };
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

      return {
        success: true,
        message: `Schema applied for '${p.collectionName}'`,
        // Pipeline result's bumped version; fall back to inferred bump
        // if the readNewSchemaVersionsForSlugs callback didn't surface
        // the slug (e.g., registry cache missed).
        newSchemaVersion:
          result.newSchemaVersions[p.collectionName] ?? currentVersion + 1,
        // F10 PR 6: a contextual toast summary for the admin Save flow.
        // The pipeline already computed the diff counts for the journal;
        // we render them as "1 field added" / "1 field added, 1 renamed"
        // here so the admin doesn't need to recompute. Undefined-safe:
        // older clients will fall through to a generic toast string.
        toastSummary: result.summary
          ? formatToastSummary(result.summary)
          : undefined,
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
