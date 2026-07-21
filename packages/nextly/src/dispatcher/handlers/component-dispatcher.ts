/**
 * Components (reusable field group) dispatch handlers.
 *
 * Routes 5 operations against `ComponentRegistryService`:
 * list / create / get / update / delete. The create/update flows run
 * `comp_*` table migrations directly against the DI-registered adapter
 * so UI-edited components have a usable backing table immediately.
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
import { buildCompanionTransitionStatements } from "../../domains/i18n/migration/reconcile-companion";
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
import type { DesiredComponent } from "../../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";
import { calculateSchemaHash } from "../../domains/schema/services/schema-hash";
import { NextlyError } from "../../errors";
import { getProductionNotifier } from "../../runtime/notifications/index";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import { getI18nArchiveDdl } from "../../schemas/nextly-i18n-archive";
import type { ComponentRegistryService } from "../../services/components/component-registry-service";
import { ComponentSchemaService } from "../../services/components/component-schema-service";
import { buildFullDesiredSchema } from "../helpers/desired-schema";
import {
  getAdapterFromDI,
  getComponentRegistryFromDI,
  getConfigFromDI,
  getMigrationJournalFromDI,
  getSchemaRegistryFromDI,
} from "../helpers/di";
import { requireParam, toNumber } from "../helpers/validation";
import { writeBuilderMigration } from "../helpers/write-builder-migration";
import type { MethodHandler, Params } from "../types";

import { assertSchemaVersionMatch } from "./schema-version-guard";

interface ComponentsServices {
  registry: ComponentRegistryService;
}

// ============================================================
// Pagination helper
// ============================================================

/**
 * Translate the registry's `limit/offset/total` triple into the canonical
 * `PaginationMeta` shape that `respondList` expects. Mirrors the helper
 * in `single-dispatcher.ts` because the Components registry uses the
 * same offset-based shape.
 */
