/**
 * Service Registration for DI Container
 *
 * Provides the async entrypoint `registerServices()` that bootstraps the
 * database adapter, media storage, and every Nextly domain service. The
 * individual domain registrations live in `./registrations/` — this file
 * is the orchestrator that stitches them together.
 *
 * **IMPORTANT:** `registerServices()` is async and must be awaited.
 * The database adapter is created and connected during registration for
 * fail-fast error handling and predictable initialization.
 *
 * @example
 * ```typescript
 * import { registerServices, getService } from '@revnixhq/nextly';
 *
 * await registerServices({
 *   imageProcessor: getImageProcessor(),
 *   logger: customLogger, // optional
 * });
 *
 * const userService = getService('userService');
 * const user = await userService.findById(userId, context);
 * ```
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { CollectionConfig } from "../collections/config/define-collection";
import type {
  SanitizedApiKeysConfig,
  SecurityConfig,
} from "../collections/config/define-config";
import type { FieldConfig } from "../collections/fields/types";
import { createAdapterFromEnv, validateDatabaseEnv } from "../database/factory";
import type { AuthService } from "../domains/auth/services/auth-service";
import type { SingleEntryService } from "../domains/singles/services/single-entry-service";
import type {
  SingleRegistryService,
  CodeFirstSingleConfig,
} from "../domains/singles/services/single-registry-service";
import { registerActivityLogHooks } from "../hooks/activity-log-hooks";
import type { HookRegistry } from "../hooks/hook-registry";
import { getHookRegistry } from "../hooks/hook-registry";
import { createSanitizationHook } from "../hooks/sanitization-hooks";
import type { PluginDefinition } from "../plugins/plugin-context";
import { createPluginContext } from "../plugins/plugin-context";
import type { FieldDefinition } from "../schemas/dynamic-collections";
import type { ApiKeyService } from "../services/auth/api-key-service";
import type { PermissionSeedService } from "../services/auth/permission-seed-service";
import type { RBACAccessControlService } from "../services/auth/rbac-access-control-service";
import type {
  CollectionRegistryService,
  CodeFirstCollectionConfig,
} from "../services/collections/collection-registry-service";
import type { CollectionRelationshipService } from "../services/collections/collection-relationship-service";
import type { CollectionService } from "../services/collections/collection-service";
import type {
  ComponentRegistryService,
  CodeFirstComponentConfig,
  ComponentDataService,
  ComponentSchemaService,
} from "../services/components";
import type { ActivityLogService } from "../services/dashboard/activity-log-service";
import type { DashboardService } from "../services/dashboard/dashboard-service";
import type { EmailProviderService } from "../services/email/email-provider-service";
import type { EmailService } from "../services/email/email-service";
import type { EmailTemplateService } from "../services/email/email-template-service";
import type { EmailConfig } from "../services/email/types";
import type { GeneralSettingsService } from "../services/general-settings/general-settings-service";
import type { MediaService as UnifiedMediaService } from "../services/media/media-service";
import { consoleLogger } from "../services/shared";
import type { Logger } from "../services/shared";
import type { UserExtSchemaService } from "../services/users/user-ext-schema-service";
import type { UserFieldDefinitionService } from "../services/users/user-field-definition-service";
import type { UserService } from "../services/users/user-service";
import type { SingleConfig } from "../singles/config/types";
import type { IStorageAdapter } from "../storage/adapters/base-adapter";
import type { ImageProcessor } from "../storage/image-processor";
import type { MediaStorage } from "../storage/storage";
import { initializeMediaStorage } from "../storage/storage";
import type { StoragePlugin } from "../storage/types";
import type { DatabaseInstance } from "../types/database-operations";
import type { UserConfig } from "../users/config/types";

import { container } from "./container";
import {
  registerAuthServices,
  registerCollectionServices,
  registerComponentServices,
  registerDashboardServices,
  registerEmailServices,
  registerMediaServices,
  registerSingleServices,
  registerUserServices,
  type RegistrationContext,
} from "./registrations";

// ============================================================
// Configuration Interface
// ============================================================

/**
 * Configuration for service registration.
 *
 * **Database Configuration:**
 * - If `adapter` is provided, it will be used directly
 * - Otherwise, one is created from environment variables using
 *   `DB_DIALECT` and `DATABASE_URL`
 * - Legacy `db` and `tables` properties are deprecated but still
 *   supported for backward compatibility.
 */
export interface NextlyServiceConfig {
  /**
   * Database instance (Drizzle).
   * @deprecated Use adapter pattern instead. This will be removed in a future version.
   */
  db?: DatabaseInstance;

  /**
   * Database adapter for multi-database support.
   * If not provided, created automatically from environment variables.
   */
  adapter?: DrizzleAdapter;

  /**
   * Dialect-specific table schemas.
   * @deprecated Use adapter pattern instead.
   */
  tables?: unknown;

