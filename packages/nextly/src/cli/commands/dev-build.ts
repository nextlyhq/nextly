/**
 * Dev Command — Build / Sync Operations
 *
 * Config-driven registry sync operations extracted from `dev.ts`. This
 * module owns the "build" phase: syncing collections/singles/components
 * from the config into the registry, syncing user fields, and seeding
 * permissions and user data.
 *
 * @module cli/commands/dev-build
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { PermissionSeedService } from "../../domains/auth/services/permission-seed-service";
import { teardownEntityComponentData } from "../../domains/field-groups/services/teardown-entity-field-group-data";
import { teardownEntityI18n } from "../../domains/i18n/migration/teardown-entity-i18n";
import { resolveTransitionRecorder } from "../../domains/i18n/migration/transition-recorder";
import {
  beginI18nTransition,
  type I18nTransitionKind,
} from "../../domains/i18n/migration/transition-state";
// Resolve the versioning config so `db:sync` persists it (parity with boot/HMR).
import { resolveVersionsConfig } from "../../domains/versions/resolve-config";
import {
  describeError,
  immediateMessage,
  NextlyError,
} from "../../errors/index";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import { CollectionSyncService } from "../../services/collections/collection-sync-service";
import type { CollectionSyncResultWithValidation } from "../../services/collections/collection-sync-service";
import {
  FieldGroupRegistryService,
  type CodeFirstComponentConfig,
  type SyncComponentResult,
} from "../../services/field-groups/field-group-registry-service";
import type { Logger as ServiceLogger } from "../../services/shared/types";
import {
  SingleRegistryService,
  type CodeFirstSingleConfig,
  type SyncSingleResult,
} from "../../services/singles/single-registry-service";
import { UserExtSchemaService } from "../../services/users/user-ext-schema-service";
import { UserFieldDefinitionService } from "../../services/users/user-field-definition-service";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";
import type { LoadConfigResult } from "../utils/config-loader";
import { formatCount } from "../utils/logger";

import type { ResolvedDevOptions } from "./db-sync";
import {
  displayComponentsSyncResults,
  displaySinglesSyncResults,
  displaySyncResults,
} from "./dev-display";
import {
  performAutoSync,
  performComponentsAutoSync,
  performSinglesAutoSync,
  performSinglesReconcile,
} from "./dev-server";

// ============================================================================
// Orphan Record Type
// ============================================================================

/** Orphan record returned by detection functions. */
interface OrphanRecord {
  slug: string;
  tableName: string;
}

// ============================================================================
// Collection Sync
// ============================================================================

/**
 * Sync collections to database and generate files
 */
export async function syncCollections(
  configResult: LoadConfigResult,
  adapter: CLIDatabaseAdapter,
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const { config } = configResult;

  logger.newline();
  logger.info("Syncing collections...");

  // Create sync service with adapter cast to DrizzleAdapter
  // The CLIDatabaseAdapter is compatible with DrizzleAdapter interface
  const serviceLogger: ServiceLogger = {
    info: (msg: string) => logger.debug(msg),
    warn: (msg: string) => logger.warn(msg),
    error: (msg: string) => logger.error(msg),
    debug: (msg: string) => logger.debug(msg),
  };

  const syncService = new CollectionSyncService(
    adapter as unknown as DrizzleAdapter,
    serviceLogger
  );

  // Determine what to generate (opt-in: only generate when explicitly
  // requested). Drizzle `.ts` schema generation was removed (orphan output);
  // the `--schemas` flag now only drives Zod validation schema generation.
  const generateTypes = options.types === true;
  const generateZodSchemas = options.schemas === true;

  let result: CollectionSyncResultWithValidation;
  try {
    result = await syncService.syncWithValidation(config, {
      generateZodSchemas,
      generateTypes,
      dialect: adapter.getCapabilities().dialect,
      cwd: options.cwd ?? process.cwd(),
      onRemoved: options.removeOrphaned ? "delete" : "warn",
    });
  } catch (error) {
    // Name the phase that failed, then rethrow. The detail is deliberately
    // left to the top-level handler: printing it here too would render the
    // same description twice for a single failure.
    logger.error("Sync failed while registering collections.");
    throw error;
  }

  // Display sync results
  displaySyncResults(result, options, context);

  // Step 5: Auto-sync schema to database (development mode only)
  const autoSyncEnabled = options.autoSync !== false;
  if (autoSyncEnabled) {
    await performAutoSync(config, adapter, result, options, context);
  }

  // Seeding moved out of syncCollections to the orchestrator (runDbSync).
  // When collections AND singles exist, running the user seed here caused
  // the seed to execute before singles' physical tables were created by
  // syncSingles (which runs AFTER syncCollections). Any seed that calls
  // nextly.updateSingle("...") then failed with
  //   DatabaseError: no such table: single_<slug>
  // even though the singles were registered in dynamic_singles. The fix is
  // to seed AFTER every sync step has run — runDbSync now owns that call.
}

