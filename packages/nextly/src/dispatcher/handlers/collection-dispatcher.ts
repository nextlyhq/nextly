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

import { z } from "zod";

import {
  assertBuilderFieldNames,
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
  withSessionCacheHeaders,
} from "../../api/response-shapes";
import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import { container } from "../../di/container";
import type { UserContext } from "../../domains/collections/services/collection-types";
import { clearRegistryRowCache } from "../../domains/dynamic-collections/services/collection-row-cache";
import { DynamicCollectionService } from "../../domains/dynamic-collections/services/dynamic-collection-service";
import { assertLocalizationConfigured } from "../../domains/i18n/config/require-app-config";
import { fieldsAsFirstPushed } from "../../domains/i18n/migration/archive-preflight";
import {
  publishesPerLanguage,
  storesPerLanguage,
} from "../../domains/i18n/per-language-storage";
import { buildCompanionRuntimeTable } from "../../domains/i18n/runtime/companion-registration";
import {
  previewCollectionSave,
  writeCollectionSave,
  type BuilderSaveSetup,
} from "../../domains/schema/builder-save/collection-save";
import {
  saveOfSchemaChange,
  type SchemaChangeAnswers,
} from "../../domains/schema/builder-save/schema-change-save";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import type { BrowserRenameResolution } from "../../domains/schema/pipeline/prompt-dispatcher/browser";
import { reachesRelationStorage } from "../../domains/schema/pipeline/recorded-shapes";
import type { Resolution } from "../../domains/schema/pipeline/resolution/types";
import type { DesiredCollection } from "../../domains/schema/pipeline/types";
import { refuseRenamedFieldOntoTakenColumn } from "../../domains/schema/rename-target";
import {
  applyCollectionSchemaChange,
  recordedFieldsOf,
} from "../../domains/schema/services/collection-schema-apply";
import { generateRuntimeSchema } from "../../domains/schema/services/runtime-schema-generator";
import { withSchemaChangeExcluded } from "../../domains/schema/services/schema-change-exclusion";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";
import { assertNoNewSiblingClashes } from "../../domains/schema/sibling-fields";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import { NextlyError } from "../../errors";
import {
  applyPluginAdminViews,
  type CollectionWithAdmin,
} from "../../plugins/admin-views";
import { bumpSchemaVersion } from "../../route-handler/schema-version";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import type { ServiceContainer } from "../../services";
import type { CollectionsHandler } from "../../services/collections-handler";
import { readableSlugAllowlist } from "../../services/lib/readable-slug-allowlist";
import { SKIP_TIMEZONE_FORMAT_HEADER } from "../../shared/lib/date-formatting";
import { SLUG_PATTERN } from "../../shared/slug-pattern";
import { consoleLogger } from "../../shared/types";
import {
  readAuthenticatedActor,
  readAuthenticatedScope,
  routeAdmittedUpdate,
  routeVouched,
} from "../helpers/authenticated-actor";
import {
  readAuthenticatedUser,
  requireAuthenticatedUser,
} from "../helpers/authenticated-user";
import { builderSchemaPreviewBody } from "../helpers/builder-schema-preview";
import { refuseChangeDefinedInCode } from "../helpers/defined-in-code";
import { buildFullDesiredSchema } from "../helpers/desired-schema";
import {
  getAdapterFromDI,
  getCollectionRegistryFromDI,
  getCollectionsHandlerFromDI,
  getLoggerFromDI,
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
  parseCountParam,
  parseRichTextFormat,
  parseSelectParam,
  parseStatusParam,
  parseWhereParam,
  requireBody,
  requireParam,
  readClientWhere,
  toNumber,
} from "../helpers/validation";
import { versionInputOf, versionInputOfQuery } from "../helpers/version-input";
import type { MethodHandler, Params } from "../types";

import { readListOwner, slugListsForOwner } from "./list-owner";
import { readAccessCallerForDispatch } from "./read-access-caller";
// Shared guard that centralizes required + stale schema-version validation for
// all three entity kinds, so a stale UI save is rejected before any DDL runs.
import { assertSchemaVersionMatch } from "./schema-version-guard";
import {
  discardWorkingDraftForDocument,
  takeLiveSharedValuesForDocument,
  getVersionDiffForDocument,
  getVersionForDocument,
  restoreVersionForDocument,
  respondSubjectEvents,
  respondVersionPage,
  markVersionSeenForDocument,
  setVersionLabelForDocument,
  autosaveForDocument,
  getAutosaveForDocument,
  requireSnapshotBody,
  readComparisonParams,
} from "./versions-methods";

type CollectionsHandlerType = CollectionsHandler;

/**
 * The caller as the collection service takes it: the id, and the one user
 * `readAuthenticatedUser` builds, claims and roles included, so a write's
 * access rules and hooks see the same caller a read's do. Nothing for an
 * unauthenticated request, which the service reads as anonymous.
 */
function callerUser(): { userId?: string; user?: UserContext } {
  const user = readAuthenticatedUser();
  return user ? { userId: user.id, user } : {};
}

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
 * Both directions of the all-locales lifecycle, as one handler.
 *
 * Publishing every language of an entry at once has a twin, the takedown.
 * They differ in exactly two things — the service method and the success
 * message — and everything else about them is the same identity forwarding and
 * the same attestation. Written twice, they were a 40-line clone whose halves
 * could drift in which credentials they passed, and the drift would show up as
 * a takedown being denied for a user the route had already authorized.
 *
 * The parameters are forwarded rather than defaulted for reasons that apply to
 * both: `userRoles` so role-based access evaluates against the real user;
 * `routeAuthorized` false, since the route admitted this POST on the
 * `publish-`/`unpublish-` grant or on update, and attests no gate the service
 * could skip; and `authenticatedScope` so a scoped API key's own grant and the
 * rule are judged by the service, in each language the change puts live.
 */
