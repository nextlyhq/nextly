/**
 * Migrate Command
 *
 * Implements the `nextly migrate` command for running pending database migrations.
 *
 * **Runtime restriction (F11):** This module is CLI-only. Do NOT
 * import it from runtime code (init/, route-handler/, dispatcher/, api/,
 * actions/, direct-api/, routeHandler.ts, next.ts). The deployed
 * Next.js app must not perform schema migrations at boot. Enforced by
 * ESLint (`no-restricted-imports`); see
 * docs/guides/production-migrations.mdx for the deploy-time CLI patterns.
 *
 * @module cli/commands/migrate
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Run all pending migrations
 * nextly migrate
 *
 * # Preview migrations without executing (dry run)
 * nextly migrate --dry-run
 *
 * # Run only the next 2 migrations
 * nextly migrate --step 2
 *
 * # Custom config path
 * nextly migrate --config ./custom/nextly.config.ts
 * ```
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import { getFieldGroupRegistryAliases } from "../../domains/field-groups/storage/registry-schemas";
import { resolveRegistryNameFromCatalog } from "../../domains/field-groups/storage/resolve-storage-names";
import {
  isLocalizationIntentRefusal,
  LOCALIZATION_INTENT_HEADER,
  parseLocalizationIntent,
  type LocalizationMigrationIntent,
} from "../../domains/i18n/migration/migration-intent";
import { assertNoLegacyBookkeeping } from "../../domains/schema/events/legacy-detection";
import { newestEventsByFilename } from "../../domains/schema/events/newest-event";
import { getSchemaEventsDdl } from "../../domains/schema/events/schema-events-ddl";
import {
  SchemaEventsRepository,
  truncateErrorMessage,
} from "../../domains/schema/events/schema-events-repository";
import type { ExtensionSchema } from "../../domains/schema/extension/build-extension-schema";
import { compileExtensionSchema } from "../../domains/schema/extension/publish";
import { reconcileCore } from "../../domains/schema/migrate/core-reconcile";
import { reconcileFile } from "../../domains/schema/migrate/drift-reconcile";
import {
  pluginMigrationSetsFrom,
  runPluginMigrations,
  type PluginMigrationSet,
} from "../../domains/schema/migrate/plugin/run-plugin-migrations";
import { reconcileMigrationMetadata } from "../../domains/schema/migrate/reconcile-metadata";
import { resolveDeclaredSchema } from "../../domains/schema/migrate/resolved-schema";
import {
  mergeContributions,
  narrowToContributions,
} from "../../domains/schema/migrate-create/app-stream";
import {
  ENTITY_HEADER_GUIDANCE,
  parseEntityHeaders,
} from "../../domains/schema/migrate-create/format-file";
import {
  EMPTY_SNAPSHOT,
  parseSnapshotFile,
  type SnapshotFile,
} from "../../domains/schema/migrate-create/snapshot-io";
import { assertNoForeignDrops } from "../../domains/schema/ownership/drop-guard";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import type {
  ContributedElements,
  NextlySchemaSnapshot,
} from "../../domains/schema/pipeline/diff/types";
import {
  forceUnlock,
  withMigrateLock,
} from "../../domains/schema/pipeline/locks";
import { snapshotComparableTables } from "../../domains/schema/pipeline/managed-tables";
import { NextlyError, describeError } from "../../errors";
import { createContext, type CommandContext } from "../program";
import {
  createCliAdapter,
  validateDatabaseEnv,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
  type SupportedDialect,
} from "../utils/adapter";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader";
import { formatDuration, formatCount } from "../utils/logger";
import {
  discoverMigrationGroups,
  selectVariant,
  getSortedBaseNames,
} from "../utils/migration-discovery";

/**
 * Options specific to the migrate command
 */
export interface MigrateCommandOptions {
  /**
   * Show what would be migrated without executing.
   * @default false
   */
  dryRun?: boolean;

  /**
   * Run only N migrations.
   */
  step?: number;

  /**
   * Clear a stale migrate lock before running (e.g. left by a crashed run).
   * @default false
   */
  forceUnlock?: boolean;