// ============================================================================
// Singles Sync
// ============================================================================

/**
 * Sync singles to database registry
 *
 * This syncs code-first Singles from the config to the dynamic_singles
 * registry table. Unlike collections, Singles don't generate individual
 * schema files - they use the registry for metadata and auto-create
 * their data tables on first access.
 */
export async function syncSingles(
  configResult: LoadConfigResult,
  adapter: CLIDatabaseAdapter,
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const { config } = configResult;

  logger.newline();
  logger.info("Syncing singles...");

  // Create service logger
  const serviceLogger: ServiceLogger = {
    info: (msg: string) => logger.debug(msg),
    warn: (msg: string) => logger.warn(msg),
    error: (msg: string) => logger.error(msg),
    debug: (msg: string) => logger.debug(msg),
  };

  const singleRegistry = new SingleRegistryService(
    adapter as unknown as DrizzleAdapter,
    serviceLogger
  );

  // Transform SingleConfig[] to CodeFirstSingleConfig[]
  const codeFirstConfigs: CodeFirstSingleConfig[] = config.singles.map(
    single => ({
      slug: single.slug,
      label: single.label?.singular ?? toTitleCase(single.slug),
      fields: single.fields,
      description: single.description,
      tableName: single.dbName,
      admin: single.admin,
      // Persist Draft/Published, i18n, and resolved versioning through db:sync
      // (parity with the boot/HMR registry sync).
      status: single.status === true,
      localized: single.localized === true,
      versions: resolveVersionsConfig(single.versions, single.status),
      // Forward the cache-revalidation config through db:sync too, so a
      // code-first single's disable/tags reach dynamic_singles.revalidate.
      revalidate: single.revalidate,
      configPath: `singles/${single.slug}.ts`,
    })
  );

  let result: SyncSingleResult;
  try {
    result = await singleRegistry.syncCodeFirstSingles(codeFirstConfigs);
  } catch (error) {
    logger.error("Singles sync failed while registering singles.");
    throw error;
  }

  // Detect orphaned singles (in DB with source='code' but not in config)
  const removedSingles = await detectRemovedSingles(
    codeFirstConfigs,
    singleRegistry
  );

  if (removedSingles.length > 0) {
    if (options.removeOrphaned) {
      await handleRemovedSingles(
        removedSingles,
        adapter as unknown as DrizzleAdapter,
        logger
      );
    } else {
      logger.newline();
      logger.warn(`${removedSingles.length} orphaned single(s) in database:`);
      for (const { slug } of removedSingles) {
        logger.item(slug, 1);
      }
      logger.info(
        "These exist in the database but not in your config. Run with --remove-orphaned to delete."
      );
    }
  }

  // Display sync results
  displaySinglesSyncResults(result, options, context);

  // Auto-sync: Create data tables for created/updated Singles and set status to 'applied'
  const autoSyncEnabled = options.autoSync !== false;
  if (
    autoSyncEnabled &&
    (result.created.length > 0 || result.updated.length > 0)
  ) {
    await performSinglesAutoSync(
      config,
      adapter,
      singleRegistry,
      result,
      options,
      context
    );
  }

  // Reconcile: even when no singles changed in this sync (and thus auto-sync
  // didn't run), ensure every registered single has its physical table. This
  // covers the "registry row exists but table missing" case that can happen
  // after a DB reset, a dropped table, or a UI-created single whose DDL
  // aborted. Runs unconditionally after sync so reality always matches
  // registry by the time `pnpm dev` finishes startup.
  if (autoSyncEnabled) {
    await performSinglesReconcile(config, adapter, singleRegistry, context);
  }
}