function allLocalesLifecycle(
  method: "publishAllLocales" | "unpublishAllLocales",
  successMessage: string
): MethodHandler<CollectionsHandlerType> {
  return {
    execute: async (svc, p, body, request) => {
      // `requireParam` rather than an inline throw: a missing route parameter is
      // caller-fixable, and a bare `Error` here would surface it as a 500.
      const collectionName = requireParam(p, "collectionName");
      const entryId = requireParam(p, "entryId");
      const result = await svc[method]({
        // The request this transition's hooks are told about.
        request,
        collectionName,
        entryId,
        actor: readAuthenticatedActor(),
        ...callerUser(),
        routeAuthorized: false,
        authenticatedScope: readAuthenticatedScope(),
        // The version the move was made from, judged on every language.
        data: versionInputOf(body),
      });
      const entry = unwrapServiceResult(result, { collectionName, entryId });
      return respondMutation(result.message ?? successMessage, entry);
    },
  };
}

/**
 * The `together` query parameter of a collection delete: slugs separated by
 * commas, each spelled as a slug is. Absent or empty means none.
 */
const TogetherParam = z
  .string()
  .max(20_000)
  .transform(value =>
    value
      .split(",")
      .map(slug => slug.trim())
      .filter(slug => slug !== "")
  )
  .pipe(
    z
      .array(
        z
          .string()
          .regex(SLUG_PATTERN, "Each collection must be named by its slug.")
      )
      .max(500)
  );