  /**
   * Storage adapter for media files.
   * @deprecated Consider using `storagePlugins` for cloud storage support.
   */
  storage?: IStorageAdapter;

  /** Storage plugins for cloud storage providers (S3, Vercel Blob, etc.). */
  storagePlugins?: StoragePlugin[];

  /** Image processor for media operations. */
  imageProcessor: ImageProcessor;

  /** Optional logger instance. Defaults to `consoleLogger`. */
  logger?: Logger;

  /** Optional hook registry. When absent, hooks are disabled. */
  hookRegistry?: HookRegistry;

  /** Optional password hasher for user authentication. */
  passwordHasher?: {
    hash(password: string): Promise<string>;
    verify(password: string, hash: string): Promise<boolean>;
  };

  /** Optional base path for collection file operations. */
  basePath?: string;

  /** Optional directory for dynamic collection schemas. */
  schemasDir?: string;

  /** Optional directory for dynamic collection migrations. */
  migrationsDir?: string;

  /** Plugins to initialize with Nextly. */
  plugins?: PluginDefinition[];

  /** Collection configurations. */
  collections?: CollectionConfig[];

  /** Single (global document) configurations. */
  singles?: SingleConfig[];

  /** Component (reusable field group) configurations. */
  components?: import("../components/config/types").ComponentConfig[];

  /** User model extension configuration. */
  users?: UserConfig;

  /** Email system configuration. */
  email?: EmailConfig;

  /** API key authentication configuration with defaults applied. */
  apiKeys?: SanitizedApiKeysConfig;

  /** Security configuration (headers, CORS, uploads, sanitization). */
  security?: SecurityConfig;
}

// ============================================================
// Service Map Interface
// ============================================================

/**
 * Type-safe service map returned by `getService()`.
 */
export interface ServiceMap {
  adapter: DrizzleAdapter;
  /** @deprecated Use adapter instead. */
  db?: DatabaseInstance;
  logger: Logger;
  config: NextlyServiceConfig;
  mediaStorage: MediaStorage;
  collectionService: CollectionService;
  collectionRegistryService: CollectionRegistryService;
  userService: UserService;
  mediaService: UnifiedMediaService;
  singleRegistryService: SingleRegistryService;
  singleEntryService: SingleEntryService;
  componentRegistryService: ComponentRegistryService;
  componentSchemaService: ComponentSchemaService;
  componentDataService: ComponentDataService;
  relationshipService: CollectionRelationshipService;
  userExtSchemaService: UserExtSchemaService;
  emailProviderService: EmailProviderService;
  emailTemplateService: EmailTemplateService;
  emailService: EmailService;
  userFieldDefinitionService: UserFieldDefinitionService;
  permissionSeedService: PermissionSeedService;
  rbacAccessControlService: RBACAccessControlService;
  apiKeyService: ApiKeyService;
  authService: AuthService;
  generalSettingsService: GeneralSettingsService;
  activityLogService: ActivityLogService;
  dashboardService: DashboardService;
}

// ============================================================
// Registration State
// ============================================================

// Stored on globalThis to survive ESM module duplication in Next.js/Turbopack.
const globalForReg = globalThis as unknown as {
  __nextly_isRegistered?: boolean;
};

// ============================================================
// Registration Function
// ============================================================

/**
 * Register all Nextly services in the DI container.
 *
 * This function should be called once during application initialization.
 * Services are registered as singletons and lazily initialized on first access.
 *
 * @param config - Service configuration with required dependencies
 * @throws Error if called multiple times (use `clearServices()` first)
 * @throws Error if database environment configuration is invalid
 * @throws Error if database connection fails
 */