// ============================================================================
// Components Sync
// ============================================================================

/**
 * Sync components to database registry
 *
 * This syncs code-first Components from the config to the dynamic_components
 * registry table. Components are reusable field group templates that can be
 * embedded in Collections and Singles via the `component` field type.
 */
export async function syncComponents(
  configResult: LoadConfigResult,
  adapter: CLIDatabaseAdapter,
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const { config } = configResult;

  logger.newline();
  logger.info("Syncing components...");

  // Create service logger
  const serviceLogger: ServiceLogger = {
    info: (msg: string) => logger.debug(msg),
    warn: (msg: string) => logger.warn(msg),
    error: (msg: string) => logger.error(msg),
    debug: (msg: string) => logger.debug(msg),
  };

  const componentRegistry = new FieldGroupRegistryService(
    adapter as unknown as DrizzleAdapter,
    serviceLogger
  );

  // Transform FieldGroupConfig[] to CodeFirstComponentConfig[]
  const codeFirstConfigs: CodeFirstComponentConfig[] = config.fieldGroups.map(
    component => ({
      slug: component.slug,
      label: component.label?.singular ?? toTitleCase(component.slug),
      fields: component.fields,
      description: component.description,
      admin: component.admin,
      // Persist i18n through db:sync, as the singles mapping above already does.
      // Runtime field-group writes gate on the stored flag, so leaving it unset
      // made `db:sync` record a localized field group as non-localized:
      // translatable values kept being treated as shared main-table fields, and a
      // save in a non-default locale overwrote the default one.
      localized: component.localized === true,
      configPath: `${STORAGE_FORMAT.configPathDir}/${component.slug}.ts`,
    })
  );

  let result: SyncComponentResult;
  try {
    result = await componentRegistry.syncCodeFirstComponents(codeFirstConfigs);
  } catch (error) {
    logger.error("Components sync failed while registering components.");
    throw error;
  }

  // Detect orphaned components (in DB with source='code' but not in config)
  const removedComponents = await detectRemovedComponents(
    codeFirstConfigs,
    componentRegistry
  );

  if (removedComponents.length > 0) {
    if (options.removeOrphaned) {
      await handleRemovedComponents(
        removedComponents,
        adapter as unknown as DrizzleAdapter,
        logger
      );
    } else {
      logger.newline();
      logger.warn(
        `${removedComponents.length} orphaned component(s) in database:`
      );
      for (const { slug } of removedComponents) {
        logger.item(slug, 1);
      }
      logger.info(
        "These exist in the database but not in your config. Run with --remove-orphaned to delete."
      );
    }
  }

  // Display sync results
  displayComponentsSyncResults(result, options, context);

  // Auto-sync: Create data tables for created/updated Components and set status to 'applied'
  const autoSyncEnabled = options.autoSync !== false;
  if (
    autoSyncEnabled &&
    (result.created.length > 0 || result.updated.length > 0)
  ) {
    await performComponentsAutoSync(
      config,
      adapter,
      componentRegistry,
      result,
      options,
      context
    );
  }
}

// ============================================================================
// User Field Sync
// ============================================================================

