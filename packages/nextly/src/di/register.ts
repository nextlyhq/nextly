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
 * import { registerServices, getService } from 'nextly';
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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { dequal } from "dequal";

import type { CollectionConfig } from "../collections/config/define-collection";
import type {
  SanitizedApiKeysConfig,
  SecurityConfig,
} from "../collections/config/define-config";
import type { FieldConfig } from "../collections/fields/types";
import type { ComponentConfig } from "../components/config/types";
import { createAdapterFromEnv, validateDatabaseEnv } from "../database/factory";
import type { SchemaRegistry } from "../database/schema-registry";
import type { ApiKeyService } from "../domains/auth/services/api-key-service";
import type { AuthService } from "../domains/auth/services/auth-service";
import type { PermissionSeedService } from "../domains/auth/services/permission-seed-service";
import type { RBACAccessControlService } from "../domains/auth/services/rbac-access-control-service";
import {
  getEmailProviderRegistry,
  resetEmailProviderRegistry,
} from "../domains/email/services/email-provider-registry";
import type { SanitizedLocalizationConfig } from "../domains/i18n/config/types";
import type { MetaService } from "../domains/meta";
import {
  clearFieldTypes,
  registerFieldType,
} from "../domains/schema/field-types/field-type-registry";
import type { DesiredCollection } from "../domains/schema/pipeline/types";
import type { SingleEntryService } from "../domains/singles/services/single-entry-service";
import type {
  SingleRegistryService,
  CodeFirstSingleConfig,
} from "../domains/singles/services/single-registry-service";
import { resolveVersionsConfig } from "../domains/versions/resolve-config";
import type { VersionsService } from "../domains/versions/versions-service";
import type { ResolvedWebhookRetentionConfig } from "../domains/webhooks/retention-config";
import { getEventBus } from "../events/event-bus";
import { registerActivityLogHooks } from "../hooks/activity-log-hooks";
import type { HookRegistry } from "../hooks/hook-registry";
import { getHookRegistry } from "../hooks/hook-registry";
import { createSanitizationHook } from "../hooks/sanitization-hooks";
import type { PluginPermission, PluginRole } from "../plugins/contributions";
import { getCoreVersion } from "../plugins/core-version";
import { collectCustomPermissions } from "../plugins/permissions/collect-permissions";
import type {
  PluginContext,
  PluginDefinition,
} from "../plugins/plugin-context";
import { createPluginContext } from "../plugins/plugin-context";
import { resolvePlugins } from "../plugins/resolve";
import { collectRoles } from "../plugins/roles/collect-roles";
import { collectPluginRoutes } from "../plugins/routes/collect-routes";
import { getPluginRouteRegistry } from "../plugins/routes/route-registry";
import { applyPluginSchemaContributionsDeferred } from "../plugins/schema/apply-contributions";
import { reconcileBuilderContributions } from "../plugins/schema/reconcile-builder-contributions";
import {
  collectUnresolvedRelationTargets,
  finalizeRelationTargets,
  validateCrossPluginRelations,
} from "../plugins/schema/validate-relations";
import { extendTargetUnknownError } from "../plugins/schema-error";
import {
  clearPluginServices,
  registerPluginService,
} from "../plugins/services/plugin-services-registry";
import { clearPluginSubscriptions } from "../plugins/subscription-tracker";
import type {
  CollectionSource,
  FieldDefinition,
} from "../schemas/dynamic-collections";
import type {
  CollectionRegistryService,
  CodeFirstCollectionConfig,
} from "../services/collections/collection-registry-service";
import type { CollectionRelationshipService } from "../services/collections/collection-relationship-service";
import type { CollectionService } from "../services/collections/collection-service";
import type { CollectionsHandler } from "../services/collections-handler";
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
import { registerFieldFunctions } from "../shared/lib/field-level-registry";
import type { AdminConfig, AuthConfig } from "../shared/types/config";
import type { SingleConfig } from "../singles/config/types";
import type { ImageProcessor } from "../storage/image-processor";
import { initializeMediaStorage, type MediaStorage } from "../storage/storage";
import type { IStorageAdapter, StoragePlugin } from "../storage/types";
import type { DatabaseInstance } from "../types/database-operations";
import type { UserConfig } from "../users/config/types";

import { container } from "./container";
import {
  type LoadedBuilderEntity,
  loadBuilderEntities,
  loadDynamicTables,
} from "./load-dynamic-tables";
import {
  registerAuthServices,
  registerCollectionServices,
  registerComponentServices,
  registerDashboardServices,
  registerEmailServices,
  registerMediaServices,
  registerMetaServices,
  registerSingleServices,
  registerUserServices,
  registerVersionServices,
  type RegistrationContext,
} from "./registrations";

// ============================================================
// Configuration Interface
// ============================================================

/**
 * Configuration for service registration.
 *
 * **Database Configuration:** if `adapter` is provided, it is used
 * directly. Otherwise, one is created from environment variables using
 * `DB_DIALECT` and `DATABASE_URL`.
 */
export interface NextlyServiceConfig {
  /**
   * Database adapter for multi-database support.
   * If not provided, created automatically from environment variables.
   */
  adapter?: DrizzleAdapter;

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

  /**
   * @experimental Fail fast (throw) when a plugin `extend`/relation targets an
   * entity that is NEITHER a code/plugin entity NOR a Builder collection/single/
   * component. Default `false`: such a target is warned-and-skipped so a typo or
   * a removed Builder entity can't take the whole app down (P8). Also enabled by
   * `NEXTLY_STRICT_PLUGIN_TARGETS=1` (recommended for CI/production).
   */
  strictPluginTargets?: boolean;

  /** @experimental App-declared custom permissions, seeded like plugin permissions (D36). */
  permissions?: PluginPermission[];

  /** @experimental App-declared role bundles, seeded like plugin roles (D67). */
  roles?: PluginRole[];

  /** Collection configurations. */
  collections?: CollectionConfig[];

  /** Single (global document) configurations. */
  singles?: SingleConfig[];

  /** Component (reusable field group) configurations. */
  components?: ComponentConfig[];

  /** User model extension configuration. */
  users?: UserConfig;

  /** Email system configuration. */
  email?: EmailConfig;

  /** API key authentication configuration with defaults applied. */
  apiKeys?: SanitizedApiKeysConfig;

  /** Security configuration (headers, CORS, uploads, sanitization). */
  security?: SecurityConfig;

  /**
   * Admin panel configuration (branding, plugin overrides, devAutoLogin).
   * Carried through from `nextly.config.ts` so handlers that read from the
   * DI's "config" service can see admin-level toggles. Without this the
   * admin object gets dropped during buildServiceConfig.
   */
  admin?: AdminConfig;

  /**
   * Authentication configuration (revealRegistrationConflict and friends).
   * Same rationale as admin: carried through so handlers can read it.
   */
  auth?: AuthConfig;

  /**
   * Content-localization configuration (i18n), normalized. Carried through so the
   * collection read path can resolve a requested locale to its fallback chain when
   * populating localized fields from the companion `_locales` table.
   */
  localization?: SanitizedLocalizationConfig;