export async function registerServices(
  config: NextlyServiceConfig
): Promise<void> {
  if (globalForReg.__nextly_isRegistered) {
    throw new Error(
      "Services are already registered. Call clearServices() first if you need to re-register."
    );
  }

  // ----------------------------------------
  // Layer 0: Process Plugin Config Transformers
  // ----------------------------------------
  const transformedConfig = await applyPluginConfigTransformers(config);

  const {
    db,
    adapter: providedAdapter,
    storage,
    storagePlugins,
    imageProcessor,
    logger,
    hookRegistry,
    basePath,
    schemasDir,
    migrationsDir,
    passwordHasher,
  } = transformedConfig;

  const resolvedLogger = logger ?? consoleLogger;
  const resolvedBasePath = basePath ?? process.cwd();

  if (transformedConfig.plugins && transformedConfig.plugins.length > 0) {
    const pluginNames = transformedConfig.plugins.map(p => p.name).join(", ");
    resolvedLogger.info?.(`Registered plugins: ${pluginNames}`);
  }

  // ----------------------------------------
  // Layer 1: Create and Connect Adapter
  // ----------------------------------------
  const adapter = await resolveAdapter(providedAdapter, resolvedLogger);

  // ----------------------------------------
  // Layer 2: Register Infrastructure
  // ----------------------------------------

  // Extract the adapter's drizzle instance to share with legacy services.
  // This avoids creating a SECOND connection pool via drizzle.ts, which
  // can exhaust cloud database connection limits (e.g., Neon pooler).
  const adapterDrizzleDb = adapter.getDrizzle<DatabaseInstance>();

  container.registerSingleton<DrizzleAdapter>("adapter", () => adapter);

  const schemaRegistry = await initializeSchemaRegistry(adapter);

  // Belt-and-suspenders: also register every code-first collection and
  // single from the supplied config directly into the resolver. The
  // `loadDynamicTables` pass inside initializeSchemaRegistry reads from
  // the `dynamic_collections` / `dynamic_singles` DB tables and swallows
  // errors on failure, which means a silent read hiccup (SQLite driver
  // quirk, partially-written row, wrong JSON shape on the `fields`
  // column) leaves code-first tables invisible at runtime. Registering
  // straight from the loaded `NextlyConfig` sidesteps that failure mode
  // entirely for code-first tables - the DB is still the source of
  // truth for UI-created tables via `loadDynamicTables`.
  if (schemaRegistry) {
    try {
      await registerConfigTablesInResolver(
        schemaRegistry,
        transformedConfig,
        adapter,
        resolvedLogger
      );
    } catch (err) {
      // Non-fatal: the DB-backed pass may still have registered these
      // tables. Log at debug so real issues surface during dev.
      resolvedLogger.debug?.(
        `[registerServices] Could not register config tables into resolver: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Register SchemaChangeService for schema change confirmation flow.
  // Depends on adapter, SchemaRegistry (from initializeSchemaRegistry),
  // and DrizzlePushService. Created after schema registry is initialized.
  try {
    const dialect = adapter.getCapabilities().dialect;
    if (schemaRegistry) {
      const { DrizzlePushService } = await import(
        "../domains/schema/services/drizzle-push-service.js"
      );
      const pushService = new DrizzlePushService(dialect, adapter.getDrizzle());
      container.registerSingleton("drizzlePushService", () => pushService);

      const { SchemaChangeService } = await import(
        "../services/schema/schema-change-service.js"
      );
      const schemaChangeService = new SchemaChangeService(
        adapter,
        schemaRegistry,
        pushService
      );
      // Wire schema version bump callback for API response header
      try {
        const { bumpSchemaVersion } = await import("../routeHandler.js");
        schemaChangeService.setOnApplySuccess(bumpSchemaVersion);
      } catch {
        // routeHandler may not be available in CLI-only contexts
      }
      container.registerSingleton(
        "schemaChangeService",
        () => schemaChangeService
      );
    }
  } catch {
    // SchemaChangeService init failed - confirmation flow unavailable
  }

  container.registerSingleton<Logger>("logger", () => resolvedLogger);
  container.registerSingleton<NextlyServiceConfig>(
    "config",
    () => transformedConfig
  );

  if (db) {
    container.registerSingleton<DatabaseInstance>("db", () => db);
  }

  // ----------------------------------------
  // Layer 2.5: Initialize Media Storage
  // ----------------------------------------
  const mediaStorage = initializeMediaStorage({ plugins: storagePlugins });
  logStorageConfiguration(mediaStorage, storagePlugins, resolvedLogger);
  container.registerSingleton<MediaStorage>("mediaStorage", () => mediaStorage);

  // Priority: provided storage > MediaStorage default adapter (if available).
  // Storage is optional — app can run without it for non-media operations.
  let resolvedStorageAdapter: IStorageAdapter | null = storage ?? null;
  if (!resolvedStorageAdapter) {
    try {
      resolvedStorageAdapter = mediaStorage.getDefaultAdapter();
    } catch {
      resolvedLogger.warn?.(
        "No storage plugin configured. Media operations will not be available."
      );
    }
  }

  // ----------------------------------------
  // Layer 3: Domain Service Registrations
  // ----------------------------------------
  const ctx: RegistrationContext = {
    adapter,
    adapterDrizzleDb,
    db,
    logger: resolvedLogger,
    config: transformedConfig,
    basePath: resolvedBasePath,
    schemasDir,
    migrationsDir,
    storage: resolvedStorageAdapter,
    mediaStorage,
    imageProcessor,
    hookRegistry,
    passwordHasher,
  };

  // Order is not strictly required because every registration is a lazy
  // singleton; however, we order domains roughly by dependency depth so
  // that the shape matches the original monolithic implementation.
  registerComponentServices(ctx);
  registerUserServices(ctx);
  registerEmailServices(ctx);
  registerDashboardServices(ctx);
  registerAuthServices(ctx);
  registerCollectionServices(ctx);
  registerMediaServices(ctx);
  registerSingleServices(ctx);

  // ----------------------------------------
  // Layer 4: Sync Code-First Collections
  // ----------------------------------------
  await syncCodeFirstCollections(adapter, resolvedLogger, transformedConfig);

  // ----------------------------------------
  // Layer 5: Sync Code-First Components
  // ----------------------------------------
  await syncCodeFirstComponents(adapter, resolvedLogger, transformedConfig);

  // ----------------------------------------
  // Layer 6: Sync Code-First Singles
  // ----------------------------------------
  await syncCodeFirstSingles(resolvedLogger, transformedConfig);

  // ----------------------------------------
  // Layer 7: Initialize Plugins
  // ----------------------------------------
  await initializePlugins(
    transformedConfig,
    adapterDrizzleDb,
    resolvedLogger,
    hookRegistry
  );

  // ----------------------------------------
  // Layer 8: Register Global Sanitization + Activity Log Hooks
  // ----------------------------------------
  if (hookRegistry) {
    const sanitizationHandler = createSanitizationHook(
      transformedConfig.security?.sanitization
    );
    hookRegistry.register("beforeCreate", "*", sanitizationHandler);
    hookRegistry.register("beforeUpdate", "*", sanitizationHandler);
    resolvedLogger.info?.(
      `Input sanitization hook registered (enabled: ${transformedConfig.security?.sanitization?.enabled !== false})`
    );

    registerActivityLogHooks(hookRegistry);
    resolvedLogger.info?.("Activity log hooks registered");
  }

  globalForReg.__nextly_isRegistered = true;
}

// ============================================================
// Orchestration Helpers
// ============================================================

async function applyPluginConfigTransformers(
  config: NextlyServiceConfig
): Promise<NextlyServiceConfig> {
  const plugins = config.plugins ?? [];
  if (plugins.length === 0) return config;

  let transformed = config;
  for (const plugin of plugins) {
    if (!plugin.config) continue;
    try {
      transformed = plugin.config(transformed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Plugin "${plugin.name}" config transformer failed: ${message}`
      );
    }
  }
  return transformed;
}