/**
 * Sync user custom fields and ensure user_ext table exists.
 *
 * Always runs (even without code-defined fields) because UI-defined
 * fields may exist in the database. Steps:
 * 1. Sync code fields from config → user_field_definitions table
 * 2. Load merged fields (code + UI) into schema service
 * 3. If merged fields exist, generate and execute CREATE TABLE IF NOT EXISTS
 * 4. Verify user_ext table exists
 */
export async function syncUserFields(
  configResult: LoadConfigResult,
  adapter: CLIDatabaseAdapter,
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const { config } = configResult;

  logger.newline();
  logger.info("Syncing user fields...");

  // Create service logger
  const serviceLogger: ServiceLogger = {
    info: (msg: string) => logger.debug(msg),
    warn: (msg: string) => logger.warn(msg),
    error: (msg: string) => logger.error(msg),
    debug: (msg: string) => logger.debug(msg),
  };

  const drizzleAdapter = adapter as unknown as DrizzleAdapter;
  const dialect = drizzleAdapter.getCapabilities().dialect;

  // 1. Instantiate services
  const fieldDefService = new UserFieldDefinitionService(
    drizzleAdapter,
    serviceLogger
  );
  const schemaService = new UserExtSchemaService(dialect, fieldDefService);

  // 2. Sync code fields from config → user_field_definitions table
  const codeFields = config.users?.fields || [];
  try {
    await fieldDefService.syncCodeFields(
      codeFields as unknown as { name: string; [key: string]: unknown }[]
    );
  } catch {
    // user_field_definitions table might not exist yet (migrations not run)
    logger.debug("Skipping user field sync (table may not exist yet)");
    return;
  }

  // 3. Load merged fields (code + UI)
  try {
    await schemaService.loadMergedFields();
  } catch {
    logger.debug("Skipping user field sync (could not load merged fields)");
    return;
  }

  const mergedFields = schemaService.getMergedFieldConfigs();

  if (mergedFields.length === 0) {
    logger.success("No user custom fields defined (code or UI)");
    return;
  }

  const codeCount = codeFields.length;
  const uiCount = mergedFields.length - codeCount;
  const parts: string[] = [];
  if (codeCount > 0) parts.push(`${codeCount} code`);
  if (uiCount > 0) parts.push(`${uiCount} UI`);
  const breakdown = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  logger.success(
    `Found ${formatCount(mergedFields.length, "user field")}${breakdown}`
  );

  // 4. Auto-sync: generate and execute migration SQL for user_ext table
  const autoSyncEnabled = options.autoSync !== false;
  if (!autoSyncEnabled) {
    logger.debug("Auto-sync disabled, skipping user_ext table sync");
    return;
  }

  logger.info("Auto-syncing user_ext table...");

  const migrationSQL = schemaService.generateMigrationSQL(mergedFields);

  // Execute the migration SQL (same pattern as singles/components)
  const statements = migrationSQL
    .split("--> statement-breakpoint")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  try {
    for (const statement of statements) {
      const cleanStatement = statement
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();

      if (cleanStatement) {
        await drizzleAdapter.executeQuery(cleanStatement);
      }
    }

    // Verify table actually exists
    const tableExists = await drizzleAdapter.tableExists("user_ext");
    if (tableExists) {
      logger.success("Synced user_ext table");
    } else {
      logger.warn("user_ext table creation SQL executed but table not found");
    }
  } catch (error) {
    // Table already exists is expected with CREATE TABLE IF NOT EXISTS.
    // Match the immediate message only, so a wrapped failure carrying those
    // words deeper in its cause chain is still reported rather than skipped.
    const immediate = immediateMessage(error);
    if (
      immediate.includes("already exists") ||
      immediate.includes("duplicate")
    ) {
      const tableExists = await drizzleAdapter.tableExists("user_ext");
      if (tableExists) {
        logger.success("user_ext table already exists");
      }
    } else {
      logger.warn(`user_ext sync error: ${describeError(error)}`);
    }
  }
}

