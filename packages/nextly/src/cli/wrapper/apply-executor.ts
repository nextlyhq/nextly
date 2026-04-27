// What: executes a schema apply request in the wrapper's plain-Node context.
// Responsibilities:
//   1. Instantiate adapter + SchemaRegistry + CollectionRegistry +
//      DrizzlePushService + SchemaChangeService in the wrapper process
//   2. Resolve the collection's current state from the registry
//   3. Run SchemaChangeService.apply (DDL + metadata + rollback on failure)
//   4. Return a structured result the orchestrator can forward via IPC
// Why: the child (next dev) cannot run DDL reliably because drizzle-kit/api
// uses dynamic imports that Turbopack breaks. The wrapper runs in plain
// Node where drizzle-kit/api works. Task 11's central move is this split:
// the child owns HTTP + admin UI; the wrapper owns DDL + restart.

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { getDialectTables } from "../../database/index.js";
import { SchemaRegistry } from "../../database/schema-registry.js";
import { DrizzlePushService } from "../../domains/schema/services/drizzle-push-service.js";
import { SchemaChangeService } from "../../domains/schema/services/schema-change-service.js";
import { CollectionRegistryService } from "../../services/collections/collection-registry-service.js";
import type { Logger } from "../../services/shared/types.js";
import type { CLIDatabaseAdapter } from "../utils/adapter.js";

export interface ApplyExecutionInput {
  slug: string;
  newFields: unknown[];
  resolutions: Record<string, unknown>;
}

export interface ApplyExecutionResult {
  success: boolean;
  newSchemaVersion?: number;
  error?: string;
  message?: string;
}

// Pre-built service bundle. Instantiated once per wrapper session and
// reused for every apply-request so we do not pay the DI cost per call.
export interface ApplyServices {
  registry: CollectionRegistryService;
  schemaChangeService: SchemaChangeService;
  schemaRegistry: SchemaRegistry;
}

export function createApplyServices(
  adapter: CLIDatabaseAdapter,
  logger: Logger
): ApplyServices {
  // Cast to full DrizzleAdapter: CLIDatabaseAdapter is structurally
  // compatible and this is the same pattern used in db-sync.ts line 258.
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;
  const dialect = drizzleAdapter.getCapabilities().dialect;

  const schemaRegistry = new SchemaRegistry(dialect);
  // Register the dialect's static system tables (dynamic_collections,
  // dynamic_singles, users, roles, etc.) so CollectionRegistryService can
  // resolve them via the adapter's CRUD methods. Matches the pattern in
  // di/register.ts lines 524-525 - without this, getCollectionBySlug
  // throws "Table 'dynamic_collections' not found in schema registry".
  schemaRegistry.registerStaticSchemas(getDialectTables(dialect));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (drizzleAdapter as any).setTableResolver?.(schemaRegistry);

  const registry = new CollectionRegistryService(drizzleAdapter, logger);

  // DrizzlePushService expects the raw drizzle-orm db handle and the
  // dialect. The CLI adapter exposes getDrizzle via the DrizzleAdapter
  // surface after the cast above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (drizzleAdapter as any).getDrizzle();
  // MySQL needs its database name for pushSchema dispatch. Extract from
  // DATABASE_URL rather than asking the user to configure it twice.
  const databaseName =
    dialect === "mysql" ? extractMysqlDatabaseName() : undefined;
  // Constructor signature is (dialect, db, databaseName). Passing db first
  // made this.dialect the drizzle handle and this.db the string, so
  // callPushSchema's switch hit default and threw "Unsupported dialect: [object Object]".
  const pushService = new DrizzlePushService(dialect, db, databaseName);

  const schemaChangeService = new SchemaChangeService(
    drizzleAdapter,
    schemaRegistry,
    pushService
  );

  return { registry, schemaChangeService, schemaRegistry };
}

export async function executeApplyRequest(
  services: ApplyServices,
  input: ApplyExecutionInput
): Promise<ApplyExecutionResult> {
  try {
    const collection = await services.registry.getCollectionBySlug(input.slug);
    if (!collection) {
      return {
        success: false,
        error: `Collection '${input.slug}' not found in registry.`,
      };
    }

    // Register EVERY existing dynamic collection's current schema in the
    // registry before calling apply(). drizzle-kit's pushSchema drops any
    // table not in the passed schema, so if we only register the one being
    // changed it would DROP all other dc_* tables. This loads the current
    // on-disk shape for each collection and registers it so the full schema
    // snapshot includes every table. Must happen every apply because
    // collections can be added/renamed between wrapper service creation
    // and the actual apply call.
    try {
      const allCollections = await services.registry.getAllCollections();
      const dialect = services.schemaRegistry.getDialect();
      const { generateRuntimeSchema } = await import(
        "../../domains/schema/services/runtime-schema-generator.js"
      );
      for (const coll of allCollections) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = coll as any;
        const tableName = c.tableName ?? `dc_${c.slug}`;
        const fields = (c.fields ?? []) as unknown[];
        if (fields.length === 0) continue;
        const { table } = generateRuntimeSchema(
          tableName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fields as any,
          dialect
        );
        services.schemaRegistry.registerDynamicSchema(tableName, table);
      }
    } catch (regErr) {
      // Non-fatal: if this fails, apply will surface a clear error when it
      // tries to push DDL. Log for diagnosis but continue.

      console.warn(
        `[apply-executor] Failed to pre-register dynamic schemas: ${regErr instanceof Error ? regErr.message : String(regErr)}`
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentFields = (collection.fields ?? []) as any[];
    const tableName =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (collection as any).tableName ?? `dc_${collection.slug}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentVersion = (collection as any).schemaVersion ?? 0;

    const result = await services.schemaChangeService.apply(
      input.slug,
      tableName,
      currentFields,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input.newFields as any[],
      currentVersion,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      services.registry as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input.resolutions as any
    );

    return {
      success: result.success,
      newSchemaVersion: result.newSchemaVersion,
      error: result.error,
      message: result.message,
    };
  } catch (err) {
    // Guard against throws from inside SchemaChangeService (e.g. drizzle-kit
    // module load failure, missing adapter method). Without this, the
    // wrapper's apply-poll tick swallows the throw and the admin dialog
    // hangs forever waiting for /apply-result.
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return {
      success: false,
      error: `executeApplyRequest threw: ${message}${stack ? `\n${stack}` : ""}`,
    };
  }
}

// MySQL URL shape: mysql://user:pass@host:port/databaseName?opts
// Pulls the database name out so DrizzlePushService can pass it to
// drizzle-kit which needs it as the third pushSchema arg. Returns
// undefined if the URL is malformed; the push service treats that as
// "no database name" and will surface a clear error.
function extractMysqlDatabaseName(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    if (!pathname || pathname === "/") return undefined;
    return pathname.slice(1).split("?")[0];
  } catch {
    return undefined;
  }
}
