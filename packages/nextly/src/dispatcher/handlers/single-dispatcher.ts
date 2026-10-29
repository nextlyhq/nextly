/**
 * Singles (global document) dispatch handlers.
 *
 * Routes 7 operations against `SingleRegistryService` and
 * `SingleEntryService`:
 * - CRUD on single definitions (list/create/delete)
 * - CRUD on single documents (get/update)
 * - Schema management (getSingleSchema/updateSingleSchema) with
 *   runtime ALTER TABLE migration execution
 *
 * The create/update schema flows run SQL migrations directly against
 * the DI-registered adapter so that UI-edited Singles immediately have
 * a usable backing table (sandbox dev-db semantics).
 *
 * Every handler returns a Response built via the respondX helpers in
 * `../../api/response-shapes.ts`. The dispatcher passes the Response
 * through unchanged. See spec §5.1 for the canonical shape contract.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  assertValidFieldsPayload,
  assertValidPluginFieldOptions,
} from "../../api/fields-payload";
import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "../../api/response-shapes";
import {
  assertComparisonRequest,
  resolveSingleDocumentId,
} from "../../api/versions-access";
import type { FieldConfig } from "../../collections/fields/types";
import { container } from "../../di/container";
import { assertLocalizationConfigured } from "../../domains/i18n/config/require-app-config";
import { appLocalization } from "../../domains/i18n/configured-locales";
import {
  archiveFieldsLeavingTranslation,
  fieldsAsFirstPushed,
  fieldsWithLeavingSettingsDeferred,
} from "../../domains/i18n/migration/archive-preflight";
import { resolveCompanionRename } from "../../domains/i18n/migration/companion-rename";
import { buildCompanionRuntimeTable } from "../../domains/i18n/runtime/companion-registration";
import { extractDatabaseNameFromUrl } from "../../domains/schema/pipeline/database-url";
import type { BrowserRenameResolution } from "../../domains/schema/pipeline/prompt-dispatcher/browser";
import type { Resolution } from "../../domains/schema/pipeline/resolution/types";
import type { DesiredSingle } from "../../domains/schema/pipeline/types";
import { generateRuntimeSchema } from "../../domains/schema/services/runtime-schema-generator";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";
import { calculateSchemaHash } from "../../domains/schema/services/schema-hash";
import {
  resolveSingleTableName,
  singleTableFamiliesCollide,
} from "../../domains/singles/services/resolve-single-table-name";
import type { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import type { SingleMetadataService } from "../../domains/singles/services/single-metadata-service";
import type { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import { resolveBuilderVersions } from "../../domains/versions/builder-versions";
import {
  draftSplitResponseFields,
  schemaDraftSplit,
} from "../../domains/versions/draft-split-eligibility";
import { resolveBuilderWebhooks } from "../../domains/webhooks/builder-webhooks";
import { NextlyError } from "../../errors";
import { transformRichTextFields } from "../../lib/field-transform";
import { resolveBuilderRevalidate } from "../../revalidation/builder-revalidate";
import { withSessionCacheHeaders } from "../../routeHandler";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import { readableSlugAllowlist } from "../../services/lib/readable-slug-allowlist";
import { assertGlobalResourceSlugAvailable } from "../../services/lib/resource-slug-guard";
import { assertAddressAllowed } from "../../shared/address-rule";
import { SKIP_TIMEZONE_FORMAT_HEADER } from "../../shared/lib/date-formatting";
import { consoleLogger } from "../../shared/types";
import {
  readAuthenticatedActor,
  readAuthenticatedScope,
  routeAdmittedUpdate,
} from "../helpers/authenticated-actor";
import {
  readAuthenticatedUser,
  requireAuthenticatedUser,
} from "../helpers/authenticated-user";
import { builderSchemaPreviewBody } from "../helpers/builder-schema-preview";
import {
  builderSchemaPush,
  leavingSettingsStep,
  pushAndReconcileCompanion,
  refuseRefusedLeavingSettings,
} from "../helpers/builder-schema-push";
import { refuseChangeDefinedInCode } from "../helpers/defined-in-code";
import { buildFullDesiredSchema } from "../helpers/desired-schema";
import {
  getAdapterFromDI,
  getComponentRegistryFromDI,
  getSchemaRegistryFromDI,
  getSingleEntryServiceFromDI,
  getSingleMetadataServiceFromDI,
  getSingleRegistryFromDI,
} from "../helpers/di";
import { readRequestLocalized } from "../helpers/request-localized";
import {
  offsetPaginationToMeta,
  unwrapServiceResult,
} from "../helpers/service-envelope";
import {
  parseRichTextFormat,
  isTruthyParam,
  parseStatusParam,
  requireParam,
  toNumber,
} from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

import { readAccessCallerForDispatch } from "./read-access-caller";
import { assertSchemaVersionMatch } from "./schema-version-guard";
import {
  assertLabelRequestValid,
  autosaveForDocument,
  discardWorkingDraftForDocument,
  takeLiveSharedValuesForDocument,
  getAutosaveForDocument,
  requireSnapshotBody,
  getVersionDiffForDocument,
  getVersionForDocument,
  restoreVersionForDocument,
  markVersionSeenForDocument,
  setVersionLabelForDocument,
  respondSubjectEvents,
  respondVersionPage,
  readComparisonParams,
} from "./versions-methods";

// ============================================================
// Default field helpers
// ============================================================

interface SingleField {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  unique?: boolean;
  /** See the synthetic declarations below: system columns set this false. */
  localized?: boolean;
  admin?: Record<string, unknown>;
  validation?: { pattern: string; message: string };
}

interface SingleWithFields {
  source?: string;
  fields?: SingleField[];
  [key: string]: unknown;
}

/** Synthetic title field added to every UI-created Single. */
const SINGLE_TITLE_FIELD: SingleField = {
  name: "title",
  type: "text",
  label: "Title",
  required: true,
  // A main-table system column, not content. Text-like fields localize by
  // default, so without this the column the entity is titled by would be
  // classified translatable on a localized single and dropped from the main
  // table's desired shape. Collections declare their synthetic title the
  // same way.
  localized: false,
  admin: { placeholder: "Enter title" },
};