async function resolveAdapter(
  providedAdapter: DrizzleAdapter | undefined,
  logger: Logger
): Promise<DrizzleAdapter> {
  if (providedAdapter) {
    logger.info?.("Using provided database adapter");
    return providedAdapter;
  }

  logger.info?.("Creating database adapter from environment variables...");

  const validation = validateDatabaseEnv();
  if (!validation.valid) {
    throw new Error(
      `Database configuration error:\n${validation.errors.map(e => `  - ${e}`).join("\n")}`
    );
  }

  const adapter = await createAdapterFromEnv();
  const capabilities = adapter.getCapabilities();
  logger.info?.(`Database adapter initialized: ${capabilities.dialect}`);
  logger.info?.(`  - JSONB support: ${capabilities.supportsJsonb ? "✓" : "✗"}`);
  logger.info?.(
    `  - RETURNING support: ${capabilities.supportsReturning ? "✓" : "✗"}`
  );
  logger.info?.(
    `  - Full-text search: ${capabilities.supportsFts ? "✓" : "✗"}`
  );
  return adapter;
}

/**
 * Sets up the SchemaRegistry with static system tables AND dynamic
 * collections/singles/components so that Drizzle CRUD queries work for
 * every table in every adapter context (CLI + API routes).
 *
 * Static tables come from compile-time Drizzle schema definitions.
 * Dynamic tables come from the `dynamic_collections`, `dynamic_singles`,
 * and `dynamic_components` DB tables and are generated at runtime.
 */
async function initializeSchemaRegistry(
  adapter: DrizzleAdapter
): Promise<
  import("../database/schema-registry.js").SchemaRegistry | undefined
> {
  try {
    const { SchemaRegistry } = await import("../database/schema-registry.js");
    const { getDialectTables } = await import("../database/index.js");
    const dialect = adapter.getCapabilities().dialect;
    const registry = new SchemaRegistry(dialect);

    container.registerSingleton("schemaRegistry", () => registry);

    // Step 1: Register static system tables.
    registry.registerStaticSchemas(getDialectTables(dialect));
    adapter.setTableResolver(registry);

    // Step 2: Dynamic collections.
    await loadDynamicTables(
      adapter,
      "dynamic_collections",
      async (tableName, fields) => {
        const { generateRuntimeSchema } = await import(
          "../domains/schema/services/runtime-schema-generator.js"
        );
        const { table } = generateRuntimeSchema(
          tableName,
          fields as FieldDefinition[],
          dialect
        );
        registry.registerDynamicSchema(tableName, table);
      }
    );

    // Step 3: Dynamic singles.
    await loadDynamicTables(
      adapter,
      "dynamic_singles",
      async (tableName, fields) => {
        const { generateRuntimeSchema } = await import(
          "../domains/schema/services/runtime-schema-generator.js"
        );
        const { table } = generateRuntimeSchema(
          tableName,
          fields as FieldDefinition[],
          dialect
        );
        registry.registerDynamicSchema(tableName, table);
      }
    );

    // Step 4: Dynamic components (comp_* tables).
    await loadDynamicTables(
      adapter,
      "dynamic_components",
      async (tableName, fields) => {
        const { ComponentSchemaService } = await import(
          "../services/components/component-schema-service.js"
        );
        const compSchemaService = new ComponentSchemaService(dialect);
        const runtimeTable = compSchemaService.generateRuntimeSchema(
          tableName,
          fields as FieldConfig[]
        );
        registry.registerDynamicSchema(tableName, runtimeTable);
      }
    );

    return registry;
  } catch {
    // SchemaRegistry setup failed entirely — adapter falls back to
    // executeQuery for basic operations.
    return undefined;
  }
}