// ============================================================================
// Permission Seeding
// ============================================================================

/**
 * Seed permissions for all collections, singles, and system resources.
 *
 * This ensures that CRUD permissions exist for every collection (4 each:
 * create/read/update/delete) and every single (2 each: read/update), plus
 * all system resource permissions. Newly created permissions are auto-assigned
 * to the super_admin role.
 *
 * All operations are idempotent — existing permissions are skipped.
 * Runs on every `nextly db:sync` run and watch-mode re-sync.
 */
export async function performPermissionSeeding(
  adapter: CLIDatabaseAdapter,
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  logger.newline();
  logger.info("Syncing permissions...");

  try {
    const drizzleAdapter = adapter as unknown as DrizzleAdapter;

    // Adapt the CLI logger to the ServiceLogger interface expected by the
    // PermissionSeedService. Routing info/debug to the CLI's debug channel
    // keeps the seeding output concise during dev startup.
    const serviceLogger: ServiceLogger = {
      info: (msg: string) => logger.debug(msg),
      warn: (msg: string) => logger.warn(msg),
      error: (msg: string) => logger.error(msg),
      debug: (msg: string) => logger.debug(msg),
    };

    const permissionSeedService = new PermissionSeedService(
      drizzleAdapter,
      serviceLogger
    );

    // Seed system permissions (users, roles, permissions, media, settings, email-*)
    const systemResult = await permissionSeedService.seedSystemPermissions();

    // Seed collection permissions (4 CRUD each)
    const collectionResult =
      await permissionSeedService.seedAllCollectionPermissions();

    // Seed single permissions (read/update each)
    const singleResult = await permissionSeedService.seedAllSinglePermissions();

    // Auto-assign newly created permissions to super_admin role
    const allNewIds = [
      ...systemResult.newPermissionIds,
      ...collectionResult.newPermissionIds,
      ...singleResult.newPermissionIds,
    ];

    if (allNewIds.length > 0) {
      await permissionSeedService.assignNewPermissionsToSuperAdmin(allNewIds);
    }

    // Log summary
    const totalCreated =
      systemResult.created + collectionResult.created + singleResult.created;
    const totalTotal =
      systemResult.total + collectionResult.total + singleResult.total;

    if (totalCreated > 0) {
      const parts: string[] = [];
      if (systemResult.created > 0) {
        parts.push(`${systemResult.created} system`);
      }
      if (collectionResult.created > 0) {
        parts.push(`${collectionResult.created} collection`);
      }
      if (singleResult.created > 0) {
        parts.push(`${singleResult.created} single`);
      }

      logger.success(
        `Permissions: ${parts.join(" + ")} permission(s) created (${totalTotal} total)`
      );

      if (allNewIds.length > 0) {
        logger.debug(
          `Assigned ${allNewIds.length} new permission(s) to super-admin`
        );
      }
    } else {
      logger.success(`Permissions: all synced (${totalTotal} total)`);
    }

    // When remove-orphaned mode is enabled, also clean up stale permissions
    // that no longer map to any existing code-first resource.
    if (options.removeOrphaned) {
      const cleanupResult =
        await permissionSeedService.cleanupOrphanedPermissions();

      if (cleanupResult.created > 0) {
        logger.success(
          `Permissions cleanup: removed ${cleanupResult.created} orphaned permission(s)`
        );
      } else {
        logger.debug("Permissions cleanup: no orphaned permissions found");
      }
    }
  } catch (error) {
    // Handle fresh DB scenarios gracefully (tables may not exist yet). The
    // immediate message decides: a real seeding failure that merely wraps a
    // "does not exist" cause must still be reported, not skipped silently.
    const immediate = immediateMessage(error);
    if (
      immediate.includes("no such table") ||
      immediate.includes("does not exist") ||
      immediate.includes("relation") ||
      immediate.includes("doesn't exist")
    ) {
      logger.debug("Skipping permission seeding (tables may not exist yet)");
    } else {
      logger.warn(`Permission seeding failed: ${describeError(error)}`);
    }
  }
}

