/**
 * Collection-service dispatch handlers.
 *
 * Routes 14 collection operations to the DI-registered
 * `CollectionsHandler` (with fallback to the container's legacy
 * collections service). `listCollections` filters the results by the
 * caller's effective read permissions so non-super-admin users only see
 * collections they can actually read.
 *
 * Every handler returns a Response built via the respondX helpers in
 * `../../api/response-shapes.ts`. The dispatcher passes the Response
 * through unchanged. See spec §5.1 for the canonical shape
 * contract.
 *
 * Bulk operations (`bulkDeleteEntries`, `bulkUpdateEntries`,
 * `bulkUpdateByQuery`) emit canonical `respondBulk` envelopes
 * (`{ message, items, errors }`). Per-item failures decompose to
 * `{ id, code, message }` keyed by canonical NextlyErrorCode.
 */

import {
  assertValidFieldsPayload,
  assertValidPluginFieldOptions,
} from "../../api/fields-payload";
import {
  respondAction,
  respondBulk,
  respondCount,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "../../api/response-shapes";
import { assertLocalizationConfigured } from "../../domains/i18n/config/require-app-config";
import { buildCompanionTransitionStatements } from "../../domains/i18n/migration/reconcile-companion";
import {
  companionHasStatusColumn,
  localizedColumnsOnMain,
} from "../../domains/i18n/runtime/companion-io";
import { buildCompanionRuntimeTable } from "../../domains/i18n/runtime/companion-registration";
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
import { PushSchemaPipeline } from "../../domains/schema/pipeline/pushschema-pipeline";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "../../domains/schema/pipeline/pushschema-pipeline-stubs";
import { toRenameCandidateWire } from "../../domains/schema/pipeline/rename-candidate-wire";
import { RegexRenameDetector } from "../../domains/schema/pipeline/rename-detector";
import type { Resolution } from "../../domains/schema/pipeline/resolution/types";
import { isIdempotencyError } from "../../domains/schema/pipeline/sql-statement-utils";
import type { DesiredCollection } from "../../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import { generateRuntimeSchema } from "../../domains/schema/services/runtime-schema-generator";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";
import { NextlyError } from "../../errors";
import {
  applyPluginAdminViews,
  type CollectionWithAdmin,
} from "../../plugins/admin-views";
import { getHandlerConfig } from "../../route-handler/auth-handler";
import { withSessionCacheHeaders } from "../../routeHandler";
import { getProductionNotifier } from "../../runtime/notifications/index";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import {
  getI18nArchiveDdl,
  getI18nArchiveIndexRepairDdl,
} from "../../schemas/nextly-i18n-archive";
import type { ServiceContainer } from "../../services";
import type { WhereFilter } from "../../services/collections/query-operators";
import type { CollectionsHandler } from "../../services/collections-handler";
import {
  isSuperAdmin,
  listEffectivePermissions,
} from "../../services/lib/permissions";
import { SKIP_TIMEZONE_FORMAT_HEADER } from "../../shared/lib/date-formatting";
import {
  readAuthenticatedActor,
  readAuthenticatedScope,
} from "../helpers/authenticated-actor";
import { readAuthenticatedRoles } from "../helpers/authenticated-roles";
import { readAuthenticatedUser } from "../helpers/authenticated-user";
import { buildFullDesiredSchema } from "../helpers/desired-schema";
import {
  getAdapterFromDI,
  getCollectionRegistryFromDI,
  getCollectionsHandlerFromDI,
  getConfigFromDI,
  getMigrationJournalFromDI,
  getSchemaRegistryFromDI,
} from "../helpers/di";
import { readRequestLocalized } from "../helpers/request-localized";
import {
  paginatedResponseToMeta,
  toPaginationMeta,
  unwrapServiceResult,
} from "../helpers/service-envelope";
import {
  isTruthyParam,
  parseRichTextFormat,
  parseSelectParam,
  parseStatusParam,
  parseWhereParam,
  requireBody,
  requireParam,
  stripOwnerColumnsFromWhere,
  toNumber,
} from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

// Shared guard that centralizes required + stale schema-version validation for
// all three entity kinds, so a stale UI save is rejected before any DDL runs.
import { assertSchemaVersionMatch } from "./schema-version-guard";
import {
  discardWorkingDraftForDocument,
  getVersionDiffForDocument,
  getVersionForDocument,
  restoreVersionForDocument,
  listVersionsForDocument,
  setVersionLabelForDocument,
  userFromParams,
  autosaveForDocument,
  getAutosaveForDocument,
  requireSnapshotBody,
} from "./versions-methods";

type CollectionsHandlerType = CollectionsHandler;

// Decides whether the apply payload carries actionable rename hints we
// should log a debug receipt for. Pure helper so tests can pin the
// "non-empty renames map only" semantics without mocking the entire
// applySchemaChanges path.
function shouldLogF14HintReceipt(hints: unknown): boolean {
  if (!hints || typeof hints !== "object") return false;
  const renames = (hints as { renames?: unknown }).renames;
  if (!renames || typeof renames !== "object") return false;
  return Object.keys(renames).length > 0;
}

// Render a per-change-kind summary as a toast-friendly phrase. The
// admin Save handler concatenates this with the collection name like
// "Posts schema updated. 1 field added".
//
// Pure helper. Mirrors the admin-side `formatJournalSummary` from
// `packages/admin/.../formatters.ts` so server-rendered and admin-
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
    parts.push(`${summary.added} field${summary.added === 1 ? "" : "s"} added`);
  }
  if (summary.renamed) parts.push(`${summary.renamed} renamed`);
  if (summary.changed) parts.push(`${summary.changed} changed`);
  if (summary.removed) parts.push(`${summary.removed} removed`);
  return parts.length > 0 ? parts.join(", ") : "no changes";
}

/**
 * Version-history reads for a collection entry.
 *
 * Split out so the dispatcher registration and the auth method set in
 * `routeHandler.ts` stay in step, and so the Single equivalent can mirror it.
 * The shared methods return data; the canonical envelope is applied here.
 */
export const COLLECTION_VERSION_METHODS: Record<
  string,
  MethodHandler<CollectionsHandlerType>
