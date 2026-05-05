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

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "../../api/response-shapes";
import type { FieldConfig } from "../../collections/fields/types";
import { container } from "../../di/container";
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
import type {
  DesiredComponent,
  DesiredSchema,
} from "../../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";
import { calculateSchemaHash } from "../../domains/schema/services/schema-hash";
import { NextlyError } from "../../errors";
import { getProductionNotifier } from "../../runtime/notifications/index";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import type { ComponentRegistryService } from "../../services/components/component-registry-service";
import { ComponentSchemaService } from "../../services/components/component-schema-service";
import {
  getAdapterFromDI,
  getComponentRegistryFromDI,
  getMigrationJournalFromDI,
} from "../helpers/di";
import { buildFullDesiredSchema } from "../helpers/desired-schema";
import { requireParam, toNumber } from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

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

function registerComponentRuntimeSchema(
  adapter: DrizzleAdapter,
  dialect: string,
  tableName: string,
  fields: FieldConfig[]
): void {
  try {
    const componentSchemaService = new ComponentSchemaService(
      dialect as ConstructorParameters<typeof ComponentSchemaService>[0]
    );
    const runtimeTable = componentSchemaService.generateRuntimeSchema(
      tableName,
      fields
    );

    const resolver = (
      adapter as unknown as {
        tableResolver?: {
          registerDynamicSchema?: (name: string, table: unknown) => void;
        };
      }
    ).tableResolver;

    if (resolver && typeof resolver.registerDynamicSchema === "function") {
      resolver.registerDynamicSchema(tableName, runtimeTable);
    }
  } catch {
    // Non-fatal: schema will be registered on next server restart.
  }
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
          }
        | undefined;

      if (!b?.slug || !b?.fields) {
        throw new Error("Component slug and fields are required");
      }

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
        b.fields
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
              b.fields
            );
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

      if (b?.fields) {
        updateData.fields = b.fields;
        updateData.schemaHash = calculateSchemaHash(b.fields);

        // Schema changes (rename, drop, add required column) must go through
        // applyComponentSchemaChanges which runs PushSchemaPipeline. Here we
        // only store the updated fields JSON — this path is reached when
        // previewComponentSchemaChanges returned hasChanges: false (labels,
        // descriptions, or field reordering changed but no DDL is needed).
        if (container.has("adapter")) {
          const adapter = container.get<DrizzleAdapter>("adapter");
          registerComponentRuntimeSchema(
            adapter,
            adapter.getCapabilities().dialect,
            existing.tableName,
            b.fields
          );
        }
      }

      const updated = await svc.registry.updateComponent(
        slug,
        updateData
      );

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

      const currentFields = (component.fields ?? []) as unknown as FieldDefinition[];
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
      };

      const pipelinePreview = await previewDesiredSchema({ desired, db, dialect });

      const legacyShape = await translatePipelinePreviewToLegacy(pipelinePreview, {
        tableName,
        currentFields,
        newFields: fields as FieldDefinition[],
        db,
        dialect,
      });

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
      } = body as {
        fields: unknown[];
        confirmed: boolean;
        schemaVersion?: number;
        resolutions?: Record<string, FieldResolution>;
        renameResolutions?: BrowserRenameResolution[];
        eventResolutions?: Resolution[];
      };

      if (!confirmed) throw new Error("Schema changes must be confirmed");
      if (!fields) throw new Error("fields is required in request body");

      const currentVersion = component.schemaVersion ?? 1;
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
      };

      const promptDispatcher = new BrowserPromptDispatcher(
        renameResolutions ?? [],
        eventResolutions ?? [],
        legacyBundle
      );

      const migrationJournal = getMigrationJournalFromDI() ?? noopMigrationJournal;
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
        throw new Error(result.error?.message ?? "Failed to apply schema changes");
      }

      // Post-apply: update dynamic_components fields JSON + schema_hash directly
      // to avoid the registry's auto-bump of schemaVersion / migrationStatus.
      try {
        await adapter.update(
          "dynamic_components",
          {
            fields: JSON.stringify(fields),
            schema_hash: calculateSchemaHash(fields as FieldConfig[]),
            migration_status: "applied",
            updated_at: new Date(),
          },
          { and: [{ column: "slug", op: "=", value: slug }] }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[applyComponentSchemaChanges] Post-apply metadata write failed for '${slug}': ${msg}.`
        );
      }

      // Post-apply: refresh in-memory runtime schema so CRUD paths reflect
      // the new column layout without requiring a server restart.
      // Must use registerComponentRuntimeSchema (not generateRuntimeSchema)
      // so the registered table includes component system columns
      // (_parent_id, _parent_table, _parent_field, _order, _component_type)
      // instead of collection columns (title, slug).
      registerComponentRuntimeSchema(adapter, dialect, tableName, fields as FieldConfig[]);

      // Pipeline (PipelineResult) does not carry per-slug schema versions;
      // those live on createApplyDesiredSchema's ApplyResult wrapper. Bump by
      // 1 locally — matches the collection fallback pattern.
      const newSchemaVersion = currentVersion + 1;

      void schemaVersion; // accepted but unused (reserved for future optimistic lock)

      return respondAction(`Schema applied for component '${slug}'`, {
        newSchemaVersion,
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