function parseTogetherParam(value: string | undefined): string[] {
  if (value === undefined) return [];
  try {
    return TogetherParam.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) throw nextlyValidationFromZod(error);
    throw error;
  }
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
  // The entry's content events, behind the same read gate as its history.
  listEntryEvents: {
    execute: async (_svc, p) =>
      respondSubjectEvents(
        {
          kind: "collection",
          slug: String(p.collectionName ?? ""),
          id: String(p.entryId ?? ""),
        },
        p
      ),
  },
  listEntryVersions: {
    execute: async (_svc, p) =>
      respondVersionPage(
        {
          scopeKind: "collection",
          slug: String(p.collectionName ?? ""),
          entryId: String(p.entryId ?? ""),
        },
        p
      ),
  },
  setEntryVersionLabel: {
    execute: async (_svc, p, body) => {
      const row = await setVersionLabelForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: requireAuthenticatedUser(),
        versionNo: Number(p.versionNo),
        // Forwarded whole: whether `label` is present is part of what the
        // request means, and the core is what reads it.
        body,
        params: p,
      });
      return respondMutation("Version renamed.", row);
    },
  },
  markEntryVersionSeen: {
    execute: async (_svc, p) => {
      const seen = await markVersionSeenForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: requireAuthenticatedUser(),
        authenticatedScope: readAuthenticatedScope(),
        versionNo: Number(p.versionNo),
      });
      return respondMutation("Marked as seen.", seen);
    },
  },
  restoreEntryVersion: {
    execute: async (_svc, p, body, request) => {
      const result = await restoreVersionForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: requireAuthenticatedUser(),
        actor: readAuthenticatedActor(),
        versionNo: Number(p.versionNo),
        params: p,
        // A restore replays a snapshot through the ordinary update, so its
        // hooks are told about the caller the same way an edit's are.
        request,
        // The version the restore was made from, judged as its update is.
        version: versionInputOf(body),
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
        user: requireAuthenticatedUser(),
        params: p,
        // `?locale=` names the language whose pending change is being thrown
        // away. An empty value is the same as none: the request named no
        // language, which a localized document resolves to its default.
        locale: typeof p.locale === "string" && p.locale ? p.locale : null,
        // The version the change was read at, from the query: a DELETE
        // carries no body to read it from.
        version: versionInputOfQuery(p),
      });
      return respondMutation("Working draft discarded.", item);
    },
  },
  takeLiveSharedValues: {
    execute: async (_svc, p, body) => {
      const item = await takeLiveSharedValuesForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: requireAuthenticatedUser(),
        // `?locale=` names the language whose pending change takes the live
        // values. An empty value is the same as none: the default language.
        locale: typeof p.locale === "string" && p.locale ? p.locale : null,
        // The version the change was read at, judged as a save of it.
        version: versionInputOf(body),
      });
      return respondMutation("Live values taken.", item);
    },
  },
  autosaveEntry: {
    execute: async (_svc, p, body) => {
      const item = await autosaveForDocument({
        scopeKind: "collection",
        slug: String(p.collectionName ?? ""),
        entryId: String(p.entryId ?? ""),
        user: requireAuthenticatedUser(),
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
        user: requireAuthenticatedUser(),
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
        user: requireAuthenticatedUser(),
        authenticatedScope: readAuthenticatedScope(),
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
        user: requireAuthenticatedUser(),
        authenticatedScope: readAuthenticatedScope(),
        ...readComparisonParams(p),
      });
      // Private to the caller: a comparison from where this person last
      // looked differs from one person to the next.
      return withSessionCacheHeaders(respondDoc(diff));
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
    // envelope to the canonical `{ items, meta }` body.
    //
    // 🔴 Permission filtering runs BEFORE the query, as a slug allowlist the
    // registry puts in its WHERE clause. Filtering the returned page instead
    // made the meta describe a different set from the rows: `total` became the
    // count of one filtered page, so `totalPages` collapsed to 1 and `hasNext`
    // was false however many pages the reader could actually see. A client
    // reading that stops at the first page, and everything past it is
    // unreachable. The singles dispatcher resolves its allowlist the same way.
    execute: async (svc, p) => {
      // Read first, so an owner it does not know is refused before any work.
      const owner = readListOwner(p.owner);
      // The SHARED resolver, which the singles listing asks too, handed the
      // SAME caller every other read decision takes. `undefined` means no
      // filter — an unauthenticated caller, gated at the route layer, or a
      // session super admin. An empty list means nothing is visible, which
      // the registry short-circuits to a zero-row, zero-total answer.
      const reader = readAuthenticatedUser();
      const readable = await readableSlugAllowlist(
        reader ? readAccessCallerForDispatch(reader) : undefined,
        "collection"
      );
      // The site's own collections or the plugins', as conditions on the
      // same query: the plugins' list only narrows what the reader may read.
      const slugLists = await slugListsForOwner(owner, "collections", readable);

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
        ...slugLists,
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

      // The rows and the meta now describe one set, because the allowlist was
      // a condition on the query that produced both. A collection removed from
      // code stays listed, marked, so the admin can say so and name the step
      // that retires it.
      // Loaded on first use rather than with the dispatcher, so a module that
      // imports the dispatcher and never lists does not load the mark.
      const { withRemovedFromCodeMarks } = await import(
        "../helpers/removed-from-code-marks"
      );
      return respondList(
        await withRemovedFromCodeMarks("collection", items),
        toPaginationMeta(baseMeta)
      );
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
      // win; plugin fills empties (see applyPluginAdminViews). The route
      // handler's config store is loaded here, not imported at the top: it
      // reaches the auth routes and every plugin's context, several hundred
      // modules the other collection operations never need.
      const { getHandlerConfig } = await import(
        "../../route-handler/auth-handler"
      );
      const config = getHandlerConfig();
      const [collectionWithViews] = applyPluginAdminViews(
        [collection as CollectionWithAdmin],
        config?.plugins ?? []
      );
      // Marked as the listing marks it, so the entity's own screens show the
      // notice the navigation's mark promises.
      const { withRemovedFromCodeMarks } = await import(
        "../helpers/removed-from-code-marks"
      );
      const [marked] = await withRemovedFromCodeMarks("collection", [
        collectionWithViews as unknown as Record<string, unknown>,
      ]);
      return respondDoc(marked as unknown);
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
    // The deleted record is the `item`. `?together=a,b` names the collections
    // a bulk delete removes with this one, in the same operation: the whole
    // set is checked before anything is removed, so collections that point
    // only at one another can go together where each alone is refused.
    execute: async (svc, p) => {
      requireParam(p, "collectionName");
      // A variable rather than an inline literal: `CollectionsHandler` types
      // its parameter by the one key it reads and forwards the object, whole,
      // to the metadata service, which reads `together` from it.
      const request: { collectionName: string; together: string[] } = {
        collectionName: p.collectionName,
        together: parseTogetherParam(p.together),
      };
      const result = await svc.deleteCollection(request);
      const collection = unwrapServiceResult(result, {
        slug: p.collectionName,
      });
      return respondMutation(
        result.message ?? "Collection deleted.",
        collection
      );
    },
  },
  // What deleting a collection takes with it besides its own entries, by the
  // plugin that holds it (`ctx.hooks.onCollectionDelete`), for the delete
  // dialog to list before the confirm. `?together=a,b` names the collections
  // a bulk delete removes with this one, as on the delete. Reads only.
  previewCollectionDelete: {
    execute: async (_svc, p) => {
      const collectionName = requireParam(p, "collectionName");
      const slugs = [
        ...new Set([collectionName, ...parseTogetherParam(p.together)]),
      ];
      const [{ collectionDeleteImpact }, { getActiveHookRegistry }] =
        await Promise.all([
          import(
            "../../domains/collections/services/collection-delete-plugins"
          ),
          import("../../hooks/hook-registry"),
        ]);
      const impact = await collectionDeleteImpact(
        getActiveHookRegistry(),
        slugs
      );
      // Read for this caller's dialog only; no shared cache keeps it.
      return withSessionCacheHeaders(respondData({ impact }));
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
      refuseChangeDefinedInCode(collection, "collection", p.collectionName);
      const { fields } = body as { fields: unknown[] };
      if (!fields) throw new Error("fields is required in request body");
      const previewLocalized = readRequestLocalized(body);
      // Same rules as the ui-schema.json mirror (see api/fields-payload):
      // an invalid field must fail HERE, not only at the file write, or
      // the DB and the committed manifest diverge silently.
      // A field name the collection already holds keeps working whatever its case.
      assertValidFieldsPayload(fields, {
        kind: "collection",
        stored: collection.fields ?? [],
      });
      // A pair of sibling fields this save would create is refused before anything is planned;
      // one the entity already holds keeps working (judged against the stored fields).
      assertNoNewSiblingClashes(
        { kind: "collection", slug: p.collectionName },
        fields,
        collection.fields ?? []
      );
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
        // As the apply's first push creates them (`fieldsAsFirstPushed`).
        fields: fieldsAsFirstPushed({
          oldFields: currentFields,
          newFields: fields as FieldDefinition[],
          entity: collection,
          requestedLocalized: previewLocalized,
        }) as DesiredCollection["fields"],
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
        recordedFields: recordedFieldsOf(collection),
      };

      const preview = await builderSchemaPreviewBody({
        desired,
        db,
        dialect,
        slug: p.collectionName,
        tableName,
        builtBy: "collection",
        entity: collection,
        currentFields,
        newFields: fields as FieldDefinition[],
        requestedLocalized: previewLocalized,
        // Legacy rows (schema_version NULL) read as 1, so the editor always has a concrete
        // version to echo back on Apply; JSON omits an undefined one and the guard would reject
        // the first save as version-less.
        schemaVersion: collection.schemaVersion ?? 1,
      });
      // What the save writes beyond the person's change, for the review to
      // show before they confirm: each conversion, fill and delete. The
      // answers are optional here, so the review can ask again once chosen.
      const answers = body as SchemaChangeAnswers;
      const notices = await reviewLinesOf({
        slug: p.collectionName,
        collection: writerRowOf(collection),
        fields: fields as FieldDefinition[],
        localized:
          previewLocalized ??
          (collection as { localized?: boolean }).localized === true,
        answers: {
          renameResolutions: answers.renameResolutions ?? [],
          eventResolutions: answers.eventResolutions ?? [],
          ...(answers.resolutions === undefined
            ? {}
            : { resolutions: answers.resolutions }),
          ...(answers.acknowledgedConversions === undefined
            ? {}
            : { acknowledgedConversions: answers.acknowledgedConversions }),
        },
      });
      return respondData({ ...preview, notices });
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
      assertValidFieldsPayload(fields, {
        kind: "collection",
        stored: "under-lock",
      });

      // Log a debug line when hints arrive so we can track adoption
      // without surprising operators with errors. The current version
      // ignores the field entirely.
      if (shouldLogF14HintReceipt(hints)) {
        consoleLogger.debug(
          `[F14] hints received but not processed; see plans/specs/F10-notifications-and-audit-design.md §6.6`
        );
      }

      // Everything above reads the request alone, so no concurrent writer can change its answer
      // and it is decided before the lock is taken: a malformed save is answered as one, not with
      // a lock refusal or a lock table created on the way to rejecting it. Everything below reads
      // or writes the database, from the registry row the save is checked against to the response,
      // and runs holding the schema lock, refused at once while a migration holds it. The shared
      // apply takes the lock too, re-entrantly; it is taken here so the registry read, the version
      // check and the registry write sit inside the same claim as the DDL.
      return withSchemaChangeExcluded(
        {
          adapter: getAdapterFromDI(),
          // An app whose DI registered no logger still saves; the refusal's log line then goes to
          // the console.
          logger: getLoggerFromDI() ?? consoleLogger,
          label: `apply schema changes to collection "${p.collectionName}"`,
          // This road runs the push pipeline, so it issues DDL and may create the lock table.
          issuesDdl: true,
        },
        async () => {
          // Read once the lock is held, so the row every check below is asked against is the one
          // the DDL and the registry write act on.
          const collection = await registry.getCollectionBySlug(
            p.collectionName
          );
          if (!collection) throw new Error("Collection not found");
          refuseChangeDefinedInCode(collection, "collection", p.collectionName);
          // A field name the collection already holds keeps working whatever its case; one this
          // save creates is the Builder's own. Judged against the row as stored now.
          assertBuilderFieldNames(fields, collection.fields ?? []);
          // A pair of sibling fields this save would create is refused before any statement or
          // archive write; one the entity already holds keeps working. Asked here because this
          // road reaches its DDL through no shared service that could ask it.
          assertNoNewSiblingClashes(
            { kind: "collection", slug: p.collectionName },
            fields,
            collection.fields ?? []
          );

          // Default legacy rows (schema_version NULL) to 1 so a first save is not
          // rejected as version-less. The registry types schemaVersion as `number`
          // via a type assertion, but the DB column is nullable, so the value can
          // be null at runtime; singles/components apply the same `?? 1` fallback.
          const currentVersion = collection.schemaVersion ?? 1;
          // Reject a stale or version-less UI save before any DDL runs. The shared
          // guard gives all three entity kinds (collections, singles, components)
          // one optimistic-lock behavior and one error surface.
          assertSchemaVersionMatch(
            schemaVersion,
            currentVersion,
            p.collectionName
          );
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
          // Where its translatable values are stored once this apply runs, which the runtime
          // tables registered below describe: per language when it is translated, or always under
          // per-language storage. `isLocalized` stays the product's answer.
          const isStoredPerLanguage = storesPerLanguage({
            localized: isLocalized,
          });
          // i18n: enabling Internationalization needs the app-level
          // `localization` config — without it the companion reconcile below
          // would move translatable columns into a table the runtime cannot
          // address. Gate the false→true transition only.
          if (!wasLocalized && isLocalized) {
            assertLocalizationConfigured("collection", p.collectionName);
          }

          const adapter = getAdapterFromDI();
          if (!adapter) {
            throw new Error("Database adapter not initialized");
          }
          // `dialect` is an abstract readonly property on DrizzleAdapter, not a method.
          const dialect = adapter.dialect;

          // A field renamed onto a column that is already there is refused before anything
          // changes, on either way below: written and run as a migration, or pushed. The dialog
          // never offers such a change as a rename, only as the old column dropped beside a field
          // kept on the column that is there, so it is found from the field lists.
          await refuseRenamedFieldOntoTakenColumn(
            adapter,
            {
              previousFields: (collection.fields ??
                []) as unknown as FieldDefinition[],
              fields: fields as unknown as FieldDefinition[],
              mainTable: tableName,
              wasLocalized: storesPerLanguage({ localized: wasLocalized }),
              isLocalized: isStoredPerLanguage,
              dialect,
              builtBy: "collection",
            },
            { collection: p.collectionName }
          );

          // One apply of the schema pipeline, with the admin's answers from the dialog, then the
          // companion brought in step: the same path a Builder save of the collection takes. Legacy
          // per-field answers are translated to typed resolutions inside the prompt dispatcher.
          // With the Builder save writer set up, the change is the migration
          // `migrate:create` would write for this collection, with the
          // person's renames and answers in it, run in development as
          // `nextly migrate` runs it (`writeCollectionSave`).
          const acknowledgedConversions = (
            body as { acknowledgedConversions?: string[] }
          ).acknowledgedConversions;
          const change: Parameters<typeof applyCollectionSchemaChange>[0] = {
            slug: p.collectionName,
            collection,
            fields: fields as unknown as FieldDefinition[],
            wasLocalized,
            isLocalized,
            // The dialog does not change Draft/Published: the persisted status, before and after.
            status: collection.status === true,
            wasStatus: collection.status === true,
            renameResolutions: renameResolutions ?? [],
            eventResolutions: eventResolutions ?? [],
            legacyResolutions: resolutions
              ? { tableName, byFieldName: resolutions }
              : undefined,
          };
          let pushedSummary: PushSummary | undefined;
          const push = async (): Promise<void> => {
            pushedSummary = (await applyCollectionSchemaChange(change)).summary;
          };
          const written = await saveThroughWriter({
            appliedBy: push,
            // Whether the push applies the change in development, the writer recording its
            // migration once the push has run: a translated collection, or one turning
            // translation on or off, whose push carries its values across the change; and a change
            // reaching a relation's storage (`reachesRelationStorage`), which the push plans from
            // the live table, where the file alone, written from the newest snapshot, does not.
            pushWhen: async () =>
              wasLocalized ||
              isLocalized ||
              reachesRelationStorage({
                before: collection.fields ?? [],
                after: fields as unknown as FieldDefinition[],
                liveTable: async () =>
                  (
                    await introspectLiveSnapshot(
                      adapter.getDrizzle(),
                      dialect,
                      [tableName]
                    )
                  ).tables[0],
              }),
            slug: p.collectionName,
            collection: writerRowOf(collection),
            fields: fields as unknown as FieldDefinition[],
            localized: isLocalized,
            answers: {
              renameResolutions: renameResolutions ?? [],
              eventResolutions: eventResolutions ?? [],
              ...(resolutions === undefined ? {} : { resolutions }),
              ...(acknowledgedConversions === undefined
                ? {}
                : { acknowledgedConversions }),
            },
          });
          const storedFields =
            written === undefined
              ? (fields as unknown as FieldDefinition[])
              : written.fields;
          const result =
            written !== undefined
              ? { summary: pushedSummary }
              : await applyCollectionSchemaChange(change);

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
                fields: JSON.stringify(storedFields),
                schema_version: newSchemaVersion,
                // Written but not run outside development: `nextly migrate`
                // applies it on deploy.
                ...(written !== undefined && !written.applied
                  ? { migration_status: "pending" }
                  : {}),
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
            // Written past the registry services, so the cached rows are cleared
            // here: a read during the save may have cached the row from before it.
            clearRegistryRowCache();
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
            consoleLogger.warn(
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
              storedFields,
              dialect,
              {
                localized: isStoredPerLanguage,
                status: collection.status === true,
              }
            );
            getCollectionsHandlerFromDI()?.refreshCollectionSchema(
              tableName,
              freshTable
            );
            getSchemaRegistryFromDI()?.registerDynamicSchema(
              tableName,
              freshTable
            );
            if (isStoredPerLanguage) {
              const companion = buildCompanionRuntimeTable({
                slug: p.collectionName,
                tableName,
                fields: fields as FieldDefinition[],
                dialect,
                localized: true,
                // As saved, not as the record read before the save: a save that turns
                // translation on gives a Draft/Published collection its per-language `_status`.
                status: publishesPerLanguage({
                  localized: isLocalized,
                  status: (collection as { status?: unknown }).status,
                }),
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
            consoleLogger.warn(
              `[applySchemaChanges] In-memory schema refresh failed for ` +
                `'${p.collectionName}': ${msg}. Entry queries may reference ` +
                `old column names until next server restart.`
            );
          }

          // The dispatcher fires bumpSchemaVersion directly after a
          // successful pipeline apply. The bump only matters for UI-first
          // applies (sets the X-Schema-Version response header so admin tabs
          // know to refetch); HMR and boot paths don't need it.
          bumpSchemaVersion();

          // applySchemaChanges is a non-CRUD mutation: there's no "item" to
          // surface. The action result carries the new schema version (so
          // the admin can update its X-Schema-Version header probe) and a
          // toast summary string. toastSummary may be undefined when the
          // pipeline didn't emit diff counts; the conditional spread drops
          // undefined fields silently.
          return respondAction(`Schema applied for '${p.collectionName}'`, {
            newSchemaVersion: versionPersisted
              ? newSchemaVersion
              : currentVersion,
            ...(result.summary
              ? { toastSummary: formatToastSummary(result.summary) }
              : {}),
          });
        }
      );
    },
  },
  listEntries: {
    // The entry-query service wraps a PaginatedResponse
    // (`{ docs, totalDocs, limit, page, totalPages, hasNextPage,
    // hasPrevPage, ... }`) in CollectionServiceResult; we unwrap it and
    // translate to canonical PaginationMeta via paginatedResponseToMeta.
    execute: async (svc, p, _body, request) => {
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

      // Forward the caller so the service evaluates the collection's read gate
      // for them. Without a user the service falls through to the
      // permission-less default and returns every row over HTTP.
      // `routeAuthorized` attests that the route already ran the coarse RBAC
      // gate, so only that re-check is skipped.
      const user = readAuthenticatedUser();

      const result = await svc.listEntries({
        // The request this operation's hooks are told about.
        request,
        collectionName: p.collectionName,
        user,
        routeAuthorized: !!user,
        // A scoped API key is judged on its own read grant rather than on the
        // permissions of the user that owns it, so a super-admin-owned key
        // cannot read past its scope by inheriting the session bypass.
        authenticatedScope: readAuthenticatedScope(),
        page: p.page !== undefined ? parseInt(String(p.page), 10) : undefined,
        limit:
          rawLimit !== undefined ? parseInt(String(rawLimit), 10) : undefined,
        search: p.search,
        depth:
          p.depth !== undefined ? parseInt(String(p.depth), 10) : undefined,
        select: parseSelectParam(p.select),
        where: parseWhereParam(p.where, p.whereBrackets),
        richTextFormat: parseRichTextFormat(p.richTextFormat),
        sort,
        status,
        // i18n M4: `?locale=` + `?fallback-locale=` select the content language.
        locale: p.locale,
        fallbackLocale: p["fallback-locale"],
        // i18n M7: `?translation-status=1` attaches the per-locale `_translations` overview map.
        translationStatus: isTruthyParam(p["translation-status"]),
        // `?count=capped` counts the total no further than the list shows.
        countUpTo: parseCountParam(p.count),
      });

      type PaginatedShape = {
        docs: unknown[];
        totalDocs: number;
        limit: number;
        page: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
        totalCapped?: true;
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
    execute: async (svc, p, _body, request) => {
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
      const user = readAuthenticatedUser();

      const result = await svc.countEntries({
        // The request this operation's hooks are told about.
        request,
        collectionName: p.collectionName,
        user,
        routeAuthorized: !!user,
        // Same scope judgement as listEntries: a count that ignored the key's
        // own grant would disclose how many rows exist beyond it.
        authenticatedScope: readAuthenticatedScope(),
        search: p.search,
        where: parseWhereParam(p.where, p.whereBrackets),
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
    execute: async (svc, p, body, request) => {
      if (!p.collectionName || !body)
        throw new Error("collectionName and entry data are required");
      const result = await svc.createEntry(
        {
          // The request this operation's hooks are told about.
          request,
          collectionName: p.collectionName,
          depth:
            p.depth !== undefined ? parseInt(String(p.depth), 10) : undefined,
          ...callerUser(),
          // i18n M5: `?locale=de` stores the translatable values for German.
          locale: p.locale,
          // Who performed the write, recorded on the outbox event.
          actor: readAuthenticatedActor(),
          // Route middleware already ran the RBAC/code-access gate for the
          // caller it authenticated; attest it so the handler skips only that
          // redundant re-check (field-level write access still runs). Never
          // inferred from userId, and never for a visitor, whom the service
          // judges itself.
          routeAuthorized: routeVouched(),
          // The route authorized only `create` against an API key's scope; a
          // create-as-published publish gate judges the key's own grants.
          authenticatedScope: readAuthenticatedScope(),
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
    execute: async (svc, p, _body, request) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      // Absent → undefined so the service applies its published-only default;
      // pass `?status=all|draft|published` to widen, invalid → 400. Matches
      // listEntries.
      const status = parseStatusParam(p.status);
      // Same caller context as listEntries. Fetching one document by id is the
      // path where a missing user matters most: without it the gate falls
      // through to the permission-less default on a direct read.
      const user = readAuthenticatedUser();

      const result = await svc.getEntry({
        // The request this operation's hooks are told about.
        request,
        collectionName: p.collectionName,
        entryId: p.entryId,
        user,
        routeAuthorized: !!user,
        // A scoped API key is judged on its own read grant rather than on the
        // permissions of the user that owns it, matching listEntries, countEntries
        // and the publish gate.
        authenticatedScope: readAuthenticatedScope(),
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
    execute: async (svc, p, body, request) => {
      if (!p.collectionName || !p.entryId || !body) {
        throw new Error(
          "collectionName, entryId, and update data are required"
        );
      }
      const result = await svc.updateEntry(
        {
          // The request this operation's hooks are told about.
          request,
          collectionName: p.collectionName,
          entryId: p.entryId,
          depth:
            p.depth !== undefined ? parseInt(String(p.depth), 10) : undefined,
          ...callerUser(),
          // i18n M5: `?locale=de` updates only the German translatable values.
          locale: p.locale,
          // Who performed the write, recorded on the outbox event.
          actor: readAuthenticatedActor(),
          // Where the route admitted the caller on update, attest it so the
          // handler skips only that redundant re-check (field-level write
          // access still runs). A caller admitted on publish or unpublish
          // alone is judged by the service. Never inferred from userId.
          routeAuthorized: routeAdmittedUpdate(),
          // The route authorized only `update` against an API key's scope; the
          // service-side publish/unpublish gate judges the key's own grants.
          authenticatedScope: readAuthenticatedScope(),
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
  publishAllLocales: allLocalesLifecycle(
    "publishAllLocales",
    "All languages published."
  ),
  unpublishAllLocales: allLocalesLifecycle(
    "unpublishAllLocales",
    "All languages unpublished."
  ),

  previewPublishAllLocales: {
    // What publishing every language would do, language by language, without
    // doing it. Asked as the publish is: the service judges the publish
    // permission and rule in each language it would put live, and names only
    // the fields the caller may read.
    execute: async (svc, p) => {
      const collectionName = requireParam(p, "collectionName");
      const entryId = requireParam(p, "entryId");
      const result = await svc.previewPublishAllLocales({
        collectionName,
        entryId,
        ...callerUser(),
        // The route admitted this read on the `publish-{slug}` grant alone,
        // so it attests no gate, as the publish's route attests none.
        routeAuthorized: false,
        authenticatedScope: readAuthenticatedScope(),
      });
      const preview = unwrapServiceResult<{
        id: string;
        languages: unknown[];
        blockers: unknown[];
      }>(result, { collectionName, entryId });
      // One caller's answer: who may publish, and which fields they may read,
      // decide it, so no shared cache may hand it to anyone else.
      return withSessionCacheHeaders(respondData(preview));
    },
  },
  deleteEntry: {
    // The deleted record is the `item`.
    execute: async (svc, p, _body, request) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      const result = await svc.deleteEntry({
        // The request this operation's hooks are told about.
        request,
        collectionName: p.collectionName,
        entryId: p.entryId,
        ...callerUser(),
        // Who performed the delete (user vs API key), recorded on the
        // `entry.deleted` outbox event — same attribution as create/update.
        actor: readAuthenticatedActor(),
        // Route middleware already ran the RBAC/code-access gate for the
        // caller it authenticated; attest it so the handler skips only that
        // redundant re-check (field-level write access still runs). Never
        // inferred from userId, and never for a visitor, whom the service
        // judges itself.
        routeAuthorized: routeVouched(),
        // The route authorized `delete` against the key's scope; carry the scope
        // so a super-admin-owned key's delete is judged on the key's OWN grant
        // and does not skip stored owner/role delete rules.
        authenticatedScope: readAuthenticatedScope(),
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
    execute: async (svc, p, body, request) => {
      const b = body as { ids?: string[] } | undefined;
      if (!p.collectionName) {
        throw new Error("collectionName parameter is required");
      }
      if (!b?.ids || !Array.isArray(b.ids) || b.ids.length === 0) {
        throw new Error("ids must be a non-empty array");
      }
      const result = await svc.bulkDeleteEntries({
        // The request this operation's hooks are told about.
        request,
        collectionName: p.collectionName,
        ids: b.ids,
        ...callerUser(),
        // Who performed the bulk delete (user vs API key), recorded on each
        // entry's `entry.deleted` event — same attribution as single delete.
        actor: readAuthenticatedActor(),
        // Route middleware already ran the RBAC/code-access gate; attest it so
        // the handler skips only that redundant re-check (field-level write
        // access still runs). Never inferred from userId.
        routeAuthorized: true,
        // Carry the key's scope so each per-id delete is judged on the key's OWN
        // grant, not the key owner's super-admin roles.
        authenticatedScope: readAuthenticatedScope(),
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
    execute: async (svc, p, body, request) => {
      const b = body as
        | { ids?: string[]; data?: Record<string, unknown>; revs?: unknown }
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
        // The request this operation's hooks are told about.
        request,
        collectionName: p.collectionName,
        ids: b.ids,
        data: b.data,
        // Each id's own version, where given: judged per document.
        revs: b.revs,
        actor: readAuthenticatedActor(),
        ...callerUser(),
        // Where the route admitted the caller on update, attest it so the
        // handler skips only that redundant re-check (field-level write access
        // still runs). Never inferred from userId.
        routeAuthorized: routeAdmittedUpdate(),
        // The route authorized `update` against the key's scope, never
        // publish/unpublish — carry the scope so each per-id transition is
        // judged on the key's OWN grants.
        authenticatedScope: readAuthenticatedScope(),
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
    execute: async (svc, p, body, request) => {
      const b = body as
        | {
            where?: Record<string, unknown>;
            data?: Record<string, unknown>;
            limit?: number;
            revs?: unknown;
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
          // The request this operation's hooks are told about.
          request,
          collectionName: p.collectionName,
          // The body filter is checked as the query-string one is: a malformed
          // filter, or one naming the owner column, is refused with a 400
          // before any row is matched. `b.where` was checked to be an object
          // above, so the check always returns it.
          where: readClientWhere(b.where) ?? {},
          data: b.data,
          // Passed so it is refused, not ignored: a query names no ids.
          revs: b.revs,
          actor: readAuthenticatedActor(),
          ...callerUser(),
          // Where the route admitted the caller on update, attest it so the
          // handler skips only that redundant re-check (field-level write
          // access still runs). Never inferred from userId.
          routeAuthorized: routeAdmittedUpdate(),
          // The route authorized `update` against the key's scope, never
          // publish/unpublish — carry the scope so the collection-level gate and
          // each per-row transition are judged on the key's OWN grants.
          authenticatedScope: readAuthenticatedScope(),
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
    execute: async (svc, p, body, request) => {
      if (!p.collectionName || !p.entryId) {
        throw new Error("collectionName and entryId parameters are required");
      }
      const b = body as { overrides?: Record<string, unknown> } | undefined;
      const result = await svc.duplicateEntry({
        // The request this operation's hooks are told about.
        request,
        collectionName: p.collectionName,
        entryId: p.entryId,
        overrides: b?.overrides,
        actor: readAuthenticatedActor(),
        ...callerUser(),
        // Route middleware already ran the RBAC/code-access gate; attest it so
        // the handler skips only that redundant re-check (field-level write
        // access still runs). Never inferred from userId.
        routeAuthorized: true,
        // A duplicate is a create; carry the scope so a create-as-published is
        // judged on the key's OWN publish grant, never the key owner's.
        authenticatedScope: readAuthenticatedScope(),
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
  body: unknown,
  request?: Request
): Promise<unknown> {
  const collectionsHandler =
    getCollectionsHandlerFromDI() ?? services.collections;
  const handler = COLLECTIONS_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute(collectionsHandler, params, body, request);
}

// Test seam: the helper is module-private but pure, and re-exporting
// under a verbose name keeps the public surface honest while letting
// unit tests pin its behaviour.
export const formatToastSummaryForTest = formatToastSummary;

// Test seam for the hint-receipt decision helper. The behavioural
// contract is "non-empty renames map -> log; everything else -> silent".
export const shouldLogF14HintReceiptForTest = shouldLogF14HintReceipt;

/**
 * A registry row as the writer reads it: its table and its fields, which the
 * registry stores as the field definitions they were saved as.
 */
function writerRowOf(collection: { tableName: string; fields?: unknown }): {
  tableName: string;
  fields: FieldDefinition[];
} {
  return {
    tableName: collection.tableName,
    fields: (collection.fields ?? []) as FieldDefinition[],
  };
}

/** What a field change gives the Builder save writer. */
interface WriterChange {
  slug: string;
  collection: { tableName: string; fields?: FieldDefinition[] };
  fields: FieldDefinition[];
  localized: boolean;
  answers: SchemaChangeAnswers;
}

/**
 * The Builder save writer's dependencies and the save a field change makes
 * (`saveOfSchemaChange`), read from the definition as it stands. Undefined
 * when the app registered no writer.
 */
async function writerSaveOf(change: WriterChange): Promise<
  | {
      deps: Parameters<typeof writeCollectionSave>[0];
      save: Parameters<typeof writeCollectionSave>[1];
      fields: FieldDefinition[];
    }
  | undefined
> {
  if (!container.has("builderSaveSetup")) return undefined;
  const setup = container.get<BuilderSaveSetup>("builderSaveSetup");
  const adapter = getAdapterFromDI();
  // A writer registered with no adapter is a wiring fault of the app, not the editor's: reported
  // as an internal error, with what was missing in the log.
  if (!adapter) {
    throw NextlyError.internal({
      logContext: { reason: "database adapter not initialized" },
    });
  }
  const logger = getLoggerFromDI() ?? consoleLogger;
  const dynamic = new DynamicCollectionService(adapter, logger);
  const before = change.collection.fields ?? [];
  const { save, fields } = saveOfSchemaChange({
    slug: change.slug,
    table: change.collection.tableName,
    definition: await loadUiSchema({
      projectRoot: setup.projectRoot,
      uiSchemaFile: setup.config.db.uiSchemaFile,
    }),
    row: change.collection,
    fields: change.fields,
    localized: change.localized,
    answers: change.answers,
    // Keys and junctions to the tables their targets are stored in.
    ...(await dynamic.writerRelations(
      change.collection.tableName,
      before,
      change.fields
    )),
  });
  return {
    deps: {
      ...setup,
      adapter,
      logger,
      applies: process.env.NODE_ENV === "development",
    },
    save,
    fields,
  };
}

/**
 * A field change through the Builder save writer, when the app registered
 * one: written and, in development, run, or applied by `appliedBy` and then
 * recorded. Undefined without a writer, where the push pipeline applies the
 * change as it did before.
 */
async function saveThroughWriter(
  change: WriterChange & {
    /** Applies the change in development instead of the file (`writeCollectionSave`). */
    appliedBy?: () => Promise<void>;
    /**
     * Whether `appliedBy` applies this change rather than the file. Asked only where the
     * answer is used, a save the writer runs in development, so a production save or one with
     * no writer reads nothing for it. Absent, `appliedBy` applies whenever it is given.
     */
    pushWhen?: () => Promise<boolean>;
  }
): Promise<{ fields: FieldDefinition[]; applied: boolean } | undefined> {
  const prepared = await writerSaveOf(change);
  if (prepared === undefined) return undefined;
  const viaPush =
    change.appliedBy !== undefined &&
    prepared.deps.applies &&
    (change.pushWhen === undefined || (await change.pushWhen()));
  const result = await writeCollectionSave(
    prepared.deps,
    prepared.save,
    viaPush && change.appliedBy !== undefined
      ? { appliedBy: change.appliedBy }
      : {}
  );
  return { fields: prepared.fields, applied: result.applied };
}

/**
 * The lines the review shows for a field change through the writer: each
 * conversion an adoption makes, each fill and each delete
 * (`previewCollectionSave`). None without a writer.
 */
async function reviewLinesOf(change: WriterChange): Promise<string[]> {
  const prepared = await writerSaveOf(change);
  if (prepared === undefined) return [];
  return (await previewCollectionSave(prepared.deps, prepared.save)).notices;
}

/** What a push reports of the change it applied. */
type PushSummary = Awaited<
  ReturnType<typeof applyCollectionSchemaChange>
>["summary"];