> = {
  listEntryVersions: {
    execute: async (_svc, p) => {
      const result = await listVersionsForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: userFromParams(p),
        authenticatedScope: readAuthenticatedScope(p),
        limit: p.limit !== undefined ? Number(p.limit) : undefined,
        cursor: p.cursor !== undefined ? Number(p.cursor) : undefined,
        locale: p.locale !== undefined ? String(p.locale) : undefined,
      });
      return respondList(result.items, result.meta);
    },
  },
  setEntryVersionLabel: {
    execute: async (_svc, p, body) => {
      const row = await setVersionLabelForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: userFromParams(p),
        versionNo: Number(p.versionNo),
        // Forwarded whole: whether `label` is present is part of what the
        // request means, and the core is what reads it.
        body,
        params: p,
      });
      return respondMutation("Version renamed.", row);
    },
  },
  restoreEntryVersion: {
    execute: async (_svc, p) => {
      const result = await restoreVersionForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: userFromParams(p),
        actor: readAuthenticatedActor(p),
        versionNo: Number(p.versionNo),
        params: p,
      });
      return respondAction("Version restored.", result);
    },
  },
  discardWorkingDraft: {
    execute: async (_svc, p) => {
      const item = await discardWorkingDraftForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: userFromParams(p),
        params: p,
        // `?locale=` names the language whose pending change is being thrown
        // away. An empty value is the same as none: the request named no
        // language, which a localized document resolves to its default.
        locale: typeof p.locale === "string" && p.locale ? p.locale : null,
      });
      return respondMutation("Working draft discarded.", item);
    },
  },
  autosaveEntry: {
    execute: async (_svc, p, body) => {
      const item = await autosaveForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: userFromParams(p),
        params: p,
        // The body IS the snapshot. Its CONTENTS are stored unvalidated,
        // because a recovery point records what the author had and someone
        // part-way through a required field still has work worth not losing.
        // That it is an object at all is a different question, and one a
        // malformed request must be told about rather than being answered with
        // a serialization failure.
        snapshot: requireSnapshotBody(body),
        locale: typeof p.locale === "string" && p.locale ? p.locale : null,
      });
      return respondMutation("Draft recovery point saved.", item);
    },
  },
  getEntryAutosave: {
    execute: async (_svc, p) => {
      const item = await getAutosaveForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: userFromParams(p),
        params: p,
      });
      // Private, never shared. This returns one author's unpublished snapshot
      // under a session cookie, so a shared HTTP cache holding it could serve
      // it to a different authenticated user without authorization running
      // again. Uses the same helper the session-bearing routes in the route
      // handler use rather than restating the header pair.
      // Opaque to the timezone pass. The snapshot is the author's raw form
      // values, so a TEXT field whose literal content happens to look like an
      // ISO timestamp would be shifted by the global rewrite and come back
      // different from what they typed -- a recovery point that does not
      // recover. The row's own metadata is UTC and the client formats it.
      return withSessionCacheHeaders(
        respondDoc(item, {
          headers: { [SKIP_TIMEZONE_FORMAT_HEADER]: "1" },
        })
      );
    },
  },
  getEntryVersion: {
    execute: async (_svc, p) => {
      const row = await getVersionForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: userFromParams(p),
        authenticatedScope: readAuthenticatedScope(p),
        versionNo: Number(p.versionNo),
      });
      return respondDoc(row);
    },
  },
  getEntryVersionDiff: {
    execute: async (_svc, p) => {
      const diff = await getVersionDiffForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: userFromParams(p),
        authenticatedScope: readAuthenticatedScope(p),
        from: Number(p.from),
        to: Number(p.to),
        modifiedOnly: p.modifiedOnly === "1" || p.modifiedOnly === "true",
      });
      return respondDoc(diff);
    },
  },
};

const COLLECTIONS_METHODS: Record<
  string,
  MethodHandler<CollectionsHandlerType>