// CLI. Demo content seeding is now Payload-style: an auth-gated POST route
// in the user's project at `src/app/admin/api/seed/route.ts` invokes the
// seed function (under `src/endpoints/seed/`) on user action from the
// admin UI. Eliminates the boot-/CLI-time esbuild + dynamic-import dance
// and the silent-failure mode it introduced.

// ============================================================================
// Utilities
// ============================================================================

/**
 * Convert slug to title case for display
 * @example 'site-settings' -> 'Site Settings'
 */
function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

// ============================================================================
// Orphan Detection & Removal Helpers
// ============================================================================

/**
 * Detect singles that exist in the database with source='code' but are
 * no longer defined in the config.
 */
async function detectRemovedSingles(
  codeSingles: CodeFirstSingleConfig[],
  registry: SingleRegistryService
): Promise<OrphanRecord[]> {
  const dbSingles = await registry.getAllSingles({ source: "code" });
  const codeSlugs = new Set(codeSingles.map(s => s.slug));
  return dbSingles
    .filter(s => !codeSlugs.has(s.slug))
    .map(s => ({ slug: s.slug, tableName: s.tableName }));
}

/**
 * Delete orphaned singles: remove registry entry and drop data table.
 * Uses raw delete to avoid re-fetch issues with getSingle/updateSingle.
 */
async function handleRemovedSingles(
  removed: OrphanRecord[],
  adapter: DrizzleAdapter,
  logger: CommandContext["logger"]
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  const q = dialect === "mysql" ? "`" : '"';

  for (const { slug, tableName } of removed) {
    try {
      // Dependent data first: embedded component instances have no FK back to this table
      // so the drop cascades nothing onto them, and the `_locales` companion holds an FK
      // to `<main>.id` which blocks the drop outright on MySQL. Running before the registry
      // delete keeps the single detectable as an orphan if any of this fails.
      await teardownEntityComponentData({ adapter, parentTable: tableName });
      await teardownEntityI18n({ adapter, slug, tableName });

      // Delete registry entry directly
      await adapter.delete("dynamic_singles", {
        and: [{ column: "slug", op: "=", value: slug }],
      });

      // Drop the data table
      const sql =
        dialect === "postgresql"
          ? `DROP TABLE IF EXISTS ${q}${tableName}${q} CASCADE`
          : `DROP TABLE IF EXISTS ${q}${tableName}${q}`;
      await adapter.executeQuery(sql);

      logger.success(`Deleted orphaned single: ${slug} (table: ${tableName})`);
    } catch (error) {
      logger.error(
        `Failed to delete single "${slug}": ${describeError(error)}`
      );
    }
  }
}

/**
 * Detect components that exist in the database with source='code' but are
 * no longer defined in the config.
 */
async function detectRemovedComponents(
  codeComponents: CodeFirstComponentConfig[],
  registry: FieldGroupRegistryService
): Promise<OrphanRecord[]> {
  const dbComponents = await registry.getAllComponents({ source: "code" });
  const codeSlugs = new Set(codeComponents.map(c => c.slug));
  return dbComponents
    .filter(c => !codeSlugs.has(c.slug))
    .map(c => ({ slug: c.slug, tableName: c.tableName }));
}

/**
 * Delete orphaned components: remove registry entry and drop data table.
 * Uses raw delete to avoid re-fetch issues with getComponent/updateComponent.
 */