function offsetPaginationToMeta(args: {
  total: number;
  limit?: number;
  offset?: number;
}) {
  const total = args.total;
  const limit = args.limit && args.limit > 0 ? args.limit : total || 1;
  const offset = args.offset ?? 0;
  const page = Math.floor(offset / limit) + 1;
  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
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

// Refresh the cached Drizzle table so the next entry query joining this
// component uses the new column layout without a server restart.
function registerComponentRuntimeSchema(
  adapter: DrizzleAdapter,
  dialect: string,
  tableName: string,
  fields: FieldConfig[],
  // i18n: when localized, the main comp_ runtime table omits translatable columns and the
  // companion comp_<slug>_locales runtime table is registered for per-language reads/writes.
  localized = false
): void {
  try {
    const componentSchemaService = new ComponentSchemaService(
      dialect as ConstructorParameters<typeof ComponentSchemaService>[0]
    );
    const runtimeTable = componentSchemaService.generateRuntimeSchema(
      tableName,
      fields,
      { localized }
    );
    const companion = localized
      ? buildCompanionRuntimeTable({
          slug: tableName,
          tableName,
          fields: fields as { name: string; type: string }[],
          dialect: dialect as Parameters<
            typeof buildCompanionRuntimeTable
          >[0]["dialect"],
          localized: true,
          status: false,
        })
      : null;

    const registry = getSchemaRegistryFromDI();
    if (registry) {
      registry.registerDynamicSchema(tableName, runtimeTable);
      if (companion) {
        registry.registerDynamicSchema(
          companion.companionTableName,
          companion.table
        );
      }
      return;
    }

    // Fallback for paths where DI isn't wired (tests, CLI).
    const resolver = (
      adapter as unknown as {
        tableResolver?: {
          registerDynamicSchema?: (name: string, table: unknown) => void;
        };
      }
    ).tableResolver;
    if (resolver && typeof resolver.registerDynamicSchema === "function") {
      resolver.registerDynamicSchema(tableName, runtimeTable);
      return;
    }

    console.warn(
      `[registerComponentRuntimeSchema] No SchemaRegistry available for ` +
        `'${tableName}'. Component queries may reference old column names ` +
        `until next server restart.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[registerComponentRuntimeSchema] In-memory schema refresh failed for ` +
        `'${tableName}': ${msg}. Component queries may reference old ` +
        `column names until next server restart.`
    );
  }
}

/**
 * Provision (create / ADD-DROP columns) the component's companion `comp_<slug>_locales` table
 * out-of-band after a schema change, then register its runtime table. The push pipeline excludes
 * companions, so every component create/update/apply path that changes the localized field set
 * goes through here. No-op when the component isn't localized. Mirrors reconcileSingleCompanion.
 * DDL throws on failure; runtime registration is best-effort. Does not move existing main-table
 * rows into the companion — that is the `nextly migrate` enable/disable path.
 */
async function reconcileComponentCompanion(args: {
  slug: string;
  tableName: string;
  oldFields: FieldDefinition[];
  newFields: FieldDefinition[];
  /** Localization state AFTER this save (requested). */
  localized: boolean;
  /** Localization state BEFORE this save (persisted). Drives enable/disable detection. */
  wasLocalized: boolean;
  adapter: DrizzleAdapter;
}): Promise<void> {
  const { slug, tableName, oldFields, newFields, localized, adapter } = args;
  const wasLocalized = args.wasLocalized;
  // Nothing to do when the component was and remains non-localized.
  if (!wasLocalized && !localized) return;

  const dialect = adapter.dialect;
  const defaultLocale = getConfigFromDI()?.localization?.defaultLocale ?? "en";

  const plan = buildCompanionTransitionStatements({
    slug,
    tableName,
    dialect,
    defaultLocale,
    // Components are never Draft/Published — companion has no `_status`.
    status: false,
    wasLocalized,
    isLocalized: localized,
    oldFields,
    newFields,
    companionExists: await adapter.tableExists(`${tableName}_locales`),
  });

  // A disable archives non-default translations, so ensure `nextly_i18n_archive` exists first
  // (Builder entities have no `nextly migrate` step to provision it). Idempotent.
  if (plan.needsArchive) {
    for (const stmt of getI18nArchiveDdl(dialect)) {
      await adapter.executeQuery(stmt);
    }
  }
  for (const stmt of plan.statements) {
    await adapter.executeQuery(stmt);
  }
  // Runtime registration of the companion is handled by registerComponentRuntimeSchema(localized)
  // in the calling handlers, so no separate registration is needed here.
}

const COMPONENTS_METHODS: Record<string, MethodHandler<ComponentsServices>> = {
  listComponents: {
    // Registry returns BaseListResult `{data,total}` with limit/offset
    // semantics; offsetPaginationToMeta synthesises the canonical
    // PaginationMeta so the wire shape matches every other dispatcher.
    execute: async (svc, p) => {
      const limit = toNumber(p.limit);
      const offset = toNumber(p.offset);
      const result = await svc.registry.listComponents({
        source: p.source as "code" | "ui" | undefined,
        search: p.search,
        limit,
        offset,
      });
      return respondList(
        result.data,
        offsetPaginationToMeta({ total: result.total, limit, offset })
      );
    },
  },

  createComponent: {
    execute: async (svc, _, body) => {
      const b = body as
        | {
            slug?: string;
            label?: string;
            fields?: FieldConfig[];
            admin?: Record<string, unknown>;
            description?: string;
            // i18n: Internationalization opt-in; persists to dynamic_components.localized and
            // provisions the companion comp_<slug>_locales table.
            localized?: boolean;
          }
        | undefined;

      if (!b?.slug || !b?.fields) {
        throw new Error("Component slug and fields are required");
      }

      const isLocalized = b.localized === true;
      const schemaHash = calculateSchemaHash(b.fields);
      const tableName = `comp_${b.slug.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

      // Use ComponentSchemaService to generate tables with parent
      // reference columns (_parent_id, _parent_table, _parent_field,
      // _order, _component_type).
      const adapter = getAdapterFromDI();
      const dialect = adapter?.dialect || "postgresql";
      const componentSchemaService = new ComponentSchemaService(dialect);

      const migrationSQL = componentSchemaService.generateMigrationSQL(
        tableName,
        b.fields,
        // i18n: omit translatable columns from the main comp_ table when localized — they live
        // in the companion comp_<slug>_locales table (provisioned below).
        { localized: isLocalized }
      );

      let migrationStatus: "pending" | "applied" | "failed" = "pending";

      try {
        if (container.has("adapter")) {
          const diAdapter = container.get<DrizzleAdapter>("adapter");

          await executeMigrationStatements(diAdapter, migrationSQL);

          const tableExists = await diAdapter.tableExists(tableName);
          if (tableExists) {
            migrationStatus = "applied";
            registerComponentRuntimeSchema(
              diAdapter,
              dialect,
              tableName,
              b.fields,
              // i18n: main runtime table omits translatable columns for a localized component.
              isLocalized
            );
            // i18n: provision the companion comp_<slug>_locales table for a localized component.
            try {
              await reconcileComponentCompanion({
                slug: b.slug,
                tableName,
                oldFields: [],
                newFields: b.fields as unknown as FieldDefinition[],
                localized: isLocalized,
                // A brand-new component was never localized, so a localized create is a
                // create-only companion rather than an enable transition.
                wasLocalized: false,
                adapter: diAdapter,
              });
            } catch (companionErr) {
              migrationStatus = "failed";
              const m =
                companionErr instanceof Error
                  ? companionErr.message
                  : String(companionErr);
              console.error(
                `[Components] Companion provisioning failed for "${tableName}": ${m}`
              );
            }
          } else {
            migrationStatus = "failed";
            console.error(
              `[Components] Table "${tableName}" was not created after migration`
            );
          }
        } else {
          console.warn(
            "[Components] No adapter found in container, migration not executed"
          );
        }
      } catch (migrationError) {
        migrationStatus = "failed";
        const message =
          migrationError instanceof Error
            ? migrationError.message
            : String(migrationError);
        console.error("[Components] Migration execution failed:", message);
        console.error("[Components] Migration SQL was:", migrationSQL);
      }

      const created = await svc.registry.registerComponent({
        slug: b.slug,
        label: b.label || b.slug,
        tableName,
        fields: b.fields,
        admin: b.admin,
        description: b.description,
        source: "ui",
        locked: false,
        // i18n: persist the Internationalization flag so the component reads/writes per language.
        localized: isLocalized,
        schemaHash,
        schemaVersion: 1,
        migrationStatus,
      });

      // Migration status drives the toast copy so admins immediately
      // know whether the table was applied.
      const message =
        migrationStatus === "applied"
          ? `Component "${b.slug}" created and table applied!`
          : `Component "${b.slug}" created. Run migrations to apply the table.`;
      return respondMutation(message, created, { status: 201 });
    },
  },

  getComponent: {
    // registry.getComponent throws NextlyError on not-found, so we never
    // see a null doc here.
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Component slug");
      const component = await svc.registry.getComponent(slug);
      return respondDoc(component);
    },
  },

  updateComponent: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Component slug");
      const b = body as
        | {
            label?: string;
            fields?: FieldConfig[];
            admin?: Record<string, unknown>;
            description?: string;
            // i18n: Internationalization toggle; honoured when defined, undefined leaves the
            // existing value untouched. Persists to dynamic_components.localized.
            localized?: boolean;
          }
        | undefined;

      const isLocked = await svc.registry.isLocked(slug);
      if (isLocked) {
        // Throw a NextlyError so the dispatcher's error path emits the
        // canonical singular `{ error: ... }` shape with a 403 status.
        // Slug stays in logContext per §13.8 (never on the wire).
        throw NextlyError.forbidden({
          logContext: {
            reason: "component-locked",
            slug,
          },
        });
      }

      const existing = await svc.registry.getComponent(slug);
      if (!existing) {
        throw new Error(`Component "${slug}" not found`);
      }

      const updateData: Record<string, unknown> = {};
      if (b?.label) updateData.label = b.label;
      if (b?.admin) updateData.admin = b.admin;
      if (b?.description) updateData.description = b.description;
      // i18n: persist the Internationalization toggle. `isLocalized` drives the companion
      // provisioning below (create when newly localized, ADD/DROP as translatable fields change).
      if (b?.localized !== undefined) updateData.localized = b.localized;
      const wasLocalized =
        (existing as { localized?: boolean }).localized === true;
      const isLocalized =
        b?.localized !== undefined ? b.localized === true : wasLocalized;

      if (b?.fields) {
        updateData.fields = b.fields;
        updateData.schemaHash = calculateSchemaHash(b.fields);
      }

      // Run the companion reconcile when fields changed OR the Internationalization flag toggled
      // (a flag-only save still needs the enable/disable data move: enabling seeds + drops main
      // columns, disabling restores + archives them). Without the transition on a flag-only
      // toggle, `localized` was persisted while the physical schema stayed put and content
      // stranded in the wrong table.
      if (b?.fields || isLocalized !== wasLocalized) {
        // Schema changes (rename, drop, add required column) must go through
        // applyComponentSchemaChanges which runs PushSchemaPipeline. Here we
        // only store the updated fields JSON — this path is reached when
        // previewComponentSchemaChanges returned hasChanges: false (labels,
        // descriptions, or field reordering changed but no DDL is needed).
        if (container.has("adapter")) {
          const adapter = container.get<DrizzleAdapter>("adapter");
          const newFields = b?.fields ?? existing.fields;
          registerComponentRuntimeSchema(
            adapter,
            adapter.getCapabilities().dialect,
            existing.tableName,
            newFields,
            // i18n: main runtime table omits translatable columns when localized.
            isLocalized
          );
          // i18n: provision/alter the companion comp_<slug>_locales table for the new localized
          // field set: enabling seeds the default locale from main then drops those columns,
          // disabling restores + archives them, a field change ADDs/DROPs columns.
          try {
            await reconcileComponentCompanion({
              slug,
              tableName: existing.tableName,
              oldFields: existing.fields as unknown as FieldDefinition[],
              newFields: newFields as unknown as FieldDefinition[],
              localized: isLocalized,
              wasLocalized,
              adapter,
            });
          } catch (companionErr) {
            const m =
              companionErr instanceof Error
                ? companionErr.message
                : String(companionErr);
            console.error(
              `[Components] Companion reconcile failed for "${existing.tableName}": ${m}`
            );
          }
        }
      }

      const updated = await svc.registry.updateComponent(slug, updateData);

      return respondMutation(`Component "${slug}" updated.`, updated);
    },
  },

  // Preview component schema changes — dry-run diff returning rename candidates
  // and classification. Mirrors previewSchemaChanges in collection-dispatcher.
  previewComponentSchemaChanges: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Component slug");
      const component = await svc.registry.getComponent(slug);
      if (!component) throw new Error("Component not found");
      if (component.locked) {
        throw new Error(
          "This component is managed via code and cannot be modified in the UI"
        );
      }

      const { fields } = body as { fields: unknown[] };
      if (!fields) throw new Error("fields is required in request body");
      // Same rules as the ui-schema.json mirror (see api/fields-payload):
      // an invalid field must fail HERE, not only at the file write, or
      // the DB and the committed manifest diverge silently.
      assertValidFieldsPayload(fields);

      const currentFields = (component.fields ??
        []) as unknown as FieldDefinition[];
      const tableName = component.tableName;

      const adapter = getAdapterFromDI();
      if (!adapter) throw new Error("Database adapter not initialized");
      const dialect = adapter.dialect;
      const db = adapter.getDrizzle();

      const desired = await buildFullDesiredSchema();
      desired.components[slug] = {
        slug,
        tableName,
        fields: fields as DesiredComponent["fields"],
        // i18n: carry the localized flag so the push diff omits translatable columns
        // from the component's main table (they live in comp_<slug>_locales, reconciled
        // out-of-band below) — mirrors the collection/single apply path.
        localized: (component as { localized?: boolean }).localized === true,
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
        schemaVersion: component.schemaVersion,
      });
    },
  },

  // Apply confirmed component schema changes via PushSchemaPipeline.
  // Mirrors applySchemaChanges in collection-dispatcher.
  applyComponentSchemaChanges: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Component slug");
      const component = await svc.registry.getComponent(slug);
      if (!component) throw new Error("Component not found");
      if (component.locked) {
        throw new Error(
          "This component is managed via code and cannot be modified in the UI"
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
        // i18n: the builder sends the current toggle so a save that flips i18n AND changes fields
        // provisions the companion in the same apply. Undefined = leave the persisted value.
        localized?: boolean;
      };

      if (!confirmed) throw new Error("Schema changes must be confirmed");
      if (!fields) throw new Error("fields is required in request body");
      // Same rules as the ui-schema.json mirror (see api/fields-payload):
      // an invalid field must fail HERE, not only at the file write, or
      // the DB and the committed manifest diverge silently.
      assertValidFieldsPayload(fields);

      // i18n: prefer the request's localized flag over the persisted one (stale on a
      // simultaneous toggle+field-change save); fall back to the registry value.
      const isLocalized =
        requestLocalized !== undefined
          ? requestLocalized === true
          : (component as { localized?: boolean }).localized === true;

      const currentVersion = component.schemaVersion ?? 1;
      // Reject a stale UI save before any DDL runs so two admins editing the
      // same component cannot silently overwrite each other (last-write-wins).
      assertSchemaVersionMatch(schemaVersion, currentVersion, slug);
      const tableName = component.tableName;

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
      desired.components[slug] = {
        slug,
        tableName,
        fields: fields as DesiredComponent["fields"],
        // i18n: carry the localized flag so the push diff omits translatable columns
        // from the component's main table (they live in comp_<slug>_locales, reconciled
        // out-of-band below) — mirrors the collection/single apply path.
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

      if (result.success) {
        // Persist the DDL that just ran so the change is reproducible on a
        // fresh database, matching the collection path.
        await writeBuilderMigration(
          "component",
          slug,
          result.executedStatements
        );
      }

      if (!result.success) {
        throw new Error(
          result.error?.message ?? "Failed to apply schema changes"
        );
      }

      // i18n: the push pipeline excludes companion tables, so reconcile the component's companion
      // comp_<slug>_locales out-of-band — create on the first translatable field, then ADD/DROP
      // columns as the field set changes. Uses the request's `isLocalized`.
      try {
        await reconcileComponentCompanion({
          slug,
          tableName,
          oldFields: component.fields as unknown as FieldDefinition[],
          newFields: fields as unknown as FieldDefinition[],
          localized: isLocalized,
          // Detect an enable/disable transition against the persisted state so this apply
          // seeds/restores existing rows rather than only creating an empty companion.
          wasLocalized:
            (component as { localized?: boolean }).localized === true,
          adapter,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw NextlyError.internal({
          cause: err instanceof Error ? err : undefined,
          logContext: { op: "componentCompanionReconcile", slug, detail: msg },
        });
      }

      const newSchemaVersion = currentVersion + 1;

      // Post-apply: update dynamic_components fields JSON + schema_hash directly
      // (not via the registry helper, whose auto-bump would also reset
      // migration_status). Advance schema_version here so the optimistic-lock
      // check above sees a new value on the next save (without the bump the
      // stored version never changes and a second stale save would pass), and
      // persist `localized` so a simultaneous toggle+field-change save keeps the
      // flag. The write is non-fatal (the DDL already succeeded), but track
      // whether it landed so the response never reports a version the DB did not
      // persist.
      let versionPersisted = true;
      try {
        await adapter.update(
          "dynamic_components",
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
          `[applyComponentSchemaChanges] Post-apply metadata write failed for '${slug}': ${msg}. ` +
            `schema_version was not advanced; the save is reported at the current version so a retry re-attempts the bump.`
        );
      }

      // Post-apply: refresh in-memory runtime schema so CRUD paths reflect
      // the new column layout without requiring a server restart.
      // Must use registerComponentRuntimeSchema (not generateRuntimeSchema)
      // so the registered table includes component system columns
      // (_parent_id, _parent_table, _parent_field, _order, _component_type)
      // instead of collection columns (title, slug).
      registerComponentRuntimeSchema(
        adapter,
        dialect,
        tableName,
        fields as FieldConfig[],
        isLocalized
      );

      return respondAction(`Schema applied for component '${slug}'`, {
        newSchemaVersion: versionPersisted ? newSchemaVersion : currentVersion,
      });
    },
  },

  deleteComponent: {
    // Spec divergence: spec §5.1 / §7.4 strictly maps delete to
    // respondMutation, but registry.deleteComponent returns void (no
    // deleted record to surface). We use respondAction here so the wire
    // shape is `{ message, slug }` rather than the awkward
    // `{ message, item: undefined }` that respondMutation would emit.
    // If registry.deleteComponent is later refactored to return the
    // deleted record, switch this back to respondMutation.
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Component slug");

      const isLocked = await svc.registry.isLocked(slug);
      if (isLocked) {
        // Same NextlyError pattern as updateComponent's locked branch.
        throw NextlyError.forbidden({
          logContext: {
            reason: "component-locked",
            slug,
          },
        });
      }

      await svc.registry.deleteComponent(slug);

      return respondAction(`Component "${slug}" deleted successfully.`, {
        slug,
      });
    },
  },
};

/**
 * Dispatch a Components method call. Resolves the registry from DI and
 * throws a descriptive error if it isn't registered yet.
 */
export function dispatchComponents(
  method: string,
  params: Params,
  body: unknown
): Promise<unknown> {
  const componentRegistry = getComponentRegistryFromDI();
  if (!componentRegistry) {
    throw new Error(
      "Components service not initialized. " +
        "Ensure registerServices() or getNextly() has been called before API requests."
    );
  }

  const handler = COMPONENTS_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute({ registry: componentRegistry }, params, body);
}