/** Synthetic slug field added to every UI-created Single. */
const SINGLE_SLUG_FIELD: SingleField = {
  name: "slug",
  type: "text",
  label: "Slug",
  required: true,
  unique: true,
  // Main-table system column — see SINGLE_TITLE_FIELD.
  localized: false,
  admin: { placeholder: "my-entry-slug" },
  validation: {
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    message: "Slug must be lowercase with hyphens only (e.g., my-entry-slug)",
  },
};

/**
 * Inject synthetic title/slug fields into UI-created Singles so the
 * Admin UI always has a title and slug to render. Code-first singles
 * already declare their own schema and are returned unchanged.
 */
function injectSingleDefaultFields<T extends SingleWithFields | null>(
  single: T
): T {
  if (!single) return single;
  const isCodeFirst = single.source === "code" || single.source === "built-in";
  if (isCodeFirst) return single;
  const baseFields = single.fields ?? [];
  // Filter out any existing title/slug fields to prevent duplicates.
  // These may exist in stored data from before the save-side filtering.
  const reservedNames = ["title", "slug"];
  const userFields = baseFields.filter(f => !reservedNames.includes(f.name));
  return {
    ...single,
    fields: [SINGLE_TITLE_FIELD, SINGLE_SLUG_FIELD, ...userFields],
  };
}

// ============================================================
// Singles services bundle
// ============================================================

interface SinglesServices {
  registry: SingleRegistryService;
  entry: SingleEntryService;
  /** Owns the pairing of a table change with the registry write that records it. */
  metadata: SingleMetadataService;
}

// ============================================================
// Method definitions
// ============================================================

/**
 * Version-history reads for a Single document.
 *
 * A Single's URL carries no entry id — there is only ever one document — so the
 * id is resolved from the live row rather than taken from params. Trusting a
 * client-supplied value would defeat the check that stops a Single recreated
 * under a new id from exposing its predecessor's snapshots.
 */
export const SINGLE_VERSION_METHODS: Record<
  string,
  MethodHandler<SinglesServices>
> = {
  // The Single's content events, behind the same read gate as its history,
  // for the live document only: its id comes from the live row.
  listSingleEvents: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      const id = await requireLiveSingleId(slug);
      return respondSubjectEvents({ kind: "single", slug, id }, p);
    },
  },
  listSingleVersions: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      const entryId = await requireLiveSingleId(slug);
      return respondVersionPage({ scopeKind: "single", slug, entryId }, p);
    },
  },
  restoreSingleVersion: {
    execute: async (_svc, p, _body, request) => {
      const slug = String(p.slug ?? "");
      // The document id comes from the live row, never from the URL: a Single
      // has exactly one document and the client must not name which.
      const entryId = await requireLiveSingleId(slug);
      const result = await restoreVersionForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: requireAuthenticatedUser(),
        actor: readAuthenticatedActor(),
        versionNo: Number(p.versionNo),
        params: p,
        // A restore replays a snapshot through the ordinary update, so its
        // hooks are told about the caller the same way an edit's are.
        request,
      });
      return respondAction("Version restored.", result);
    },
  },
  getSingleVersion: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      const entryId = await requireLiveSingleId(slug);
      const row = await getVersionForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: requireAuthenticatedUser(),
        authenticatedScope: readAuthenticatedScope(),
        versionNo: Number(p.versionNo),
      });
      return respondDoc(row);
    },
  },
  getSingleVersionDiff: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      const comparison = readComparisonParams(p);
      // Validate the request before resolving the live Single, so a malformed
      // comparison fails as a validation error whether or not the Single has
      // been materialized.
      assertComparisonRequest(comparison);
      const entryId = await requireLiveSingleId(slug);
      const diff = await getVersionDiffForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: requireAuthenticatedUser(),
        authenticatedScope: readAuthenticatedScope(),
        ...comparison,
      });
      // Private to the caller: a comparison from where this person last
      // looked differs from one person to the next.
      return withSessionCacheHeaders(respondDoc(diff));
    },
  },
  markSingleVersionSeen: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      // The live id comes from the server, never the request, as for every
      // version operation on a Single.
      const entryId = await requireLiveSingleId(slug);
      const seen = await markVersionSeenForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: requireAuthenticatedUser(),
        authenticatedScope: readAuthenticatedScope(),
        versionNo: Number(p.versionNo),
      });
      return respondMutation("Marked as seen.", seen);
    },
  },
  setSingleVersionLabel: {
    execute: async (_svc, p, body) => {
      const slug = String(p.slug ?? "");
      // Validate before resolving anything. Otherwise the same malformed
      // request answers 404 for an unmaterialized Single and 400 for a
      // materialized one, and performs a lookup it was never going to use.
      assertLabelRequestValid(Number(p.versionNo), body);
      // The live id comes from the server, never the request: a Single has one
      // document and a client-supplied id would be a way to reach another.
      const entryId = await requireLiveSingleId(slug);
      const row = await setVersionLabelForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: requireAuthenticatedUser(),
        versionNo: Number(p.versionNo),
        // See the collection handler: the body goes through whole.
        body,
        params: p,
      });
      return respondMutation("Version renamed.", row);
    },
  },
  autosaveSingle: {
    execute: async (_svc, p, body) => {
      const slug = String(p.slug ?? "");
      // Validate the body BEFORE resolving the live document. Otherwise one
      // malformed request answers 404 for an unmaterialized Single and 400 for
      // a materialized one, which tells a caller whose per-document rule has
      // not been evaluated yet whether the document exists. Same ordering the
      // label handler uses, and for the same reason.
      const snapshot = requireSnapshotBody(body);
      // As everywhere in this handler, the document id comes from the live row
      // rather than the URL: a Single has exactly one document and the client
      // must not name which one it is writing a recovery point for.
      const entryId = await requireLiveSingleId(slug);
      const item = await autosaveForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: requireAuthenticatedUser(),
        params: p,
        // The body IS the snapshot. See the collection handler.
        snapshot,
        locale: typeof p.locale === "string" && p.locale ? p.locale : null,
      });
      return respondMutation("Draft recovery point saved.", item);
    },
  },
  getSingleAutosave: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      const entryId = await requireLiveSingleId(slug);
      const item = await getAutosaveForDocument({
        scopeKind: "single",
        slug,
        entryId,
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
  discardSingleWorkingDraft: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      // The document id comes from the live row rather than the URL, as
      // everywhere in this handler: it is what the authorization checks are
      // made against, and a client-supplied one would let a caller aim them at
      // a document other than the one being written.
      const entryId = await requireLiveSingleId(slug);
      const item = await discardWorkingDraftForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: requireAuthenticatedUser(),
        params: p,
        // `?locale=` names the language whose pending change is being thrown
        // away. An empty value is the same as none: the request named no
        // language, which a localized Single resolves to its default.
        locale: typeof p.locale === "string" && p.locale ? p.locale : null,
      });
      return respondMutation("Working draft discarded.", item);
    },
  },
  takeLiveSingleSharedValues: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      // The document id comes from the live row, as for a discard: it is what
      // the authorization checks are made against.
      const entryId = await requireLiveSingleId(slug);
      const item = await takeLiveSharedValuesForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: requireAuthenticatedUser(),
        // `?locale=` names the language whose pending change takes the live
        // values. An empty value is the same as none: the default language.
        locale: typeof p.locale === "string" && p.locale ? p.locale : null,
      });
      return respondMutation("Live values taken.", item);
    },
  },
};