  /**
   * Copy existing content into the translation tables of localized entities that carry no record
   * of ever having transitioned.
   *
   * Opt-in, and it has to be. An entity with no record is either an install that enabled
   * localization before Nextly began recording transitions, or one that has been localized since
   * birth and owes nothing — and nothing on disk tells the two apart. That is the same conclusion
   * this whole mechanism rests on: which language existing values are in cannot be recovered by
   * looking at them, which is why it is recorded rather than inferred. Guessing here would
   * manufacture a default-locale translation for every entry, including ones deliberately authored
   * in another language only.
   *
   * Running it is the operator supplying the one missing fact: that their main tables hold content
   * in the configured default locale. Rows that already have a translation in that locale are left
   * alone, so it is safe to repeat and cannot overwrite a real translation.
   *
   * @default false
   */
  repairLocalization?: boolean;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedMigrateOptions extends MigrateCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

/**
 * Migration source type
 */
type MigrationSource = "core" | "app";

/**
 * Parsed migration file data
 */
interface ParsedMigration {
  /** Migration file name (without extension) */
  name: string;
  /** Full file path */
  filePath: string;
  /** UP SQL statements */
  upSql: string;
  /** DOWN SQL statements */
  downSql: string;
  /** SHA-256 checksum of file content */
  checksum: string;
  /** Original checksum from file header (if present) */
  originalChecksum?: string;
  /** Collection slugs (if present in file header) */
  collections: string[];
  /** Single slugs (if present in file header) */
  singles: string[];
  /** Component slugs (if present in file header) */
  components: string[];
  /**
   * What a companion migration declares it is FOR, when it declares anything.
   *
   * Undefined for ordinary migrations and for companion files written before the field existed;
   * both apply verbatim, which is what they have always done.
   */
  localization?: LocalizationMigrationIntent;
  /** Timestamp extracted from filename */
  timestamp: string;
  /** Source of the migration (core bundled or app) */
  source: MigrationSource;
}

/**
 * Execute the migrate command
 *
 * @param options - Combined global and command options
 * @param context - Command context with logger
 */
export async function runMigrate(
  options: ResolvedMigrateOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const startTime = Date.now();

  logger.header("Migrate");

  logger.debug("Validating database environment...");
  const dbValidation = validateDatabaseEnv();

  if (!dbValidation.valid) {
    for (const error of dbValidation.errors) {
      logger.error(error);
    }
    logger.newline();
    logger.info(
      "Set DATABASE_URL and optionally DB_DIALECT environment variables."
    );
    process.exit(1);
  }

  const dialect = dbValidation.dialect!;
  logger.debug(`Database dialect: ${dialect}`);

  logger.info("Loading configuration...");

  let configResult: LoadConfigResult;
  try {
    configResult = await loadConfig({
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    });
  } catch (error) {
    logger.error(`Failed to load config: ${describeError(error)}`);
    process.exit(1);
  }

  if (configResult.configPath) {
    logger.success(`Loaded config from ${configResult.configPath}`);
  } else {
    logger.warn("No config file found, using defaults");
  }

  logger.keyValue("Dialect", getDialectDisplayName(dialect));

  if (options.dryRun) {
    logger.keyValue("Mode", "Dry Run (no changes will be made)");
  }

  logger.newline();
  logger.info(`Connecting to ${getDialectDisplayName(dialect)}...`);

  let adapter: CLIDatabaseAdapter;
  try {
    adapter = await createCliAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: options.verbose ? logger : undefined,
    });
    logger.success("Database connected");
  } catch (error) {
    logger.error(`Failed to connect to database: ${describeError(error)}`);
    process.exit(1);
  }

  installRegistryResolver(adapter as unknown as DrizzleAdapter);

  try {
    const db = (adapter as unknown as DrizzleAdapter).getDrizzle();
    const cwd = options.cwd ?? process.cwd();
    const appMigrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

    // Config and the Builder manifest, merged as generation merges them. The
    // drift check needs the derived-table set, and assembling it here from the
    // config alone missed Builder entities and plugin extends.
    const resolvedSchema = await resolveDeclaredSchema({
      projectRoot: cwd,
      config: configResult.config,
      deferredExtends: configResult.deferredExtends,
    });

    // Phase 0 — legacy bookkeeping gate (spec §4.6). Aborts with
    // NEXTLY_LEGACY_BOOKKEEPING_DETECTED if the pre-consolidation tables exist.
    await assertNoLegacyBookkeeping(
      adapter as unknown as { tableExists: (n: string) => Promise<boolean> }
    );

    if (options.dryRun) {
      const pending = await findPendingFiles(
        adapter,
        db,
        dialect,
        appMigrationsDir,
        logger
      );
      logger.newline();
      logger.keyValue("Pending", formatCount(pending.length, "migration"));
      for (const m of pending) logger.info(`  • ${m.name}.sql`);
      logger.success("Dry run complete (no changes made).");
      return;
    }

    // Operator-set override; never in CI config (spec §4.6.1).
    const allowCoreDestructive = process.env.NEXTLY_ALLOW_CORE_DESTRUCTIVE === "1"; // prettier-ignore
    // Separate flag, because losing rows is a different decision from
    // accepting a schema change; read here so both live at the same edge.
    const allowDropNonEmptyRetired = process.env.NEXTLY_DROP_NONEMPTY_RETIRED === "1"; // prettier-ignore

    const dz = adapter as unknown as DrizzleAdapter & {
      tableExists: (n: string) => Promise<boolean>;
    };

    // Clear a stale lock first when --force-unlock is passed (e.g. left by a
    // crashed prior run), then proceed with the normal migrate.
    await maybeForceUnlock(options, db, dialect);

    // Delegate to the non-exiting core (Phase 1 + Phase 2 under the lock). The
    // ledger (`nextly_schema_events`) is bootstrapped out-of-band by
    // `ensureLedger` — AFTER applyCore (so pushSchema doesn't see it as an
    // extraneous table) and BEFORE the event is recorded; idempotent. A thrown
    // error here maps to a non-zero CLI exit (the core itself never exits).
    try {
      const pluginMigrationSets = await pluginMigrationSetsFrom(
        configResult.config.plugins ?? []
      );
      const extensionSchema = await compileExtensionSchema({
        dialect,
        plugins: configResult.config.plugins ?? [],
        config: configResult.config,
        logger: { warn: m => logger.warn(m) },
      });
      const { applied, metadata } = await migrateCore({
        extensionSchema,
        dialect,
        db,
        adapter,
        migrationsDir: appMigrationsDir,
        logger,
        pluginMigrationSets,
        pluginsWithMigrations: new Set(
          pluginMigrationSets.map(set => set.pluginName)
        ),
        lockMode: "fail-fast",
        ttlSeconds: configResult.config.db.migrateLockTtlSeconds,
        // A custom `options.junctionTable` name cannot be inferred from any
        // convention, and such a table is in no snapshot — so the drift check
        // has to be told about it or it reports a difference no migration can
        // resolve.
        knownJunctions: resolvedSchema.knownJunctions,
        allowDestructive: allowCoreDestructive,
        allowDropNonEmptyRetired,
        ensureLedger: async () => {
          if (!(await dz.tableExists("nextly_schema_events"))) {
            for (const stmt of getSchemaEventsDdl(dialect)) {
              await dz.executeQuery(stmt);
            }
          }
        },
        step: options.step,
      });

      logger.newline();

      /*
       * 🔴 "Up to date" is a claim about the REGISTRY as well as the files.
       * Phase 3 can leave rows outstanding while no migration file applied --
       * a row whose table is absent produces no per-row warning, by design --
       * so reporting only `applied` let a run announce a current database while
       * registry work it had just measured was still owed.
       */
      reportMetadataOutcome(metadata, logger);

      logger.success(
        applied === 0
          ? metadata.stillPending > 0 || metadata.unreadable.length > 0
            ? "No migration files to apply."
            : "Nothing to migrate. Database is up to date."
          : `${formatCount(applied, "migration")} applied.`
      );
    } catch (err) {
      logger.error(describeError(err));
      process.exit(1);
    }

    // Localization companions, once the schema is in step.
    //
    // The push pipeline does not manage companion tables, so a localized entity can be fully
    // migrated and still have nowhere to store translations — and in production nothing else may
    // create one, because boot deliberately refuses to run DDL there. This is the supervised path
    // the refusal message names, and the only one an install that transitioned before transitions
    // were recorded can be repaired from.
    //
    // After the migrations, not before: a companion carries a foreign key to its main table, and
    // the columns it seeds from are whatever the migrations have just left in place.
    //
    // Skipped entirely while any migration is still pending, which `--step` is precisely for. The
    // config describes the FINAL schema, so provisioning against it now would create a companion
    // that a later pending migration is going to create for itself — and that migration's
    // unconditional `CREATE TABLE` then fails on a table that already exists. Deriving the work
    // from the applied subset instead is not worth it: the operator stepping through migrations
    // will reach the end, and the run that gets there does the provisioning.
    try {
      const stillPending = await findPendingFiles(
        adapter,
        db,
        dialect,
        appMigrationsDir,
        logger
      );
      if (stillPending.length > 0) {
        logger.info(
          `Skipping translation-table provisioning: ${formatCount(stillPending.length, "migration")} still pending. ` +
            `Run \`nextly migrate\` without --step to finish.`
        );
      } else {
        const { ensureLocalizedCompanions } = await import("./dev-build");
        await ensureLocalizedCompanions(
          configResult.config,
          adapter,
          context,
          "afterApply",
          {
            supervised: true,
            // Never by default: an entity with no transition record may be a legacy install or one
            // localized since birth, and nothing distinguishes them. See `repairLocalization`.
            repairUntracked: options.repairLocalization === true,
          }
        );
      }
    } catch (err) {
      logger.error(describeError(err));
      process.exit(1);
    }

    const duration = Date.now() - startTime;
    logger.divider();
    logger.success(`migrate completed in ${formatDuration(duration)}`);
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Non-exiting migrate core: runs Phase 1 (core reconcile) + Phase 2 (file
 * migrations) under the lock, and **throws** on failure (never `process.exit`).
 * Shared by the CLI `runMigrate` (which maps a throw → process.exit) and the
 * production run-on-boot hook (which catches → logs, never exits). The lock
 * `mode` is threaded so boot can run in "wait" mode. Seams are injectable for
 * tests.
 */
export interface MigrateCoreDeps {
  /**
   * The extension schema compiled from the caller's config, or `undefined`
   * when nothing declares one.
   *
   * REQUIRED, and passed rather than read from the process-wide active
   * schema: only a server boot publishes that, so the CLI saw none. The
   * plugin-table refusal then passed a plugin that ships no migrations, and
   * no element ownership was recorded — a run that reported success while
   * skipping exactly what those checks protect. Required so a new entry point
   * cannot forget it; compile with `compileExtensionSchema`.
   */
  extensionSchema: ExtensionSchema | undefined;
  /**
   * Plugin ids that ship migration modules.
   *
   * A plugin here is applied by the plugin phase; one declaring tables and
   * absent from this set has no path to production and is refused.
   */
  pluginsWithMigrations?: ReadonlySet<string>;
  /**
   * The migration modules to run, in resolver order. Phase 1.5 applies them
   * between the core reconcile and the app's files; the first failure stops
   * the run. Omitted by callers with no plugin migrations to run.
   */
  pluginMigrationSets?: readonly PluginMigrationSet[];
  dialect: SupportedDialect;
  db: unknown;
  adapter: CLIDatabaseAdapter;
  migrationsDir: string;
  logger: CommandContext["logger"];
  lockMode?: "fail-fast" | "wait";
  ttlSeconds?: number;
  isSettled?: () => Promise<boolean>;
  allowDestructive?: boolean;
  /**
   * NEXTLY_DROP_NONEMPTY_RETIRED=1: also drop a retired table holding rows.
   *
   * Read at the CLI edge and threaded, like `allowDestructive`, rather than
   * read here — a core that consults the environment cannot be tested for the
   * other answer.
   */
  allowDropNonEmptyRetired?: boolean;
  ensureLedger?: () => Promise<void>;
  step?: number;
  reconcileCoreFn?: typeof reconcileCore;
  runFileMigrationsFn?: typeof runFileMigrations;
  /** Junction tables the config names outright; see `runFileMigrations`. */
  knownJunctions?: ReadonlySet<string>;
  withLock?: typeof withMigrateLock;
  /** Seam for tests; defaults to the real metadata reconciliation. */
  reconcileMetadataFn?: typeof reconcileMigrationMetadata;
  /**
   * Seam for tests; defaults to recording and retiring element owner rows
   * against the database.
   */
  syncElementOwnersFn?: (deps: MigrateCoreDeps) => Promise<void>;
}

export interface MigrateCoreResult {
  applied: number;
  coreChanged: boolean;
  /**
   * Whether the migration body actually RAN.
   *
   * `false` only in `"wait"` mode, where the lock stayed held past the wait
   * deadline. `applied` is 0 in that case and so is it on an up-to-date
   * database — the two are indistinguishable without this flag, which is how
   * production boot came to log `Boot migrations complete (0 applied)` for
   * migrations that never started.
   */
  ran: boolean;
  /**
   * Registry rows this run brought into agreement with the tables.
   *
   * Reported so a caller can say what happened rather than implying it from
   * `applied`, which counts migration FILES: a run can apply no files and still
   * record a row whose table landed on a previous one.
   */
  metadata: {
    collectionsRegistered: number;
    singlesRegistered: number;
    marked: number;
    stillPending: number;
    awaitingMigration: number;
    unscopedMigrations: string[];
    unreadable: string[];
  };
}

/** Clear a stale migrate lock when `--force-unlock` was passed (else no-op). */
export async function maybeForceUnlock(
  options: { forceUnlock?: boolean },
  db: unknown,
  dialect: SupportedDialect
): Promise<void> {
  if (!options.forceUnlock) return;
  await forceUnlock(db, dialect);
}

/**
 * Give the adapter a way to resolve core table NAMES to Drizzle tables.
 *
 * 🔴 Without this, the metadata reconciliation silently does nothing.
 * `adapter.select` maps a name through a resolver and refuses with "not found
 * in schema registry" when none is installed. A CLI run has no boot to install
 * one — which is why `prune`, `webhooks-prune`, `migrate-field-groups` and
 * `dev-server` each wire it up the same way before touching adapter CRUD.
 *
 * Missing here, every registry read in the sweep threw, the per-registry guard
 * caught all three, and the command reported success having repaired nothing:
 * a no-op in exactly the production case the phase exists for.
 *
 * Both spellings of the field-group registry are registered, because a database
 * whose storage migration has run has no handle for it under the other name.
 *
 * Its own exported function so the wiring can be asserted by its OUTCOME — that
 * the registry table resolves — rather than by whether a call appears in the
 * source.
 */
export function installRegistryResolver(
  adapter: DrizzleAdapter
): SchemaRegistry {
  const { dialect } = adapter.getCapabilities();
  const schemaRegistry = new SchemaRegistry(dialect);
  schemaRegistry.registerStaticSchemas({
    ...getDialectTables(dialect),
    ...getFieldGroupRegistryAliases(dialect),
  });
  adapter.setTableResolver(schemaRegistry);
  return schemaRegistry;
}

/**
 * One SQL executor for every phase: split, run in one transaction, count.
 *
 * Shared by the app files and the plugin modules so the two paths cannot
 * drift about what "executed as one unit" means.
 */
function buildSqlExecutor(
  dz: DrizzleAdapter,
  dialect: SupportedDialect
): (sqlText: string) => Promise<number> {
  return async sqlText => {
    const statements = splitSqlStatements(sqlText, dialect);
    await executeTransaction(dz, dialect, async () => {
      for (const statement of statements) {
        await dz.executeQuery(statement);
      }
    });
    return statements.length;
  };
}

/**
 * Per-element owner rows for elements the APP contributed to tables a
 * plugin owns (its indexes riding the app migration stream). Table-level
 * rows are written by the streams that carry the tables; these say who
 * owns the ELEMENT, so a plugin's reconcile can exclude it.
 */
async function recordElementOwners(deps: MigrateCoreDeps): Promise<void> {
  const elementOwners = deps.extensionSchema?.elementOwners;
  if (elementOwners === undefined || elementOwners.size === 0) return;
  const { SchemaOwnersRepository: OwnersRepo } = await import(
    "../../domains/schema/ownership/schema-owners-repository"
  );
  const owners = new OwnersRepo(deps.db, deps.dialect);
  for (const [tableName, elements] of elementOwners) {
    await owners.upsert(
      elements.map(element => ({
        tableName,
        elementKind: element.elementKind,
        elementName: element.elementName,
        ownerKind: element.owner.kind,
        ownerId: element.owner.kind === "app" ? "app" : element.owner.id,
        // The stream that carries the element, which is the CONTRIBUTOR's.
        //
        // Hard-coding "app" mis-filed every plugin contribution. A later
        // module from that plugin changing or dropping its own index found the
        // live index attributed to another stream, so `runPluginPhase`
        // excluded it from the snapshot it compares — which then matched
        // neither the module's `before` nor its target, and the upgrade
        // stopped as drift over an element the plugin owns.
        migratedBy:
          element.owner.kind === "app" ? "app" : `plugin:${element.owner.id}`,
        ownerVersion: null,
        schemaVersion: null,
        state: "active" as const,
      }))
    );
  }
}

/** Record the current element owner rows, then retire the stale ones. */
async function syncElementOwners(deps: MigrateCoreDeps): Promise<void> {
  await recordElementOwners(deps);
  await retireElementOwners(deps);
}

/**
 * Delete element owner rows whose element is gone from the config AND the
 * database; see `retiredElementRows` for why both must hold.
 */
async function retireElementOwners(deps: MigrateCoreDeps): Promise<void> {
  const { SchemaOwnersRepository: OwnersRepo } = await import(
    "../../domains/schema/ownership/schema-owners-repository"
  );
  const { retiredElementRows } = await import(
    "../../domains/schema/ownership/retired-elements"
  );
  const owners = new OwnersRepo(deps.db, deps.dialect);
  const elementRows = (await owners.read()).filter(
    row => (row.elementKind ?? "table") !== "table"
  );
  if (elementRows.length === 0) return;
  const tables = [...new Set(elementRows.map(row => row.tableName))];
  const live = await introspectLiveSnapshot(deps.db, deps.dialect, tables);
  const retired = retiredElementRows({
    rows: elementRows,
    declared: deps.extensionSchema?.elementOwners ?? new Map(),
    live,
  });
  for (const row of retired) {
    await owners.deleteElement(
      row.tableName,
      row.elementKind,
      row.elementName ?? ""
    );
  }
}

/**
 * Phase 1.5 — plugin migration modules, between core and the app's files,
 * under the caller's lock. Plugins run first because an app migration may
 * index an entity table a plugin contributes. The first failure propagates
 * and stops Phase 2: later migrations assume a database state that was never
 * reached.
 */
export async function runPluginPhase(deps: MigrateCoreDeps): Promise<void> {
  if (!deps.pluginMigrationSets || deps.pluginMigrationSets.length === 0) {
    return;
  }
  deps.logger.info("Phase 1.5: applying plugin migrations...");
  const dz = deps.adapter as unknown as DrizzleAdapter;
  const eventsRepo = new SchemaEventsRepository(deps.db, deps.dialect);
  // Applied plugin modules, keyed by qualified filename, with the sha256 that
  // ran. The NEWEST event per filename decides it — a rolled_back event
  // INSERTED after an applied one (the shape `migrate:down` records) means the
  // module is not applied, however many older applied rows exist — through
  // the one helper every ledger reader shares, so this phase cannot disagree
  // with `migrate:down` or `plugins uninstall` about the same row set.
  const appliedShas = new Map<string, string | null>();
  for (const [filename, newest] of newestEventsByFilename(
    await eventsRepo.listFileApplies()
  )) {
    if (filename.startsWith("plugin:") && newest.status === "applied") {
      appliedShas.set(filename, newest.sha256);
    }
  }

  // Loaded here rather than imported at the top: both modules sit on cycles
  // that close through this command, and the file's existing convention for
  // that is a dynamic import at the point of use.
  const { SchemaOwnersRepository: OwnersRepo } = await import(
    "../../domains/schema/ownership/schema-owners-repository"
  );
  const owners = new OwnersRepo(deps.db, deps.dialect);
  // Table-level rows only: an element row shares its table's name, and in a
  // name-keyed map it would shadow the table row the drop guard compares.
  const ownerRows = new Map(
    (await owners.read())
      .filter(record => (record.elementKind ?? "table") === "table")
      .map(record => [record.tableName, record])
  );
  // Per-element ownership for the reconcile exclusion: a live element whose
  // row names a different stream is not this stream's business, and reading
  // it as drift would refuse an adoption over an index the plugin never
  // declared.
  const allRows = await owners.read();
  const elementStream = new Map<string, string>();
  for (const record of allRows) {
    const kind = record.elementKind ?? "table";
    if (kind === "table") continue;
    // Keyed by KIND as well as name: a column and an index on one table can
    // share a name, and a kind-blind key would let one decide the other's
    // stream.
    elementStream.set(
      `${record.tableName}\u0000${kind}\u0000${record.elementName ?? ""}`,
      record.migratedBy
    );
  }
  const pluginOutcome = await runPluginMigrations(deps.pluginMigrationSets, {
    dialect: deps.dialect,
    appliedShas,
    owners: ownerRows,
    introspect: async (names, stream) => {
      const liveTables = await safeListTables(deps.adapter);
      const managed = snapshotComparableTables(
        liveTables,
        new Set(names),
        new Set()
      );
      const live = await introspectLiveSnapshot(deps.db, deps.dialect, managed);
      // Drop live elements another stream owns, so this plugin's comparison
      // sees only what its own stream claims.
      //
      // COLUMNS as well as indexes. When another plugin or the app contributes
      // a column to this plugin's table, the plugin's own module has
      // before/target snapshots that do not mention it while introspection
      // still returns it — so the live table matched neither side and a valid
      // upgrade was refused as drift. The registry has recorded
      // `elementKind: "column"` all along; this simply asks it.
      const ownedByAnother = (
        kind: "column" | "index",
        tableName: string,
        elementName: string
      ): boolean => {
        const owner = elementStream.get(
          `${tableName}\u0000${kind}\u0000${elementName}`
        );
        return owner !== undefined && owner !== stream;
      };

      for (const table of live.tables) {
        table.columns = table.columns.filter(
          column => !ownedByAnother("column", table.name, column.name)
        );
        if (table.indexes === undefined) continue;
        table.indexes = table.indexes.filter(
          index => !ownedByAnother("index", table.name, index.name)
        );
      }
      return live;
    },
    executeSql: buildSqlExecutor(dz, deps.dialect),
    repo: eventsRepo,
    recordOwner: async ({
      pluginName,
      pluginVersion,
      schemaVersion,
      tables,
    }) => {
      // A module that leaves this plugin owning NOTHING still moved its
      // schema version.
      //
      // `upsert([])` returns early, so a migration removing a plugin's last
      // table left its existing rows at the old version — and the production
      // boot gate then reads that stale number and rejects the configured
      // plugin as behind, permanently, over a migration that applied
      // correctly. The rows are carried forward rather than deleted: they are
      // what records that the tables were this plugin's, which the drop guard
      // and a later uninstall both still need.
      if (tables.length === 0) {
        const existing = (await owners.read()).filter(
          row => row.ownerId === pluginName
        );
        if (existing.length > 0) {
          await owners.upsert(
            existing.map(row => ({
              ...row,
              ownerVersion: pluginVersion,
              schemaVersion,
            }))
          );
        }
        return;
      }

      await owners.upsert(
        tables.map(tableName => ({
          tableName,
          ownerKind: "plugin" as const,
          ownerId: pluginName,
          migratedBy: `plugin:${pluginName}`,
          ownerVersion: pluginVersion,
          schemaVersion,
          state: "active" as const,
        }))
      );
    },
  });
  if (pluginOutcome.applied > 0 || pluginOutcome.adopted > 0) {
    deps.logger.success(
      `Plugin migrations: ${pluginOutcome.applied} applied, ${pluginOutcome.adopted} adopted, ${pluginOutcome.skipped} already recorded.`
    );
  }
}

/**
 * Refuse to migrate a plugin's tables when that plugin ships no migrations.
 *
 * A plugin that DOES ship migration modules is applied by the plugin phase.
 * One that declares tables and ships nothing to create them has no path to
 * production, and a run that proceeded would report success having created
 * none of them — the first sign being a query against a table nothing made.
 *
 * Narrowed from refusing every plugin table: that was correct while no plugin
 * could ship migrations at all, and became wrong the moment one could.
 */
function assertPluginTablesAreMigratable(
  extensionSchema: ExtensionSchema | undefined,
  pluginsWithMigrations: ReadonlySet<string>
): void {
  const owners = extensionSchema?.owners;
  if (!owners) return;

  const unmigratable = [...owners.entries()]
    .filter(
      ([, owner]) =>
        owner.kind === "plugin" && !pluginsWithMigrations.has(owner.id)
    )
    .map(([name]) => name);
  if (unmigratable.length === 0) return;

  throw new NextlyError({
    code: "PLUGIN_MIGRATIONS_UNAVAILABLE",
    publicMessage:
      "A plugin declares tables but ships no migrations to create them. They exist in development through push; generate the plugin's migrations before deploying.",
    logContext: { tables: unmigratable },
  });
}

/**
 * Say what Phase 3 did, and what it could not do.
 *
 * Extracted from the command body because the reporting is four independent
 * decisions about one result — could the registries be read, what was recorded,
 * what is waiting for a migration to exist, what is waiting for one to run —
 * and interleaving them with the migrate flow made both harder to follow than
 * either is alone.
 */
function reportMetadataOutcome(
  metadata: MigrateCoreResult["metadata"],
  logger: CommandContext["logger"]
): void {
  const {
    marked,
    stillPending,
    awaitingMigration,
    unscopedMigrations,
    unreadable,
  } = metadata;

  if (unreadable.length > 0) {
    // Not a count of rows: this is "the sweep could not look". Reported
    // separately because zero repaired and zero readable are the same
    // number and opposite facts.
    logger.warn(
      `Could not read the ${unreadable.join(", ")} registry, so migration ` +
        `status was not reconciled. The tables are in place; re-run \`nextly migrate\`.`
    );
  }

  if (marked > 0) {
    logger.success(
      `${formatCount(marked, "registry row")} recorded as applied.`
    );
  }

  /*
   * Split, because the two causes send an operator to different places. A row
   * whose table is absent is waiting for a migration to be GENERATED; a row
   * whose shape disagrees with the applied migrations has one generated and
   * not yet run, or has been edited since. One combined count says "something
   * is owed" and leaves them to guess which.
   */
  if (unscopedMigrations.length > 0) {
    /*
     * Named, because the remedy is to add one line to those files. Silence here
     * would leave an operator with rows recorded as migrated by a rule that
     * could not see the migration that changes them.
     */
    logger.warn(
      `${formatCount(unscopedMigrations.length, "pending migration")} name no collection, single or field group, ` +
        `so registry rows were recorded from their tables alone: ${unscopedMigrations.join(", ")}. ` +
        // Taken from the formatter rather than restated, because a remediation
        // that drifts from the format tells an operator to do something that
        // does not work — which is exactly how this line came to name only
        // `-- Collections:` while the template named all three.
        `${ENTITY_HEADER_GUIDANCE}.`
    );
  }

  const awaitingTable = stillPending - awaitingMigration;
  if (awaitingTable > 0) {
    logger.warn(
      `${formatCount(awaitingTable, "registry row")} still awaiting a migration. ` +
        `Run \`nextly migrate:create\` if the change has no migration yet.`
    );
  }
  if (awaitingMigration > 0) {
    logger.warn(
      `${formatCount(awaitingMigration, "registry row")} awaiting a migration that has not been applied. ` +
        `Run \`nextly migrate\` without --step to apply it.`
    );
  }
}

export async function migrateCore(
  deps: MigrateCoreDeps
): Promise<MigrateCoreResult> {
  // Refused HERE rather than in `runMigrate`, because this function is also
  // reached from `runMigrationsOnBoot` and from boot-apply. A refusal in the
  // command alone would let a production boot apply migrations that silently
  // skip every plugin-owned table, and the first failure would be a query
  // against a table nothing created.
  assertPluginTablesAreMigratable(
    deps.extensionSchema,
    new Set(deps.pluginsWithMigrations ?? [])
  );

  const reconcile = deps.reconcileCoreFn ?? reconcileCore;
  const runFiles = deps.runFileMigrationsFn ?? runFileMigrations;
  const reconcileMetadata =
    deps.reconcileMetadataFn ?? reconcileMigrationMetadata;
  const lock = deps.withLock ?? withMigrateLock;
  let applied = 0;
  let coreChanged = false;
  let metadata = {
    collectionsRegistered: 0,
    singlesRegistered: 0,
    marked: 0,
    stillPending: 0,
    awaitingMigration: 0,
    unscopedMigrations: [] as string[],
    unreadable: [] as string[],
  };

  const outcome = await lock(
    deps.db,
    deps.dialect,
    async () => {
      deps.logger.info("Phase 1: reconciling core schema...");
      // Resolved here, where a failure can still fail the command cleanly. The
      // core schema is a desired shape, so naming a registry the database does
      // not have is an instruction to create it — and an empty legacy registry
      // beside a populated migrated one is preferred by every reader.
      const fieldGroupRegistryTable = await resolveRegistryNameFromCatalog({
        dialect: deps.dialect,
        getDrizzle: <T>() => deps.db as T,
      });
      // DETECTED rather than asserted. Not every caller builds a full adapter:
      // the dev-boot path wraps the Drizzle adapter in a small object carrying
      // `executeQuery` and nothing else, so a cast to a shape with
      // `tableExists` produced a call on `undefined` — a TypeError the boot
      // handler catches, which silently skipped the whole migration phase. The
      // cleanup already reports itself as skipped when these are absent, so
      // omitting them degrades to a note instead of a crash.
      const retiredOps = deps.adapter as unknown as {
        tableExists?: (table: string) => Promise<boolean>;
        executeQuery?: (sql: string) => Promise<unknown>;
      };
      const canDropRetired =
        typeof retiredOps.tableExists === "function" &&
        typeof retiredOps.executeQuery === "function";
      const r = await reconcile({
        db: deps.db,
        dialect: deps.dialect,
        fieldGroupRegistryTable,
        logger: {
          info: m => deps.logger.debug(m),
          warn: m => deps.logger.warn(m),
        },
        allowDestructive: deps.allowDestructive,
        ...(deps.allowDropNonEmptyRetired === true
          ? { allowDropNonEmptyRetired: true }
          : {}),
        // The operations the retired-table drop needs. Without them the
        // cleanup returned at its first guard, so the documented
        // NEXTLY_ALLOW_CORE_DESTRUCTIVE flow dropped nothing and said nothing.
        // Passed as a group: half of them is not a usable cleanup, and the
        // guard reads their absence as "this caller is not asking for it".
        ...(canDropRetired
          ? {
              tableExists: (table: string) =>
                (retiredOps.tableExists as (t: string) => Promise<boolean>)(
                  table
                ),
              countRows: async (
                database: unknown,
                d: SupportedDialect,
                table: string
              ) => {
                const { countRows } = await import(
                  "../../domains/schema/pipeline/classifier/count-helpers"
                );
                return countRows(database, d, table);
              },
              executeSql: (sql: string) =>
                (retiredOps.executeQuery as (s: string) => Promise<unknown>)(
                  sql
                ),
            }
          : {}),
        ensureLedger: deps.ensureLedger,
      });
      coreChanged = r.changed;

      await runPluginPhase(deps);

      deps.logger.info("Phase 2: applying user migrations...");
      applied = await runFiles({
        adapter: deps.adapter,
        db: deps.db,
        dialect: deps.dialect,
        migrationsDir: deps.migrationsDir,
        step: deps.step,
        logger: deps.logger,
        knownJunctions: deps.knownJunctions,
      });

      // Element rows for contributed elements: written AFTER every stream has
      // applied, so a row exists exactly when the element does — then rows
      // whose element is gone from both the config and the database are
      // retired, so a reused name is never attributed to a stream that no
      // longer holds it. Each stream's reconcile ignores elements it does not
      // own, which is what these rows say.
      await (deps.syncElementOwnersFn ?? syncElementOwners)(deps);

      /*
       * Phase 3 — make the registry agree with the tables Phase 2 just created.
       *
       * 🔴 Inside the lock, unlike the dev-boot path, which runs its equivalent
       * outside because several dev-server workers race there. A CLI invocation
       * already holds the lock, so this sweep cannot interleave with another
       * migrate and needs no conflict tolerance of its own.
       *
       * CAUGHT, and the command still succeeds. The DDL has landed by now, and
       * MySQL commits DDL implicitly, so there is no transaction to roll back
       * into: a bookkeeping failure leaves working tables beside a row that is
       * behind. Failing here would report a migration that worked as broken,
       * and the next invocation repairs the row because this runs every time.
       */
      deps.logger.info("Phase 3: recording migration metadata...");
      try {
        metadata = await reconcileMetadata({
          adapter: deps.adapter as unknown as DrizzleAdapter,
          dialect: deps.dialect,
          migrationsDir: deps.migrationsDir,
          logger: {
            info: (m: string) => deps.logger.debug(m),
            warn: (m: string) => deps.logger.warn(m),
            debug: (m: string) => deps.logger.debug(m),
          },
        });
      } catch (error) {
        // The whole pass failed, so nothing was read: say so in the result
        // rather than returning zeroes that read like "nothing needed doing".
        metadata = {
          ...metadata,
          unreadable: ["collection", "single", "field group"],
        };
        deps.logger.warn(
          `Migration metadata was not recorded: ${
            error instanceof Error ? error.message : String(error)
          }. The tables are in place; run \`nextly migrate\` again to record it.`
        );
      }
    },
    {
      mode: deps.lockMode ?? "fail-fast",
      ttlSeconds: deps.ttlSeconds,
      isSettled: deps.isSettled,
      logger: {
        warn: m => deps.logger.warn(m),
        info: m => deps.logger.info(m),
      },
    }
  );

  return { applied, coreChanged, ran: outcome.ran, metadata };
}

/**
 * Discover migration files with no applied `file_apply` event yet. On a fresh
 * DB the ledger table does not exist yet (only the real `migrate` bootstraps
 * it in Phase 1); dry-run must stay read-only, so if the ledger is absent we
 * report every discovered file as pending rather than querying (and throwing).
 */
export async function findPendingFiles(
  adapter: CLIDatabaseAdapter,
  db: unknown,
  dialect: SupportedDialect,
  migrationsDir: string,
  logger: CommandContext["logger"]
): Promise<ParsedMigration[]> {
  // Passing dialect prefers {name}.{dialect}.sql over base {name}.sql when both exist
  const all = await discoverMigrations(migrationsDir, logger, dialect, "app");
  const hasLedger = await (
    adapter as unknown as { tableExists: (n: string) => Promise<boolean> }
  ).tableExists("nextly_schema_events");
  if (!hasLedger) return all;

  const repo = new SchemaEventsRepository(db, dialect);
  const pending: ParsedMigration[] = [];
  for (const m of all) {
    if (!(await repo.isFileApplied(`${m.name}.sql`))) pending.push(m);
  }
  return pending;
}

async function safeListTables(adapter: CLIDatabaseAdapter): Promise<string[]> {
  try {
    return await (
      adapter as unknown as { listTables: () => Promise<string[]> }
    ).listTables();
  } catch {
    return [];
  }
}

/** Load a migration's paired target snapshot, or null if absent. */
async function loadTargetSnapshot(
  metaDir: string,
  name: string
): Promise<SnapshotFile | null> {
  const file = `${name}.snapshot.json`;
  const filePath = resolve(metaDir, file);

  // Check if file exists first
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    // File not found - treat as no snapshot (apply SQL verbatim)
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw NextlyError.internal({ cause: err as Error });
  }

  // Detect snapshot format before parsing
  // - Drift snapshots have { version, migrationHash, snapshot: { tables: [...] } }
  // - Custom metadata snapshots (e.g., blog template) have { collections, singles }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Invalid JSON - let parseSnapshotFile handle the error reporting
  }

  // If it looks like a custom metadata format (has collections/singles, no migrationHash),
  // treat as no snapshot so migration runs verbatim
  if (
    parsed &&
    typeof parsed === "object" &&
    !("migrationHash" in parsed) &&
    ("collections" in parsed || "singles" in parsed)
  ) {
    return null;
  }

  // Otherwise, parse as a drift snapshot. The whole file, because its
  // `contributions` say which parts of a foreign table the drift check may
  // judge.
  return parseSnapshotFile(content, file);
}

