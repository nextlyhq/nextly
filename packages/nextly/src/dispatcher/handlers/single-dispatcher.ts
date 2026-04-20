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
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { FieldConfig } from "../../collections/fields/types";
import { container } from "../../di/container";
import { DynamicCollectionSchemaService } from "../../domains/dynamic-collections/services/dynamic-collection-schema-service";
import { calculateSchemaHash } from "../../domains/schema/services/schema-hash";
import type { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import type { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import { transformRichTextFields } from "../../lib/field-transform";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import {
  isSuperAdmin,
  listEffectivePermissions,
} from "../../services/lib/permissions";
import {
  getComponentRegistryFromDI,
  getSingleEntryServiceFromDI,
  getSingleRegistryFromDI,
} from "../helpers/di";
import {
  parseRichTextFormat,
  requireParam,
  toNumber,
} from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

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
// Method definitions
// ============================================================

const SINGLES_METHODS: Record<string, MethodHandler<SinglesServices>> = {
  listSingles: {
    execute: async (svc, p) => {
      const result = await svc.registry.listSingles({
        source: p.source as "code" | "ui" | "built-in" | undefined,
        search: p.search,
        limit: toNumber(p.limit),
        offset: toNumber(p.offset),
      });
      const userId = p._authenticatedUserId
        ? String(p._authenticatedUserId)
        : undefined;

      let filteredSingles = result.data;
      if (userId) {
        const superAdmin = await isSuperAdmin(userId);
        if (!superAdmin) {
          const permissionPairs = await listEffectivePermissions(userId);
          const readableResources = new Set(
            permissionPairs
              .filter(pair => pair.endsWith(":read"))
              .map(pair => pair.split(":")[0])
          );
          filteredSingles = result.data.filter(single => {
            const slug = single?.slug;
            return slug ? readableResources.has(String(slug)) : false;
          });
        }
      }

      return {
        success: true,
        statusCode: 200,
        data: filteredSingles.map(s =>
          injectSingleDefaultFields(s as unknown as SingleWithFields)
        ),
        meta: {
          total: filteredSingles.length,
          limit: toNumber(p.limit),
          offset: toNumber(p.offset),
        },
      };
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
          }
        | undefined;

      if (!b?.slug) throw new Error("Single slug is required");
      if (!b?.label) throw new Error("Single label is required");
      if (!b?.fields || !Array.isArray(b.fields))
        throw new Error("Single fields array is required");

      const schemaHash = calculateSchemaHash(b.fields);
      const tableName = `single_${b.slug.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

      // Generate migration SQL for the Single's data table. Passing
      // isSingle: true skips the slug column and auto-adds updated_at.
      const schemaService = new DynamicCollectionSchemaService();
      const migrationSQL = schemaService.generateMigrationSQL(
        tableName,
        b.fields as unknown as FieldDefinition[],
        { isSingle: true }
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
                "../../services/schema/runtime-schema-generator.js"
              );
              const dialect = adapter.getCapabilities().dialect;
              const { table: runtimeTable } = generateRuntimeSchema(
                tableName,
                b.fields as unknown as FieldDefinition[],
                dialect
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
        admin: b.admin as Parameters<
          typeof svc.registry.registerSingle
        >[0]["admin"],
        source: "ui",
        locked: false,
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

      return {
        success: true,
        statusCode: 201,
        data: single,
        message:
          migrationStatus === "applied"
            ? `Single "${b.slug}" created and table applied!`
            : `Single "${b.slug}" created. Run migrations to apply the table.`,
      };
    },
  },

  getSingleDocument: {
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Single slug");
      const richTextFormat = parseRichTextFormat(p.richTextFormat);
      const result = await svc.entry.get(slug, {
        depth: toNumber(p.depth),
        locale: p.locale,
      });

      // Transform rich text fields to requested format when not JSON.
      if (
        result.success &&
        result.data &&
        richTextFormat &&
        richTextFormat !== "json"
      ) {
        const single = await svc.registry.getSingleBySlug(slug);
        if (single?.fields && Array.isArray(single.fields)) {
          result.data = transformRichTextFields(
            result.data as Record<string, unknown>,
            single.fields,
            richTextFormat
          ) as typeof result.data;
        }
      }

      return result;
    },
  },

  updateSingleDocument: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Single slug");
      if (!body) throw new Error("Update data is required");
      const user = p._authenticatedUserId
        ? {
            id: String(p._authenticatedUserId),
            name: p._authenticatedUserName
              ? String(p._authenticatedUserName)
              : undefined,
            email: p._authenticatedUserEmail
              ? String(p._authenticatedUserEmail)
              : undefined,
          }
        : undefined;
      return svc.entry.update(slug, body as Record<string, unknown>, {
        locale: p.locale,
        user,
        overrideAccess: !!user,
      });
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
          // Log but don't throw — continue to delete metadata even if table drop fails.
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

      return {
        success: true,
        statusCode: 200,
        message: `Single "${slug}" deleted successfully`,
      };
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

      return {
        success: true,
        statusCode: 200,
        data: injectSingleDefaultFields(
          enrichedData as unknown as SingleWithFields
        ),
      };
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

      let migrationStatus = existing.migrationStatus;

      if (b.fields !== undefined) {
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
          { name: "title", type: "text", required: true } as FieldDefinition,
          { name: "slug", type: "text", required: true } as FieldDefinition,
        ];

        const existingFields = (existing.fields ??
          []) as unknown as FieldDefinition[];
        const existingFieldNames = new Set(existingFields.map(f => f.name));
        const normalizedOldFields: FieldDefinition[] = [
          ...systemFields.filter(sf => !existingFieldNames.has(sf.name)),
          ...existingFields,
          {
            name: "updatedAt",
            type: "date",
            required: false,
          } as FieldDefinition,
        ];

        const newFieldsRaw = b.fields as unknown as FieldDefinition[];
        const newFieldNames = new Set(newFieldsRaw.map(f => f.name));
        const normalizedNewFields: FieldDefinition[] = [
          ...systemFields.filter(sf => !newFieldNames.has(sf.name)),
          ...newFieldsRaw,
          {
            name: "updatedAt",
            type: "date",
            required: false,
          } as FieldDefinition,
        ];

        const migrationSQL = schemaService.generateAlterTableMigration(
          tableName,
          normalizedOldFields,
          normalizedNewFields
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
                { isSingle: true }
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
                  "../../services/schema/runtime-schema-generator.js"
                );
                const dialect = adapter.getCapabilities().dialect;
                const { table: runtimeTable } = generateRuntimeSchema(
                  tableName,
                  (b.fields ?? existing.fields) as FieldDefinition[],
                  dialect
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

      const updated = await svc.registry.updateSingle(
        slug,
        updateData as Parameters<typeof svc.registry.updateSingle>[1],
        { source: "ui" }
      );

      return {
        success: true,
        statusCode: 200,
        data: updated,
        message:
          migrationStatus === "applied"
            ? `Single "${slug}" schema updated and migration applied successfully`
            : `Single "${slug}" schema updated. Migration pending - run migrations to apply changes.`,
      };
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