  /**
   * Resolved webhook retention policy, carried through so services can offer a
   * retention pass without re-deriving it. Null when the user switched
   * retention off; absent when this container was built without app config.
   */
  webhookRetention?: ResolvedWebhookRetentionConfig | null;
}

// ============================================================
// Service Map Interface
// ============================================================

/**
 * Type-safe service map returned by `getService()`.
 */
export interface ServiceMap {
  adapter: DrizzleAdapter;
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
  metaService: MetaService;
  versionsService: VersionsService;
  // Registered by registerCollectionServices but previously untyped here, so
  // consumers had to reach past getService() to use it.
  collectionsHandler: CollectionsHandler;
}

// ============================================================
// Registration State
// ============================================================

// Stored on globalThis to survive ESM module duplication in Next.js/Turbopack.
const globalForReg = globalThis as unknown as {
  __nextly_isRegistered?: boolean;
  /** Resolved plugins + their contexts, for reverse-order destroy on shutdown (D4). */
  __nextly_pluginTeardown?: Array<{
    plugin: PluginDefinition;
    context: PluginContext;
  }>;
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
  // Layer 0a: Resolve Plugins (validate + order)
  // ----------------------------------------
  // Validate core/dependency compatibility (D6) and topologically sort by
  // declared dependencies (D5), failing fast with a great error (D7). The
  // resolved order drives BOTH setup and init below. Runs over all plugins
  // (including disabled ones) so schema stays deterministic (D49).
  const resolvedPlugins = resolvePlugins(config.plugins ?? [], {
    coreVersion: getCoreVersion(),
  });
  const resolvedConfig: NextlyServiceConfig = {
    ...config,
    plugins: resolvedPlugins,
  };

  // ----------------------------------------
  // Layer 0b: Process Plugin Config Transformers (resolved order)
  // ----------------------------------------
  const setupConfig = await applyPluginConfigTransformers(resolvedConfig);

  // ----------------------------------------
  // Layer 0c: Fold declarative plugin schema contributions (D3/D12/D50)
  // ----------------------------------------
  // Merge `contributes.{collections,singles,components}` into the config so the
  // downstream registry/sync/migration machinery treats them like ordinary
  // code-first entities. Runs over ALL resolved plugins (incl. disabled — D49)
  // and fails fast on plugin-involved slug collisions (D13). The CLI applies the
  // SAME fold (config-loader.ts) so both paths agree (D50). `extend`/relation
  // targets that aren't code/plugin entities are DEFERRED here (candidate
  // Builder-made collections) and finalized after the DB is reachable below —
  // this is how extending/relating to a Builder collection works (P8/D3/R2).
  const { config: transformedConfig, deferredExtends } =
    applyPluginSchemaContributionsDeferred(setupConfig, resolvedPlugins);

  // Collect every relationTo (code + plugin) that doesn't resolve to a merged
  // collection (or core target); require dependsOn for cross-plugin relations
  // (D15). Builder-target relations stay in `unresolvedRelations` and are
  // finalized once Builder slugs are loaded from the DB (below).
  const unresolvedRelations =
    collectUnresolvedRelationTargets(transformedConfig);
  validateCrossPluginRelations(resolvedPlugins);

  // Fail fast on invalid plugin-declared custom permissions (D36). Validation
  // only here; the list is re-derived + seeded in runPostInitTasks.
  collectCustomPermissions(transformedConfig, resolvedPlugins);

  // Fail fast on role-bundle collisions (D67). Validation only here; roles are
  // re-derived + seeded (resolving permission slugs→ids) in runPostInitTasks.
  collectRoles(transformedConfig, resolvedPlugins);

  // Register plugin custom field types (C7/D16) BEFORE schema sync, so the DDL
  // classifier (classifyFieldKind) maps each custom type to its storage
  // primitive. Declarative + schema-affecting, so registered for ALL plugins
  // (incl. disabled, per D49). Clear-and-rebuild per boot; fail-fast on collision.
  clearFieldTypes();
  for (const fieldTypePlugin of resolvedPlugins) {
    for (const fieldType of fieldTypePlugin.contributes?.fieldTypes ?? []) {
      registerFieldType(fieldType);
    }
  }

  const {
    adapter: providedAdapter,
    storagePlugins,
    imageProcessor,
    logger,
    hookRegistry: providedHookRegistry,
    basePath,
    schemasDir,
    migrationsDir,
    passwordHasher,
  } = transformedConfig;

  // Default to the global hook registry when the boot path didn't supply one.
  // Both production boot paths (init.ts instrumentation + auth-handler.ts
  // request-path) omit `hookRegistry`; only the `createTestNextly` harness
  // passed it. Without a real registry the collection services' hook execution
  // resolves to a stub, so `ctx.services.collections` reads (used by plugin
  // routes — e.g. the redirects lookup + SEO sitemap) throw
  // "executeBeforeOperation is not a function" in production. Defaulting here
  // also ensures sanitization + activity-log "*" hooks register on every boot.
  const hookRegistry = providedHookRegistry ?? getHookRegistry();

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

  // Finalize the deferred Builder-lane targets now the DB is reachable (P8/D3).
  // Builder/UI entities live in the dynamic_* registry tables (loaded by
  // `loadDynamicTables` above), not in `config`, so their slugs weren't knowable
  // at fold time. A plugin extend/relation targeting a Builder collection
  // resolves here. The runtime now RECONCILES (not just existence-checks) so the
  // dev-push path converges with `migrate`: each active plugin's fields are
  // merged onto its Builder target (tagged source:"plugin"/locked) and the
  // columns materialized via the same add-only apply dev-push already uses;
  // stale plugin fields (owning plugin removed) are stripped from the registry
  // row, leaving the physical column orphaned (data-safe). A target in NEITHER
  // code/plugin NOR the Builder set is unresolved (handled per strict/graceful).
  {
    // Always reconcile (no outer guard) so a REMOVED plugin's stale fields are
    // stripped on the next boot (P8 §7) even when this boot has no deferred
    // extends. The reconcile is a pure read+transform; the `changed` filter
    // below keeps a plugin-free or unchanged boot write-free (no registry
    // writes, no DDL, no apply-helper imports) — the byte-for-byte no-op path.
    const builderEntities = await loadBuilderEntities(adapter);
    const { entities, unresolved } = reconcileBuilderContributions(
      deferredExtends,
      builderEntities
    );

    if (unresolved.length > 0) {
      handleUnresolvedExtends(unresolved, transformedConfig, resolvedLogger);
    }

    // Only touch the DB for entities whose merged field set actually differs
    // from what's persisted — keeps an unchanged/plugin-free boot write-free and
    // skips the apply-helper imports entirely.
    const dialect = adapter.getCapabilities().dialect;
    const changedOf = (
      reconciled: ReadonlyArray<{ slug: string; fields?: FieldConfig[] }>,
      loaded: LoadedBuilderEntity[]
    ) =>
      reconciled.filter(e => {
        const before = loaded.find(c => c.slug === e.slug);
        return before !== undefined && !dequal(before.fields, e.fields ?? []);
      });

    const collChanged = changedOf(
      entities.collections,
      builderEntities.collections
    );
    const singleChanged = changedOf(entities.singles, builderEntities.singles);
    const compChanged = changedOf(
      entities.components,
      builderEntities.components
    );

    if (collChanged.length + singleChanged.length + compChanged.length > 0) {
      const { addMissingColumnsForFields } = await import(
        "../domains/schema/utils/missing-columns"
      );
      const { generateRuntimeSchema } = await import(
        "../domains/schema/services/runtime-schema-generator"
      );

      // Materialize FIRST (add-only, never drops → removed-plugin columns
      // orphan, data-safe), then persist the reconciled fields on the registry
      // row, then re-register the runtime table so reads in THIS boot see the
      // new column. A per-entity failure is logged + skipped (retried next boot).
      const materializeKind = async (
        kind: string,
        changed: ReadonlyArray<{ slug: string; fields?: FieldConfig[] }>,
        loaded: LoadedBuilderEntity[],
        persist: (slug: string, fields: FieldConfig[]) => Promise<unknown>,
        makeRuntime: (
          tableName: string,
          fields: FieldConfig[],
          status: boolean
        ) => unknown
      ): Promise<void> => {
        for (const ent of changed) {
          const before = loaded.find(c => c.slug === ent.slug);
          if (!before) continue;
          const fields = ent.fields ?? [];
          try {
            await addMissingColumnsForFields(
              adapter,
              resolvedLogger,
              before.tableName,
              fields,
              { timestamps: true }
            );
            await persist(ent.slug, fields);
            if (schemaRegistry) {
              schemaRegistry.registerDynamicSchema(
                before.tableName,
                makeRuntime(before.tableName, fields, before.status)
              );
            }
          } catch (err) {
            resolvedLogger.warn?.(
              `[plugins] Failed to materialize plugin fields onto Builder ${kind} "${ent.slug}": ${
                err instanceof Error ? err.message : String(err)
              }. Skipping; will retry next boot.`
            );
          }
        }
      };

      // Collections + singles share the standard runtime-schema generator.
      const runtimeTable = (
        tableName: string,
        fields: FieldConfig[],
        status: boolean
      ) =>
        generateRuntimeSchema(
          tableName,
          fields as unknown as FieldDefinition[],
          dialect,
          { status }
        ).table;

      if (collChanged.length > 0) {
        const { DynamicCollectionRegistryService } = await import(
          "../domains/dynamic-collections/services/dynamic-collection-registry-service"
        );
        const reg = new DynamicCollectionRegistryService(
          adapter,
          resolvedLogger
        );
        await materializeKind(
          "collection",
          collChanged,
          builderEntities.collections,
          (slug, fields) =>
            reg.updateCollectionMetadata(slug, {
              fields: fields as unknown as FieldDefinition[],
            }),
          runtimeTable
        );
      }

      if (singleChanged.length > 0) {
        const { SingleRegistryService } = await import(
          "../domains/singles/services/single-registry-service"
        );
        const reg = new SingleRegistryService(adapter, resolvedLogger);
        await materializeKind(
          "single",
          singleChanged,
          builderEntities.singles,
          (slug, fields) => reg.updateSingle(slug, { fields: fields }),
          runtimeTable
        );
      }

      if (compChanged.length > 0) {
        const { ComponentRegistryService } = await import(
          "../domains/components/services/component-registry-service"
        );
        const { ComponentSchemaService } = await import(
          "../domains/components/services/component-schema-service"
        );
        const reg = new ComponentRegistryService(adapter, resolvedLogger);
        const compSchema = new ComponentSchemaService(dialect);
        await materializeKind(
          "component",
          compChanged,
          builderEntities.components,
          (slug, fields) => reg.updateComponent(slug, { fields: fields }),
          (tableName, fields) =>
            compSchema.generateRuntimeSchema(tableName, fields)
        );
      }
    }

    const builderCollectionSlugs = new Set(
      builderEntities.collections.map(c => c.slug)
    );
    finalizeRelationTargets(unresolvedRelations, builderCollectionSlugs, {
      strict: isStrictPluginTargets(transformedConfig),
      logger: resolvedLogger,
    });
  }

  // F8 PR 3: SchemaChangeService + DrizzlePushService DI registration
  // removed. The legacy preview path now uses pipeline/preview.ts +
  // legacy-preview/translate.ts (no DI lookup); the apply path uses
  // applyDesiredSchema (already DI-wired). bumpSchemaVersion is now
  // called directly from the dispatcher's apply handler after a
  // successful pipeline apply (was previously wired via
  // SchemaChangeService.setOnApplySuccess). PR 4 deleted the legacy
  // service classes themselves.

  // F8 PR 5: MigrationJournal — records every pipeline apply
  // (success/failure/abort) into nextly_migration_journal. Construction
  // is dialect-aware: the same DB instance + dialect the adapter wraps.
  try {
    const dialect = adapter.getCapabilities().dialect;
    const { DrizzleMigrationJournal } = await import(
      "../domains/schema/journal/migration-journal"
    );
    const journal = new DrizzleMigrationJournal({
      db: adapter.getDrizzle(),
      dialect,
      logger: resolvedLogger,
    });
    container.registerSingleton("migrationJournal", () => journal);
  } catch (err) {
    // Journal init failure is non-fatal — pipeline falls back to noop.
    resolvedLogger.warn?.(
      `[registerServices] Failed to register MigrationJournal: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  container.registerSingleton<Logger>("logger", () => resolvedLogger);
  container.registerSingleton<NextlyServiceConfig>(
    "config",
    () => transformedConfig
  );

  // ----------------------------------------
  // Layer 2.5: Initialize Media Storage
  // ----------------------------------------
  const mediaStorage = initializeMediaStorage({ plugins: storagePlugins });
  logStorageConfiguration(mediaStorage, storagePlugins, resolvedLogger);
  container.registerSingleton<MediaStorage>("mediaStorage", () => mediaStorage);

  // Storage adapter resolves from MediaStorage's default adapter.
  // Storage is optional; app can run without it for non-media operations.
  let resolvedStorageAdapter: IStorageAdapter | null = null;
  try {
    resolvedStorageAdapter = mediaStorage.getDefaultAdapter();
  } catch {
    resolvedLogger.warn?.(
      "No storage plugin configured. Media operations will not be available."
    );
  }

  // ----------------------------------------
  // Layer 3: Domain Service Registrations
  // ----------------------------------------
  const ctx: RegistrationContext = {
    adapter,
    adapterDrizzleDb,
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
  registerMetaServices(ctx);
  registerSingleServices(ctx);
  registerVersionServices(ctx);

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
  await syncCodeFirstSingles(adapter, resolvedLogger, transformedConfig);

  // ----------------------------------------
  // Layer 7: Initialize Plugins
  // ----------------------------------------
  // Stash the resolved plugins + their contexts so shutdownServices can run
  // destroy() in reverse order (D4).
  globalForReg.__nextly_pluginTeardown = await initializePlugins(
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

  // now Payload-style: an auth-gated POST route in the project's app
  // (templates/blog/src/app/admin/api/seed/route.ts) imports the seed
  // function directly and runs it on user action. This eliminates an
  // ordering-fragile pre-init pathway that silently failed if the
  // cached singleton was bootstrapped before the boot-time seed
  // attempted to run. System bootstrap (permissions table) still
  // happens automatically — see permission-seed-service.

  globalForReg.__nextly_isRegistered = true;
}

// ============================================================
// Orchestration Helpers
// ============================================================

// eslint-disable-next-line @typescript-eslint/require-await
async function applyPluginConfigTransformers(
  config: NextlyServiceConfig
): Promise<NextlyServiceConfig> {
  const plugins = config.plugins ?? [];
  if (plugins.length === 0) return config;

  let transformed = config;
  for (const plugin of plugins) {
    if (!plugin.setup) continue;
    try {
      transformed = plugin.setup(transformed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Plugin "${plugin.name}" setup transformer failed: ${message}`
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
): Promise<SchemaRegistry | undefined> {
  try {
    const { SchemaRegistry } = await import("../database/schema-registry");
    const { getDialectTables } = await import("../database/index");
    const dialect = adapter.getCapabilities().dialect;
    const registry = new SchemaRegistry(dialect);

    container.registerSingleton("schemaRegistry", () => registry);

    // Step 1: Register static system tables.
    registry.registerStaticSchemas(getDialectTables(dialect));
    adapter.setTableResolver(registry);

    // Step 1.5 (F8 PR 6): first-run static-table push. Probes for
    // `nextly_migration_journal` and, if missing, creates the static
    // schema via freshPushSchema. Must run BEFORE Step 2's
    // loadDynamicTables — that step queries `dynamic_collections`
    // which doesn't exist on a brand-new DB. Failure-safe (logs but
    // doesn't throw); see init/first-run.ts.
    try {
      const { ensureFirstRunSetup } = await import("../init/first-run");
      // initializeSchemaRegistry doesn't have resolvedLogger in scope;
      // console is the right fallback because first-run is a one-time
      // user-visible event and the boot logger wiring isn't done yet.
      await ensureFirstRunSetup({
        adapter,
        logger: {
          debug: msg => console.debug(msg),
          info: msg => console.log(msg),
          warn: msg => console.warn(msg),
          error: msg => console.error(msg),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[registerServices] First-run setup helper crashed: ${msg}. Continuing.`
      );
    }

    // Step 2: Dynamic collections.
    await loadDynamicTables(
      adapter,
      "dynamic_collections",
      async (tableName, fields, hasStatus, localized) => {
        const { generateRuntimeSchema } = await import(
          "../domains/schema/services/runtime-schema-generator"
        );
        // Localized collections omit their translatable columns from the main
        // runtime table (they live in the companion) — mirror the migration.
        const { table } = generateRuntimeSchema(
          tableName,
          fields as FieldDefinition[],
          dialect,
          { status: hasStatus === true, localized }
        );
        registry.registerDynamicSchema(tableName, table);
        // Register the companion `_locales` table so queries can reach it (M4).
        if (localized) {
          // i18n: create the companion on boot/db:sync if a migration hasn't already
          // (idempotent) so code-first localized entities work without a manual migrate.
          const { ensureCompanionTable } = await import(
            "../domains/i18n/runtime/companion-io"
          );
          await ensureCompanionTable(adapter, {
            slug: tableName,
            tableName,
            fields: fields as { name: string; type: string }[],
            dialect,
            status: hasStatus === true,
          });
          const { buildCompanionRuntimeTable } = await import(
            "../domains/i18n/runtime/companion-registration"
          );
          const companion = buildCompanionRuntimeTable({
            slug: tableName,
            tableName,
            fields: fields as { name: string; type: string }[],
            dialect,
            localized: true,
            // Carry `_status` so a Draft/Published localized collection's
            // DI-registered companion matches loadCompanionSchema.
            status: hasStatus === true,
          });
          if (companion) {
            registry.registerDynamicSchema(
              companion.companionTableName,
              companion.table
            );
          }
        }
      }
    );

    // Step 3: Dynamic singles. Localized singles omit their translatable columns
    // from the main runtime table and register the companion `single_<slug>_locales`
    // table for reads/writes — mirrors collections (Step 2).
    await loadDynamicTables(
      adapter,
      "dynamic_singles",
      async (tableName, fields, hasStatus, localized) => {
        const { generateRuntimeSchema } = await import(
          "../domains/schema/services/runtime-schema-generator"
        );
        const { table } = generateRuntimeSchema(
          tableName,
          fields as FieldDefinition[],
          dialect,
          { status: hasStatus === true, localized }
        );
        registry.registerDynamicSchema(tableName, table);
        if (localized) {
          const { ensureCompanionTable } = await import(
            "../domains/i18n/runtime/companion-io"
          );
          await ensureCompanionTable(adapter, {
            slug: tableName,
            tableName,
            fields: fields as { name: string; type: string }[],
            dialect,
            status: hasStatus === true,
          });
          const { buildCompanionRuntimeTable } = await import(
            "../domains/i18n/runtime/companion-registration"
          );
          const companion = buildCompanionRuntimeTable({
            slug: tableName,
            tableName,
            fields: fields as { name: string; type: string }[],
            dialect,
            localized: true,
            status: hasStatus === true,
          });
          if (companion) {
            registry.registerDynamicSchema(
              companion.companionTableName,
              companion.table
            );
          }
        }
      }
    );

    // Step 4: Dynamic components (comp_* tables). Components have no status
    // column, but a localized component omits its translatable columns from the
    // main comp_ table and registers/creates its companion `comp_<slug>_locales`.
    await loadDynamicTables(
      adapter,
      "dynamic_components",
      async (tableName, fields, _hasStatus, localized) => {
        const { ComponentSchemaService } = await import(
          "../services/components/component-schema-service"
        );
        const compSchemaService = new ComponentSchemaService(dialect);
        const runtimeTable = compSchemaService.generateRuntimeSchema(
          tableName,
          fields as FieldConfig[],
          { localized }
        );
        registry.registerDynamicSchema(tableName, runtimeTable);
        if (localized) {
          const { ensureCompanionTable } = await import(
            "../domains/i18n/runtime/companion-io"
          );
          await ensureCompanionTable(adapter, {
            slug: tableName,
            tableName,
            fields: fields as { name: string; type: string }[],
            dialect,
            status: false,
          });
          const { buildCompanionRuntimeTable } = await import(
            "../domains/i18n/runtime/companion-registration"
          );
          const companion = buildCompanionRuntimeTable({
            slug: tableName,
            tableName,
            fields: fields as { name: string; type: string }[],
            dialect,
            localized: true,
            status: false,
          });
          if (companion) {
            registry.registerDynamicSchema(
              companion.companionTableName,
              companion.table
            );
          }
        }
      }
    );

    return registry;
  } catch {
    // SchemaRegistry setup failed entirely — adapter falls back to
    // executeQuery for basic operations.
    return undefined;
  }
}

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
  registry: SchemaRegistry,
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
      // Capture function-bearing field configs (validate/access/hooks)
      // from the LIVE config: the DB-backed registry serializes fields,
      // which drops functions, so the write/read services resolve them
      // through the field-level registry instead.
      registerFieldFunctions("collection", slug, fields);
      const baseTableName = dbName ?? slug.replace(/-/g, "_");
      const tableName = baseTableName.startsWith("dc_")
        ? baseTableName
        : `dc_${baseTableName}`;
      // Why: forward the code-first `status: true` flag so the runtime
      // Drizzle table includes the system status column. Without this,
      // adapter CRUD on Draft/Published collections can't read or write
      // the status column even though the physical table has it.
      const hasStatus = (collection as { status?: boolean }).status === true;
      const localized =
        (collection as { localized?: boolean }).localized === true;
      const { generateRuntimeSchema } = await import(
        "../domains/schema/services/runtime-schema-generator"
      );
      const { table } = generateRuntimeSchema(
        tableName,
        fields as FieldDefinition[],
        dialect,
        { status: hasStatus, localized }
      );
      registry.registerDynamicSchema(tableName, table);
      // Register the companion `_locales` table for a localized collection (M4 reads).
      if (localized) {
        const { buildCompanionRuntimeTable } = await import(
          "../domains/i18n/runtime/companion-registration"
        );
        const companion = buildCompanionRuntimeTable({
          slug,
          tableName,
          fields: fields as { name: string; type: string }[],
          dialect,
          localized: true,
          // Carry `_status` so a Draft/Published localized collection's
          // DI-registered companion matches loadCompanionSchema.
          status: hasStatus === true,
        });
        if (companion) {
          registry.registerDynamicSchema(
            companion.companionTableName,
            companion.table
          );
        }
      }
    } catch (err) {
      logger.debug?.(
        `[registerServices] Failed to register collection "${(collection as { slug?: string }).slug ?? "?"}" in resolver: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Singles: table name convention is `single_<slug-with-underscores>`.
  // so every code path agrees on the physical table name.
  const { resolveSingleTableName } = await import(
    "../domains/singles/services/resolve-single-table-name"
  );
  for (const single of config.singles ?? []) {
    try {
      const slug = (single as { slug: string }).slug;
      const dbName = (single as { dbName?: string }).dbName;
      const fields = (single as { fields?: unknown[] }).fields ?? [];
      if (!slug || !Array.isArray(fields) || fields.length === 0) continue;
      // Same live-config capture as the collections branch above.
      registerFieldFunctions("single", slug, fields);
      const tableName = resolveSingleTableName({ slug, dbName });
      // Why: forward the code-first `status: true` flag for singles too —
      // mirrors the collection branch above. Same Draft/Published runtime
      // wiring needs the system status column on the Drizzle table.
      const hasStatus = (single as { status?: boolean }).status === true;
      const { generateRuntimeSchema } = await import(
        "../domains/schema/services/runtime-schema-generator"
      );
      const { table } = generateRuntimeSchema(
        tableName,
        fields as FieldDefinition[],
        dialect,
        { status: hasStatus }
      );
      registry.registerDynamicSchema(tableName, table);
    } catch (err) {
      logger.debug?.(
        `[registerServices] Failed to register single "${(single as { slug?: string }).slug ?? "?"}" in resolver: ${err instanceof Error ? err.message : String(err)}`
      );
    }
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

  // Wire schema-cache invalidation before sync so a dbName change drops the
  // stale Drizzle table from CollectionFileManager on the next request.
  if (container.has("collectionService")) {
    try {
      const collectionService = container.get<{
        invalidateSchemaForSlug: (slug: string) => void;
      }>("collectionService");
      collectionRegistry.setOnTableNameChanged((slug: string) => {
        collectionService.invalidateSchemaForSlug(slug);
      });
    } catch (err) {
      logger.warn?.(
        `[registerServices] Could not wire tableName-change cache invalidation: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Provenance (D14): tag each collection by who contributed it. A slug that a
  // resolved plugin declares in `contributes.collections` is `plugin:<name>`;
  // everything else (app code-first) is `code`. Drives locking + `nextly prune`.
  const sourceBySlug = new Map<string, CollectionSource>();
  for (const plugin of transformedConfig.plugins ?? []) {
    for (const contributed of plugin.contributes?.collections ?? []) {
      sourceBySlug.set(contributed.slug, `plugin:${plugin.name}`);
    }
  }

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
      source: sourceBySlug.get(collection.slug) ?? "code",
      // Forward Draft/Published flag from code-first config so the boot-time
      // sync persists it to dynamic_collections.status.
      status: collection.status === true,
      // Resolve + forward the versioning config so it persists to
      // dynamic_collections.versions. `status: true` aliases to a versioned
      // config, so pass both to the resolver.
      versions: resolveVersionsConfig(collection.versions, collection.status),
      // Forward the i18n master switch (mirrors status) so the boot sync persists
      // dynamic_collections.localized — the read path keys companion resolution off it.
      localized: collection.localized === true,
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
  // Resolve via the config's dbName (falling back to slug) so dbName-using
  // collections check the correct physical table.
  const collectionsBySlug = new Map(
    (transformedConfig.collections ?? []).map(c => [c.slug, c])
  );
  for (const slug of syncResult.unchanged) {
    const collection = collectionsBySlug.get(slug);
    const baseTableName = collection?.dbName ?? slug.replace(/-/g, "_");
    const tableName = baseTableName.startsWith("dc_")
      ? baseTableName
      : `dc_${baseTableName}`;
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

  // F8 PR 3: route auto-sync through the F2 applyDesiredSchema pipeline.
  // Was SchemaPushService.syncSchema() with `{ force: true,
  // skipExistingTables: true }` — legacy idiom for "create missing
  // tables, leave existing alone." We preserve that semantic by
  // filtering down to only collections whose physical tables DO NOT
  // EXIST before invoking the pipeline. Why this matters:
  //
  //   The pipeline runs the classifier on every diff. If we passed
  //   collections with existing tables, the classifier could emit
  //   add_not_null_with_nulls or add_required_field_no_default events
  //   for drift between the live table and the new config. Those
  //   events trigger the (terminal) PromptDispatcher, which throws
  //   TTYRequiredError on production deploys (Docker, PM2, systemd).
  //   That would crash boot where the legacy code silently skipped.
  //
  //   By restricting to truly-missing tables, the pipeline only sees
  //   add_table ops — pure additive, no prompts, no TTY dependency.
  //
  //   Drift on existing tables is intentionally not handled here —
  //   the dev-server.ts auto-sync (manual `nextly db:sync`) and the
  //   HMR reload-config path remain the canonical drift-handling
  //   entry points (those have a TTY and accept prompts).
  try {
    const { applyDesiredSchema } = await import(
      "../domains/schema/pipeline/index"
    );
    const { generateRuntimeSchema } = await import(
      "../domains/schema/services/runtime-schema-generator"
    );

    const collectionsToSyncSet = new Set(collectionsNeedingTableSync);
    const desiredCollections: Record<string, DesiredCollection> = {};
    const slugsAfterFilter: string[] = [];
    for (const collection of transformedConfig.collections) {
      if (!collectionsToSyncSet.has(collection.slug)) continue;
      const baseTableName =
        collection.dbName ?? collection.slug.replace(/-/g, "_");
      const tableName = baseTableName.startsWith("dc_")
        ? baseTableName
        : `dc_${baseTableName}`;

      // Skip collections whose tables already exist — the pipeline's
      // diff would compare against the live table and could emit
      // interactive events. Mirrors legacy `skipExistingTables: true`.
      let tableExists = false;
      try {
        tableExists = await adapter.tableExists(tableName);
      } catch {
        // Defensive: treat introspect failure as "table missing" so
        // the pipeline can attempt to create it. If it really exists
        // and we're wrong, drizzle-kit will emit `CREATE TABLE IF NOT
        // EXISTS`-equivalent semantics or a no-op diff.
      }
      if (tableExists) {
        logger.info?.(
          `Table ${tableName} already exists for ${collection.slug}, skipping`
        );
        // Still mark as applied so the registry status reflects reality.
        await collectionRegistry
          .updateMigrationStatus(collection.slug, "applied")
          .catch(() => {});
        continue;
      }

      // Why: forward the code-first `status: true` flag so the diff
      // pipeline's first-run CREATE TABLE includes the system status
      // column. Without this, `defineCollection({ status: true })` would
      // silently come up with no status column on this auto-sync path
      // (boot-time fast track for collections whose tables don't exist
      // yet). Mirrors the same forwarding done for HMR in
      // init/reload-config.ts.
      desiredCollections[collection.slug] = {
        slug: collection.slug,
        tableName,
        fields: collection.fields ?? [],
        status: (collection as { status?: boolean }).status === true,
        // i18n: carry the localized flag so the boot-time push pipeline omits translatable
        // columns from the main table (they live in the companion `_locales` table). Without
        // this the main table is created WITH the translatable columns and no companion is
        // ever provisioned — the exact "no _locales table" failure on a fresh boot.
        localized: (collection as { localized?: boolean }).localized === true,
      };
      slugsAfterFilter.push(collection.slug);
    }

    if (slugsAfterFilter.length === 0) {
      // Every collection that was flagged for sync now has a table —
      // legacy behavior was to silently return here too.
      return;
    }

    const result = await applyDesiredSchema(
      {
        collections: desiredCollections,
        singles: {},
        components: {},
      },
      "code",
      { promptChannel: "terminal" }
    );

    if (!result.success) {
      logger.warn?.(
        `Auto-sync tables failed (${result.error.code}): ${result.error.message}`
      );
      return;
    }

    // Post-apply: update migration_status + register runtime schemas in
    // the adapter resolver. The pipeline owns CREATE TABLE; these are
    // app-level concerns that stay in the boot path. Iterates only
    // slugs that actually went through the pipeline (post-filter).
    const syncDialect = adapter.getCapabilities().dialect;
    for (const slug of slugsAfterFilter) {
      const desired = desiredCollections[slug];
      if (!desired) continue;
      await collectionRegistry
        .updateMigrationStatus(slug, "applied")
        .catch(() => {});
      logger.info?.(`Created table ${desired.tableName} for ${slug}`);

      try {
        // Read fields back from dynamic_collections (the pipeline's
        // apply already wrote them) so the runtime schema mirrors
        // exactly what's in the DB. Belt-and-braces against any in-
        // memory drift between transformedConfig and persisted state.
        const rows = await adapter.executeQuery<{ fields: string }>(
          `SELECT fields FROM dynamic_collections WHERE table_name = '${desired.tableName}'`
        );
        if (rows[0]) {
          const fields =
            typeof rows[0].fields === "string"
              ? JSON.parse(rows[0].fields)
              : rows[0].fields;
          if (Array.isArray(fields) && fields.length > 0) {
            // Why: forward the desired status + localized flags so the live runtime
            // table descriptor matches what the pipeline applied — the main table
            // omits translatable columns (they live in the companion), keeping config
            // and runtime in lockstep.
            const localized = desired.localized === true;
            const { table: runtimeTable } = generateRuntimeSchema(
              desired.tableName,
              fields,
              syncDialect,
              { status: desired.status === true, localized }
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
              resolver.registerDynamicSchema(desired.tableName, runtimeTable);
              // i18n: the push pipeline excludes companion tables, so create the
              // localized collection's companion here (idempotent) and register its
              // runtime table — the fix for "no _locales table" on a fresh code-first boot.
              if (localized) {
                const { ensureCompanionTable } = await import(
                  "../domains/i18n/runtime/companion-io"
                );
                await ensureCompanionTable(adapter, {
                  slug,
                  tableName: desired.tableName,
                  fields,
                  dialect: syncDialect,
                  status: desired.status === true,
                });
                const { buildCompanionRuntimeTable } = await import(
                  "../domains/i18n/runtime/companion-registration"
                );
                const companion = buildCompanionRuntimeTable({
                  slug,
                  tableName: desired.tableName,
                  fields,
                  dialect: syncDialect,
                  localized: true,
                  status: desired.status === true,
                });
                if (companion) {
                  resolver.registerDynamicSchema(
                    companion.companionTableName,
                    companion.table
                  );
                }
              }
            }
          }
        }
      } catch {
        // Non-fatal: schema will be registered on next server restart.
      }
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
      // i18n: forward the localized flag from defineComponent so the registry persists
      // it and the companion is provisioned for embedded per-language values.
      localized: (comp as { localized?: boolean }).localized === true,
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
      "../services/components/component-schema-service"
    );
    const dialect = adapter.getCapabilities().dialect;
    const compSchemaService = new CompSchemaService(dialect);
    // Shared resolver so this DDL path and the migration CLI produce identical
    // component table names.
    const { resolveComponentTableName } = await import(
      "../domains/schema/utils/resolve-table-name"
    );

    for (const slug of componentsNeedingTableSync) {
      const compConfig = transformedConfig.components.find(
        c => c.slug === slug
      );
      if (!compConfig) continue;

      const tableName = resolveComponentTableName(slug, compConfig.dbName);

      // i18n: a localized component omits its translatable columns from the main comp_
      // table and gets a companion `comp_<slug>_locales` (created below).
      const compLocalized =
        (compConfig as { localized?: boolean }).localized === true;
      try {
        const migrationSQL = compSchemaService.generateMigrationSQL(
          tableName,
          compConfig.fields,
          { localized: compLocalized }
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
              compConfig.fields,
              { localized: compLocalized }
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
              // i18n: create + register the component's companion (generateMigrationSQL
              // omits it) so a localized component works on a fresh code-first boot.
              if (compLocalized) {
                const { ensureCompanionTable } = await import(
                  "../domains/i18n/runtime/companion-io"
                );
                await ensureCompanionTable(adapter, {
                  slug,
                  tableName,
                  fields: compConfig.fields as { name: string; type: string }[],
                  dialect,
                  status: false,
                });
                const { buildCompanionRuntimeTable } = await import(
                  "../domains/i18n/runtime/companion-registration"
                );
                const companion = buildCompanionRuntimeTable({
                  slug,
                  tableName,
                  fields: compConfig.fields as { name: string; type: string }[],
                  dialect,
                  localized: true,
                  status: false,
                });
                if (companion) {
                  resolver.registerDynamicSchema(
                    companion.companionTableName,
                    companion.table
                  );
                }
              }
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
  adapter: DrizzleAdapter,
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
      // Forward Draft/Published flag from code-first config so the boot-time
      // sync persists it to dynamic_singles.status.
      status: single.status === true,
      // Forward the i18n flag so a code-first single with localized:true
      // persists it to dynamic_singles.localized at boot (parity with
      // collections; previously dropped here).
      localized: single.localized === true,
      // Resolve + forward the versioning config so it persists to
      // dynamic_singles.versions (status:true aliases to a versioned config).
      versions: resolveVersionsConfig(single.versions, single.status),
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
    return;
  }

  // dynamic_singles) only describe what SHOULD exist; the actual storage
  // tables (e.g. single_site_settings) need DDL too. Without this, every
  // boot that brings up a fresh code-first project leaves singles
  // registered-but-unbacked, and the very first read from the frontend
  // hits "no such table: single_site_settings". Mirrors the existing
  // reconcileSingleTables call in cli/commands/dev-server.ts so the
  // dev-server boot path and the `nextly db:sync` CLI converge on the
  // same physical-table contract.
  await reconcileSingleTablesForBoot(adapter, logger, transformedConfig);
}

// physical `single_*` tables match `dynamic_singles`. Lives next to the
// caller because the dev-server has its own slightly richer flavour
// (logger.success, reconciledSlugs aggregation) — the dev-server flow
// can converge on this helper later as part of a tidier refactor; for
// now the duplication is intentional + minimal.
async function reconcileSingleTablesForBoot(
  adapter: DrizzleAdapter,
  logger: Logger,
  transformedConfig: NextlyServiceConfig
): Promise<void> {
  try {
    const { reconcileSingleTables } = await import(
      "../domains/singles/services/reconcile-single-tables"
    );
    const { DynamicCollectionSchemaService } = await import(
      "../domains/dynamic-collections/services/dynamic-collection-schema-service"
    );
    const schemaService = new DynamicCollectionSchemaService();
    const singleRegistry = container.get<SingleRegistryService>(
      "singleRegistryService"
    );

    let createdCount = 0;
    await reconcileSingleTables({
      registeredSingles: async () => {
        const records = await singleRegistry.getAllSingles();
        return records.map(r => ({ slug: r.slug, tableName: r.tableName }));
      },
      existingTableNames: async () => {
        const tables = await adapter.listTables();
        return new Set(tables);
      },
      createTable: async single => {
        // Prefer code-first config fields (source of truth) but fall back
        // to the registry's stored fields for UI-created singles.
        const codeFirstConfig = transformedConfig.singles?.find(
          s => s.slug === single.slug
        );
        let fields: FieldDefinition[];
        // Why: pull the Draft/Published flag from whichever source we
        // pulled fields from. Without this, a code-first single declared
        // with `defineSingle({ status: true })` gets a physical table
        // without the system status column on first reconcile.
        let hasStatus = false;
        // i18n: same for the localized flag — a localized single must omit its
        // translatable columns from the main table (they live in the companion).
        let localized = false;
        if (codeFirstConfig) {
          fields = codeFirstConfig.fields as unknown as FieldDefinition[];
          hasStatus = (codeFirstConfig as { status?: boolean }).status === true;
          localized =
            (codeFirstConfig as { localized?: boolean }).localized === true;
        } else {
          const record = await singleRegistry.getSingleBySlug(single.slug);
          if (!record) {
            throw new Error(
              `Cannot reconcile "${single.slug}": registry row disappeared between list and fetch`
            );
          }
          fields = record.fields as unknown as FieldDefinition[];
          hasStatus = record.status === true;
          localized = (record as { localized?: boolean }).localized === true;
        }

        const migrationSQL = schemaService.generateMigrationSQL(
          single.tableName,
          fields,
          { isSingle: true, hasStatus, localized }
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

        const tableExists = await adapter.tableExists(single.tableName);
        if (tableExists) {
          // Register the freshly-created single in the live resolver so
          // queries in this same boot (e.g. the user's nextly.seed.ts or
          // the homepage's first render) find the table without waiting
          // for a restart.
          try {
            const dialect = adapter.getCapabilities().dialect;
            const { generateRuntimeSchema: genRt } = await import(
              "../domains/schema/services/runtime-schema-generator"
            );
            // Why: same status + localized flags we passed to generateMigrationSQL
            // above — keep the runtime resolver in lockstep with the physical table
            // just created (localized omits translatable columns from main).
            const { table } = genRt(single.tableName, fields, dialect, {
              status: hasStatus,
              localized,
            });
            const resolver = (
              adapter as unknown as {
                tableResolver?: {
                  registerDynamicSchema?: (name: string, t: unknown) => void;
                };
              }
            ).tableResolver;
            if (
              resolver &&
              typeof resolver.registerDynamicSchema === "function"
            ) {
              resolver.registerDynamicSchema(single.tableName, table);
              // i18n: create + register the single's companion `single_<slug>_locales`
              // (generateMigrationSQL omits it) so a localized single works on a fresh boot.
              if (localized) {
                const { ensureCompanionTable } = await import(
                  "../domains/i18n/runtime/companion-io"
                );
                await ensureCompanionTable(adapter, {
                  slug: single.slug,
                  tableName: single.tableName,
                  fields: fields,
                  dialect,
                  status: hasStatus,
                });
                const { buildCompanionRuntimeTable } = await import(
                  "../domains/i18n/runtime/companion-registration"
                );
                const companion = buildCompanionRuntimeTable({
                  slug: single.slug,
                  tableName: single.tableName,
                  fields: fields,
                  dialect,
                  localized: true,
                  status: hasStatus,
                });
                if (companion) {
                  resolver.registerDynamicSchema(
                    companion.companionTableName,
                    companion.table
                  );
                }
              }
            }
          } catch {
            // Resolver registration is best-effort; the table itself is
            // committed and the next boot will pick it up either way.
          }
          await singleRegistry
            .updateMigrationStatus(single.slug, "applied")
            .catch(() => {});
          createdCount++;
          logger.info?.(
            `Created single table ${single.tableName} for ${single.slug}`
          );
        } else {
          await singleRegistry
            .updateMigrationStatus(single.slug, "failed")
            .catch(() => {});
          throw new Error(
            `Reconcile ran DDL for "${single.slug}" but table "${single.tableName}" still missing`
          );
        }
      },
    });

    if (createdCount > 0) {
      logger.info?.(`Reconciled ${createdCount} missing single table(s).`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn?.(`Single-table reconcile failed: ${msg}`);
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
): Promise<Array<{ plugin: PluginDefinition; context: PluginContext }>> {
  const plugins = transformedConfig.plugins ?? [];
  if (plugins.length === 0) return [];

  // Collect + validate contributed routes BEFORE any init runs so a route
  // collision / invalid path fails the boot fast (D25/D7), before side effects.
  const collectedRoutes = collectPluginRoutes(plugins);

  const pluginHookRegistry = hookRegistry ?? getHookRegistry();

  const getServiceForPlugin = <
    T extends
      | "collectionService"
      | "userService"
      | "mediaService"
      | "emailService"
      | "versionsService"
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
    | VersionsService
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
      case "versionsService":
        return container.get<VersionsService>("versionsService");
      case "db":
        return adapterDrizzleDb;
      case "logger":
        return logger;
      case "config":
        return transformedConfig;
      default:
        throw new Error(`Unknown service: ${name}`);
    }
  };

  const hookBridge = {
    register: (
      hookType: Parameters<typeof pluginHookRegistry.register>[0],
      collection: string,
      handler: Parameters<typeof pluginHookRegistry.register>[2]
    ) => {
      pluginHookRegistry.register(hookType, collection, handler);
    },
    unregister: (
      hookType: Parameters<typeof pluginHookRegistry.unregister>[0],
      collection: string,
      handler: Parameters<typeof pluginHookRegistry.unregister>[2]
    ) => {
      pluginHookRegistry.unregister(hookType, collection, handler);
    },
  };

  // HMR/re-registration safety (B2): drop every plugin's prior event/hook
  // subscriptions before plugins re-subscribe in init(), so the globalThis
  // EventBus + HookRegistry never accumulate duplicates across module
  // re-evaluation. Mirrors the route registry's clear-and-rebuild below. Core
  // (non-plugin) subscriptions are untracked and untouched.
  clearPluginSubscriptions();
  // Re-register plugin services from scratch each boot (D64) — same
  // clear-and-rebuild posture as subscriptions/routes, so HMR never leaks stale
  // service instances.
  clearPluginServices();
  // Reset the email provider registry to built-ins, then re-register plugin
  // providers below (C2/D65) — clear-and-rebuild so HMR can't double-register.
  resetEmailProviderRegistry();

  const teardown: Array<{ plugin: PluginDefinition; context: PluginContext }> =
    [];
  const contexts = new Map<string, PluginContext>();

  // PASS 1 — build every enabled plugin's context, register its contributed
  // services (D64) and declared event names. Services register BEFORE any init
  // runs, so a plugin's `init` can resolve any other plugin's service lazily via
  // `ctx.services.plugins.<name>.<svc>`, regardless of init order.
  for (const plugin of plugins) {
    // D49: `enabled: false` skips behavior (init/hooks/events/destroy). The
    // plugin's `setup` already ran in applyPluginConfigTransformers, so its
    // declarative schema is still applied.
    if (plugin.enabled === false) continue;

    // Build a per-plugin context so `ctx.self` resolves to this plugin's own
    // entities (D54). Built for every enabled plugin (even without `init`) so
    // `destroy` has a context at shutdown.
    const pluginContext = createPluginContext(
      getServiceForPlugin as Parameters<typeof createPluginContext>[0],
      hookBridge,
      plugin
    );
    teardown.push({ plugin, context: pluginContext });
    contexts.set(plugin.name, pluginContext);

    // Register contributed services, lazily bound to this plugin's context (D64).
    for (const [svcName, factory] of Object.entries(
      plugin.contributes?.services ?? {}
    )) {
      registerPluginService(plugin.name, svcName, () => factory(pluginContext));
    }

    // Register contributed email providers (C2/D65) — fail-fast on type collision.
    for (const provider of plugin.contributes?.emailProviders ?? []) {
      getEmailProviderRegistry().register(
        provider.type,
        provider.createAdapter
      );
    }

    // Register custom event names this plugin declares (D9) so its emits
    // don't trigger an "undeclared event" warning.
    const declaredEvents = plugin.contributes?.events?.map(e => e.name) ?? [];
    if (declaredEvents.length > 0) {
      getEventBus().registerDeclaredEvents(declaredEvents);
    }
  }

  // PASS 2 — run `init` for each enabled plugin (services from any plugin are now
  // resolvable). Topological order is preserved from `plugins`.
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const pluginContext = contexts.get(plugin.name)!;

    if (plugin.init) {
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

    // Post-init lifecycle event (D8) — best-effort, observe-only; other plugins
    // that subscribed in their own init can react.
    getEventBus().emit("plugin.initialized", {
      name: plugin.name,
      version: plugin.version,
    });
  }

  // Register contributed routes into the global registry (D25). Rebuilt every
  // boot (cleared first) so HMR / re-registration never accumulates. Each route
  // carries its plugin's boot-built context; the dispatcher adds per-request
  // user/params at call time.
  const routeRegistry = getPluginRouteRegistry();
  routeRegistry.clear();
  if (collectedRoutes.length > 0) {
    const contextByPlugin = new Map(
      teardown.map(t => [t.plugin.name, t.context])
    );
    for (const collected of collectedRoutes) {
      const context = contextByPlugin.get(collected.pluginName);
      if (context) {
        routeRegistry.register(collected.pluginName, collected.route, context);
      }
    }
    logger.info?.(`Registered ${collectedRoutes.length} plugin route(s)`);
  }

  return teardown;
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

  // Run plugin destroy() in REVERSE init order (mirror of setup→init), each
  // isolated so one failing teardown can't block the others or the disconnect
  // (D4/D7). Runs before the adapter disconnects so destroy can still use db.
  const teardown = globalForReg.__nextly_pluginTeardown ?? [];
  for (let i = teardown.length - 1; i >= 0; i--) {
    const { plugin, context } = teardown[i];
    if (!plugin.destroy) continue;
    try {
      await plugin.destroy(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Plugin "${plugin.name}" destroy failed: ${message}`);
    }
  }
  globalForReg.__nextly_pluginTeardown = undefined;

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

/** Strict plugin-target resolution — config flag OR env (CI/prod). */
function isStrictPluginTargets(config: NextlyServiceConfig): boolean {
  return (
    config.strictPluginTargets === true ||
    process.env.NEXTLY_STRICT_PLUGIN_TARGETS === "1"
  );
}

/**
 * Handle plugin `extend` targets that resolve to NEITHER a code/plugin entity
 * NOR a Builder entity (a typo, or a removed/renamed Builder target). Graceful
 * by default — warn + skip that one contribution so the rest of the app still
 * boots (P8); strict mode (config flag or `NEXTLY_STRICT_PLUGIN_TARGETS=1`)
 * restores the fail-fast throw for CI/production (D7/D12).
 */
function handleUnresolvedExtends(
  unresolved: { target: string; owner: string }[],
  config: NextlyServiceConfig,
  logger: Logger
): void {
  const strict = isStrictPluginTargets(config);
  for (const u of unresolved) {
    if (strict) throw extendTargetUnknownError(u.target, u.owner);
    logger.warn?.(
      `[plugins] "${u.owner}" extends unknown entity "${u.target}" — skipping. ` +
        `It is neither a code/plugin entity nor a Builder collection/single/component. ` +
        `Fix the slug or remove the extend (set NEXTLY_STRICT_PLUGIN_TARGETS=1 to fail fast).`
    );
  }
}
