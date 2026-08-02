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
  assertDiffVersionPair,
  resolveSingleDocumentId,
} from "../../api/versions-access";
import type { FieldConfig } from "../../collections/fields/types";
import { container } from "../../di/container";
import { teardownEntityComponentData } from "../../domains/field-groups/services/teardown-entity-field-group-data";
import { resolveLocalizedFieldNames } from "../../domains/i18n/classify-fields";
import { buildCompanionTransitionStatements } from "../../domains/i18n/migration/reconcile-companion";
import { teardownEntityI18n } from "../../domains/i18n/migration/teardown-entity-i18n";
import {
  companionHasStatusColumn,
  localizedColumnsOnMain,
} from "../../domains/i18n/runtime/companion-io";
import { buildCompanionRuntimeTable } from "../../domains/i18n/runtime/companion-registration";
import { translatePipelinePreviewToLegacy } from "../../domains/schema/legacy-preview/translate";
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
import { RegexRenameDetector } from "../../domains/schema/pipeline/rename-detector";
import type { Resolution } from "../../domains/schema/pipeline/resolution/types";
import { isIdempotencyError } from "../../domains/schema/pipeline/sql-statement-utils";
import type { DesiredSingle } from "../../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import { generateRuntimeSchema } from "../../domains/schema/services/runtime-schema-generator";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";
import { calculateSchemaHash } from "../../domains/schema/services/schema-hash";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name";
import type { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import type { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import { resolveBuilderVersions } from "../../domains/versions/builder-versions";
import { resolveBuilderWebhooks } from "../../domains/webhooks/builder-webhooks";
import { NextlyError } from "../../errors";
import { transformRichTextFields } from "../../lib/field-transform";
import { resolveBuilderRevalidate } from "../../revalidation/builder-revalidate";
import { getProductionNotifier } from "../../runtime/notifications/index";
import { isReservedResourceSlug } from "../../schemas/_zod/rbac";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import {
  getI18nArchiveDdl,
  getI18nArchiveIndexRepairDdl,
} from "../../schemas/nextly-i18n-archive";
import {
  isSuperAdmin,
  listEffectivePermissions,
} from "../../services/lib/permissions";
import { applyBuilderSchema } from "../helpers/apply-builder-schema";
import {
  readAuthenticatedActor,
  readAuthenticatedScope,
} from "../helpers/authenticated-actor";
import { readAuthenticatedRoles } from "../helpers/authenticated-roles";
import { readAuthenticatedUser } from "../helpers/authenticated-user";
import { buildFullDesiredSchema } from "../helpers/desired-schema";
import {
  getAdapterFromDI,
  getComponentRegistryFromDI,
  getConfigFromDI,
  getMigrationJournalFromDI,
  getSchemaRegistryFromDI,
  getSingleEntryServiceFromDI,
  getSingleRegistryFromDI,
} from "../helpers/di";
import {
  offsetPaginationToMeta,
  unwrapServiceResult,
} from "../helpers/service-envelope";
import {
  parseRichTextFormat,
  parseStatusParam,
  requireParam,
  toNumber,
} from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

import { assertSchemaVersionMatch } from "./schema-version-guard";
import {
  assertLabelRequestValid,
  getVersionDiffForDocument,
  getVersionForDocument,
  restoreVersionForDocument,
  setVersionLabelForDocument,
  listVersionsForDocument,
  userFromParams,
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
  admin: { placeholder: "Enter title" },
};

/** Synthetic slug field added to every UI-created Single. */
const SINGLE_SLUG_FIELD: SingleField = {
  name: "slug",
  type: "text",
  label: "Slug",
  required: true,
  unique: true,
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
// Migration SQL execution helper

// ============================================================
// Singles services bundle
// ============================================================

interface SinglesServices {
  registry: SingleRegistryService;
  entry: SingleEntryService;
}

// ============================================================
// i18n helpers
// ============================================================

/**
 * Provision (create / ADD-DROP columns / drop) the single's companion `single_<slug>_locales`
 * table out-of-band after a schema apply, then register its runtime table so per-language
 * reads/writes resolve without a restart. The push pipeline excludes companion tables, so every
 * single write/create/apply path that changes the localized field set goes through here.
 *
 * Shared by createSingle, updateSingleSchema and applySingleSchemaChanges so the three stay in
 * lockstep. No-op when the single isn't localized (a non-localized single has no companion).
 * The DDL reconcile throws on failure (data-integrity critical); the runtime registration is
 * best-effort (recovered on next restart).
 */
async function reconcileSingleCompanion(args: {
  slug: string;
  tableName: string;
  oldFields: FieldDefinition[];
  newFields: FieldDefinition[];
  /** Localization state AFTER this save (requested). */
  localized: boolean;
  /** Localization state BEFORE this save (persisted). Drives enable/disable detection. */
  wasLocalized: boolean;
  status: boolean;
  /**
   * Whether the single had Draft/Published BEFORE this apply.
   *
   * Separate from `status` because the disable restore asks a different question: not what the
   * single is being saved as, but whether main carried `status` and the companion `_status`
   * beforehand — a copy from columns that were not there fails the whole migration.
   */
  wasStatus: boolean;
  adapter: DrizzleAdapter;
}): Promise<void> {
  const {
    slug,
    tableName,
    oldFields,
    newFields,
    localized,
    status,
    wasStatus,
    adapter,
  } = args;
  const wasLocalized = args.wasLocalized;
  // Nothing to do when the single was and remains non-localized.
  if (!wasLocalized && !localized) return;

  const dialect = adapter.dialect;
  const companionTable = `${tableName}_locales`;
  const companionExists = await adapter.tableExists(companionTable);
  // Only introspect `_status` when it can matter: an existing companion that stays localized
  // (a later Draft/Published toggle must ADD/DROP `_status`).
  const companionHasStatus =
    companionExists && wasLocalized && localized
      ? await companionHasStatusColumn(adapter, companionTable)
      : undefined;

  // The seed (enable) and restore (disable) copy the default-locale value to/from the companion;
  // read the configured default locale (falls back to "en" when localization isn't configured).
  const defaultLocale = getConfigFromDI()?.localization?.defaultLocale ?? "en";

  const plan = buildCompanionTransitionStatements({
    slug,
    tableName,
    dialect,
    defaultLocale,
    status,
    wasLocalized,
    isLocalized: localized,
    oldFields,
    newFields,
    companionExists,
    companionHasStatus,
    wasStatus,
    // Which translatable columns the main table still carries. A disable must not re-add one that
    // is already there, and must still restore it: presence says the column exists, never that its
    // value is current, because every localized write went to the companion alone.
    existingMainColumns: await localizedColumnsOnMain(
      adapter,
      tableName,
      oldFields
    ).then(cols => cols.map(c => c.name)),
  });

  // A disable archives non-default translations, so ensure `nextly_i18n_archive` exists first
  // (Builder entities have no `nextly migrate` step to provision it). Idempotent.
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
  for (const stmt of plan.statements) {
    await adapter.executeQuery(stmt);
  }

  // The transition record describes a companion that no longer exists, so it stops being true the
  // moment the disable succeeds. Left behind, it would refuse the next enable's real source locale
  // — the check that protects a live transition would block a legitimate one instead.
  if (plan.companionDropped) {
    // The other half of "this companion is gone": readiness remembers only that one exists.
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
      "single",
      slug
    );
  }

  // Register the companion runtime table (best-effort — next boot re-registers it). Skipped when
  // the plan dropped the companion (disable) or the single is no longer localized.
  if (!plan.companionDropped && localized) {
    try {
      const companion = buildCompanionRuntimeTable({
        slug,
        tableName,
        fields: newFields,
        dialect,
        localized: true,
        status,
      });
      if (companion) {
        getSchemaRegistryFromDI()?.registerDynamicSchema(
          companion.companionTableName,
          companion.table
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[reconcileSingleCompanion] Companion runtime registration failed for '${slug}': ${msg}.`
      );
    }
  }
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
  listSingleVersions: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      const entryId = await requireLiveSingleId(slug);
      const result = await listVersionsForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: userFromParams(p),
        authenticatedScope: readAuthenticatedScope(p),
        limit: p.limit !== undefined ? Number(p.limit) : undefined,
        cursor: p.cursor !== undefined ? Number(p.cursor) : undefined,
        locale: p.locale !== undefined ? String(p.locale) : undefined,
      });
      return respondList(result.items, result.meta);
    },
  },
  restoreSingleVersion: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      // The document id comes from the live row, never from the URL: a Single
      // has exactly one document and the client must not name which.
      const entryId = await requireLiveSingleId(slug);
      const result = await restoreVersionForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: userFromParams(p),
        actor: readAuthenticatedActor(p),
        versionNo: Number(p.versionNo),
        params: p,
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
        user: userFromParams(p),
        authenticatedScope: readAuthenticatedScope(p),
        versionNo: Number(p.versionNo),
      });
      return respondDoc(row);
    },
  },
  getSingleVersionDiff: {
    execute: async (_svc, p) => {
      const slug = String(p.slug ?? "");
      const from = Number(p.from);
      const to = Number(p.to);
      // Validate the version pair before resolving the live Single, so a
      // malformed comparison fails as a validation error whether or not the
      // Single has been materialized.
      assertDiffVersionPair(from, to);
      const entryId = await requireLiveSingleId(slug);
      const diff = await getVersionDiffForDocument({
        scopeKind: "single",
        slug,
        entryId,
        user: userFromParams(p),
        authenticatedScope: readAuthenticatedScope(p),
        from,
        to,
        modifiedOnly: p.modifiedOnly === "1" || p.modifiedOnly === "true",
      });
      return respondDoc(diff);
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
        user: userFromParams(p),
        versionNo: Number(p.versionNo),
        // See the collection handler: the body goes through whole.
        body,
        params: p,
      });
      return respondMutation("Version renamed.", row);
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

      const userId = p._authenticatedUserId
        ? String(p._authenticatedUserId)
        : undefined;

      // Resolve the per-user readable-slug allowlist BEFORE the registry
      // call. Super admins (and unauthenticated callers, who are gated at
      // the route layer) pass through with `slugAllowlist: undefined`,
      // which means "no filter". Authenticated non-super-admins get an
      // explicit list (possibly empty); the registry short-circuits an
      // empty list to a zero-row, zero-total response.
      let slugAllowlist: string[] | undefined;
      if (userId) {
        const superAdmin = await isSuperAdmin(userId);
        if (!superAdmin) {
          const permissionPairs = await listEffectivePermissions(userId);
          slugAllowlist = Array.from(
            new Set(
              permissionPairs
                .filter(pair => pair.endsWith(":read"))
                .map(pair => pair.split(":")[0])
            )
          );
        }
      }

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
      // Rejected before the DDL below runs: a reserved slug seeds the same
      // permission rows a system resource's routes check, and checking only at
      // registration (further down) would create `single_<slug>` and its locale
      // companion first, leaving orphan tables when registration then refused it.
      if (isReservedResourceSlug(b.slug)) {
        throw NextlyError.validation({
          errors: [
            {
              path: "slug",
              code: "reserved_slug",
              message:
                "This name is reserved by Nextly and cannot be used as a slug. Choose a different name.",
            },
          ],
          logContext: { reason: "system-resource-slug", slug: b.slug },
        });
      }
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

      // Generate migration SQL for the Single's data table. Passing
      // isSingle: true skips the slug column and auto-adds updated_at.
      // Pass hasStatus so the data table also gets a `status` column
      // when the user opted into Draft/Published — without it the
      // runtime schema would expect a column the DDL never created.
      // The dialect comes from the adapter that will run this DDL, not from
      // the service's own DB_DIALECT default — that variable is optional and
      // falls back to "postgresql", so an app configured with only a MySQL or
      // SQLite DATABASE_URL would create this table as PostgreSQL.
      //
      // Read the same optional way the execution below reads it: with no
      // adapter registered the statements are generated and never run, so the
      // service keeps its own default rather than this path demanding a
      // connection it is not going to use.
      const isLocalized = b.localized === true;

      // Run migration immediately (same semantics as Collections).
      let migrationStatus: "pending" | "applied" | "failed" = "pending";

      try {
        if (container.has("adapter")) {
          const adapter = container.get<DrizzleAdapter>("adapter");

          // The same route the SAVE handler takes. Creating through the shared pipeline is what
          // gives a created table the column types the ORM binds, the index set a code-first
          // definition would produce, and a row in the schema journal.
          await applyBuilderSchema({
            adapter,
            dialect: adapter.getCapabilities().dialect,
            slug: b.slug,
            kind: "single",
            apply: desired => {
              desired.singles[b.slug!] = {
                slug: b.slug!,
                tableName,
                fields: b.fields as DesiredSingle["fields"],
                status: b.status === true,
                // i18n: carry the flag so the diff omits translatable columns from the main
                // table — they live in single_<slug>_locales, provisioned below.
                localized: isLocalized,
              };
            },
          });

          const tableExists = await adapter.tableExists(tableName);
          if (tableExists) {
            migrationStatus = "applied";

            // Register runtime schema so the adapter can resolve this
            // table immediately without a server restart.
            try {
              const { generateRuntimeSchema } = await import(
                "../../domains/schema/services/runtime-schema-generator"
              );
              const dialect = adapter.getCapabilities().dialect;
              const { table: runtimeTable } = generateRuntimeSchema(
                tableName,
                b.fields as unknown as FieldDefinition[],
                dialect,
                // i18n: main runtime table omits translatable columns for a localized single.
                { status: b.status === true, localized: isLocalized }
              );
              const resolver = (
                adapter as unknown as {
                  tableResolver?: {
                    registerDynamicSchema?: (
                      name: string,
                      table: unknown
                    ) => void;
                  };
                }
              ).tableResolver;
              if (
                resolver &&
                typeof resolver.registerDynamicSchema === "function"
              ) {
                resolver.registerDynamicSchema(tableName, runtimeTable);
              }
            } catch {
              // Non-fatal: schema will be registered on next server restart.
            }

            // i18n: provision the companion single_<slug>_locales table for a localized single
            // (create-only — the single is brand new) and register its runtime table. The push
            // pipeline excludes companions, so this is the only place it gets created on create.
            try {
              await reconcileSingleCompanion({
                slug: b.slug,
                tableName,
                oldFields: [],
                newFields: b.fields as unknown as FieldDefinition[],
                localized: isLocalized,
                // A brand-new single was never localized before, so a localized create is a
                // create-only companion (no seed/drop) rather than an enable transition.
                wasLocalized: false,
                // A single being created has no prior state at all.
                wasStatus: false,
                status: b.status === true,
                adapter,
              });
            } catch (companionErr) {
              migrationStatus = "failed";
              const m =
                companionErr instanceof Error
                  ? companionErr.message
                  : String(companionErr);
              console.error(
                `[Singles] Companion provisioning failed for "${tableName}": ${m}`
              );
            }
          } else {
            migrationStatus = "failed";
            console.error(
              `[Singles] Table "${tableName}" was not created after migration`
            );
          }
        } else {
          console.warn(
            "[Singles] No adapter found in container, migration not executed"
          );
        }
      } catch (migrationError) {
        migrationStatus = "failed";
        const message =
          migrationError instanceof Error
            ? migrationError.message
            : String(migrationError);
        // The statements belong to the pipeline now, which reports them through the journal row
        // and the notifier rather than through this handler.
        console.error("[Singles] Migration execution failed:", message);
      }

      const single = await svc.registry.registerSingle({
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
        localized: isLocalized,
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
        migrationStatus,
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
          console.warn(
            `[Singles] Failed to seed permissions for "${b.slug}":`,
            e
          );
        }
      }

      // Migration status drives the toast copy so admins see "table
      // applied" vs "run migrations" without an extra round-trip.
      const message =
        migrationStatus === "applied"
          ? `Single "${b.slug}" created and table applied!`
          : `Single "${b.slug}" created. Run migrations to apply the table.`;
      return respondMutation(message, single, { status: 201 });
    },
  },

  getSingleDocument: {
    // Bare doc body. The legacy SingleResult envelope is unwrapped here
    // so a service-side failure throws a NextlyError which the
    // dispatcher's error path canonicalises.
    execute: async (svc, p) => {
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
      const user = readAuthenticatedUser(p);

      const result = await svc.entry.get(slug, {
        user,
        routeAuthorized: !!user,
        // A scoped API key is judged on its own read grant rather than on the
        // permissions of the account that issued it.
        authenticatedScope: readAuthenticatedScope(p),
        depth: toNumber(p.depth),
        // `?locale=` selects the content language; `?fallback-locale=none`
        // disables fallback so an untranslated field reads empty (admin editor relies on
        // this); `?translation-status=1` attaches the per-locale `_translations` map for
        // the language pills. All no-op for non-localized singles.
        locale: p.locale,
        fallbackLocale: p["fallback-locale"],
        translationStatus: p["translation-status"] === "1",
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
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Single slug");
      if (!body) throw new Error("Update data is required");
      const roles = readAuthenticatedRoles(p);
      const user = p._authenticatedUserId
        ? {
            id: String(p._authenticatedUserId),
            name: p._authenticatedUserName
              ? String(p._authenticatedUserName)
              : undefined,
            email: p._authenticatedUserEmail
              ? String(p._authenticatedUserEmail)
              : undefined,
            // Forward decoded role slugs so field-level `access.read` redaction
            // evaluates against the caller's roles, matching the collection and
            // standalone-single paths.
            roles,
            // Also expose a representative singular `role` so field-level
            // `access.update`/`access.read` callbacks reading `req.user.role`
            // see an authorized value instead of stripping fields.
            role: roles?.[0],
          }
        : undefined;
      const result = await svc.entry.update(
        slug,
        body as Record<string, unknown>,
        {
          locale: p.locale,
          user,
          // Who performed the write, recorded on the outbox event: an API-key
          // caller attributes to the key itself rather than the user that owns
          // it. Mirrors the collection update handler.
          actor: readAuthenticatedActor(p),
          // Route auth already ran the RBAC gate; `routeAuthorized` skips only
          // that re-check while field-level write access + response redaction
          // still run for this user (overrideAccess stays false).
          overrideAccess: false,
          routeAuthorized: !!user,
          // The route authorized only `update` against an API key's scope; the
          // service-side publish/unpublish gate judges the key's own grants.
          authenticatedScope: readAuthenticatedScope(p),
        }
      );
      const doc = unwrapServiceResult(result, { slug });
      return respondMutation(
        result.message ?? `Single "${slug}" updated.`,
        doc
      );
    },
  },

  deleteSingle: {
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Single slug");
      console.log(
        `[deleteSingle] === START === slug: "${slug}" at ${new Date().toISOString()}`
      );

      // Code-first Singles are locked and cannot be deleted via API.
      const single = await svc.registry.getSingleBySlug(slug);
      console.log(
        `[deleteSingle] getSingleBySlug returned:`,
        single ? `found (tableName: ${single.tableName})` : "null"
      );

      if (!single) {
        throw new Error(`Single "${slug}" not found`);
      }
      if (single.locked) {
        throw new Error(
          `Single "${slug}" is locked and cannot be deleted. Code-first Singles must be removed from code.`
        );
      }

      // Drop the data table FIRST so we don't leave orphans if deletion fails.
      const tableName = single.tableName;
      if (tableName && container.has("adapter")) {
        const adapter = container.get<DrizzleAdapter>("adapter");
        // Embedded component instances point back at this table by a plain string with
        // no FK, so the drop below cascades nothing and would strand them. Sweep first.
        await teardownEntityComponentData({ adapter, parentTable: tableName });

        // Remove the companion `_locales` table and this single's archive rows before
        // the main table. The companion holds an FK to `<main>.id`, so it must go first
        // or the main drop orphans it (Postgres) / is rejected by the FK (MySQL).
        await teardownEntityI18n({ adapter, slug, tableName, kind: "single" });

        // Use dialect-appropriate quoting for the table name.
        const dialect = adapter.dialect || "postgresql";
        const quotedTableName =
          dialect === "mysql" ? `\`${tableName}\`` : `"${tableName}"`;
        // Postgres needs CASCADE to drop dependent objects: the companion's FK makes the
        // main table an FK target, and a non-cascading drop of one raises. Failures
        // propagate so a single that cannot be fully removed stays intact and retryable
        // rather than losing its registry row while its tables survive.
        const dropSql =
          dialect === "postgresql"
            ? `DROP TABLE IF EXISTS ${quotedTableName} CASCADE`
            : `DROP TABLE IF EXISTS ${quotedTableName}`;
        await adapter.executeQuery(dropSql);
      }

      // Delete the metadata from the dynamic_singles registry.
      try {
        await svc.registry.deleteSingle(slug, { force: true });
      } catch (deleteError) {
        const message =
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError);
        if (message.includes("not found")) {
          console.log(
            `[deleteSingle] Metadata already deleted for "${slug}", treating as success`
          );
        } else {
          throw deleteError;
        }
      }

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
          console.debug(
            "[Dispatcher] Failed to enrich Single component fields:",
            enrichError
          );
        }
      }

      // The schema record IS the doc here, so the admin Schema Builder
      // reads slug/fields/admin off the response body directly without
      // an envelope wrapper.
      return respondDoc(
        injectSingleDefaultFields(enrichedData as unknown as SingleWithFields)
      );
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
      if (existing.locked) {
        throw new Error(
          `Single "${slug}" is locked and cannot be modified via UI. Code-first Singles must be updated in code.`
        );
      }

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
      const alterOmitLocalized = isLocalized || wasLocalized;

      let migrationStatus = existing.migrationStatus;

      if (b.fields !== undefined) {
        // Same rules as the ui-schema.json mirror (see api/fields-payload).
        assertValidFieldsPayload(b.fields);
        updateData.fields = b.fields;
        updateData.schemaHash = calculateSchemaHash(b.fields);

        // Generate and execute ALTER TABLE migration. The dialect comes from
        // the adapter that will run it, for the same reason as the create
        // path above: the service's own default is "postgresql". Read
        // optionally, matching how the execution below reads it.
        const tableName = existing.tableName;

        // The system columns are NOT restated here. They were, back when the generator this path
        // used did not inject them and the diff would otherwise have tried to add columns the table
        // already had. The shared pipeline injects id, created_at and updated_at itself, and
        // title/slug unless a user field claims those names, so restating them describes the same
        // physical column twice: the appended user definition wins the name map and carries neither
        // the system default nor the system nullability, and a rebuild hands Drizzle a duplicate
        // column name. The create path above never restated them, so dropping them here also makes
        // the two paths describe a single the same way.

        // i18n: when the single is localized (in either state), translatable columns live on the
        // companion, never the main table — drop them from the ALTER input so the main-table diff
        // never tries to ADD/DROP them. `reconcileSingleCompanion` owns the companion side.
        const omitLocalized = (
          fields: FieldDefinition[]
        ): FieldDefinition[] => {
          if (!alterOmitLocalized) return fields;
          const localizedNames = new Set(
            resolveLocalizedFieldNames(fields, true)
          );
          return fields.filter(f => !localizedNames.has(f.name));
        };
        // The previous shape is no longer assembled here. The pipeline reads what the database
        // actually has rather than being told what it used to hold, so a stale or hand-edited
        // registry row can no longer produce an alter against a shape that was never there.

        const newFieldsRaw = b.fields as unknown as FieldDefinition[];
        const normalizedNewFields: FieldDefinition[] =
          omitLocalized(newFieldsRaw);

        // Forward status flags so the alter migration can ADD/DROP the
        // `status` column when the user toggles Draft/Published. `existing`
        // holds the previous value; `b.status` holds what the user is
        // saving (undefined = leave alone).
        const wasStatus = (existing as { status?: boolean }).status === true;
        const hasStatus =
          b.status !== undefined ? b.status === true : wasStatus;
        migrationStatus = "pending";

        try {
          if (container.has("adapter")) {
            const adapter = container.get<DrizzleAdapter>("adapter");

            // One route whether or not the table is there. The pipeline diffs the declared shape
            // against what the database actually has, so the missing-table case (an earlier create
            // that failed) needs no branch of its own — it simply produces a create instead of an
            // alter, from the same declaration.
            await applyBuilderSchema({
              adapter,
              dialect: adapter.getCapabilities().dialect,
              slug,
              kind: "single",
              apply: desired => {
                desired.singles[slug] = {
                  slug,
                  tableName,
                  fields: normalizedNewFields as DesiredSingle["fields"],
                  status: hasStatus,
                  localized: isLocalized,
                };
              },
            });

            const tableExistsAfter = await adapter.tableExists(tableName);
            if (tableExistsAfter) {
              migrationStatus = "applied";

              // Re-register runtime schema with updated fields.
              try {
                const { generateRuntimeSchema } = await import(
                  "../../domains/schema/services/runtime-schema-generator"
                );
                const dialect = adapter.getCapabilities().dialect;
                const { table: runtimeTable } = generateRuntimeSchema(
                  tableName,
                  (b.fields ?? existing.fields) as FieldDefinition[],
                  dialect,
                  // i18n: main runtime table omits translatable columns when localized.
                  { status: hasStatus, localized: isLocalized }
                );
                const resolver = (
                  adapter as unknown as {
                    tableResolver?: {
                      registerDynamicSchema?: (
                        name: string,
                        table: unknown
                      ) => void;
                    };
                  }
                ).tableResolver;
                if (
                  resolver &&
                  typeof resolver.registerDynamicSchema === "function"
                ) {
                  resolver.registerDynamicSchema(tableName, runtimeTable);
                }
              } catch {
                // Non-fatal.
              }

              // i18n: provision/alter the companion single_<slug>_locales table for the new
              // localized field set: CREATE + seed the default locale from main and drop those
              // columns when newly localized (enable), restore + archive + drop on disable, or
              // ADD/DROP columns as translatable fields change. `wasLocalized` drives the
              // enable/disable detection.
              try {
                await reconcileSingleCompanion({
                  slug,
                  tableName,
                  oldFields: existing.fields as unknown as FieldDefinition[],
                  newFields: (b.fields ??
                    existing.fields) as unknown as FieldDefinition[],
                  localized: isLocalized,
                  wasLocalized,
                  status: hasStatus,
                  // Already computed above from the persisted record, for the shared ALTER. The
                  // disable restore needs the same fact.
                  wasStatus,
                  adapter,
                });
              } catch (companionErr) {
                migrationStatus = "failed";
                const m =
                  companionErr instanceof Error
                    ? companionErr.message
                    : String(companionErr);
                console.error(
                  `[Singles] Companion reconcile failed for "${tableName}": ${m}`
                );
              }
            } else {
              migrationStatus = "failed";
              console.error(
                `[Singles] Table "${tableName}" not found after migration update`
              );
            }
          } else {
            console.warn(
              "[Singles] No adapter found in container, migration not executed"
            );
          }
        } catch (migrationError) {
          const message =
            migrationError instanceof Error
              ? migrationError.message
              : String(migrationError);
          // Reported through the journal row and the notifier by the pipeline now.
          console.error("[Singles] Migration execution failed:", message);
          // Refused rather than recorded. The field changes are already staged into `updateData`,
          // so returning here would store definitions describing columns the table does not have —
          // and the next save would then diff against a shape that was never applied. This endpoint
          // carries no way to resolve a rename prompt, so a refusal is a real outcome rather than a
          // remote one, and the caller has to learn the change did not happen.
          throw NextlyError.internal({
            logContext: {
              reason: "single_schema_apply_failed",
              slug,
              detail: message,
            },
          });
        }

        updateData.migrationStatus = migrationStatus;
      } else if (
        isLocalized !== wasLocalized ||
        (b.status !== undefined && (isLocalized || wasLocalized))
      ) {
        // Flag-only save (no field changes) that still needs companion work: an i18n
        // enable/disable transition, or a Draft/Published toggle on a localized single (which
        // ADDs/DROPs the companion `_status`). Without this, a settings-only toggle persisted the
        // flag while leaving the physical schema untouched — data would strand in the wrong table.
        try {
          if (container.has("adapter")) {
            const adapter = container.get<DrizzleAdapter>("adapter");
            const tableName = existing.tableName;
            const existingFields =
              existing.fields as unknown as FieldDefinition[];
            // What the single is being saved AS, and what it currently IS. The disable restore
            // needs the second: whether main carried `status` and the companion `_status` before
            // this apply.
            const wasStatus =
              (existing as { status?: boolean }).status === true;
            const hasStatus =
              b.status !== undefined ? b.status === true : wasStatus;
            await reconcileSingleCompanion({
              slug,
              tableName,
              oldFields: existingFields,
              newFields: existingFields,
              localized: isLocalized,
              wasLocalized,
              status: hasStatus,
              wasStatus,
              adapter,
            });
            // Re-register the main runtime table so it reflects the new column shape: a disable
            // restores the translatable columns onto main, an enable omits them.
            try {
              const dialect = adapter.getCapabilities().dialect;
              const { table: runtimeTable } = generateRuntimeSchema(
                tableName,
                existingFields,
                dialect,
                { status: hasStatus, localized: isLocalized }
              );
              const resolver = (
                adapter as unknown as {
                  tableResolver?: {
                    registerDynamicSchema?: (
                      name: string,
                      table: unknown
                    ) => void;
                  };
                }
              ).tableResolver;
              if (typeof resolver?.registerDynamicSchema === "function") {
                resolver.registerDynamicSchema(tableName, runtimeTable);
              }
            } catch {
              // Non-fatal: next boot re-registers the runtime table.
            }
            updateData.migrationStatus = "applied";
          }
        } catch (companionErr) {
          const m =
            companionErr instanceof Error
              ? companionErr.message
              : String(companionErr);
          console.error(
            `[Singles] Companion transition failed for "${existing.tableName}": ${m}`
          );
          updateData.migrationStatus = "failed";
        }
      }

      const updated = await svc.registry.updateSingle(slug, updateData, {
        source: "ui",
      });

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
      if (single.locked) {
        throw new Error(
          "This single is managed via code and cannot be modified in the UI"
        );
      }

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
        fields: fields as DesiredSingle["fields"],
        // Carry the Draft/Published flag so previewDesiredSchema injects
        // the `status` column into the desired snapshot.
        status: single.status === true,
        // i18n: carry localized so the preview omits translatable columns from the
        // single's main table (mirrors the apply path).
        localized: (single as { localized?: boolean }).localized === true,
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

      const renamed = pipelinePreview.candidates.map(c => ({
        table: c.tableName,
        from: c.fromColumn,
        to: c.toColumn,
        fromType: c.fromType,
        toType: c.toType,
        typesCompatible: c.typesCompatible,
        defaultSuggestion: c.defaultSuggestion,
      }));

      const legacyAsRecord = legacyShape as unknown as Record<string, unknown>;
      return respondData({
        ...legacyAsRecord,
        renamed,
        schemaVersion: single.schemaVersion ?? 1,
      });
    },
  },

  applySingleSchemaChanges: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Single slug");
      const single = await svc.registry.getSingleBySlug(slug);
      if (!single) throw new Error("Single not found");
      if (single.locked) {
        throw new Error(
          "This single is managed via code and cannot be modified in the UI"
        );
      }

      const {
        fields,
        confirmed,
        schemaVersion,
        resolutions,
        renameResolutions,
        eventResolutions,
        localized: requestLocalized,
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
      const isLocalized =
        requestLocalized !== undefined
          ? requestLocalized === true
          : (single as { localized?: boolean }).localized === true;

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
      const dialect = adapter.dialect;
      const db = adapter.getDrizzle();
      const databaseName =
        dialect === "mysql"
          ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
          : undefined;

      const desired = await buildFullDesiredSchema();
      desired.singles[slug] = {
        slug,
        tableName,
        fields: fields as DesiredSingle["fields"],
        // Mirror previewSingleSchemaChanges so apply diffs against the
        // same desired schema.
        status: single.status === true,
        // i18n: carry the localized flag so the push diff omits translatable columns
        // from the single's main table (they live in single_<slug>_locales, reconciled
        // out-of-band below) — mirrors the collection apply path.
        localized: isLocalized,
      };

      const promptDispatcher = new BrowserPromptDispatcher(
        renameResolutions ?? [],
        eventResolutions ?? [],
        legacyBundle
      );

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
        notifier: getProductionNotifier(),
      });

      const result = await pipeline.apply({
        desired,
        db,
        dialect,
        source: "ui",
        promptChannel: "browser",
        databaseName,
        uiTargetSlug: slug,
      });

      if (!result.success) {
        throw new Error(
          result.error?.message ?? "Failed to apply schema changes"
        );
      }

      // i18n: the push pipeline excludes companion tables, so reconcile the single's companion
      // out-of-band — create single_<slug>_locales on the first translatable field, then ADD/DROP
      // columns as the field set changes (mirrors collections). Uses the request's `isLocalized`.
      try {
        await reconcileSingleCompanion({
          slug,
          tableName,
          oldFields: single.fields as unknown as FieldDefinition[],
          newFields: fields as unknown as FieldDefinition[],
          localized: isLocalized,
          // Detect an enable/disable transition against the persisted state so this apply
          // seeds/restores existing rows rather than only creating an empty companion.
          wasLocalized: (single as { localized?: boolean }).localized === true,
          status: single.status === true,
          // Read from the same persisted record as `wasLocalized`, so both describe the state
          // before this apply.
          wasStatus: single.status === true,
          adapter,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw NextlyError.internal({
          cause: err instanceof Error ? err : undefined,
          logContext: { op: "singleCompanionReconcile", slug, detail: msg },
        });
      }

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
        console.warn(
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
        console.warn(
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
  body: unknown
): Promise<unknown> {
  const singleRegistry = getSingleRegistryFromDI();
  const singleEntryService = getSingleEntryServiceFromDI();

  if (!singleRegistry || !singleEntryService) {
    const missing: string[] = [];
    if (!singleRegistry) missing.push("singleRegistryService");
    if (!singleEntryService) missing.push("singleEntryService");

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
    { registry: singleRegistry, entry: singleEntryService },
    params,
    body
  );
}