/**
 * Phase 2 — apply pending user migration files via §4.7 drift reconciliation.
 * Walks files in lex order, carrying each file's target snapshot forward as the
 * next file's baseline. Returns the count actually applied.
 */
export async function runFileMigrations(args: {
  adapter: CLIDatabaseAdapter;
  db: unknown;
  dialect: SupportedDialect;
  migrationsDir: string;
  step?: number;
  logger: CommandContext["logger"];
  /**
   * Junction tables the config names outright via `options.junctionTable`.
   *
   * The generated `<mainA>_<mainB>_<field>` shape can be inferred; a custom
   * name cannot. Such a table appears in neither the before nor the target
   * snapshot, so without this it stays in the live scope and the first
   * migration after adoption stops with drift no migration could resolve.
   */
  knownJunctions?: ReadonlySet<string>;
}): Promise<number> {
  const { adapter, db, dialect, migrationsDir, logger } = args;
  // Passing dialect prefers {name}.{dialect}.sql over base {name}.sql when both exist
  const all = await discoverMigrations(migrationsDir, logger, dialect, "app");
  if (all.length === 0) {
    logger.debug("No user migration files found.");
    return 0;
  }

  const repo = new SchemaEventsRepository(db, dialect);
  const metaDir = resolve(migrationsDir, "meta");

  const dz = adapter as unknown as DrizzleAdapter;
  const executeSql = buildSqlExecutor(dz, dialect);

  // Owner rows for the drop guard: an app file dropping a plugin-migrated
  // table is refused whole, before its first statement. Read once; absent
  // registry reads as "nothing is claimed" and refuses nothing, which is a
  // database predating the registry.
  const { SchemaOwnersRepository: OwnersRepoForFiles, tableOwnersByName } =
    await import("../../domains/schema/ownership/schema-owners-repository");
  const fileOwners = tableOwnersByName(
    await new OwnersRepoForFiles(db, dialect).read()
  );

  let before: NextlySchemaSnapshot = EMPTY_SNAPSHOT;
  let beforeContributions: Record<string, ContributedElements> = {};
  let applied = 0;
  let remaining =
    args.step && args.step > 0 ? args.step : Number.POSITIVE_INFINITY;

  for (const m of all) {
    const filename = `${m.name}.sql`;
    const targetFile = await loadTargetSnapshot(metaDir, m.name);
    const target = targetFile?.snapshot ?? null;

    if (await repo.isFileApplied(filename)) {
      // Advance the baseline past applied files.
      if (targetFile) {
        before = targetFile.snapshot;
        beforeContributions = targetFile.contributions ?? {};
      }
      continue;
    }
    if (remaining <= 0) break;

    // Both apply routes run the same whole-file judgement, so a foreign drop
    // is refused identically with or without a paired snapshot.
    assertNoForeignDrops({
      statements: splitSqlStatements(m.upSql, dialect),
      stream: "app",
      owners: fileOwners,
      dialect,
      source: filename,
    });

    if (!target) {
      // No paired snapshot (hand-written migration): run verbatim + record.
      logger.warn(
        `No snapshot for ${filename}; applying verbatim without drift checks.`
      );
      const id = await repo.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename,
        sha256: m.checksum,
      });
      let didApply: boolean;
      try {
        const n = await executeSql(m.upSql);
        didApply = await repo.markApplied(id, {
          statementsExecuted: n,
          uniqueFilename: filename,
        });
      } catch (err) {
        await repo.markFailed(id, {
          // Bounded, and without logContext: this row is persisted and is
          // served back by the schema-journal endpoint, so it keeps the code,
          // message and cause chain but not the arbitrary identifiers a log
          // context can carry. An unbounded write could also fail here and
          // leave the migration with no recorded failure at all.
          errorMessage: truncateErrorMessage(
            describeError(err, { context: false })
          ),
        });
        throw err;
      }
      if (didApply) {
        applied++;
        remaining--;
        logger.success(`Applied ${filename}`);
      } else {
        // Another run applied this file first (concurrent-apply race); our row
        // was recorded as superseded. Don't double-count or report a false apply.
        logger.warn(
          `${filename} was already applied by a concurrent run; skipping.`
        );
      }
      continue;
    }

    // Recompute the managed-table scope per file: tables created by earlier
    // migrations in THIS run must be visible to this file's drift check.
    // Capturing it once before the loop left it empty on a fresh DB, so the
    // 2nd+ migration saw its tables as "absent" and aborted with false drift.
    const liveTables = await safeListTables(adapter);
    // Managed main tables only, for the same reason `migrate:resolve` uses
    // this predicate: a localized companion never appears in the snapshot this
    // is diffed against, so including one reports drift that is not there.
    // Junctions are excluded alongside companions: neither is declared by
    // config, so neither can appear in the snapshot this is compared against,
    // and including one reports drift that no migration could ever resolve.
    //
    // The snapshots on either side of this file ARE the declaration, so a
    // table named in them is a real one however much its name resembles the
    // `<mainA>_<mainB>_<field>` shape a relationship produces.
    const declared = new Set([
      ...before.tables.map(t => t.name),
      ...target.tables.map(t => t.name),
    ]);
    const managed = snapshotComparableTables(
      liveTables,
      declared,
      args.knownJunctions
    );
    // Tables the app only contributes to are judged on the app's elements
    // alone; see `narrowToContributions`.
    const sides = narrowToContributions({
      before,
      target,
      live: await introspectLiveSnapshot(db, dialect, managed),
      contributions: mergeContributions(
        beforeContributions,
        targetFile?.contributions ?? {}
      ),
    });
    await reconcileFile({
      file: { filename, sql: m.upSql, path: m.filePath, sha256: m.checksum },
      before: sides.before,
      target: sides.target,
      live: sides.live,
      repo,
      executeSql,
    });
    before = target;
    beforeContributions = targetFile?.contributions ?? {};
    applied++;
    remaining--;
    logger.success(`Applied ${filename}`);
  }

  return applied;
}