async function handleRemovedComponents(
  removed: OrphanRecord[],
  adapter: DrizzleAdapter,
  logger: CommandContext["logger"]
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  const q = dialect === "mysql" ? "`" : '"';

  for (const { slug, tableName } of removed) {
    try {
      // A component can host other components, whose instances point at THIS table and
      // would be stranded by the drop. The `_locales` companion also holds an FK to
      // `<main>.id`, blocking the drop on MySQL. Both go before the registry delete so a
      // failure leaves the component detectable as an orphan.
      await teardownEntityComponentData({ adapter, parentTable: tableName });
      await teardownEntityI18n({ adapter, slug, tableName });

      // Delete registry entry directly
      await adapter.delete(STORAGE_FORMAT.registryTable, {
        and: [{ column: "slug", op: "=", value: slug }],
      });

      // Drop the data table
      const sql =
        dialect === "postgresql"
          ? `DROP TABLE IF EXISTS ${q}${tableName}${q} CASCADE`
          : `DROP TABLE IF EXISTS ${q}${tableName}${q}`;
      await adapter.executeQuery(sql);

      logger.success(
        `Deleted orphaned component: ${slug} (table: ${tableName})`
      );
    } catch (error) {
      logger.error(
        `Failed to delete component "${slug}": ${describeError(error)}`
      );
    }
  }
}

/**
 * Create the companion `_locales` table for every localized collection, single
 * and component in the config.
 *
 * The push pipeline deliberately does not manage companion tables (see
 * `managed-tables.isCompanionTable`), and `ensureCompanionTable` — the intended
 * db:sync/dev-boot counterpart to migration-owned creation — was only ever called
 * at boot. Because `db:sync` runs in its own CLI process, it flipped the
 * registry's `localized` flag and left creation to whenever the app next started;
 * a server already running then rendered the whole localization UI over a table
 * that did not exist.
 *
 * MUST be called after `syncCollections`, `syncSingles` AND `syncComponents`:
 * the companion carries a foreign key to its main table, so running it earlier
 * fails for whichever entity types have not been pushed yet. Idempotent —
 * `ensureCompanionTable` returns early when the table is already there — so
 * running it on every sync costs one probe per localized entity.
 */