type DynamicTableRow = {
  table_name: string;
  fields: string;
  slug: string;
};

/**
 * Register every code-first collection and single from the config as a
 * runtime Drizzle schema in the resolver. Complements `loadDynamicTables`
 * which reads the same data from the `dynamic_*` DB registry; having both
 * paths makes the resolver correct even when the DB read silently fails
 * or when a just-synced row hasn't been flushed yet.
 *
 * No-op for tables that are already registered (e.g. from the DB pass).
 */
async function registerConfigTablesInResolver(
  registry: import("../database/schema-registry.js").SchemaRegistry,
  config: NextlyServiceConfig,
  adapter: DrizzleAdapter,
  logger: Partial<Logger>
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;

  // Collections: table name convention is `dc_<slug-with-underscores>`.
  for (const collection of config.collections ?? []) {
    try {
      const slug = (collection as { slug: string }).slug;
      const dbName = (collection as { dbName?: string }).dbName;
      const fields = (collection as { fields?: unknown[] }).fields ?? [];
      if (!slug || !Array.isArray(fields) || fields.length === 0) continue;
      const baseTableName = dbName ?? slug.replace(/-/g, "_");
      const tableName = baseTableName.startsWith("dc_")
        ? baseTableName
        : `dc_${baseTableName}`;
      const { generateRuntimeSchema } = await import(
        "../domains/schema/services/runtime-schema-generator.js"
      );
      const { table } = generateRuntimeSchema(
        tableName,
        fields as FieldDefinition[],
        dialect
      );
      registry.registerDynamicSchema(tableName, table);
    } catch (err) {
      logger.debug?.(
        `[registerServices] Failed to register collection "${(collection as { slug?: string }).slug ?? "?"}" in resolver: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Singles: table name convention is `single_<slug-with-underscores>`.
  // Routes through the canonical resolver helper added in Task 17 Sub-1
  // so every code path agrees on the physical table name.
  const { resolveSingleTableName } = await import(
    "../domains/singles/services/resolve-single-table-name.js"
  );
  for (const single of config.singles ?? []) {
    try {
      const slug = (single as { slug: string }).slug;
      const dbName = (single as { dbName?: string }).dbName;
      const fields = (single as { fields?: unknown[] }).fields ?? [];
      if (!slug || !Array.isArray(fields) || fields.length === 0) continue;
      const tableName = resolveSingleTableName({ slug, dbName });
      const { generateRuntimeSchema } = await import(
        "../domains/schema/services/runtime-schema-generator.js"
      );
      const { table } = generateRuntimeSchema(
        tableName,
        fields as FieldDefinition[],
        dialect
      );
      registry.registerDynamicSchema(tableName, table);
    } catch (err) {
      logger.debug?.(
        `[registerServices] Failed to register single "${(single as { slug?: string }).slug ?? "?"}" in resolver: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

async function loadDynamicTables(
  adapter: DrizzleAdapter,
  sourceTable: "dynamic_collections" | "dynamic_singles" | "dynamic_components",
  register: (tableName: string, fields: unknown[]) => Promise<void>
): Promise<void> {
  try {
    const rows = await adapter.executeQuery<DynamicTableRow>(
      `SELECT table_name, fields, slug FROM ${sourceTable}`
    );

    for (const row of rows) {
      try {
        const fields =
          typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields;

        if (Array.isArray(fields) && fields.length > 0) {
          await register(row.table_name, fields);
        }
      } catch {
        // Skip individual row if schema generation fails.
      }
    }
  } catch {
    // Dynamic table may not exist yet (fresh database).
  }
}

function logStorageConfiguration(
  mediaStorage: MediaStorage,
  storagePlugins: StoragePlugin[] | undefined,
  logger: Logger
): void {
  const configuredCollections = mediaStorage.getConfiguredCollections();
  if (configuredCollections.length > 0) {
    logger.info?.(
      `Storage plugins configured for collections: ${configuredCollections.join(", ")}`
    );
    return;
  }
  if (storagePlugins && storagePlugins.length > 0) {
    logger.info?.("Storage plugins registered (no collections configured)");
    return;
  }
  logger.info?.("Using default local storage");
}

/**
 * Syncs code-first collections from `transformedConfig.collections` to the
 * DB registry, registers their access rules, and (when possible)
 * auto-creates their tables so plugin-provided collections work without
 * a separate CLI run.
 */
async function syncCodeFirstCollections(
  adapter: DrizzleAdapter,
  logger: Logger,
  transformedConfig: NextlyServiceConfig
): Promise<void> {
  if (
    !transformedConfig.collections ||
    transformedConfig.collections.length === 0
  ) {
    return;
  }

  const collectionRegistry = container.get<CollectionRegistryService>(
    "collectionRegistryService"
  );

  const codeFirstConfigs: CodeFirstCollectionConfig[] =
    transformedConfig.collections.map(collection => ({
      slug: collection.slug,
      labels: {
        singular: collection.labels?.singular ?? collection.slug,
        plural: collection.labels?.plural ?? `${collection.slug}s`,
      },
      fields: collection.fields,
      description: collection.description,
      tableName: collection.dbName,
      timestamps: collection.timestamps,
      admin: collection.admin,
    }));

  const syncResult =
    await collectionRegistry.syncCodeFirstCollections(codeFirstConfigs);

  logger.info?.(
    `Collections registered: ${syncResult.created.length} created, ${syncResult.updated.length} updated, ${syncResult.unchanged.length} unchanged`
  );

  // On a fresh database the dynamic_collections table hasn't been created
  // by migrations yet, so every sync fails with "does not exist". That's
  // expected — the app should still start so the /setup endpoint works.
  if (syncResult.errors.length > 0) {
    const allAreMissingTable = syncResult.errors.every(
      e =>
        e.error.includes("does not exist") ||
        e.error.includes("no such table") ||
        e.error.includes("doesn't exist")
    );

    if (allAreMissingTable) {
      logger.warn?.(
        `Collections sync skipped (database tables not yet created — run migrations first). ${syncResult.errors.length} collection(s) deferred.`
      );
    } else {
      const errorDetails = syncResult.errors
        .map(e => `  - ${e.slug}: ${e.error}`)
        .join("\n");
      throw new Error(`Failed to register collections:\n${errorDetails}`);
    }
  }

  // Register code-defined access control configs with RBAC service.
  // Access functions are stored in-memory (not DB) and auto-resolved
  // during checkAccess().
  const rbacService = container.get<RBACAccessControlService>(
    "rbacAccessControlService"
  );
  for (const collection of transformedConfig.collections) {
    if (collection.access) {
      rbacService.registerCollectionAccess(collection.slug, collection.access);
    }
  }
  if (transformedConfig.singles) {
    for (const single of transformedConfig.singles) {
      if (single.access) {
        rbacService.registerSingleAccess(single.slug, single.access);
      }
    }
  }

  // Runtime auto-sync: create database tables for new/updated collections.
  // Treats dev databases as sandboxes where schema changes are auto-applied.
  const collectionsNeedingTableSync = [
    ...syncResult.created,
    ...syncResult.updated,
  ];

  // Also check unchanged collections that might be missing their tables.
  for (const slug of syncResult.unchanged) {
    const tableName = `dc_${slug.replace(/-/g, "_")}`;
    try {
      const tableExists = await adapter.tableExists(tableName);
      if (!tableExists) {
        logger.info?.(
          `Table ${tableName} missing for registered collection ${slug}, adding to sync`
        );
        collectionsNeedingTableSync.push(slug);
      }
    } catch {
      // Ignore table check errors.
    }
  }

  if (collectionsNeedingTableSync.length === 0) return;

  logger.info?.(
    `Auto-syncing ${collectionsNeedingTableSync.length} collection table(s)...`
  );

  try {
    const { SchemaPushService } = await import(
      "../domains/schema/services/schema-push-service.js"
    );
    const schemaPushService = new SchemaPushService(adapter, logger);

    // Inline sanitize the service config's user-facing fields into a
    // SanitizedNextlyConfig so schema-push doesn't need to re-check nils.
    // We only pass what SchemaPushService actually reads (collections,
    // plugins, db paths, etc.) — everything else is N/A for auto-sync.
    const { sanitizeConfig } = await import("../shared/types/config.js");
    const pushResult = await schemaPushService.syncSchema(
      sanitizeConfig({
        collections: transformedConfig.collections,
        singles: transformedConfig.singles,
        components: transformedConfig.components,
        plugins: transformedConfig.plugins,
      }),
      collectionsNeedingTableSync,
      { force: true, skipExistingTables: true }
    );

    for (const synced of pushResult.synced) {
      await collectionRegistry
        .updateMigrationStatus(synced.slug, "applied")
        .catch(() => {});
      logger.info?.(`Created table ${synced.tableName} for ${synced.slug}`);

      // Register the new table in the SchemaRegistry so adapter CRUD works.
      try {
        const { generateRuntimeSchema } = await import(
          "../domains/schema/services/runtime-schema-generator.js"
        );
        const syncDialect = adapter.getCapabilities().dialect;
        const rows = await adapter.executeQuery<{ fields: string }>(
          `SELECT fields FROM dynamic_collections WHERE table_name = '${synced.tableName}'`
        );
        if (rows[0]) {
          const fields =
            typeof rows[0].fields === "string"
              ? JSON.parse(rows[0].fields)
              : rows[0].fields;
          if (Array.isArray(fields) && fields.length > 0) {
            const { table: runtimeTable } = generateRuntimeSchema(
              synced.tableName,
              fields,
              syncDialect
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
              resolver.registerDynamicSchema(synced.tableName, runtimeTable);
            }
          }
        }
      } catch {
        // Non-fatal: schema will be registered on next server restart.
      }
    }

    for (const error of pushResult.errors) {
      logger.warn?.(`Failed to create table for ${error.slug}: ${error.error}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn?.(`Auto-sync tables failed: ${errorMsg}`);
  }
}

/**
 * Syncs code-first components (reusable field groups) to the
 * `dynamic_components` table and auto-creates their `comp_*` data
 * tables so component enrichment works at runtime.
 */
async function syncCodeFirstComponents(
  adapter: DrizzleAdapter,
  logger: Logger,
  transformedConfig: NextlyServiceConfig
): Promise<void> {
  if (
    !transformedConfig.components ||
    transformedConfig.components.length === 0
  ) {
    return;
  }

  const componentRegistry = container.get<ComponentRegistryService>(
    "componentRegistryService"
  );

  const codeFirstComponentConfigs: CodeFirstComponentConfig[] =
    transformedConfig.components.map(comp => ({
      slug: comp.slug,
      label:
        comp.label?.singular ??
        comp.slug.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      fields: comp.fields,
      description: comp.description,
      tableName: comp.dbName,
      admin: comp.admin,
      configPath: `components/${comp.slug}.ts`,
    }));

  const componentSyncResult = await componentRegistry.syncCodeFirstComponents(
    codeFirstComponentConfigs
  );

  logger.info?.(
    `Components registered: ${componentSyncResult.created.length} created, ${componentSyncResult.updated.length} updated, ${componentSyncResult.unchanged.length} unchanged`
  );

  if (componentSyncResult.errors.length > 0) {
    const errorDetails = componentSyncResult.errors
      .map(e => `  - ${e.slug}: ${e.error}`)
      .join("\n");
    logger.warn?.(`Component sync errors:\n${errorDetails}`);
  }

  const componentsNeedingTableSync = [
    ...componentSyncResult.created,
    ...componentSyncResult.updated,
  ];

  for (const slug of componentSyncResult.unchanged) {
    const tableName = `comp_${slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")}`;
    try {
      const tableExists = await adapter.tableExists(tableName);
      if (!tableExists) {
        logger.info?.(
          `Table ${tableName} missing for registered component ${slug}, adding to sync`
        );
        componentsNeedingTableSync.push(slug);
      }
    } catch {
      // Ignore table check errors.
    }
  }

  if (componentsNeedingTableSync.length === 0) return;

  logger.info?.(
    `Auto-syncing ${componentsNeedingTableSync.length} component table(s)...`
  );

  try {
    const { ComponentSchemaService: CompSchemaService } = await import(
      "../services/components/component-schema-service.js"
    );
    const dialect = adapter.getCapabilities().dialect;
    const compSchemaService = new CompSchemaService(dialect);

    for (const slug of componentsNeedingTableSync) {
      const compConfig = transformedConfig.components.find(
        c => c.slug === slug
      );
      if (!compConfig) continue;

      const tableName =
        compConfig.dbName ??
        `comp_${slug
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")}`;

      try {
        const migrationSQL = compSchemaService.generateMigrationSQL(
          tableName,
          compConfig.fields
        );

        const statements = migrationSQL
          .split("--> statement-breakpoint")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);

        for (const statement of statements) {
          const cleanStatement = statement
            .split("\n")
            .filter((line: string) => !line.trim().startsWith("--"))
            .join("\n")
            .trim();
          if (cleanStatement) {
            await adapter.executeQuery(cleanStatement);
          }
        }

        const tableActuallyExists = await adapter.tableExists(tableName);
        if (tableActuallyExists) {
          await componentRegistry
            .updateMigrationStatus(slug, "applied")
            .catch(() => {});
          logger.info?.(`Created table ${tableName} for component ${slug}`);

          try {
            const compRuntimeTable = compSchemaService.generateRuntimeSchema(
              tableName,
              compConfig.fields
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
              resolver.registerDynamicSchema(tableName, compRuntimeTable);
            }
          } catch {
            // Non-fatal: schema will be registered on next server restart.
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (
          errorMsg.includes("already exists") ||
          errorMsg.includes("duplicate")
        ) {
          await componentRegistry
            .updateMigrationStatus(slug, "applied")
            .catch(() => {});
          logger.info?.(`Table already exists for component ${slug}`);
        } else {
          logger.warn?.(
            `Failed to create table for component ${slug}: ${errorMsg}`
          );
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn?.(`Auto-sync component tables failed: ${errorMsg}`);
  }
}

/**
 * Syncs code-first Singles to the `dynamic_singles` table so permission
 * seeding (in `runPostInitTasks`) can find them. Mirrors collection sync
 * at Layer 4.
 */
async function syncCodeFirstSingles(
  logger: Logger,
  transformedConfig: NextlyServiceConfig
): Promise<void> {
  if (!transformedConfig.singles || transformedConfig.singles.length === 0) {
    return;
  }

  const singleRegistry = container.get<SingleRegistryService>(
    "singleRegistryService"
  );

  const codeFirstSingleConfigs: CodeFirstSingleConfig[] =
    transformedConfig.singles.map(single => ({
      slug: single.slug,
      label:
        single.label?.singular ??
        single.slug
          .split("-")
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      fields: single.fields,
      description: single.description,
      tableName: single.dbName,
      admin: single.admin,
    }));

  try {
    const singleSyncResult = await singleRegistry.syncCodeFirstSingles(
      codeFirstSingleConfigs
    );
    logger.info?.(
      `Singles registered: ${singleSyncResult.created.length} created, ${singleSyncResult.updated.length} updated, ${singleSyncResult.unchanged.length} unchanged`
    );
  } catch (error) {
    logger.warn?.(
      `Singles sync failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Initializes plugins that provide an `init()` method. Runs after all
 * services are registered so plugins can access the full service graph
 * via the PluginContext. Calls are awaited sequentially to preserve
 * ordering between plugins.
 */
async function initializePlugins(
  transformedConfig: NextlyServiceConfig,
  adapterDrizzleDb: DatabaseInstance,
  logger: Logger,
  hookRegistry: HookRegistry | undefined
): Promise<void> {
  const plugins = transformedConfig.plugins ?? [];
  if (plugins.length === 0) return;

  const pluginHookRegistry = hookRegistry ?? getHookRegistry();

  const getServiceForPlugin = <
    T extends
      | "collectionService"
      | "userService"
      | "mediaService"
      | "emailService"
      | "db"
      | "logger"
      | "config",
  >(
    name: T
  ):
    | CollectionService
    | UserService
    | UnifiedMediaService
    | EmailService
    | DatabaseInstance
    | Logger
    | NextlyServiceConfig => {
    switch (name) {
      case "collectionService":
        return container.get<CollectionService>("collectionService");
      case "userService":
        return container.get<UserService>("userService");
      case "mediaService":
        return container.get<UnifiedMediaService>("mediaService");
      case "emailService":
        return container.get<EmailService>("emailService");
      case "db":
        return transformedConfig.db ?? adapterDrizzleDb;
      case "logger":
        return logger;
      case "config":
        return transformedConfig;
      default:
        throw new Error(`Unknown service: ${name}`);
    }
  };

  const pluginContext = createPluginContext(
    getServiceForPlugin as Parameters<typeof createPluginContext>[0],
    {
      register: (hookType, collection, handler) => {
        pluginHookRegistry.register(hookType, collection, handler);
      },
      unregister: (hookType, collection, handler) => {
        pluginHookRegistry.unregister(hookType, collection, handler);
      },
    }
  );

  for (const plugin of plugins) {
    if (!plugin.init) continue;
    try {
      await plugin.init(pluginContext);
      logger.info?.(`Plugin "${plugin.name}" initialized`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Plugin "${plugin.name}" initialization failed: ${message}`
      );
    }
  }
}

// ============================================================
// Service Access Functions
// ============================================================

/**
 * Get a service from the container with type safety.
 * Services must be registered first via `registerServices()`.
 */
export function getService<T extends keyof ServiceMap>(name: T): ServiceMap[T] {
  return container.get<ServiceMap[T]>(name);
}

/**
 * Check if services have been registered.
 */
export function isServicesRegistered(): boolean {
  return globalForReg.__nextly_isRegistered ?? false;
}

/**
 * Shutdown all services and cleanup resources. Should be called when
 * shutting down the application to ensure proper cleanup of database
 * connections and other resources.
 */
export async function shutdownServices(): Promise<void> {
  if (!globalForReg.__nextly_isRegistered) {
    return;
  }

  try {
    if (container.has("adapter")) {
      const adapter = container.get<DrizzleAdapter>("adapter");
      await adapter.disconnect();
    }
  } catch (error) {
    console.error("Error during service shutdown:", error);
  } finally {
    container.clear();
    globalForReg.__nextly_isRegistered = false;
  }
}

/**
 * Clear all registered services. Primarily for testing or re-initialization
 * with different configuration. For production shutdown, prefer
 * `shutdownServices()` so resources are properly released.
 */
export function clearServices(): void {
  container.clear();
  globalForReg.__nextly_isRegistered = false;
}