async function discoverMigrations(
  migrationsDir: string,
  logger: CommandContext["logger"],
  dialect?: SupportedDialect,
  source: MigrationSource = "app"
): Promise<ParsedMigration[]> {
  // Use shared migration discovery to group dialect variants
  const groups = await discoverMigrationGroups(migrationsDir);
  const migrations: ParsedMigration[] = [];

  // Process each migration group in sorted order
  for (const baseName of getSortedBaseNames(groups)) {
    const group = groups.get(baseName)!;
    const selectedFile = selectVariant(group.variants, dialect);

    if (!selectedFile) {
      logger.warn(`No suitable migration file found for ${baseName}`);
      continue;
    }

    const filePath = resolve(migrationsDir, selectedFile);

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parseMigrationFile(baseName, filePath, content, source);
      migrations.push(parsed);
    } catch (error) {
      // A declared intent this build cannot read has to stop the run. Dropping the file with a
      // warning, as an unreadable file is dropped, would let every later migration apply and the
      // run report success while the transition this one describes never happened.
      if (isLocalizationIntentRefusal(error)) throw error;
      logger.warn(
        `Failed to parse migration file ${selectedFile}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Sort migrations by name to ensure consistent ordering
  migrations.sort((a, b) => a.name.localeCompare(b.name));

  return migrations;
}

function parseMigrationFile(
  name: string,
  filePath: string,
  content: string,
  source: MigrationSource = "app"
): ParsedMigration {
  const checksum = createHash("sha256").update(content).digest("hex");

  const checksumMatch = content.match(/^-- Checksum:\s*([a-f0-9]+)/m);
  const originalChecksum = checksumMatch?.[1];

  const { collections, singles, components } = parseEntityHeaders(content);

  const timestampMatch = name.match(/^(\d{8}_\d{6})/);
  const timestamp = timestampMatch?.[1] ?? name;

  const { upSql, downSql } = parseSqlSections(content);
  const localization = parseLocalizationIntent(content, `${name}.sql`);

  return {
    name,
    filePath,
    upSql,
    downSql,
    checksum,
    originalChecksum,
    collections,
    singles,
    components,
    timestamp,
    source,
    ...(localization === null ? {} : { localization }),
  };
}

export function parseSqlSections(content: string): {
  upSql: string;
  downSql: string;
} {
  const lines = content.split("\n");

  let upLines: string[] = [];
  const downLines: string[] = [];
  let currentSection: "none" | "up" | "down" = "none";

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Handle both "-- UP" and "-- UP:" formats
    if (
      trimmedLine === "-- UP" ||
      trimmedLine.startsWith("-- UP ") ||
      trimmedLine.startsWith("-- UP:")
    ) {
      currentSection = "up";
      continue;
    }
    // Handle both "-- DOWN" and "-- DOWN:" formats
    if (
      trimmedLine === "-- DOWN" ||
      trimmedLine.startsWith("-- DOWN ") ||
      trimmedLine.startsWith("-- DOWN:")
    ) {
      currentSection = "down";
      continue;
    }

    if (currentSection === "up") {
      upLines.push(line);
    } else if (currentSection === "down") {
      downLines.push(line);
    }
  }

  if (upLines.length === 0 && downLines.length === 0) {
    upLines = lines.filter(
      line =>
        !line.trim().startsWith("-- Migration:") &&
        !line.trim().startsWith("-- Generated") &&
        !line.trim().startsWith("-- Dialect:") &&
        !line.trim().startsWith("-- Checksum:") &&
        !line.trim().startsWith("-- Collections:") &&
        !line.trim().startsWith("-- Singles:") &&
        // Only reached by a file with no `-- UP` marker at all. Without this the declared intent
        // would be handed to the SQL splitter as though it were a statement.
        !line.trim().startsWith(LOCALIZATION_INTENT_HEADER)
    );
  }

  return {
    upSql: upLines.join("\n").trim(),
    downSql: downLines.join("\n").trim(),
  };
}

export async function executeTransaction(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  fn: () => Promise<void>
): Promise<void> {
  const beginSql =
    dialect === "mysql" ? "START TRANSACTION" : "BEGIN TRANSACTION";
  const commitSql = "COMMIT";
  const rollbackSql = "ROLLBACK";

  try {
    await adapter.executeQuery(beginSql);
    await fn();
    await adapter.executeQuery(commitSql);
  } catch (error) {
    try {
      await adapter.executeQuery(rollbackSql);
    } catch {
      // Ignore rollback errors
    }
    throw error;
  }
}

/**
 * Whether a `--` line comment begins at `index`.
 *
 * MySQL is the odd one out: it starts a comment at `--` only when the next
 * character is whitespace or a control character, so `n--1` is `n - -1` rather
 * than a comment. Postgres and SQLite comment on any `--`. Treating MySQL like
 * the others would swallow the rest of that line, take its semicolon with it,
 * and hand the driver two statements in one string.
 *
 * One predicate rather than two, because the line filter and the character scan
 * both need this answer and a second copy would drift from this one.
 */
function isLineCommentAt(
  text: string,
  index: number,
  dialect?: SupportedDialect
): boolean {
  if (text[index] !== "-" || text[index + 1] !== "-") return false;
  if (dialect !== "mysql") return true;
  const next = text[index + 2];
  // End of input closes the statement anyway, so `--` with nothing after it is
  // a comment for this purpose.
  if (next === undefined) return true;
  // Whitespace or a control character, which is MySQL's rule verbatim. Written as
  // a code-point comparison rather than a regex range: a control character inside
  // a pattern is unreadable in source and `no-control-regex` rejects it.
  // A third `-` does NOT qualify — `n---1` is arithmetic rather than a comment.
  return /\s/.test(next) || next.charCodeAt(0) <= 0x1f;
}

/**
 * The character that CLOSES the quoted region this character opens, or
 * undefined when it opens none.
 *
 * `'` and `"` close with themselves everywhere. The identifier forms are
 * dialect-specific: SQLite reads `[...]` as a quoted identifier while Postgres
 * reads `[` as an array subscript, and MySQL uses backticks where Postgres has
 * no such form.
 */
function quoteOpenerAt(
  char: string | undefined,
  dialect?: SupportedDialect
): string | undefined {
  if (char === "'" || char === '"') return char;
  if (dialect === "sqlite" && char === "[") return "]";
  if (dialect === "mysql" && char === "`") return "`";
  return undefined;
}

/**
 * Whether a string literal opening at `index` honours backslash escapes.
 *
 * 🔴 A PROPERTY OF THE LITERAL, not of the dialect alone. MySQL escapes with
 * backslashes in every string; SQLite never does; PostgreSQL does so only in an
 * `E'...'` escape string and treats a backslash in an ordinary literal as an
 * ordinary character. Deciding by dialect alone is wrong in both directions --
 * it mis-splits a valid PostgreSQL escape string, and applying parity to every
 * dialect mis-splits an ordinary value ending in a backslash.
 */
function opensBackslashEscapedString(
  text: string,
  index: number,
  opener: string,
  dialect: SupportedDialect | undefined
): boolean {
  // A quoted IDENTIFIER never escapes — a backtick or a bracket delimits a name,
  // not a literal — so only the two literal quotes are candidates.
  if (opener !== "'" && opener !== '"') return false;
  // 🔴 MySQL escapes in BOTH literal quotes. Under its default SQL mode a
  // double quote also delimits a string, so backslash handling has to apply to
  // whichever of the two opened the region. Gating on the single quote alone
  // leaves `SELECT "left \"; right"` splitting at the semicolon INSIDE the
  // value.
  if (dialect === "mysql") return true;
  if (dialect !== "postgresql") return false;
  // PostgreSQL's escape strings are single-quoted only: `E"…"` is not one.
  if (opener !== "'") return false;
  const prev = text[index - 1];
  if (prev !== "E" && prev !== "e") return false;
  // Not part of a longer word: `VALUES (E'x')` opens an escape string, while an
  // identifier merely ending in `e` before a literal does not.
  const before = text[index - 2];
  return before === undefined || !/[A-Za-z0-9_$]/.test(before);
}

/**
 * Whether a quote at `index` CLOSES the literal it appears in.
 *
 * The two questions — does this literal escape at all, and is this particular
 * quote escaped — are answered here rather than in the scanning loop, which is
 * long enough that one more condition inside it is one more thing to read past.
 */
function closesLiteral(
  text: string,
  index: number,
  escapesWithBackslash: boolean
): boolean {
  return !(escapesWithBackslash && precededByOddBackslashes(text, index));
}

/**
 * Whether the character at `index` is escaped by the backslash run before it.
 *
 * 🔴 PARITY, not the single preceding character. A doubled backslash is one
 * LITERAL backslash — which is how MySQL string escaping writes it — so a value
 * ending in a backslash puts `\\` immediately before its closing quote.
 * Reading only that last character calls the quote escaped, leaves the splitter
 * inside a string it has actually left, swallows the statement's semicolon, and
 * concatenates the next statement onto it. A driver with multi-statements
 * disabled then rejects the pair, after earlier statements in the same file
 * have already run.
 *
 * An EVEN run means the backslashes escape each other and the character stands
 * on its own; an odd run means the last one escapes it.
 */
function precededByOddBackslashes(text: string, index: number): boolean {
  let run = 0;
  for (let k = index - 1; k >= 0 && text[k] === "\\"; k -= 1) run += 1;
  return run % 2 === 1;
}

/** Where a scan currently stands with respect to an open string literal. */
type LiteralState = {
  inString: boolean;
  stringChar: string;
  escapesWithBackslash: boolean;
};

/**
 * Advance `state` across the character at `index`.
 *
 * The splitter and the line pre-scan both have to agree about where a literal
 * begins and ends; two copies of this decision would drift, and the drift would
 * be silent because each looks correct beside its own caller.
 */
function advanceLiteralState(
  text: string,
  index: number,
  dialect: SupportedDialect | undefined,
  state: LiteralState
): number {
  const char = text[index];
  if (!state.inString) {
    const opener = quoteOpenerAt(char, dialect);
    if (opener) {
      state.inString = true;
      state.stringChar = opener;
      // Recorded when the literal OPENS: the `E` prefix is only visible here,
      // and by the closing quote it is long past.
      state.escapesWithBackslash = opensBackslashEscapedString(
        text,
        index,
        opener,
        dialect
      );
    }
    return 1;
  }

  if (char !== state.stringChar) return 1;

  // Backslash-escaped: an ordinary character that happens to be the delimiter.
  if (!closesLiteral(text, index, state.escapesWithBackslash)) return 1;

  // 🔴 A DOUBLED delimiter escapes the delimiter and does NOT leave the
  // literal. Closing on the first and reopening on the second looks harmless
  // -- the state toggles twice and comes back correct -- but the REOPENED
  // literal is a different one: `escapesWithBackslash` is recorded from the
  // prefix at the opening quote, and the second quote of a pair is no longer
  // adjacent to the `E` of a Postgres escape string. The mode is silently
  // lost, so a later `\'` reads as the closing quote and the statement is cut
  // at the next semicolon INSIDE the value.
  if (text[index + 1] === state.stringChar) return 2;

  state.inString = false;
  return 1;
}

/**
 * End index (exclusive) of the comment beginning at `index`, or -1 if none.
 *
 * Both comment forms in one place because a scan that knows about `--` and not
 * about a block comment disagrees with one that knows about both -- and an
 * apostrophe inside `/* it's a note *\/` then reads as an opening quote,
 * putting the rest of the file "inside a literal" for that scan alone.
 */
function commentEndAt(
  text: string,
  index: number,
  dialect?: SupportedDialect
): number {
  if (isLineCommentAt(text, index, dialect)) {
    const lineEnd = text.indexOf("\n", index);
    return lineEnd === -1 ? text.length : lineEnd;
  }
  if (text[index] === "/" && text[index + 1] === "*") {
    const close = text.indexOf("*/", index + 2);
    return close === -1 ? text.length : close + 2;
  }
  return -1;
}

/**
 * For every character of `sql`, whether it sits inside a string literal.
 *
 * 🔴 The cleanup below both DROPS lines and REWRITES them, and each is an edit
 * to whatever it touches. A description carrying a comment marker or a
 * breakpoint marker is data, and editing it stores a silently truncated value
 * in the replayed database -- the migration still succeeds, so nothing reports
 * it. A per-LINE answer is not enough: a literal can open midway through a line
 * that began as ordinary SQL.
 */
function literalMask(sql: string, dialect?: SupportedDialect): boolean[] {
  const mask: boolean[] = new Array(sql.length).fill(false);
  const state: LiteralState = {
    inString: false,
    stringChar: "",
    escapesWithBackslash: false,
  };

  for (let i = 0; i < sql.length; i++) {
    if (!state.inString) {
      const commentEnd = commentEndAt(sql, i, dialect);
      if (commentEnd !== -1) {
        i = commentEnd - 1;
        continue;
      }
    }
    const consumed = advanceLiteralState(sql, i, dialect, state);
    mask[i] = state.inString;
    if (consumed === 2) {
      mask[i + 1] = state.inString;
      i += 1;
    }
  }

  return mask;
}

/** Remove breakpoint markers that lie OUTSIDE a literal, leaving data intact. */
function stripMarkersOutsideLiterals(
  line: string,
  lineStart: number,
  mask: boolean[]
): string {
  const MARKER = "--> statement-breakpoint";
  let out = "";
  for (let i = 0; i < line.length; i++) {
    if (!mask[lineStart + i] && line.startsWith(MARKER, i)) {
      i += MARKER.length - 1;
      continue;
    }
    out += line[i];
  }
  return out;
}

export function splitSqlStatements(
  sql: string,
  dialect?: SupportedDialect
): string[] {
  // Remove Drizzle's statement breakpoint markers and SQL comments.
  // drizzle-kit uses two marker patterns in generated migration SQL:
  //   1. Standalone: `--> statement-breakpoint` on its own line (between CREATE TABLE blocks)
  //   2. Inline: `SQL_STATEMENT;--> statement-breakpoint` on the same line (after CREATE INDEX/ALTER)
  // Both must be cleaned out before executing, otherwise the marker text
  // ends up as invalid SQL in the next statement.
  // Where every literal sits, so neither half of the cleanup edits data.
  const mask = literalMask(sql, dialect);
  let lineStart = 0;
  const cleanedSql = sql
    .split("\n")
    .map(line => {
      const entry = { line, start: lineStart };
      lineStart += line.length + 1;
      return entry;
    })
    .filter(({ line, start }) => {
      // A line that BEGINS inside a literal is a continuation of a value.
      if (mask[start]) return true;
      const trimmed = line.trim();
      if (trimmed.startsWith("--> statement-breakpoint")) return false;
      // Remove pure SQL comment lines (but keep lines that have SQL after comments)
      if (
        isLineCommentAt(trimmed, 0, dialect) &&
        !trimmed.includes("CREATE") &&
        !trimmed.includes("ALTER") &&
        !trimmed.includes("DROP") &&
        !trimmed.includes("INSERT")
      )
        return false;
      return true;
    })
    // Strip inline markers (pattern 2) that appear after semicolons on the
    // same line, e.g. `CREATE INDEX ...;--> statement-breakpoint`. Without
    // this, the text after the semicolon pollutes the next accumulated
    // statement and causes a MySQL syntax error. Per OCCURRENCE rather than
    // per line: a literal can open midway through a line of ordinary SQL, and
    // rewriting the whole line edits the value inside it.
    .map(({ line, start }) => stripMarkersOutsideLiterals(line, start, mask))
    .join("\n");

  const statements: string[] = [];
  let current = "";
  const state: LiteralState = {
    inString: false,
    stringChar: "",
    escapesWithBackslash: false,
  };

  for (let i = 0; i < cleanedSql.length; i++) {
    const char = cleanedSql[i];

    // Comments are copied through verbatim without being scanned, because the
    // characters inside one are prose rather than SQL. An apostrophe in a
    // retained comment ("SQLite doesn't support ...") would otherwise open a
    // string that never closes, and every semicolon after it stops separating
    // statements — the whole file then reaches the driver as one statement.
    if (!state.inString && isLineCommentAt(cleanedSql, i, dialect)) {
      const lineEnd = cleanedSql.indexOf("\n", i);
      const end = lineEnd === -1 ? cleanedSql.length : lineEnd;
      current += cleanedSql.slice(i, end);
      i = end - 1;
      continue;
    }
    if (!state.inString && char === "/" && cleanedSql[i + 1] === "*") {
      const close = cleanedSql.indexOf("*/", i + 2);
      const end = close === -1 ? cleanedSql.length : close + 2;
      current += cleanedSql.slice(i, end);
      i = end - 1;
      continue;
    }

    // Quoted IDENTIFIERS count as quoted regions too, not just string literals.
    // SQLite accepts `[a--b]` and MySQL accepts a backtick-quoted `a--b`; with
    // only ' and " tracked, the dashes inside one read as a comment opener and
    // the statement's semicolon disappears into it.
    //
    // The bracket and backtick forms are applied per dialect rather than
    // everywhere: `[` is not a quote in Postgres, where it subscripts an array,
    // so treating it as one there would swallow ordinary SQL.
    const consumed = advanceLiteralState(cleanedSql, i, dialect, state);
    if (consumed === 2) {
      current += cleanedSql[i] + cleanedSql[i + 1];
      i += 1;
      continue;
    }

    if (char === ";" && !state.inString) {
      const statement = current.trim();
      const hasSQL =
        /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|TRUNCATE|GRANT|REVOKE)\b/i.test(
          statement
        );
      if (statement && hasSQL) {
        statements.push(statement);
      }
      current = "";
    } else {
      current += char;
    }
  }

  const finalStatement = current.trim();
  const hasFinalSQL =
    /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|TRUNCATE|GRANT|REVOKE)\b/i.test(
      finalStatement
    );
  if (finalStatement && hasFinalSQL) {
    statements.push(finalStatement);
  }

  return statements;
}

// F11: dropped local generateUUID() in favor of node:crypto's randomUUID,
// which is what the rest of the codebase uses (matches schema/migration-journal
// pattern from F8 PR 5). Avoids re-implementing UUID v4 generation.

/**
 * Register the migrate command with the program
 *
 * @param program - Commander program instance
 */
export function registerMigrateCommand(program: Command): void {
  program
    .command("migrate")
    .description("Run all pending database migrations")
    .option("--dry-run", "Show what would be migrated without executing", false)
    .option("--step <n>", "Run only N migrations", parseInt)
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before running",
      false
    )
    .option(
      "--repair-localization",
      "Copy existing content into the translation tables of localized entities that have no record of transitioning (for installs that enabled localization before Nextly recorded it)",
      false
    )
    .action(async (cmdOptions: MigrateCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      const resolvedOptions: ResolvedMigrateOptions = {
        ...cmdOptions,
        config: globalOpts.config,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
        cwd: globalOpts.cwd,
      };

      try {
        await runMigrate(resolvedOptions, context);
      } catch (error) {
        context.logger.error(describeError(error));
        process.exit(1);
      }
    });
}