/**
 * The live document's id, or a not-found error when the Single has never been
 * materialized — in which case it has no history to show either.
 */
async function requireLiveSingleId(slug: string): Promise<string> {
  const id = await resolveSingleDocumentId(slug);
  if (id === null) {
    throw NextlyError.notFound({
      logContext: { reason: "single-not-materialized", slug },
    });
  }
  return id;
}

const SINGLES_METHODS: Record<string, MethodHandler<SinglesServices>> = {
  ...SINGLE_VERSION_METHODS,
  listSingles: {
    // Permission filtering is pushed into the registry as a slug allowlist
    // so the SQL count and the row results share the same scope. This keeps
    // `meta.total` and `meta.hasNext` honest for non-super-admin callers and
    // stops clients (e.g. the sidebar's auto-paginated walk) from chasing
    // hasNext through pages that filter down to zero rows.
    execute: async (svc, p) => {
      const limit = toNumber(p.limit);
      // Accept both `offset` (canonical) and `page` (1-based, what the
      // admin UI's shared buildQuery helper emits). `offset` wins when
      // both are supplied.
      let offset = toNumber(p.offset);
      if (!p.offset && p.page !== undefined && limit && limit > 0) {
        const page1Based = toNumber(p.page);
        if (page1Based !== undefined && page1Based > 0) {
          offset = (page1Based - 1) * limit;
        }
      }

      // Resolved BEFORE the registry call, through the SHARED resolver the
      // collections listing asks too, and handed the SAME caller every other
      // read decision takes -- so a Single a code rule admits is listed here
      // exactly when the dashboard offers a card for it. Session super admins
      // and unauthenticated callers (gated at the route layer) pass through
      // with `undefined`, which means "no filter"; anyone else gets an
      // explicit list, possibly empty, which the registry short-circuits to a
      // zero-row, zero-total response.
      const user = readAuthenticatedUser();
      const slugAllowlist = await readableSlugAllowlist(
        user ? readAccessCallerForDispatch(user) : undefined,
        "single"
      );

      const result = await svc.registry.listSingles({
        source: p.source as "code" | "ui" | "built-in" | undefined,
        search: p.search,
        limit,
        offset,
        slugAllowlist,
      });

      const items = result.data.map(s =>
        injectSingleDefaultFields(s as unknown as SingleWithFields)
      );
      return respondList(
        items,
        offsetPaginationToMeta({
          total: result.total,
          limit,
          offset,
        })
      );
    },
  },

  createSingle: {
    execute: async (svc, _, body) => {
      const b = body as
        | {
            slug?: string;
            label?: string;
            fields?: FieldConfig[];
            description?: string;
            admin?: Record<string, unknown>;
            // Draft/Published opt-in; persists to dynamic_singles.status.
            status?: boolean;
            // i18n: Internationalization opt-in; persists to dynamic_singles.localized and
            // provisions the companion single_<slug>_locales table.
            localized?: boolean;
            // Version history opt-in; persists to dynamic_singles.versions.
            versions?: boolean;
            // Retention: durable versions kept per document (`false` = unlimited,
            // a number = keep that many, undefined = the default 50).
            versionsMaxPerDoc?: number | false;
            // Cache-revalidation opt-out; persists to dynamic_singles.revalidate.
            revalidate?: boolean;
            // Webhook recording opt-out; persists to dynamic_singles.webhooks.
            webhooks?: boolean;
          }
        | undefined;

      if (!b?.slug) throw new Error("Single slug is required");
      // Judged by the one address rule every road shares, before the DDL below runs, so a refused
      // address leaves no `single_<slug>` table behind. A system resource's name is among its
      // refusals: it seeds the same permission rows that resource's routes check.
      assertAddressAllowed("single", b.slug);
      if (!b?.label) throw new Error("Single label is required");
      if (!b?.fields || !Array.isArray(b.fields))
        throw new Error("Single fields array is required");

      // This create path persists and runs DDL without the schema
      // preview/apply handlers. It keeps its own field rules, but nothing here
      // can judge a plugin type's own options, so an unsatisfiable declaration
      // would be stored and then fail on every write to the single.
      assertValidPluginFieldOptions(b.fields);

      const schemaHash = calculateSchemaHash(b.fields);
      // Canonical resolver keeps the UI-create path in sync with registry
      // and DDL so every call site writes and reads the same physical table.
      const tableName = resolveSingleTableName({ slug: b.slug });

      // Refused for a slug a COLLECTION already owns, one reserved by a system resource, or one
      // with the same snake_case form as another collection's or Single's address; asked before
      // the table-family check below so that refusal names both addresses. `registerSingle` makes
      // this check too, but it makes it after the table has been created, so a conflicting slug
      // rejected the request and left `single_<slug>` behind with nothing describing it. Checked
      // here, the rejection costs nothing and creates nothing. The registry keeps its own call
      // because other callers reach it without passing through this handler.
      const conflictAdapter = container.has("adapter")
        ? container.get<DrizzleAdapter>("adapter")
        : undefined;
      if (conflictAdapter) {
        await assertGlobalResourceSlugAvailable(conflictAdapter, b.slug, {
          addressKind: "single",
        });
      }

      // Refused before any DDL runs, and keyed on the TABLE FAMILY rather than the slug. A slug is
      // normalised on its way to a table name, so `foo-bar` and `foo_bar` name one physical table
      // while looking like two free slugs — and a Single's storage spans its main table AND the
      // `_locales` companion beside it, so `foo-locales` collides with `foo` the same way. The
      // registry's own check runs after the DDL, by which point the create has already acted
      // against the table that exists and rebound the runtime to this request's fields.
      const owner = (await svc.registry.getAllSingles()).find(s =>
        singleTableFamiliesCollide(s.tableName, tableName)
      );
      if (owner) {
        throw NextlyError.duplicate({
          logContext: {
            reason: "single-table-conflict",
            slug: b.slug,
            tableName,
            ownedBy: owner.slug,
          },
        });
      }

      // i18n: a localized single stores translatable values via the app's
      // `localization` config; creating one without that config would split
      // the tables into a shape the runtime cannot write to. Rejected here for
      // the same reason as the refusals above — the create below applies the
      // DDL and provisions the companion, so a rejection afterwards would
      // leave both behind.
      if (b.localized === true) {
        assertLocalizationConfigured("single", b.slug);
      }

      // The table change and the registry row are one operation, so they are issued as one:
      // the service persists the intent, applies the DDL, provisions the localized companion
      // and records the outcome. Splitting them here is what left a created table with no row
      // describing it whenever the process stopped in between.
      const { record: single, migrationStatus } =
        await svc.metadata.createSingle({
          slug: b.slug,
          label: b.label,
          tableName,
          description: b.description,
          fields: b.fields,
          admin: b.admin,
          source: "ui",
          locked: false,
          // Forward the Draft/Published flag so admin-created Singles that
          // opt in light up the Save Draft / Publish split.
          status: b.status === true,
          // i18n: persist the Internationalization flag so the single reads/writes per language.
          localized: b.localized === true,
          // Persist version history from the create payload; without it a Single
          // created with the switch on is written unversioned and the switch
          // reads as off the moment the editor loads. Retention rides along.
          versions: resolveBuilderVersions(b.versions, b.versionsMaxPerDoc),
          // Cache-revalidation opt-out from the create payload (null = standard
          // tags, { disable: true } = off), so the write path reads it back.
          revalidate: resolveBuilderRevalidate(b.revalidate),
          // Webhook recording opt-out from the create payload (null = record,
          // { record: false } = off), so boot reads it back after a restart.
          webhooks: resolveBuilderWebhooks(b.webhooks),
          schemaHash,
        });

      // Auto-seed read/update permissions for the new single.
      if (container.has("permissionSeedService")) {
        try {
          const seedService = container.get<{
            seedSinglePermissions: (
              slug: string
            ) => Promise<{ newPermissionIds: string[] }>;
            assignNewPermissionsToSuperAdmin: (
              ids: string[]
            ) => Promise<unknown>;
          }>("permissionSeedService");
          const seedResult = await seedService.seedSinglePermissions(b.slug);
          if (seedResult.newPermissionIds.length > 0) {
            await seedService.assignNewPermissionsToSuperAdmin(
              seedResult.newPermissionIds
            );
          }
        } catch (e) {
          consoleLogger.warn(
            `[Singles] Failed to seed permissions for "${b.slug}"`,
            { e }
          );
        }
      }

      // Migration status drives the toast copy so admins see "table
      // applied" vs "run migrations" without an extra round-trip.
      // 🔴 Three outcomes, not two. `failed` used to be rare enough to hide behind the pending
      // wording; the shape verification makes it a routine answer, and "run migrations" is then
      // advice that cannot work — no migration repairs a table whose columns do not match. Telling
      // an admin their Single was created when it cannot be read is the worst of the three.
      //
      // Still 201, and still carrying the row: the Single WAS registered, `migrationStatus` rides
      // in the body for a client that branches on it, and keeping the record is what makes the
      // retry a resume rather than a duplicate.
      const message =
        migrationStatus === "applied"
          ? `Single "${b.slug}" created and table applied!`
          : migrationStatus === "failed"
            ? `Single "${b.slug}" was created but its table could not be applied. It cannot be read until the schema change succeeds.`
            : `Single "${b.slug}" created. Run migrations to apply the table.`;
      return respondMutation(message, single, { status: 201 });
    },
  },

  getSingleDocument: {
    // Bare doc body. The legacy SingleResult envelope is unwrapped here
    // so a service-side failure throws a NextlyError which the
    // dispatcher's error path canonicalises.
    execute: async (svc, p, _body, request) => {
      const slug = requireParam(p, "slug", "Single slug");
      const richTextFormat = parseRichTextFormat(p.richTextFormat);
      // Absent → undefined so the service applies its published-only default
      // (an untrusted read must not leak a draft Single); pass
      // `?status=all|draft|published` to widen. An invalid value is rejected
      // with 400 rather than silently widened.
      const status = parseStatusParam(p.status);
      // Forward the caller so the service can evaluate the Single's stored read
      // rules for them. Without it those rules cannot run at all: a rule that
      // asks who is reading has no one to judge, so the admin's read setting
      // silently did nothing over HTTP. `routeAuthorized` attests the route
      // already ran the coarse RBAC gate, so only that re-check is skipped.
      const user = readAuthenticatedUser();

      const result = await svc.entry.get(slug, {
        // The request this read's hooks are told about.
        request,
        user,
        routeAuthorized: !!user,
        // A scoped API key is judged on its own read grant rather than on the
        // permissions of the account that issued it.
        authenticatedScope: readAuthenticatedScope(),
        depth: toNumber(p.depth),
        // `?locale=` selects the content language; `?fallback-locale=none`
        // disables fallback so an untranslated field reads empty (admin editor relies on
        // this); `?translation-status=1` attaches the per-locale `_translations` map for
        // the language pills. All no-op for non-localized singles.
        locale: p.locale,
        fallbackLocale: p["fallback-locale"],
        translationStatus: p["translation-status"] === "1",
        // `?draft=1` opts into the working-draft overlay, matching the entry
        // read. Gated server-side on an actual update-capability probe, so a
        // read-only caller passing it still sees the published document.
        includeWorkingDraft: isTruthyParam(p.draft),
        status,
      });

      // Transform rich text fields to requested format when not JSON.
      // Mutates result.data in place; unwrap below sees the transformed
      // payload.
      if (
        result.success &&
        result.data &&
        richTextFormat &&
        richTextFormat !== "json"
      ) {
        const single = await svc.registry.getSingleBySlug(slug);
        if (single?.fields && Array.isArray(single.fields)) {
          result.data = transformRichTextFields(
            result.data,
            single.fields,
            richTextFormat
          ) as typeof result.data;
        }
      }

      const doc = unwrapServiceResult(result, { slug });
      return respondDoc(doc);
    },
  },

  updateSingleDocument: {
    // Service returns the legacy SingleResult envelope; unwrap propagates
    // failure as a NextlyError.
    execute: async (svc, p, body, request) => {
      const slug = requireParam(p, "slug", "Single slug");
      if (!body) throw new Error("Update data is required");
      const user = readAuthenticatedUser();
      const result = await svc.entry.update(
        slug,
        body as Record<string, unknown>,
        {
          locale: p.locale,
          user,
          // The request this write's hooks are told about.
          request,
          // Who performed the write, recorded on the outbox event: an API-key
          // caller attributes to the key itself rather than the user that owns
          // it. Mirrors the collection update handler.
          actor: readAuthenticatedActor(),
          // Where route auth admitted the caller on update, `routeAuthorized`
          // skips only that re-check while field-level write access + response
          // redaction still run for this user (overrideAccess stays false). A
          // caller admitted on publish or unpublish alone is judged here.
          overrideAccess: false,
          routeAuthorized: !!user && routeAdmittedUpdate(),
          // The route authorized only `update` against an API key's scope; the
          // service-side publish/unpublish gate judges the key's own grants.
          authenticatedScope: readAuthenticatedScope(),
        }
      );
      const doc = unwrapServiceResult(result, { slug });
      return respondMutation(
        result.message ?? `Single "${slug}" updated.`,
        doc
      );
    },
  },

  publishAllSingleLocales: {
    // Publish every language of a Single in one transaction. The Single
    // equivalent of the collection entry's publish-all.
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Single slug");
      const user = readAuthenticatedUser();
      const result = await svc.entry.publishAllLocales(slug, {
        user,
        // Who performed the publish, recorded on the outbox events: an API-key
        // caller attributes to the key rather than the user that owns it.
        actor: readAuthenticatedActor(),
        overrideAccess: false,
        // The route admitted this POST on the `publish-{slug}` grant alone,
        // so it attests no gate: a Single with nothing to publish is still
        // asked update by the service.
        routeAuthorized: false,
        // The service judges an API key's own `publish-{slug}` grant and the
        // rule, in each language the publish puts live.
        authenticatedScope: readAuthenticatedScope(),
      });
      const published = unwrapServiceResult<{
        id: string;
        status?: "published";
      }>(result, { slug });
      return respondAction(result.message ?? "All languages published.", {
        slug,
        ...published,
      });
    },
  },

  deleteSingle: {
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Single slug");
      consoleLogger.info(
        `[deleteSingle] === START === slug: "${slug}" at ${new Date().toISOString()}`
      );

      // Code-first Singles are locked and cannot be deleted via API.
      const single = await svc.registry.getSingleBySlug(slug);
      consoleLogger.info(`[deleteSingle] getSingleBySlug returned`, {
        detail: single ? `found (tableName: ${single.tableName})` : "null",
      });

      if (!single) {
        throw new Error(`Single "${slug}" not found`);
      }
      if (single.locked) {
        throw NextlyError.definedInCode({
          thing: "Single",
          change: "delete",
          logContext: { reason: "single-locked-delete", slug },
        });
      }

      // The storage drop and the registry delete are one operation, so they are issued as one. Held
      // apart, a failure between them loses the row that makes the tables findable.
      // No fallback and no catch. `dispatchSingles` refuses to run any method without a metadata
      // service, so there is no path here where one is absent, and the service already treats a
      // registry row another request took as the outcome asked for. Everything else it raises —
      // storage that would not go away — is a failed delete and has to reach the caller, whatever
      // words the driver chose for it.
      await svc.metadata.deleteSingle(slug, single.tableName);

      // Spec divergence: spec §5.1 / §7.4 strictly maps delete to
      // respondMutation, but registry.deleteSingle returns void (no
      // deleted record to surface). We use respondAction here so the
      // wire shape is `{ message, slug }` rather than the awkward
      // `{ message, item: undefined }` that respondMutation would emit.
      // If registry.deleteSingle is later refactored to return the
      // deleted record, switch this back to respondMutation.
      return respondAction(`Single "${slug}" deleted successfully`, { slug });
    },
  },

  getSingleSchema: {
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Single slug");
      const single = await svc.registry.getSingleBySlug(slug);
      if (!single) {
        throw new Error(`Single "${slug}" not found`);
      }

      // Enrich component fields with inline schemas so the Admin UI
      // can render forms without extra per-component API calls.
      let enrichedData = single;
      if (single.fields) {
        try {
          const componentRegistry = getComponentRegistryFromDI();
          if (componentRegistry) {
            const enrichedFields =
              await componentRegistry.enrichFieldsWithComponentSchemas(
                single.fields as unknown as Record<string, unknown>[]
              );
            enrichedData = {
              ...single,
              fields: enrichedFields as unknown as typeof single.fields,
            };
          }
        } catch (enrichError) {
          // Non-fatal: return unenriched fields if the component registry is down.
          consoleLogger.debug(
            "[Dispatcher] Failed to enrich Single component fields",
            { error: enrichError }
          );
        }
      }

      // Whether a status-less save on this Single holds the edit rather than
      // writing the live row. Derived from the SAME predicate the write gates
      // on, which its own module requires of every call site: an editor told
      // drafts are off sends an explicit published save, and a write that names
      // a status is never held — so the pending-change support stays dark and
      // the live document is overwritten. Derived from the ORIGINAL fields, not
      // the enriched ones, because enrichment drops the markers component
      // eligibility reads.
      const draftSplit = await schemaDraftSplit({
        status: (single as { status?: boolean }).status,
        versions: single.versions,
        fields: single.fields,
        slug: (single as { slug?: string }).slug,
        localized: (single as { localized?: boolean }).localized,
        entityKind: "single",
      });

      // The schema record IS the doc here, so the admin Schema Builder
      // reads slug/fields/admin off the response body directly without
      // an envelope wrapper.
      return respondDoc({
        ...injectSingleDefaultFields(
          enrichedData as unknown as SingleWithFields
        ),
        ...draftSplitResponseFields(draftSplit),
      });
    },
  },

  updateSingleSchema: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Single slug");
      const b = body as
        | {
            label?: string;
            fields?: FieldConfig[];
            description?: string;
            admin?: Record<string, unknown>;
            // Draft/Published toggle; honoured when defined, undefined leaves
            // the existing value untouched.
            status?: boolean;
            // i18n: Internationalization toggle; honoured when defined, undefined leaves the
            // existing value untouched. Persists to dynamic_singles.localized.
            localized?: boolean;
            // Version history toggle; honoured when defined, undefined leaves
            // the existing value untouched. Persists to dynamic_singles.versions.
            versions?: boolean;
            // Retention: durable versions kept per document (`false` = unlimited,
            // a number = keep that many, undefined = the default 50).
            versionsMaxPerDoc?: number | false;
            // Cache-revalidation toggle; honoured when defined, undefined leaves
            // the existing value untouched. Persists to dynamic_singles.revalidate.
            revalidate?: boolean;
            // Webhook recording toggle; honoured when defined, undefined leaves
            // the existing value untouched. Persists to dynamic_singles.webhooks.
            webhooks?: boolean;
          }
        | undefined;

      if (!b) throw new Error("Update data is required");

      const existing = await svc.registry.getSingleBySlug(slug);
      if (!existing) {
        throw new Error(`Single "${slug}" not found`);
      }
      refuseChangeDefinedInCode(existing, "Single", slug);

      const updateData: Record<string, unknown> = {};
      if (b.label !== undefined) updateData.label = b.label;
      if (b.description !== undefined) updateData.description = b.description;
      if (b.admin !== undefined) updateData.admin = b.admin;
      if (b.status !== undefined) updateData.status = b.status;
      // i18n: persist the Internationalization toggle. `wasLocalized`/`isLocalized` drive the
      // companion provisioning below. `alterOmitLocalized` keeps translatable columns out of the
      // main-table ALTER whenever the single is localized in either state, so they are only ever
      // managed on the companion (moving existing rows between the two is the `nextly migrate`
      // path — the dev toggle provisions the companion without touching main-table data).
      if (b.localized !== undefined) updateData.localized = b.localized;
      // Version history toggle. The registry column holds the resolved config
      // every runtime reader tests, so the boolean is normalized before it is
      // stored; off writes null. `status` is deliberately not passed to the
      // resolver: it aliases to a versioned config for back-compat, which would
      // stop the toggle from turning versioning off on a Draft/Published single.
      // Retention without the on/off switch is ambiguous — the resolver needs
      // the enabled state — so a retention-only patch is rejected rather than
      // silently ignored. Mirrors the schema-detail routes.
      if (b.versionsMaxPerDoc !== undefined && b.versions === undefined) {
        throw NextlyError.validation({
          errors: [
            {
              path: "versionsMaxPerDoc",
              code: "MISSING_DEPENDENCY",
              message: "versionsMaxPerDoc requires versions to be set.",
            },
          ],
        });
      }
      if (b.versions !== undefined) {
        updateData.versions = resolveBuilderVersions(
          b.versions,
          b.versionsMaxPerDoc
        );
      }
      // Cache-revalidation toggle, normalized to the resolved config the write
      // path reads; on writes null (standard tags), off writes the disable config.
      if (b.revalidate !== undefined) {
        updateData.revalidate = resolveBuilderRevalidate(b.revalidate);
      }
      // Webhook recording toggle, normalized to the resolved policy boot reads;
      // on writes null (record), off writes the stored opt-out.
      if (b.webhooks !== undefined) {
        updateData.webhooks = resolveBuilderWebhooks(b.webhooks);
      }
      const wasLocalized = existing.localized === true;
      const isLocalized =
        b.localized !== undefined ? b.localized === true : wasLocalized;
      // i18n: gate the Internationalization enable on the app-level
      // `localization` config (false→true only — an already-localized
      // single keeps saving, and disabling is always allowed).
      if (!wasLocalized && isLocalized) {
        assertLocalizationConfigured("single", slug);
      }

      // What the single is being saved AS, and what it currently IS. Both halves are needed: the
      // ALTER adds or drops the `status` column between them, and the companion's disable restore
      // needs to know whether main carried it before this save.
      const wasStatus = (existing as { status?: boolean }).status === true;
      const hasStatus = b.status !== undefined ? b.status === true : wasStatus;

      let schemaFields: FieldDefinition[] | undefined;
      if (b.fields !== undefined) {
        // Same rules as the ui-schema.json mirror (see api/fields-payload).
        assertValidFieldsPayload(b.fields);
        updateData.fields = b.fields;
        updateData.schemaHash = calculateSchemaHash(b.fields);
        schemaFields = b.fields as unknown as FieldDefinition[];
      }

      // The schema change and the registry row are written by one service call, because a lock has
      // to cover both and cannot do that from here: the DDL would already have run by the time a
      // lock taken inside the registry service was acquired.
      const {
        record: updated,
        migrationStatus,
        refusedSettings,
      } = await svc.metadata.updateSingleSchema({
        slug,
        existing,
        updateData,
        fields: schemaFields,
        isLocalized,
        wasLocalized,
        // Whether the request SET the toggle, mirroring `statusRequested`. The service re-reads
        // the record inside its exclusion and needs to tell an explicit `localized: false` from
        // this handler having filled in the value it read.
        localizedRequested: b.localized !== undefined,
        hasStatus,
        wasStatus,
        // Whether the request SET the toggle, which is not the same as changing it: saving it at
        // its current value still reaches the companion, and that is what repairs a localized
        // single whose companion `_status` was never provisioned.
        statusRequested: b.status !== undefined,
      });

      // Leaving settings the database refused: the admin is told which setting on which field.
      refuseRefusedLeavingSettings(slug, refusedSettings);

      // Migration status drives the toast copy so admins see "applied"
      // vs "pending" immediately.
      const message =
        migrationStatus === "applied"
          ? `Single "${slug}" schema updated and migration applied successfully`
          : `Single "${slug}" schema updated. Migration pending - run migrations to apply changes.`;
      return respondMutation(message, updated);
    },
  },

  previewSingleSchemaChanges: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Single slug");
      const single = await svc.registry.getSingleBySlug(slug);
      if (!single) throw new Error("Single not found");
      refuseChangeDefinedInCode(single, "Single", slug);

      const { fields } = body as { fields: unknown[] };
      if (!fields) throw new Error("fields is required in request body");
      // Same rules as the ui-schema.json mirror (see api/fields-payload):
      // an invalid field must fail HERE, not only at the file write, or
      // the DB and the committed manifest diverge silently.
      assertValidFieldsPayload(fields);

      const currentFields = (single.fields ??
        []) as unknown as FieldDefinition[];
      const tableName = single.tableName;

      const adapter = getAdapterFromDI();
      if (!adapter) throw new Error("Database adapter not initialized");
      const dialect = adapter.dialect;
      const db = adapter.getDrizzle();

      const desired = await buildFullDesiredSchema();
      desired.singles[slug] = {
        slug,
        tableName,
        // As the apply's first push creates them (`fieldsAsFirstPushed`).
        fields: fieldsAsFirstPushed({
          oldFields: currentFields,
          newFields: fields as FieldDefinition[],
          entity: single,
          requestedLocalized: readRequestLocalized(body),
        }) as DesiredSingle["fields"],
        // Carry the Draft/Published flag so previewDesiredSchema injects
        // the `status` column into the desired snapshot.
        status: single.status === true,
        // i18n: carry localized so the preview omits translatable columns from the
        // single's main table (mirrors the apply path). The REQUEST's flag wins
        // when the Builder sent one, for the same reason the apply prefers it:
        // otherwise the preview collects resolutions for DDL the apply will not
        // run, and the save fails after the user has already confirmed.
        localized:
          readRequestLocalized(body) ??
          (single as { localized?: boolean }).localized === true,
        // Authored in the Schema Builder: this is the Builder's own save path.
        builderOwned: true,
      };

      return respondData(
        await builderSchemaPreviewBody({
          desired,
          db,
          dialect,
          slug: slug,
          tableName,
          builtBy: "collection",
          entity: single,
          currentFields,
          newFields: fields as FieldDefinition[],
          requestedLocalized: readRequestLocalized(body),
          // Legacy rows (schema_version NULL) read as 1, so the editor always has a concrete
          // version to echo back on Apply; JSON omits an undefined one and the guard would reject
          // the first save as version-less.
          schemaVersion: single.schemaVersion ?? 1,
        })
      );
    },
  },

  applySingleSchemaChanges: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Single slug");
      const single = await svc.registry.getSingleBySlug(slug);
      if (!single) throw new Error("Single not found");
      refuseChangeDefinedInCode(single, "Single", slug);

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
        resolutions?: Record<string, FieldResolution>;
        renameResolutions?: BrowserRenameResolution[];
        eventResolutions?: Resolution[];
        // i18n: the builder sends the current Internationalization toggle so a save that flips
        // i18n AND changes fields in one shot provisions the companion in the same apply, rather
        // than reading a stale registry flag. Undefined = leave the persisted value untouched.
        localized?: boolean;
      };

      if (!confirmed) throw new Error("Schema changes must be confirmed");
      if (!fields) throw new Error("fields is required in request body");
      // Same rules as the ui-schema.json mirror (see api/fields-payload):
      // an invalid field must fail HERE, not only at the file write, or
      // the DB and the committed manifest diverge silently.
      assertValidFieldsPayload(fields);

      // i18n: prefer the request's localized flag over the persisted one (which may be stale on a
      // simultaneous toggle+field-change save); fall back to the registry value.
      const wasLocalized =
        (single as { localized?: boolean }).localized === true;
      // Validated rather than coerced: `localized: "false"` would read as
      // `false` under `=== true` and turn an ordinary save of a localized
      // single into a DISABLE transition, restoring the companion's columns
      // onto the main table and archiving it.
      const isLocalized = readRequestLocalized(body) ?? wasLocalized;
      // i18n: gate the Internationalization enable on the app-level
      // `localization` config (false→true transition only).
      if (!wasLocalized && isLocalized) {
        assertLocalizationConfigured("single", slug);
      }

      const currentVersion = single.schemaVersion ?? 1;
      // Reject a stale UI save before any DDL runs so two admins editing the
      // same single cannot silently overwrite each other (last-write-wins).
      assertSchemaVersionMatch(schemaVersion, currentVersion, slug);
      const tableName = single.tableName;

      const legacyBundle = resolutions
        ? { tableName, byFieldName: resolutions }
        : undefined;

      const adapter = getAdapterFromDI();
      if (!adapter) throw new Error("Database adapter not initialized");
      // The dialog's answer on a translated field's rename, refused when it does not say,
      // before anything changes.
      const companionRename = await resolveCompanionRename(renameResolutions, {
        tableName,
        oldFields: single.fields as unknown as FieldDefinition[],
        newFields: fields as unknown as FieldDefinition[],
        wasLocalized,
        isLocalized,
        dialect: adapter.dialect,
        // A Single's table is built by the collection's generator.
        builtBy: "collection",
      });
      // A field leaving translation has preconditions of its own, asked before the push alters
      // anything.
      await archiveFieldsLeavingTranslation({
        // This builder made the table, which decides the column bounds compared.
        builtBy: "collection",
        // The rename the admin chose, or that none was; when none was offered (a storage change,
        // or no single candidate), the preflight finds it from the fields and refuses what it must.
        renamed: companionRename,
        tableName: single.tableName,
        defaultLocale: appLocalization()?.defaultLocale ?? "en",
        adapter,
        entity: slug,
        kind: "single",
        oldFields: single.fields as unknown as FieldDefinition[],
        newFields: fields as unknown as FieldDefinition[],
        wasLocalized,
        isLocalized,
        // This apply's push refuses a main-table column drop the admin did not confirm.
        mainDropsConfirmed: true,
      });
      const dialect = adapter.dialect;
      const db = adapter.getDrizzle();
      const databaseName =
        dialect === "mysql"
          ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
          : undefined;

      // A Required or Unique field leaving translation is pushed without its setting first, and
      // the setting is pushed once the companion reconcile has copied its values in, before its
      // companion column is dropped.
      const settingsDeferred = fieldsWithLeavingSettingsDeferred({
        oldFields: single.fields as unknown as FieldDefinition[],
        newFields: fields as unknown as FieldDefinition[],
        wasLocalized,
        isLocalized,
        renamed: companionRename,
      });

      const desired = await buildFullDesiredSchema();
      desired.singles[slug] = {
        slug,
        tableName,
        fields: (settingsDeferred ?? fields) as DesiredSingle["fields"],
        // Mirror previewSingleSchemaChanges so apply diffs against the
        // same desired schema.
        status: single.status === true,
        // i18n: carry the localized flag so the push diff omits translatable columns
        // from the single's main table (they live in single_<slug>_locales, reconciled
        // out-of-band below) — mirrors the collection apply path.
        localized: isLocalized,
        // Authored in the Schema Builder: this is the Builder's own save path.
        builderOwned: true,
      };

      const push = builderSchemaPush({
        dialect,
        db,
        databaseName,
        slug,
        kind: "single",
        resolutions: [
          renameResolutions ?? [],
          eventResolutions ?? [],
          legacyBundle,
        ],
      });
      // The push excludes companion tables, so single_<slug>_locales is brought in step right
      // after it: created on the first translatable field, then ADD/DROPped as the field set
      // changes (mirrors collections).
      await pushAndReconcileCompanion(push, desired, "single", {
        slug,
        tableName,
        oldFields: single.fields as unknown as FieldDefinition[],
        newFields: fields as unknown as FieldDefinition[],
        localized: isLocalized,
        wasLocalized: (single as { localized?: boolean }).localized === true,
        // Both read from the same persisted record as `wasLocalized`, so all three describe the
        // state before this apply.
        status: single.status === true,
        wasStatus: single.status === true,
        adapter,
        renamed: companionRename ?? undefined,
        // The settings the first push left off, once the shared columns hold the default
        // language's values. A new desired schema rather than an edit of the first: the pipeline
        // keeps the last one it applied, by reference, to skip a push that changes nothing.
        settleLeaving: settingsDeferred
          ? leavingSettingsStep({
              adapter,
              entity: slug,
              tableName,
              builtBy: "collection",
              oldFields: single.fields as unknown as FieldDefinition[],
              newFields: fields as unknown as FieldDefinition[],
              renamed: companionRename,
              push: () =>
                push({
                  ...desired,
                  singles: {
                    ...desired.singles,
                    [slug]: {
                      ...desired.singles[slug],
                      fields: fields as DesiredSingle["fields"],
                    },
                  },
                }),
            })
          : undefined,
      });

      const newSchemaVersion = currentVersion + 1;

      // Post-apply: update dynamic_singles fields JSON + schema_hash, advance
      // schema_version so the optimistic-lock check above sees a new value on the
      // next save (without the bump a second stale save would pass the guard), and
      // persist `localized` so a simultaneous toggle+field-change save keeps the
      // flag alongside the field set. The write is non-fatal (the DDL already
      // succeeded), but track whether it landed so the response never reports a
      // version the database did not persist.
      let versionPersisted = true;
      try {
        await adapter.update(
          "dynamic_singles",
          {
            fields: JSON.stringify(fields),
            schema_hash: calculateSchemaHash(fields as FieldConfig[]),
            migration_status: "applied",
            localized: isLocalized,
            schema_version: newSchemaVersion,
            updated_at: new Date(),
          },
          { and: [{ column: "slug", op: "=", value: slug }] }
        );
      } catch (err) {
        versionPersisted = false;
        const msg = err instanceof Error ? err.message : String(err);
        consoleLogger.warn(
          `[applySingleSchemaChanges] Post-apply metadata write failed for '${slug}': ${msg}. ` +
            `schema_version was not advanced; the save is reported at the current version so a retry re-attempts the bump.`
        );
      }

      // Post-apply: refresh in-memory runtime schema. Thread `localized` so the main
      // table omits translatable columns, then register the companion runtime table so
      // per-language reads/writes resolve in this process without a restart.
      try {
        const { table: freshTable } = generateRuntimeSchema(
          tableName,
          fields as FieldDefinition[],
          dialect,
          { localized: isLocalized, status: single.status === true }
        );
        getSchemaRegistryFromDI()?.registerDynamicSchema(tableName, freshTable);
        if (isLocalized) {
          const companion = buildCompanionRuntimeTable({
            slug,
            tableName,
            fields: fields as FieldDefinition[],
            dialect,
            localized: true,
            status: single.status === true,
          });
          if (companion) {
            getSchemaRegistryFromDI()?.registerDynamicSchema(
              companion.companionTableName,
              companion.table
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        consoleLogger.warn(
          `[applySingleSchemaChanges] In-memory schema refresh failed for '${slug}': ${msg}.`
        );
      }

      return respondAction(`Schema applied for single '${slug}'`, {
        newSchemaVersion: versionPersisted ? newSchemaVersion : currentVersion,
      });
    },
  },
};

