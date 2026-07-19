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

import { assertValidFieldsPayload } from "../../api/fields-payload";
import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "../../api/response-shapes";
import type { FieldConfig } from "../../collections/fields/types";
import { container } from "../../di/container";
import { DynamicCollectionSchemaService } from "../../domains/dynamic-collections/services/dynamic-collection-schema-service";
import { resolveLocalizedFieldNames } from "../../domains/i18n/classify-fields";
import { buildCompanionReconcileSql } from "../../domains/i18n/migration/reconcile-companion";
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
import type { DesiredSingle } from "../../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import { generateRuntimeSchema } from "../../domains/schema/services/runtime-schema-generator";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";
import { calculateSchemaHash } from "../../domains/schema/services/schema-hash";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name";
import type { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import type { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import { transformRichTextFields } from "../../lib/field-transform";
import { getProductionNotifier } from "../../runtime/notifications/index";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import {
  isSuperAdmin,
  listEffectivePermissions,
} from "../../services/lib/permissions";
import { readAuthenticatedRoles } from "../helpers/authenticated-roles";
import { buildFullDesiredSchema } from "../helpers/desired-schema";
import {
  getAdapterFromDI,
  getComponentRegistryFromDI,
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
  requireParam,
  toNumber,
} from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

import { assertSchemaVersionMatch } from "./schema-version-guard";

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

async function executeMigrationStatements(
  adapter: DrizzleAdapter,
  migrationSQL: string
): Promise<void> {
  const statements = migrationSQL
    .split("--> statement-breakpoint")
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    const cleanStatement = statement
      .split("\n")
      .filter(line => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (cleanStatement) {
      await adapter.executeQuery(cleanStatement);
    }
  }
}

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
  localized: boolean;
  status: boolean;
  adapter: DrizzleAdapter;
}): Promise<void> {
  const { slug, tableName, oldFields, newFields, localized, status, adapter } =
    args;
  if (!localized) return;
  const dialect = adapter.dialect;

  const oldLocalizedNames = new Set(resolveLocalizedFieldNames(oldFields, true));
  const newLocalizedNames = new Set(resolveLocalizedFieldNames(newFields, true));
  const companionSQL = buildCompanionReconcileSql({
    slug,
    tableName,
    oldLocalized: oldFields.filter(f => oldLocalizedNames.has(f.name)),
    newLocalized: newFields.filter(f => newLocalizedNames.has(f.name)),
    dialect,
    status,
    companionExists: await adapter.tableExists(`${tableName}_locales`),
  });
  for (const stmt of companionSQL.split(";")) {
    const s = stmt.trim();
    if (s) await adapter.executeQuery(s);
  }

  // Register the companion runtime table (best-effort — next boot re-registers it).
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

// ============================================================
// Method definitions
// ============================================================

const SINGLES_METHODS: Record<string, MethodHandler<SinglesServices>> = {
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
          }
        | undefined;

      if (!b?.slug) throw new Error("Single slug is required");
      if (!b?.label) throw new Error("Single label is required");
      if (!b?.fields || !Array.isArray(b.fields))
        throw new Error("Single fields array is required");

      const schemaHash = calculateSchemaHash(b.fields);
      // Canonical resolver keeps the UI-create path in sync with registry
      // and DDL so every call site writes and reads the same physical table.
      const tableName = resolveSingleTableName({ slug: b.slug });

      // Generate migration SQL for the Single's data table. Passing
      // isSingle: true skips the slug column and auto-adds updated_at.
      // Pass hasStatus so the data table also gets a `status` column
      // when the user opted into Draft/Published — without it the
      // runtime schema would expect a column the DDL never created.
      const schemaService = new DynamicCollectionSchemaService();
      const isLocalized = b.localized === true;
      const migrationSQL = schemaService.generateMigrationSQL(
        tableName,
        b.fields as unknown as FieldDefinition[],
        // i18n: omit translatable columns from the main table when localized — they live in the
        // companion single_<slug>_locales table (provisioned below), mirroring collections.
        { isSingle: true, hasStatus: b.status === true, localized: isLocalized }
      );

      // Run migration immediately (same semantics as Collections).
      let migrationStatus: "pending" | "applied" | "failed" = "pending";

      try {
        if (container.has("adapter")) {
          const adapter = container.get<DrizzleAdapter>("adapter");

          await executeMigrationStatements(adapter, migrationSQL);

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
        console.error("[Singles] Migration execution failed:", message);
        console.error("[Singles] Migration SQL was:", migrationSQL);
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
      // HTTP API default returns every document regardless of status; pass
      // `?status=published` or `?status=draft` to filter. The route requires
      // auth (see isPublicEndpoint), so this only affects callers who
      // already have read permission. Anything outside the allowlist falls
      // back to "all" instead of being silently dropped.
      const status =
        p.status === "all" || p.status === "draft" || p.status === "published"
          ? p.status
          : "all";
      const result = await svc.entry.get(slug, {
        depth: toNumber(p.depth),
        // i18n M4: `?locale=` selects the content language; `?fallback-locale=none`
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
          // Route auth already ran the RBAC gate; `routeAuthorized` skips only
          // that re-check while field-level write access + response redaction
          // still run for this user (overrideAccess stays false).
          overrideAccess: false,
          routeAuthorized: !!user,
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
        try {
          // Use dialect-appropriate quoting for the table name.
          const dialect = adapter.dialect || "postgresql";
          const quotedTableName =
            dialect === "mysql" ? `\`${tableName}\`` : `"${tableName}"`;
          await adapter.executeQuery(`DROP TABLE IF EXISTS ${quotedTableName}`);
        } catch (dropError) {
          const message =
            dropError instanceof Error ? dropError.message : String(dropError);
          // Log but don't throw; continue to delete metadata even if table drop fails.
          console.warn(
            `[Singles] Failed to drop data table "${tableName}": ${message}`
          );
        }
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
      const wasLocalized = existing.localized === true;
      const isLocalized = b.localized !== undefined ? b.localized === true : wasLocalized;
      const alterOmitLocalized = isLocalized || wasLocalized;

      let migrationStatus = existing.migrationStatus;

      if (b.fields !== undefined) {
        // Same rules as the ui-schema.json mirror (see api/fields-payload).
        assertValidFieldsPayload(b.fields);
        updateData.fields = b.fields;
        updateData.schemaHash = calculateSchemaHash(b.fields);

        // Generate and execute ALTER TABLE migration.
        const schemaService = new DynamicCollectionSchemaService();
        const tableName = existing.tableName;

        // Normalize field lists for ALTER TABLE comparison. The physical
        // table always has system columns (title, slug, updatedAt) added
        // by generateMigrationSQL, but stored field definitions may not
        // include them. We ensure both old and new lists include these
        // so the diff doesn't try to ADD COLUMN for columns that already
        // exist in the physical table.
        const systemFields: FieldDefinition[] = [
          { name: "title", type: "text", required: true },
          { name: "slug", type: "text", required: true },
        ];

        const existingFields = (existing.fields ??
          []) as unknown as FieldDefinition[];
        // i18n: when the single is localized (in either state), translatable columns live on the
        // companion, never the main table — drop them from the ALTER input so the main-table diff
        // never tries to ADD/DROP them. `reconcileSingleCompanion` owns the companion side.
        const omitLocalized = (fields: FieldDefinition[]): FieldDefinition[] => {
          if (!alterOmitLocalized) return fields;
          const localizedNames = new Set(resolveLocalizedFieldNames(fields, true));
          return fields.filter(f => !localizedNames.has(f.name));
        };
        const existingFieldsForAlter = omitLocalized(existingFields);
        const existingFieldNames = new Set(
          existingFieldsForAlter.map(f => f.name)
        );
        const normalizedOldFields: FieldDefinition[] = [
          ...systemFields.filter(sf => !existingFieldNames.has(sf.name)),
          ...existingFieldsForAlter,
          {
            name: "updatedAt",
            type: "date",
            required: false,
          },
        ];

        const newFieldsRaw = b.fields as unknown as FieldDefinition[];
        const newFieldsForAlter = omitLocalized(newFieldsRaw);
        const newFieldNames = new Set(newFieldsForAlter.map(f => f.name));
        const normalizedNewFields: FieldDefinition[] = [
          ...systemFields.filter(sf => !newFieldNames.has(sf.name)),
          ...newFieldsForAlter,
          {
            name: "updatedAt",
            type: "date",
            required: false,
          },
        ];

        // Forward status flags so the alter migration can ADD/DROP the
        // `status` column when the user toggles Draft/Published. `existing`
        // holds the previous value; `b.status` holds what the user is
        // saving (undefined = leave alone).
        const wasStatus = (existing as { status?: boolean }).status === true;
        const hasStatus =
          b.status !== undefined ? b.status === true : wasStatus;
        const migrationSQL = schemaService.generateAlterTableMigration(
          tableName,
          normalizedOldFields,
          normalizedNewFields,
          { wasStatus, hasStatus }
        );

        migrationStatus = "pending";

        try {
          if (container.has("adapter")) {
            const adapter = container.get<DrizzleAdapter>("adapter");

            // If the table doesn't exist (e.g. earlier creation failed),
            // create it fresh instead of altering nothing.
            const tableExistsBefore = await adapter.tableExists(tableName);

            if (!tableExistsBefore) {
              const createSQL = schemaService.generateMigrationSQL(
                tableName,
                normalizedNewFields,
                // i18n: fresh (re)create omits translatable columns when localized.
                { isSingle: true, hasStatus, localized: isLocalized }
              );
              await executeMigrationStatements(adapter, createSQL);
            } else {
              await executeMigrationStatements(adapter, migrationSQL);
            }

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
              // localized field set (create when the single is newly localized, ADD/DROP columns
              // as translatable fields change). No-op when not localized. See the note above:
              // this does not move existing main-table rows into the companion — that is the
              // `nextly migrate` enable/disable path.
              try {
                await reconcileSingleCompanion({
                  slug,
                  tableName,
                  oldFields: existing.fields as unknown as FieldDefinition[],
                  newFields: (b.fields ??
                    existing.fields) as unknown as FieldDefinition[],
                  localized: isLocalized,
                  status: hasStatus,
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
          migrationStatus = "failed";
          const message =
            migrationError instanceof Error
              ? migrationError.message
              : String(migrationError);
          console.error("[Singles] Migration execution failed:", message);
          console.error("[Singles] Migration SQL was:", migrationSQL);
        }

        updateData.migrationStatus = migrationStatus;
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
          status: single.status === true,
          adapter,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[applySingleSchemaChanges] Companion reconcile failed for '${slug}': ${msg}.`
        );
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