> = {
  ...COLLECTION_VERSION_METHODS,
  createCollection: {
    // The metadata service returns the legacy CollectionServiceResult
    // envelope; we unwrap it and pass the legacy success message through
    // as the toast string so admin UIs see the same copy ("Collection
    // created! Restart the app...").
    execute: async (svc, _, body) => {
      const created = requireBody<Parameters<typeof svc.createCollection>[0]>(
        body,
        "Collection data is required"
      );
      // Metadata generation validates field names and shapes downstream, but
      // it has no way to judge a plugin type's own options, so a declaration no
      // value could satisfy would reach the registry and fail per write.
      const createdFields = (created as { fields?: unknown }).fields;
      if (createdFields !== undefined) {
        assertValidPluginFieldOptions(createdFields);
      }
      const result = await svc.createCollection(created);
      const collection = unwrapServiceResult(result);
      return respondMutation(
        result.message ?? "Collection created.",
        collection,
        { status: 201 }
      );
    },
  },
  listCollections: {
    // Translates the legacy CollectionServiceResult `{ data, meta }`
    // envelope to the canonical `{ items, meta }` body. Permission
    // filtering (non-super-admins only see collections they can read)
    // runs after unwrap so the meta we ship reflects the FILTERED
    // counts, not the pre-filter totals.
    execute: async (svc, p) => {
      const result = await svc.listCollections({
        page: toNumber(p.page),
        limit: toNumber(p.limit),
        search: p.search,
        sortBy: p.sortBy as
          | "name"
          | "slug"
          | "createdAt"
          | "updatedAt"
          | undefined,
        sortOrder: p.sortOrder as "asc" | "desc" | undefined,
      });
      // Service returns legacy { success, data, meta }. Unwrap throws on
      // failure (which the dispatcher converts to a NextlyError response).
      const data = unwrapServiceResult<unknown>(result);
      const items = Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : [];

      // Service meta uses limit/total/totalPages; toPaginationMeta below
      // adds the canonical hasNext/hasPrev fields.
      const serviceMeta = result.meta;
      const baseMeta = {
        total:
          typeof serviceMeta?.total === "number"
            ? serviceMeta.total
            : items.length,
        page: typeof serviceMeta?.page === "number" ? serviceMeta.page : 1,
        limit:
          typeof serviceMeta?.limit === "number"
            ? serviceMeta.limit
            : items.length,
        totalPages:
          typeof serviceMeta?.totalPages === "number"
            ? serviceMeta.totalPages
            : 1,
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
    // Bare doc body (no { data } wrapper).
    execute: async (svc, p) => {
      requireParam(p, "collectionName");
      const result = await svc.getCollection({
        collectionName: p.collectionName,
      });
      const collection = unwrapServiceResult(result, {
        slug: p.collectionName,
      });
      // Fold plugin view overrides (contributes.admin.views, D23) onto the
      // collection so the list page's injection slots resolve. Collection slots
      // win; plugin fills empties (see applyPluginAdminViews).
      const config = getHandlerConfig();
      const [collectionWithViews] = applyPluginAdminViews(
        [collection as CollectionWithAdmin],
        config?.plugins ?? []
      );
      return respondDoc(collectionWithViews as unknown);
    },
  },
  updateCollection: {
    // Pass the legacy success message through so existing toast copy
    // ("Collection updated successfully") is preserved.
    execute: async (svc, p, body) => {
      if (!p.collectionName || !body)
        throw new Error("collectionName and update data are required");
      const updatedFields = (body as { fields?: unknown }).fields;
      if (updatedFields !== undefined) {
        assertValidPluginFieldOptions(updatedFields);
      }
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
    // The deleted record is the `item`.
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
      // Pipeline preview plus legacy-shape translator. The translator
      // emits the legacy 3-option resolution set so the admin
      // SchemaChangeDialog renders unchanged. Future work tracks the
      // dialog upgrade to consume ClassifierEvent[] directly (and reach
      // the 4th `delete_nonconforming` option that the pipeline emits
      // but the legacy shape can't carry).
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
      const previewLocalized = readRequestLocalized(body);
      // Same rules as the ui-schema.json mirror (see api/fields-payload):
      // an invalid field must fail HERE, not only at the file write, or
      // the DB and the committed manifest diverge silently.
      assertValidFieldsPayload(fields, { kind: "collection" });
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
        // Carry the Draft/Published flag so previewDesiredSchema injects
        // the `status` column into the desired snapshot.
        status: collection.status === true,
        // i18n: carry the localized flag so the push diff OMITS translatable
        // columns from the main table's desired snapshot (they live in the
        // companion `_locales` table). buildFullDesiredSchema already sets this
        // from the registry, but the splice above overwrites that entry, so we
        // must re-supply it or the preview would show translatable columns being
        // added to the main table. The REQUEST's flag wins when the Builder
        // sent one: the apply prefers it too, and a preview that diffed against
        // the persisted flag instead would collect resolutions for DDL the
        // apply is not going to run.
        localized:
          previewLocalized ??
          (collection as { localized?: boolean }).localized === true,
        // Authored in the Schema Builder: this is the Builder's own save path.
        builderOwned: true,
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
      // (the pipeline already detected them).
      const renamed = pipelinePreview.candidates.map(toRenameCandidateWire);

      // previewSchemaChanges returns a custom preview payload
      // (legacyShape plus renamed plus schemaVersion) with no CRUD
      // analog. We spread legacyShape into a new object so the resulting
      // body has at least the renamed/schemaVersion fields, never empty.
      // Cast through `unknown` because SchemaPreviewResult is a sealed
      // shape with no string index signature; respondData's generic
      // requires a Record<string, unknown> for spread compatibility.
      const legacyAsRecord = legacyShape as unknown as Record<string, unknown>;
      return respondData({
        ...legacyAsRecord,
        renamed,
        // Normalize legacy rows (schema_version NULL) to 1 so the editor always
        // receives a concrete version to echo back on apply; otherwise JSON
        // omits an undefined value and the guard rejects the first save as
        // version-less. Mirrors the single-dispatcher preview.
        schemaVersion: collection.schemaVersion ?? 1,
      });
    },
  },
  // Apply confirmed schema changes via the in-process schema service.
  //
  // Single-process model: drizzle-kit's payload/* entrypoints are loaded lazily via
  // drizzle-kit-lazy.ts (webpackIgnore + turbopackIgnore magic comments
  // keep it out of the handler bundle), so DDL runs cleanly in the same
  // process serving requests.
  //
  // bumpSchemaVersion is called directly here after a successful
  // pipeline apply.
  applySchemaChanges: {
    execute: async (_svc, p, body) => {
      requireParam(p, "collectionName");
      // Registry alone is sufficient as the DI-readiness probe; the
      // schema-change service is no longer consulted on the apply path.
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
        // i18n: the request's Internationalization flag is read through
        // `readRequestLocalized` below rather than destructured here, so a
        // non-boolean is rejected instead of silently coerced.
        localized?: boolean;
        // Legacy admin UI shape (per-field, used by the old
        // SchemaChangeService path). Kept alive while admin dialogs
        // still send it.
        resolutions?: Record<string, FieldResolution>;
        renameResolutions?: BrowserRenameResolution[];
        // Typed Resolution[] from the new pipeline contract. Optional:
        // admin UIs that haven't been upgraded send only the legacy
        // `resolutions` map and the new pipeline emits no events until
        // the UI is updated to consume ClassifierEvents from preview.
        eventResolutions?: Resolution[];
        // RESERVED FIELD: accepted and IGNORED in the current version.
        // A future revision will implement client-side rename hint
        // tracking plus server-side auto-confirm so the
        // SchemaChangeDialog stops asking the admin to re-confirm
        // renames they already clicked once. Reserved so the future
        // version can ship as a pure additive change without breaking
        // older admin clients.
        // See plans/specs/F10-notifications-and-audit-design.md §6.6.
        hints?: {
          renames?: Record<string, string>;
        };
      };
      if (!confirmed) {
        throw new Error("Schema changes must be confirmed");
      }
      if (!fields) throw new Error("fields is required in request body");
      // Same rules as the ui-schema.json mirror (see api/fields-payload):
      // an invalid field must fail HERE, not only at the file write, or
      // the DB and the committed manifest diverge silently.
      assertValidFieldsPayload(fields, { kind: "collection" });

      // Log a debug line when hints arrive so we can track adoption
      // without surprising operators with errors. The current version
      // ignores the field entirely.
      if (shouldLogF14HintReceipt(hints)) {
        console.debug?.(
          `[F14] hints received but not processed; see plans/specs/F10-notifications-and-audit-design.md §6.6`
        );
      }

      // Default legacy rows (schema_version NULL) to 1 so a first save is not
      // rejected as version-less. The registry types schemaVersion as `number`
      // via a type assertion, but the DB column is nullable, so the value can
      // be null at runtime; singles/components apply the same `?? 1` fallback.
      const currentVersion = collection.schemaVersion ?? 1;
      // Reject a stale or version-less UI save before any DDL runs. The shared
      // guard gives all three entity kinds (collections, singles, components)
      // one optimistic-lock behavior and one error surface.
      assertSchemaVersionMatch(schemaVersion, currentVersion, p.collectionName);
      const tableName = collection.tableName;

      // i18n: prefer the request's localized flag over the persisted one, so a simultaneous
      // toggle+field-change save applies with the NEW state (the persisted flag is only written
      // after this apply). `wasLocalized` drives enable/disable detection for the companion.
      const wasLocalized =
        (collection as { localized?: boolean }).localized === true;
      // Validated rather than coerced: `localized: "false"` would read as
      // `false` under `=== true` and turn an ordinary save of a localized
      // collection into a DISABLE transition, restoring the companion's
      // columns onto the main table and archiving it.
      const isLocalized = readRequestLocalized(body) ?? wasLocalized;
      // i18n: enabling Internationalization needs the app-level
      // `localization` config — without it the companion reconcile below
      // would move translatable columns into a table the runtime cannot
      // address. Gate the false→true transition only.
      if (!wasLocalized && isLocalized) {
        assertLocalizationConfigured("collection", p.collectionName);
      }

      // Legacy per-field resolutions get translated to typed
      // Resolution[] inside BrowserPromptDispatcher.dispatch() once the
      // pipeline emits events. Until admin dialogs ship the new
      // `eventResolutions` contract, this translator keeps existing UIs
      // working end-to-end through the pipeline.
      const legacyBundle = resolutions
        ? { tableName, byFieldName: resolutions }
        : undefined;

      // Route through the PushSchemaPipeline. Build the FULL
      // DesiredSchema (collections + singles + components) so
      // drizzle-kit sees every managed table. Without this, tables
      // of other entity types in the live DB are absent from the
      // desired snapshot and drizzle-kit offers them as rename
      // candidates for the new collection being saved.
      const desired = await buildFullDesiredSchema();

      // Splice in the user's changes for THIS collection (overwrites
      // any registry entry for the same slug).
      desired.collections[p.collectionName] = {
        slug: p.collectionName,
        tableName,
        fields: fields as DesiredCollection["fields"],
        // Mirror previewSchemaChanges so apply diffs against the same
        // desired schema preview classified.
        status: collection.status === true,
        // i18n: carry the localized flag so the push diff omits translatable
        // columns from the main table (they live in the companion `_locales`
        // table, provisioned separately below). Uses the request's flag so a
        // toggle applies immediately; without this the apply re-adds translatable
        // columns to the main table.
        localized: isLocalized,
        // Authored in the Schema Builder: this is the Builder's own save path.
        builderOwned: true,
      };

      // Resolve adapter for the pipeline construction.
      const adapter = getAdapterFromDI();
      if (!adapter) {
        throw new Error("Database adapter not initialized");
      }
      // `dialect` is an abstract readonly property on DrizzleAdapter,
      // not a method. Calling `.getDialect()` would crash at runtime.
      const dialect = adapter.dialect;
      const db = adapter.getDrizzle();
      const databaseName =
        dialect === "mysql"
          ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
          : undefined;

      // Per-call factory (not the DI-bound applyDesiredSchema in
      // pipeline/index.ts) so we can thread MySQL databaseName plus the
      // resolved adapter into the PushSchemaPipeline at this site.
      //
      // BrowserPromptDispatcher takes pre-attached rename resolutions
      // from the request body (collected by the admin SchemaChangeDialog
      // before save) and translates them into confirmedRenames inside
      // the pipeline's Phase B. No SSE, no mid-apply prompts; the dialog
      // is the prompt UX.
      const promptDispatcher = new BrowserPromptDispatcher(
        renameResolutions ?? [],
        eventResolutions ?? [],
        legacyBundle
      );
      const apply = createApplyDesiredSchema({
        applyPipeline: (desiredArg, sourceArg, channelArg) => {
          // Real classifier and real pre-cleanup executor wired at the
          // UI-first save path. Admin SchemaChangeDialog still sends the
          // legacy `resolutions` map; the pipeline ALSO emits typed
          // events that admin UIs can opt into via `eventResolutions`
          // (Resolution[]) once the dialog is updated.
          // Real journal from DI (with noop fallback so tests that
          // bypass DI keep working).
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
            // Admin-save applies print a terminal box and write the
            // NDJSON line. Same singleton across UI saves.
            notifier: getProductionNotifier(),
          });
          return pipeline.apply({
            desired: desiredArg,
            db,
            dialect,
            source: sourceArg,
            promptChannel: channelArg,
            databaseName,
            // Tag the journal row with the collection slug the user is
            // editing so the admin NotificationCenter can render "Posts
            // schema updated" instead of generic "global".
            uiTargetSlug: p.collectionName,
            // Stated rather than relying on the default, so the default stops being load-bearing.
            uiTargetKind: "collection" as const,
          });
        },
        // The optimistic-lock check now runs up front via
        // assertSchemaVersionMatch, so no schemaVersions are passed below and
        // this callback is unused; it is retained to satisfy the deps contract.
        readSchemaVersionForSlug: (slug: string) =>
          Promise.resolve(slug === p.collectionName ? currentVersion : null),
        // Read post-apply versions for the saved slug from the registry.
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

      const result = await apply(desired, "ui", {
        promptChannel: "auto",
      });

      if (!result.success) {
        // The stale-version case is already rejected up front by
        // assertSchemaVersionMatch, so any failure here is a real apply error.
        throw new Error(result.error.message);
      }

      // i18n: the push pipeline deliberately EXCLUDES companion `_locales`
      // tables from its diff (managed-tables `isCompanionTable`) — they are
      // owned by the localization layer, not drizzle-kit. So we reconcile the
      // companion out-of-band here for any localization change: enabling seeds
      // the companion default locale from the existing main columns then drops
      // them, disabling restores + archives them, and a field change ADD/DROPs
      // localized columns. Without this, a localized collection edited in the
      // builder has its translatable columns omitted from main (correct) but
      // NOWHERE to store per-language values. Runs in-process (no migration file).
      if (wasLocalized || isLocalized) {
        try {
          const oldFields = (collection.fields ??
            []) as unknown as FieldDefinition[];
          const newFields = fields as unknown as FieldDefinition[];
          const defaultLocale =
            getConfigFromDI()?.localization?.defaultLocale ?? "en";
          const companionExists = await adapter.tableExists(
            `${tableName}_locales`
          );
          const companionHasStatus =
            companionExists && wasLocalized && isLocalized
              ? await companionHasStatusColumn(adapter, `${tableName}_locales`)
              : undefined;
          const plan = buildCompanionTransitionStatements({
            // The companion mirrors the main table, and a collection's table comes from the Schema Builder's collection creator.
            builtBy: "collection" as const,
            slug: p.collectionName,
            tableName,
            dialect,
            defaultLocale,
            status: collection.status === true,
            wasLocalized,
            isLocalized,
            // The PERSISTED status, which is what the disable restore needs: it decides whether
            // main carried `status` and the companion `_status` before this apply. `collection`
            // here is the registry record, so this is the prior state for the same reason
            // `wasLocalized` above is.
            wasStatus: collection.status === true,
            oldFields,
            newFields,
            companionExists,
            companionHasStatus,
            // Which translatable columns the main table still carries. A disable must not re-add
            // one that is already there, and must still restore it: presence says the column
            // exists, never that its value is current, because every localized write went to the
            // companion alone.
            existingMainColumns: await localizedColumnsOnMain(
              adapter,
              tableName,
              oldFields
            ).then(cols => cols.map(c => c.name)),
          });
          // A disable archives non-default translations, so ensure the archive
          // table exists first. Run each statement individually (executeQuery is
          // single-statement on some drivers, e.g. sqlite).
          if (plan.needsArchive) {
            for (const stmt of getI18nArchiveDdl(dialect)) {
              await adapter.executeQuery(stmt);
            }
            // MySQL's table DDL cannot restore an index the table is missing, and
            // index-only drift produces no reconcile operations, so the repair runs
            // here. Tolerated rather than checked first: attempting it and accepting
            // "duplicate key name" is one round trip instead of two, and the same
            // tolerance the schema executor already applies.
            const indexRepair = getI18nArchiveIndexRepairDdl(dialect);
            if (indexRepair) {
              try {
                await adapter.executeQuery(indexRepair);
              } catch (err) {
                if (!isIdempotencyError(err)) throw err;
              }
            }
          }
          // 🔴 STRICT on purpose, matching the other two companion paths: tolerating a re-run
          // would make a half-finished localization ENABLE look like success, because the planner
          // cannot tell that state from an orphan repair. A loud failure is the safer outcome.
          for (const stmt of plan.statements) {
            await adapter.executeQuery(stmt);
          }

          // The transition record describes a companion that no longer exists, so it stops being true
          // the moment the disable succeeds. Left behind, it would refuse the next enable's real
          // source locale — the check that protects a live transition would block a legitimate one.
          if (plan.companionDropped) {
            // The other half of "this companion is gone": readiness remembers only that one
            // exists.
            const { forgetCompanionReadiness } = await import(
              "../../domains/i18n/runtime/companion-readiness"
            );
            forgetCompanionReadiness(adapter, `${tableName}_locales`);
            const { resolveTransitionStore } = await import(
              "../../domains/i18n/migration/transition-recorder"
            );
            const { forgetI18nTransition } = await import(
              "../../domains/i18n/migration/transition-state"
            );
            await forgetI18nTransition(
              await resolveTransitionStore(adapter),
              "collection",
              String(p.collectionName)
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Fatal to correctness (translatable values have nowhere to live), but
          // the main-table apply already committed — surface loudly rather than
          // silently leaving the collection half-migrated.
          throw NextlyError.internal({
            cause: err instanceof Error ? err : undefined,
            logContext: {
              op: "companionReconcile",
              collection: p.collectionName,
              detail: msg,
              note: "main table updated but localized companion out of sync; re-apply to retry",
            },
          });
        }
      }

      // pipeline.apply mutates the live DB (renamed/added/dropped
      // columns) but does NOT persist the updated `fields` JSON on
      // `dynamic_collections`. Without this post-apply write, subsequent
      // admin queries (entry list, entry create form, etc.) build their
      // column references from the STALE metadata and fail with `no
      // such column: <oldName>`. End-user symptom: rename succeeds in
      // the DB but the collection looks empty in the admin UI because
      // every list query 500s.
      //
      // Use `adapter.update` directly (not `registry.updateCollection`)
      // because the registry helper resets `migration_status` to `"pending"`
      // on any `fields` change, which is wrong here (the migration is now
      // `applied`). Advance `schema_version` in this same write so the
      // optimistic-lock check above sees a new value on the next save;
      // nothing else persists it, so without this bump the stored version
      // never changes and a second stale save would pass the guard. The
      // write is non-fatal (the DDL already succeeded), but track whether it
      // landed so the response never reports a version the DB did not persist.
      const newSchemaVersion = currentVersion + 1;
      let versionPersisted = true;
      try {
        await adapter.update(
          "dynamic_collections",
          {
            fields: JSON.stringify(fields),
            schema_version: newSchemaVersion,
            // i18n: persist the state this apply actually ran with (mirrors
            // the singles apply). The DDL above already performed any
            // false→true transition, so leaving the stored flag behind would
            // make the settings write that follows read another false→true
            // transition and reconcile the companion a second time.
            localized: isLocalized,
            updated_at: new Date(),
          },
          { and: [{ column: "slug", op: "=", value: p.collectionName }] }
        );
      } catch (err) {
        versionPersisted = false;
        const msg = err instanceof Error ? err.message : String(err);
        // A localization TRANSITION that reaches this point has already moved
        // the translatable columns between the main table and the companion.
        // The stored flag is what every later process reads to decide which
        // of those two tables a translatable field lives in, so failing to
        // store it does not leave a cosmetic gap — it leaves the registry
        // describing a layout the database no longer has, and the next boot
        // generates runtime schemas against the wrong table. That is the same
        // half-migrated state the companion reconcile above refuses to return
        // success for, so it is refused the same way.
        if (wasLocalized !== isLocalized) {
          throw NextlyError.internal({
            cause: err instanceof Error ? err : undefined,
            logContext: {
              op: "persistLocalizedFlag",
              collection: p.collectionName,
              detail: msg,
              wasLocalized,
              isLocalized,
              note: "columns moved but dynamic_collections.localized was not updated; re-apply to retry",
            },
          });
        }
        // Otherwise non-fatal: the schema apply itself already succeeded. If
        // the metadata write fails, the actual DB column was already
        // renamed and the collection is in a good state structurally;
        // only the admin's view of the field name is stale, and the version
        // was not advanced (the response reports the current version so a
        // retry re-attempts the bump). Log so an operator can diagnose.
        console.warn(
          `[applySchemaChanges] Post-apply metadata write failed for ` +
            `'${p.collectionName}': ${msg}. Live DB schema is correct ` +
            `but admin UI may show stale field names until next reload.`
        );
      }

      // After a schema apply (rename, add, drop) two independent in-memory
      // caches hold Drizzle table objects that are now stale:
      //
      //   1. CollectionFileManager.schemaRegistry: used by query-service
      //      SELECT / JOIN builders (loadDynamicSchema path).
      //   2. SchemaRegistry.dynamicSchemas: used by adapter.insert /
      //      update / delete / select (getTableObject path).
      //
      // Both must be refreshed with the same freshly-generated table built
      // from the apply payload's `fields`. Replacing in-place (rather than
      // invalidate + lazy-rebuild) avoids the race where a concurrent
      // request could arrive between the invalidation and the DB write of
      // the new `dynamic_collections.fields`, picking up the stale schema.
      try {
        // i18n: thread `localized`/`status` so the refreshed MAIN runtime table
        // omits translatable columns (kept in lockstep with the desired snapshot
        // above), then register the companion `_locales` runtime table too so
        // per-language reads/writes resolve in THIS process without a restart.
        const { table: freshTable } = generateRuntimeSchema(
          tableName,
          fields as FieldDefinition[],
          dialect,
          { localized: isLocalized, status: collection.status === true }
        );
        getCollectionsHandlerFromDI()?.refreshCollectionSchema(
          tableName,
          freshTable
        );
        getSchemaRegistryFromDI()?.registerDynamicSchema(tableName, freshTable);
        if (isLocalized) {
          const companion = buildCompanionRuntimeTable({
            slug: p.collectionName,
            tableName,
            fields: fields as FieldDefinition[],
            dialect,
            localized: true,
            status: collection.status === true,
          });
          if (companion) {
            getCollectionsHandlerFromDI()?.refreshCollectionSchema(
              companion.companionTableName,
              companion.table
            );
            getSchemaRegistryFromDI()?.registerDynamicSchema(
              companion.companionTableName,
              companion.table
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[applySchemaChanges] In-memory schema refresh failed for ` +
            `'${p.collectionName}': ${msg}. Entry queries may reference ` +
            `old column names until next server restart.`
        );
      }

      // The dispatcher fires bumpSchemaVersion directly after a
      // successful pipeline apply. The bump only matters for UI-first
      // applies (sets the X-Schema-Version response header so admin tabs
      // know to refetch); HMR and boot paths don't need it.
      try {
        const { bumpSchemaVersion } = await import("../../routeHandler");
        bumpSchemaVersion();
      } catch {
        // routeHandler may be unavailable in non-server contexts (tests).
      }

      // applySchemaChanges is a non-CRUD mutation: there's no "item" to
      // surface. The action result carries the new schema version (so
      // the admin can update its X-Schema-Version header probe) and a
      // toast summary string. toastSummary may be undefined when the
      // pipeline didn't emit diff counts; the conditional spread drops
      // undefined fields silently.
      return respondAction(`Schema applied for '${p.collectionName}'`, {
        newSchemaVersion: versionPersisted ? newSchemaVersion : currentVersion,
        ...(result.summary
          ? { toastSummary: formatToastSummary(result.summary) }
          : {}),
      });
    },
  },
  listEntries: {
    // The entry-query service wraps a PaginatedResponse
    // (`{ docs, totalDocs, limit, page, totalPages, hasNextPage,
    // hasPrevPage, ... }`) in CollectionServiceResult; we unwrap it and
    // translate to canonical PaginationMeta via paginatedResponseToMeta.
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

      // Forward the `?status=` URL param. Absent → undefined so the query
      // service applies its published-only default (an untrusted list read must
      // not leak drafts); pass `?status=all|draft|published` to widen. An
      // invalid value is rejected with 400 rather than silently widened. The
      // status dropdown in the entry table layers a `where: {status: {equals}}`
      // on top of this, which still works because where-narrowing happens after
      // the default filter.
      const status = parseStatusParam(p.status);

      // Forward the caller so the service evaluates the collection's stored
      // read rules for them: role-based rules, and owner-only scoping folded
      // into the SQL predicate. Without a user the service can only apply the
      // rule-less default, so an admin-configured "owner-only read" silently
      // returned every row over HTTP. `routeAuthorized` attests that the route
      // already ran the coarse RBAC gate, so only that re-check is skipped:
      // stored rules still run (mirrors the write paths and singles).
      const user = readAuthenticatedUser(p);

      const result = await svc.listEntries({
        collectionName: p.collectionName,
        user,
        routeAuthorized: !!user,
        // A scoped API key is judged on its own read grant rather than on the
        // permissions of the user that owns it, so a super-admin-owned key
        // cannot read past its scope by inheriting the session bypass.
        authenticatedScope: readAuthenticatedScope(p),
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
        status,
        // i18n M4: `?locale=` + `?fallback-locale=` select the content language.
        locale: p.locale,
        fallbackLocale: p["fallback-locale"],
        // i18n M7: `?translation-status=1` attaches the per-locale `_translations` overview map.
        translationStatus: isTruthyParam(p["translation-status"]),
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
    // Wire shape canonicalises on `{ total }`. Service still returns
    // `{ totalDocs }` internally; we translate at the boundary.
    execute: async (svc, p) => {
      requireParam(p, "collectionName");
      // Match listEntries: absent → undefined so the service applies its
      // published-only default; pass `?status=all|draft|published` to widen,
      // invalid → 400. A count must obey the same filter as the list or the
      // total would not match the rows returned.
      const status = parseStatusParam(p.status);
      // The same caller context listEntries forwards. A count that ignored the
      // read rules while the list obeyed them would report totals for rows the
      // caller cannot see, which both leaks how much data exists and breaks
      // pagination in the UI.
      const user = readAuthenticatedUser(p);

      const result = await svc.countEntries({
        collectionName: p.collectionName,
        user,
        routeAuthorized: !!user,
        // Same scope judgement as listEntries: a count that ignored the key's
        // own grant would disclose how many rows exist beyond it.
        authenticatedScope: readAuthenticatedScope(p),
        search: p.search,
        where: parseWhereParam(p.where),
        status,
        // i18n M4: keep count in parity with listEntries' locale-scoped filtering.
        locale: p.locale,
        fallbackLocale: p["fallback-locale"],
      });
      const data = unwrapServiceResult<{ totalDocs: number }>(result, {
        collectionName: p.collectionName,
      });
      return respondCount(data.totalDocs);
    },
  },
  createEntry: {
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
          // i18n M5: `?locale=de` stores the translatable values for German.
          locale: p.locale,
          userRoles: readAuthenticatedRoles(p),
          // Who performed the write, recorded on the outbox event.
          actor: readAuthenticatedActor(p),
          // Route middleware already ran the RBAC/code-access gate; attest it
          // so the handler skips only that redundant re-check (stored rules +
          // field-level write access still run). Never inferred from userId.
          routeAuthorized: true,
          // The route authorized only `create` against an API key's scope; a
          // create-as-published publish gate judges the key's own grants.
          authenticatedScope: readAuthenticatedScope(p),
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
    execute: async (svc, p) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      // Absent → undefined so the service applies its published-only default;
      // pass `?status=all|draft|published` to widen, invalid → 400. Matches
      // listEntries.
      const status = parseStatusParam(p.status);
      // Same caller context as listEntries. Fetching one document by id is the
      // path where a missing user matters most: without it an owner-only rule
      // could not deny a direct read of someone else's entry.
      const user = readAuthenticatedUser(p);

      const result = await svc.getEntry({
        collectionName: p.collectionName,
        entryId: p.entryId,
        user,
        routeAuthorized: !!user,
        // A scoped API key is judged on its own read grant rather than on the
        // permissions of the user that owns it, matching listEntries, countEntries
        // and the publish gate.
        authenticatedScope: readAuthenticatedScope(p),
        depth:
          p.depth !== undefined ? parseInt(String(p.depth), 10) : undefined,
        select: parseSelectParam(p.select),
        richTextFormat: parseRichTextFormat(p.richTextFormat),
        status,
        // `?draft=true` overlays the pending working draft in place of the live
        // row (draft/published split), matching Payload's read-side `draft`
        // parameter. The service gates it on an update-capability probe, so a
        // read-only caller passing it still receives the published row.
        includeWorkingDraft: isTruthyParam(p.draft),
        // i18n M4: `?locale=` selects the content language; `?fallback-locale=none`
        // disables fallback. Non-localized collections ignore both.
        locale: p.locale,
        fallbackLocale: p["fallback-locale"],
        // i18n M7: `?translation-status=1` attaches the per-locale `_translations` overview map.
        translationStatus: isTruthyParam(p["translation-status"]),
      });
      const entry = unwrapServiceResult(result, {
        collectionName: p.collectionName,
        entryId: p.entryId,
      });
      return respondDoc(entry);
    },
  },
  updateEntry: {
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
          // i18n M5: `?locale=de` updates only the German translatable values.
          locale: p.locale,
          userRoles: readAuthenticatedRoles(p),
          // Who performed the write, recorded on the outbox event.
          actor: readAuthenticatedActor(p),
          // Route middleware already ran the RBAC/code-access gate; attest it
          // so the handler skips only that redundant re-check (stored rules +
          // field-level write access still run). Never inferred from userId.
          routeAuthorized: true,
          // The route authorized only `update` against an API key's scope; the
          // service-side publish/unpublish gate judges the key's own grants.
          authenticatedScope: readAuthenticatedScope(p),
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
  publishAllLocales: {
    // i18n M7: publish every language of an entry at once (spec §10).
    execute: async (svc, p) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      const result = await svc.publishAllLocales({
        collectionName: p.collectionName,
        entryId: p.entryId,
        actor: readAuthenticatedActor(p),
        userId: p._authenticatedUserId
          ? String(p._authenticatedUserId)
          : undefined,
        userName: p._authenticatedUserName
          ? String(p._authenticatedUserName)
          : undefined,
        userEmail: p._authenticatedUserEmail
          ? String(p._authenticatedUserEmail)
          : undefined,
        // Forward the authenticated role set so role-based access and stored
        // rules evaluate against the real user (parity with the update handler);
        // without it publish-all could be denied for a user the route authorized.
        userRoles: readAuthenticatedRoles(p),
        // Route middleware already ran the RBAC/code-access gate; attest it so
        // the handler skips only that redundant re-check (stored rules +
        // field-level write access still run). Never inferred from userId.
        routeAuthorized: true,
        // The route authorized this POST as `update`; the publish check judges a
        // scoped API key's own `publish-<slug>` grant.
        authenticatedScope: readAuthenticatedScope(p),
      });
      const entry = unwrapServiceResult(result, {
        collectionName: p.collectionName,
        entryId: p.entryId,
      });
      return respondMutation(
        result.message ?? "All languages published.",
        entry
      );
    },
  },
  unpublishAllLocales: {
    // The takedown twin of `publishAllLocales`. Built through the mutation
    // service, entry service and handler with the same parameters, and until now
    // reachable by nothing — an editor who could publish every language at once
    // had no way to take them back down.
    execute: async (svc, p) => {
      // Guarded through `requireParam` rather than an inline throw. A missing
      // route parameter is caller-fixable, and the shared helper is where this
      // package states that refusal — a bare `Error` here would surface it as a
      // 500 and would add an exemption to the bare-Error allowlist for a case
      // the helper already covers.
      const collectionName = requireParam(p, "collectionName");
      const entryId = requireParam(p, "entryId");
      const result = await svc.unpublishAllLocales({
        collectionName,
        entryId,
        actor: readAuthenticatedActor(p),
        userId: p._authenticatedUserId
          ? String(p._authenticatedUserId)
          : undefined,
        userName: p._authenticatedUserName
          ? String(p._authenticatedUserName)
          : undefined,
        userEmail: p._authenticatedUserEmail
          ? String(p._authenticatedUserEmail)
          : undefined,
        // Forwarded for the same reason the publish direction forwards them:
        // role-based access and stored rules must evaluate against the real
        // user, or a takedown is denied for someone the route authorized.
        userRoles: readAuthenticatedRoles(p),
        // Route middleware already ran the RBAC/code-access gate; attesting it
        // skips only that redundant re-check. Stored rules and field-level write
        // access still run. Never inferred from userId.
        routeAuthorized: true,
        // The route authorized this POST as `update`; the unpublish check judges
        // a scoped API key's own grant.
        authenticatedScope: readAuthenticatedScope(p),
      });
      const entry = unwrapServiceResult(result, {
        collectionName,
        entryId,
      });
      return respondMutation(
        result.message ?? "All languages unpublished.",
        entry
      );
    },
  },
  deleteEntry: {
    // The deleted record is the `item`.
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
        userRoles: readAuthenticatedRoles(p),
        // Who performed the delete (user vs API key), recorded on the
        // `entry.deleted` outbox event — same attribution as create/update.
        actor: readAuthenticatedActor(p),
        // Route middleware already ran the RBAC/code-access gate; attest it so
        // the handler skips only that redundant re-check (stored rules +
        // field-level write access still run). Never inferred from userId.
        routeAuthorized: true,
        // The route authorized `delete` against the key's scope; carry the scope
        // so a super-admin-owned key's delete is judged on the key's OWN grant
        // and does not skip stored owner/role delete rules.
        authenticatedScope: readAuthenticatedScope(p),
      });
      const entry = unwrapServiceResult(result, {
        collectionName: p.collectionName,
        entryId: p.entryId,
      });
      return respondMutation(result.message ?? "Entry deleted.", entry);
    },
  },
  // Bulk delete by ids. Service returns BulkOperationResult with
  // structured per-item failures; the dispatcher hands successes plus
  // failures straight to respondBulk. HTTP 200 for partial success
  // (per-item failures are first-class data in the body's `errors`
  // array, not server errors).
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
        userRoles: readAuthenticatedRoles(p),
        // Who performed the bulk delete (user vs API key), recorded on each
        // entry's `entry.deleted` event — same attribution as single delete.
        actor: readAuthenticatedActor(p),
        // Route middleware already ran the RBAC/code-access gate; attest it so
        // the handler skips only that redundant re-check (stored rules +
        // field-level write access still run). Never inferred from userId.
        routeAuthorized: true,
        // Carry the key's scope so each per-id delete is judged on the key's OWN
        // grant, not the key owner's super-admin roles.
        authenticatedScope: readAuthenticatedScope(p),
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
  // Bulk update by ids. Successes carry full mutated records so the
  // admin client can refresh its cache without a re-fetch.
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
        actor: readAuthenticatedActor(p),
        userId: p._authenticatedUserId
          ? String(p._authenticatedUserId)
          : undefined,
        userName: p._authenticatedUserName
          ? String(p._authenticatedUserName)
          : undefined,
        userEmail: p._authenticatedUserEmail
          ? String(p._authenticatedUserEmail)
          : undefined,
        userRoles: readAuthenticatedRoles(p),
        // Route middleware already ran the RBAC/code-access gate; attest it so
        // the handler skips only that redundant re-check (stored rules +
        // field-level write access still run). Never inferred from userId.
        routeAuthorized: true,
        // The route authorized `update` against the key's scope, never
        // publish/unpublish — carry the scope so each per-id transition is
        // judged on the key's OWN grants.
        authenticatedScope: readAuthenticatedScope(p),
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
  // Bulk update by query. The service throws NextlyError on
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
      // Forward the authenticated identity so per-entry updates run as this
      // user (hooks get a user) and the response is redacted to what they may
      // read. Without it the query-based bulk update ran anonymously, unlike
      // the id-based bulkUpdateEntries path which already resolves the user.
      const result = await svc.bulkUpdateByQuery(
        {
          collectionName: p.collectionName,
          // Strip owner-column conditions from the request body so a caller
          // cannot target rows by the system owner column via `body.where`
          // (mirrors parseWhereParam on the query-string path). The service's
          // own owner constraint is added separately and is unaffected; a where
          // that was only an owner filter becomes {} and stays bounded by the
          // collection's access rules.
          where: stripOwnerColumnsFromWhere(b.where as WhereFilter) ?? {},
          data: b.data,
          actor: readAuthenticatedActor(p),
          userId: p._authenticatedUserId
            ? String(p._authenticatedUserId)
            : undefined,
          userName: p._authenticatedUserName
            ? String(p._authenticatedUserName)
            : undefined,
          userEmail: p._authenticatedUserEmail
            ? String(p._authenticatedUserEmail)
            : undefined,
          userRoles: readAuthenticatedRoles(p),
          // Route middleware already ran the RBAC/code-access gate; attest it
          // so the handler skips only that redundant re-check (stored rules +
          // field-level write access still run). Never inferred from userId.
          routeAuthorized: true,
          // The route authorized `update` against the key's scope, never
          // publish/unpublish — carry the scope so the collection-level gate and
          // each per-row transition are judged on the key's OWN grants.
          authenticatedScope: readAuthenticatedScope(p),
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
    // duplicateEntry is fundamentally a create: it produces a new row.
    // The bulk-service implementation delegates to
    // mutationService.createEntry which already returns statusCode 201,
    // so the wire status matches end-to-end.
    execute: async (svc, p, body) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      const b = body as { overrides?: Record<string, unknown> } | undefined;
      const result = await svc.duplicateEntry({
        collectionName: p.collectionName,
        entryId: p.entryId,
        overrides: b?.overrides,
        actor: readAuthenticatedActor(p),
        userId: p._authenticatedUserId
          ? String(p._authenticatedUserId)
          : undefined,
        userName: p._authenticatedUserName
          ? String(p._authenticatedUserName)
          : undefined,
        userEmail: p._authenticatedUserEmail
          ? String(p._authenticatedUserEmail)
          : undefined,
        userRoles: readAuthenticatedRoles(p),
        // Route middleware already ran the RBAC/code-access gate; attest it so
        // the handler skips only that redundant re-check (stored rules +
        // field-level write access still run). Never inferred from userId.
        routeAuthorized: true,
        // A duplicate is a create; carry the scope so a create-as-published is
        // judged on the key's OWN publish grant, never the key owner's.
        authenticatedScope: readAuthenticatedScope(p),
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

// Test seam: the helper is module-private but pure, and re-exporting
// under a verbose name keeps the public surface honest while letting
// unit tests pin its behaviour.
export const formatToastSummaryForTest = formatToastSummary;

// Test seam for the hint-receipt decision helper. The behavioural
// contract is "non-empty renames map -> log; everything else -> silent".
export const shouldLogF14HintReceiptForTest = shouldLogF14HintReceipt;
