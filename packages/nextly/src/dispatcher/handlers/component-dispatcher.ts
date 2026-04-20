/**
 * Components (reusable field group) dispatch handlers.
 *
 * Routes 5 operations against `ComponentRegistryService`:
 * list / create / get / update / delete. The create/update flows run
 * `comp_*` table migrations directly against the DI-registered adapter
 * so UI-edited components have a usable backing table immediately.
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { FieldConfig } from "../../collections/fields/types";
import { container } from "../../di/container";
import { DynamicCollectionSchemaService } from "../../domains/dynamic-collections/services/dynamic-collection-schema-service";
import { calculateSchemaHash } from "../../domains/schema/services/schema-hash";
import type { ComponentRegistryService } from "../../services/components/component-registry-service";
import { ComponentSchemaService } from "../../services/components/component-schema-service";
import { getAdapterFromDI, getComponentRegistryFromDI } from "../helpers/di";
import { requireParam, toNumber } from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

interface ComponentsServices {
  registry: ComponentRegistryService;
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
    execute: async (svc, p) => {
      const result = await svc.registry.listComponents({
        source: p.source as "code" | "ui" | undefined,
        search: p.search,
        limit: toNumber(p.limit),
        offset: toNumber(p.offset),
      });
      return {
        success: true,
        statusCode: 200,
        data: result.data,
        meta: {
          total: result.total,
          limit: toNumber(p.limit),
          offset: toNumber(p.offset),
        },
      };
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
        admin: b.admin as Parameters<
          typeof svc.registry.registerComponent
        >[0]["admin"],
        description: b.description,
        source: "ui",
        locked: false,
        schemaHash,
        schemaVersion: 1,
        migrationStatus,
      });

      return {
        success: true,
        statusCode: 201,
        data: created,
        message:
          migrationStatus === "applied"
            ? `Component "${b.slug}" created and table applied!`
            : `Component "${b.slug}" created. Run migrations to apply the table.`,
      };
    },
  },

  getComponent: {
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Component slug");
      const component = await svc.registry.getComponent(slug);

      return {
        success: true,
        statusCode: 200,
        data: component,
      };
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
        return {
          success: false,
          statusCode: 403,
          message: `Component "${slug}" is locked (code-first). Modify the source file instead.`,
        };
      }

      const existing = await svc.registry.getComponent(slug);
      if (!existing) {
        throw new Error(`Component "${slug}" not found`);
      }

      const updateData: Record<string, unknown> = {};
      if (b?.label) updateData.label = b.label;
      if (b?.admin) updateData.admin = b.admin;
      if (b?.description) updateData.description = b.description;

      let migrationStatus = existing.migrationStatus;

      if (b?.fields) {
        updateData.fields = b.fields;
        updateData.schemaHash = calculateSchemaHash(b.fields);

        const schemaService = new DynamicCollectionSchemaService();
        const tableName = existing.tableName;

        // Add updatedAt — Components always have this auto-managed field.
        const existingFields = (existing.fields ??
          []) as unknown as FieldConfig[];
        const oldFieldsWithUpdatedAt: FieldConfig[] = [
          ...existingFields,
          {
            name: "updatedAt",
            type: "date",
            required: false,
          } as unknown as FieldConfig,
        ];
        const newFieldsWithUpdatedAt: FieldConfig[] = [
          ...b.fields,
          {
            name: "updatedAt",
            type: "date",
            required: false,
          } as unknown as FieldConfig,
        ];

        const migrationSQL = schemaService.generateAlterTableMigration(
          tableName,
          oldFieldsWithUpdatedAt as unknown as Parameters<
            typeof schemaService.generateAlterTableMigration
          >[1],
          newFieldsWithUpdatedAt as unknown as Parameters<
            typeof schemaService.generateAlterTableMigration
          >[2]
        );

        migrationStatus = "pending";

        try {
          if (container.has("adapter")) {
            const adapter = container.get<DrizzleAdapter>("adapter");

            await executeMigrationStatements(adapter, migrationSQL);

            const tableExists = await adapter.tableExists(tableName);
            if (tableExists) {
              migrationStatus = "applied";
              registerComponentRuntimeSchema(
                adapter,
                adapter.getCapabilities().dialect,
                tableName,
                b.fields
              );
            } else {
              migrationStatus = "failed";
              console.error(
                `[Components] Table "${tableName}" not found after migration update`
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

        updateData.migrationStatus = migrationStatus;
      }

      const updated = await svc.registry.updateComponent(
        slug,
        updateData as Parameters<typeof svc.registry.updateComponent>[1]
      );

      return {
        success: true,
        statusCode: 200,
        data: updated,
        message:
          migrationStatus === "applied"
            ? `Component "${slug}" updated and migration applied successfully.`
            : b?.fields
              ? `Component "${slug}" updated. Run migrations to apply schema changes.`
              : `Component "${slug}" updated.`,
      };
    },
  },

  deleteComponent: {
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Component slug");

      const isLocked = await svc.registry.isLocked(slug);
      if (isLocked) {
        return {
          success: false,
          statusCode: 403,
          message: `Component "${slug}" is locked (code-first). Remove it from your config file instead.`,
        };
      }

      await svc.registry.deleteComponent(slug);

      return {
        success: true,
        statusCode: 200,
        message: `Component "${slug}" deleted successfully.`,
      };
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