export async function ensureLocalizedCompanions(
  config: LoadConfigResult["config"],
  adapter: CLIDatabaseAdapter,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  // Same policy `performAutoSync` applies: production never gets unattended schema
  // changes, and this issues DDL and can copy rows. Enforced here rather than at
  // each call site so no caller can reintroduce the hole. In production the
  // companion is `nextly migrate`'s job, and the write guard keeps a non-default
  // write from destroying content until it runs.
  if (process.env.NODE_ENV === "production") return;
  const dialect = adapter.getCapabilities().dialect;
  const { ensureCompanionTable, reconcileCompanionColumns } = await import(
    "../../domains/i18n/runtime/companion-io"
  );
  // Where a newly created companion's transition gets recorded, and the locale it
  // gets recorded with. Undefined when the app configures no default locale, in
  // which case no entity can be localized and nothing reaches the write below.
  const transitions = await resolveTransitionRecorder(
    config,
    adapter as unknown as DrizzleAdapter,
    logger
  );
  // Each entity kind resolves its physical table differently, and a custom
  // `dbName` is where they diverge: collections and singles force their `dc_` /
  // `single_` prefix onto it (and singles normalize the identifier), while field
  // groups take no override at all. A single shared "prefix + slug" rule would
  // point at a table the runtime never created — `dbName: "forms"` on a
  // collection lives at `dc_forms`, so the companion would be built as
  // `forms_locales` with a foreign key to a table that does not exist.
  const { resolveCollectionTableName, resolveComponentTableName } =
    await import("../../domains/schema/utils/resolve-table-name");
  const { resolveSingleTableName } = await import(
    "../../domains/singles/services/resolve-single-table-name"
  );

  interface LocalizableEntity {
    slug?: string;
    dbName?: string;
    localized?: boolean;
    status?: boolean;
    fields?: { name: string; type: string; localized?: boolean }[];
  }

  // The kind travels with each group because it is part of the transition record's
  // key: a collection, a single and a field group may share one slug, and only one
  // of them may have transitioned.
  const groups: [
    I18nTransitionKind,
    LocalizableEntity[],
    (e: LocalizableEntity) => string,
  ][] = [
    [
      "collection",
      (config.collections ?? []) as LocalizableEntity[],
      e => resolveCollectionTableName(e.slug!, e.dbName),
    ],
    [
      "single",
      (config.singles ?? []) as LocalizableEntity[],
      e => resolveSingleTableName({ slug: e.slug!, dbName: e.dbName }),
    ],
    [
      "fieldGroup",
      (config.fieldGroups ?? []) as LocalizableEntity[],
      // Field groups derive their table from the slug alone — unlike collections
      // and singles they carry no `dbName` override.
      e => resolveComponentTableName(e.slug!),
    ],
  ];

  const failures: string[] = [];
  for (const [kind, group, resolveTableName] of groups) {
    for (const entity of group) {
      if (!entity.slug || entity.localized !== true) continue;
      const tableName = resolveTableName(entity);
      // `ensureCompanionTable` resolves even on failure (a first boot may not have
      // the main table yet), so the reporter — not a try/catch — is what surfaces
      // a real problem.
      // `CLIDatabaseAdapter` under-declares the runtime object, which is a real
      // DrizzleAdapter — the same conversion this file already uses for the sync
      // service above. `ensureCompanionTable` needs `executeQuery`, which the
      // declared CLI interface omits.
      const created = await ensureCompanionTable(
        adapter as unknown as DrizzleAdapter,
        {
          slug: entity.slug,
          tableName,
          fields: entity.fields ?? [],
          dialect,
          status: entity.status === true,
        },
        error => {
          logger.error(
            `Could not prepare the translations table for "${entity.slug}" (${tableName}_locales). ` +
              `Writes in a non-default locale will be refused until it exists: ` +
              `${error instanceof Error ? error.message : String(error)}`
          );
          failures.push(entity.slug!);
        }
      );
      // Only when this call is the one that created the companion. The content on
      // the main table was written under the default locale in force at the time,
      // and this is the one moment the current default is still that locale —
      // afterwards nothing on disk can say what it was. Recorded for an existing
      // companion it would attach today's default to older content.
      if (created && transitions) {
        await beginI18nTransition(transitions, {
          kind,
          slug: entity.slug,
          sourceLocale: transitions.defaultLocale,
        });
      }
      // Creating the companion is not enough on its own. `ensureCompanionTable` returns
      // immediately once the table is there, so marking a FURTHER field localized on an
      // entity that is already localized leaves the companion a column short — while the
      // main-table sync above has already added that column to `comp_*` / `dc_*`. The write
      // then splits the value into a companion column that does not exist. Additive only,
      // Additive only. The reload path reconciles too — it is dev-only, behind its own
      // production return — so the two stay in step.
      await reconcileCompanionColumns(
        adapter as unknown as DrizzleAdapter,
        {
          slug: entity.slug,
          tableName,
          fields: entity.fields ?? [],
          dialect,
          status: entity.status === true,
        },
        error => {
          logger.error(
            `Could not update the translations table for "${entity.slug}" (${tableName}_locales). ` +
              `Newly translatable fields will fail to save until it matches: ` +
              `${error instanceof Error ? error.message : String(error)}`
          );
          failures.push(entity.slug!);
        }
      );
    }
  }
  // Fail the command. Exiting 0 here would tell deployment automation the schema is
  // in step while the registry advertises localization the database cannot store, so
  // every translation write is refused — unlike a failure from the main auto-sync
  // pipeline, which does stop the run. Boot and the HMR reload stay best-effort by
  // passing no reporter: they must not refuse to start over a companion.
  if (failures.length > 0) {
    throw NextlyError.conflict({
      reason: "state",
      message: `Could not prepare the translations table for: ${failures.join(", ")}. Writes in a non-default locale will be refused until it exists.`,
      logContext: {
        cause: "companion-provisioning-failed",
        entities: failures,
      },
    });
  }
}