/**
 * Dispatch a Singles method call. Resolves `SingleRegistryService` and
 * `SingleEntryService` from the DI container and throws a descriptive
 * error if either is missing so the caller (e.g. a route handler) can
 * report the misconfiguration clearly.
 */
export function dispatchSingles(
  method: string,
  params: Params,
  body: unknown,
  request?: Request
): Promise<unknown> {
  const singleRegistry = getSingleRegistryFromDI();
  const singleEntryService = getSingleEntryServiceFromDI();
  const singleMetadataService = getSingleMetadataServiceFromDI();

  if (!singleRegistry || !singleEntryService || !singleMetadataService) {
    const missing: string[] = [];
    if (!singleRegistry) missing.push("singleRegistryService");
    if (!singleEntryService) missing.push("singleEntryService");
    if (!singleMetadataService) missing.push("singleMetadataService");

    let containerStatus = "unknown";
    try {
      const hasAdapter = container.has("adapter");
      const hasLogger = container.has("logger");
      containerStatus = `adapter=${hasAdapter}, logger=${hasLogger}`;
    } catch {
      containerStatus = "container not accessible";
    }

    throw new Error(
      `Singles services not initialized. Missing: ${missing.join(", ")}. ` +
        `Container status: ${containerStatus}. ` +
        `Ensure registerServices() or getNextly() has been called before API requests.`
    );
  }

  const handler = SINGLES_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute(
    {
      registry: singleRegistry,
      entry: singleEntryService,
      metadata: singleMetadataService,
    },
    params,
    body,
    request
  );
}
