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

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { resolveRegistryNameFromCatalog } from "../../domains/field-groups/storage/resolve-storage-names";
import { countPasswordsStoredAsGiven } from "../../domains/field-groups/stored-plain-passwords";
import {
  isLocalizationIntentRefusal,
  parseLocalizationIntent,
  type LocalizationMigrationIntent,
} from "../../domains/i18n/migration/migration-intent";
import { sharedFileRecoveryAdvice } from "../../domains/i18n/migration/plan-field-leaves-migration";
import { readRecordedEntities } from "../../domains/i18n/migration/recorded-before";
import {
  filesWithinStep,
  stepContinuedNotice,
} from "../../domains/i18n/migration/step-windows";
import { isPluginLedgerRow } from "../../domains/schema/events/ledger-scope";
import { assertNoLegacyBookkeeping } from "../../domains/schema/events/legacy-detection";
import {
  removedOnPurpose,
  standingsByFilename,
} from "../../domains/schema/events/migration-state";
import { ensureSchemaEventsTable } from "../../domains/schema/events/schema-events-ddl";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
} from "../../domains/schema/events/schema-events-repository";
import type { ExtensionSchema } from "../../domains/schema/extension/build-extension-schema";
import { compileExtensionSchema } from "../../domains/schema/extension/publish";
import {
  appliedChecksums,
  checksumOf,
} from "../../domains/schema/migrate/applied-checksums";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { reconcileCore } from "../../domains/schema/migrate/core-reconcile";
import {
  consentToCover,
  describeDeletion,
  resolveDataLossConsent,
  type DataLossConsent,
  type Deletion,
} from "../../domains/schema/migrate/data-loss-consent";
import { addDocumentColumns } from "../../domains/schema/migrate/document-columns";
import {
  assertNotPartiallyApplied,
  applyFailedError,
  reconcileFile,
  runRecordedAttempt,
} from "../../domains/schema/migrate/drift-reconcile";
import {
  readDeletionFacts,
  runDeletions,
  runStatements,
} from "../../domains/schema/migrate/file-deletions";
import {
  outsideTransactionNotice,
  runMigrationStatements,
  type MigrationUnit,
} from "../../domains/schema/migrate/migration-transaction";
import {
  readOldBuilderLedger,
  type ChangedOldBuilderFile,
  type OldBuilderLedger,
} from "../../domains/schema/migrate/old-builder-ledger";
import {
  assertPluginHistories,
  assertPluginListsSound,
} from "../../domains/schema/migrate/plugin/plugin-history";
import { pluginModuleStatements } from "../../domains/schema/migrate/plugin/plugin-migration";
import { pluginSchemaVersionFromLedger } from "../../domains/schema/migrate/plugin/plugin-schema-version";
import {
  appliedPluginShas,
  pendingPluginModules,
  pluginMigrationArgs,
  previewPluginMigrations,
  runPluginMigrations,
  type PluginMigrationRunResult,
  type PluginMigrationSet,
  type PluginModulePreview,
} from "../../domains/schema/migrate/plugin/run-plugin-migrations";
import { reconcileMigrationMetadata } from "../../domains/schema/migrate/reconcile-metadata";
import {
  findRegistryDisagreements,
  registryDisagreementLines,
} from "../../domains/schema/migrate/registry-consistency";
import {
  previewRequiredColumns,
  refuseRequiredColumnsOverNulls,
} from "../../domains/schema/migrate/required-column-guard";
import { resolveDeclaredSchema } from "../../domains/schema/migrate/resolved-schema";
import {
  assertRunnableStatements,
  marksNoTransaction,
  splitSqlStatements,
  statementRefusals,
} from "../../domains/schema/migrate/split-sql";
import { parseSqlSections } from "../../domains/schema/migrate/sql-sections";
import { readLiveSchema } from "../../domains/schema/migrate/statement-judgement";
import { refuseUnresolvedAttempts } from "../../domains/schema/migrate/unresolved-attempt";
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
import {
  assertNoForeignDrops,
  readLiveColumns,
  readLiveElements,
  readLiveIndexTables,
  readLiveTables,
} from "../../domains/schema/ownership/drop-guard";
import {
  createOwnerRegistry,
  ownerRecordKey,
} from "../../domains/schema/ownership/owner-registry";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import type {
  ContributedElements,
  NextlySchemaSnapshot,
} from "../../domains/schema/pipeline/diff/types";
import { readDdlEventTriggers } from "../../domains/schema/pipeline/live-table-facts";
import {
  forceUnlock,
  withMigrateLock,
} from "../../domains/schema/pipeline/locks";
import { snapshotComparableTables } from "../../domains/schema/pipeline/managed-tables";
import { provisionUserFieldStorage } from "../../domains/users/services/provision-user-field-storage";
import { UserExtSchemaService } from "../../domains/users/services/user-ext-schema-service";
import { UserFieldDefinitionService } from "../../domains/users/services/user-field-definition-service";
import { NextlyError, describeError } from "../../errors";
import type { UserConfig } from "../../users/config/types";
import { CliError, exitWithError } from "../errors";
import type { CommandContext } from "../program";
import {
  openCommandAdapter,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
  type SupportedDialect,
} from "../utils/adapter";
import { databaseEnvOrThrow } from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";
import {
  askToDeleteInTerminal,
  deletionSource,
  eventTriggerNotice,
  judgeRunDeletions,
  textDigest,
  type Agreement,
  type DeletionSource,
  readDataLossConsent,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";
import { formatDuration, formatCount, type Logger } from "../utils/logger";
import {
  migrationFilesInRunOrder,
  builderMigrationRemedy,
  oldBuilderFileLine,
  partialBuilderFileLacks,
  readMigrationFolder,
  type DeclaredNames,
} from "../utils/migration-discovery";
import { installRegistryResolver } from "../utils/registry-resolver";

import {
  plainTextPasswordCleanup,
  plainTextPasswordNotice,
} from "./clear-plaintext-passwords";
import { commandRun } from "./command-run";
import {
  storedPasswordsNotice,
  storedPasswordsOn,
  storedPasswordTotal,
} from "./upgrade-steps/stored-passwords";

// Re-exported for the callers that import it from this command. Other
// commands import it from cli/utils, which does not pull this one in.
export { installRegistryResolver };

/**
 * Options specific to the migrate command
 */
export interface MigrateCommandOptions {
  /**
   * Show what would be migrated without executing; unset means a real run.
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

  /**
   * Consent to the data a migration file deletes: alone, every deletion of
   * the run; with tables and `table.column` pairs, only those
   * (`--accept-data-loss=posts,pages.summary`). Same as
   * `NEXTLY_ACCEPT_DATA_LOSS`.
   */
  acceptDataLoss?: AcceptDataLossOption;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedMigrateOptions extends MigrateCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
  /**
   * Throw a failure instead of ending the process with it, for a command that
   * runs `nextly migrate` inside work of its own: `migrate:fresh` holds the
   * schema lock around it and must release the lock before it exits. The
   * caller ends the command with the error, through `exitWithError`.
   */
  throwOnFailure?: boolean;
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
  /**
   * False when the file's first line is `-- nextly:no-transaction`: its UP
   * and DOWN run outside a transaction, statement by statement.
   */
  transaction: boolean;
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

  // Every failure below ends here: the command's exit, or with
  // `throwOnFailure` a throw its caller ends the command with.
  // Annotated so the checker reads a call to it as ending the path.
  const fail: (error: unknown, status?: 1 | 2 | 3) => never = (
    error,
    status = 1
  ) => {
    if (options.throwOnFailure === true) throw error;
    return exitWithError(logger, error, status);
  };

  logger.debug("Validating database environment...");
  let dbValidation: ReturnType<typeof databaseEnvOrThrow>;
  try {
    dbValidation = databaseEnvOrThrow();
  } catch (error) {
    fail(error);
  }

  const dialect = dbValidation.dialect;
  logger.debug(`Database dialect: ${dialect}`);

  logger.info("Loading configuration...");

  let configResult: Awaited<ReturnType<typeof loadConfig>>;
  try {
    configResult = await loadConfig({
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    });
  } catch (error) {
    fail(error);
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
    const opened = await openCommandAdapter(
      {
        dialect: dbValidation.dialect,
        databaseUrl: dbValidation.databaseUrl,
        logger: options.verbose ? logger : undefined,
        dryRun: options.dryRun,
      },
      logger
    );
    // A dry run whose database is not there has said so, and ends here.
    if (opened === undefined) return;
    adapter = opened;
    logger.success("Database connected");
  } catch (error) {
    fail(error);
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
      await previewMigrate({
        adapter,
        db,
        dialect,
        migrationsDir: appMigrationsDir,
        declared: {
          junctions: resolvedSchema.junctionsByEntity,
          tables: resolvedSchema.declaredTables,
        },
        plugins: configResult.config.plugins ?? [],
        step: options.step,
        logger,
      });
      logger.success("Dry run complete (no changes made).");
      return;
    }

    // Operator-set override; never in CI config (spec §4.6.1).
    const allowCoreDestructive = process.env.NEXTLY_ALLOW_CORE_DESTRUCTIVE === "1"; // prettier-ignore
    // The retired-table cleanup has flags of its own: removing those tables
    // and losing rows still in them are each a separate decision from
    // accepting a core schema change. Read here so all three live at one edge.
    const dropRetiredAuthTables = process.env.NEXTLY_DROP_RETIRED_AUTH_TABLES === "1"; // prettier-ignore
    const allowDropNonEmptyRetired = process.env.NEXTLY_DROP_NONEMPTY_RETIRED === "1"; // prettier-ignore

    const dz = adapter as unknown as DrizzleAdapter & {
      tableExists: (n: string) => Promise<boolean>;
    };

    // Clear a stale lock first when --force-unlock is passed (e.g. left by a
    // crashed prior run), then proceed with the normal migrate.
    await maybeForceUnlock(options, db, dialect);

    // Every entity as the registry records it before any file applies, so the companion pass
    // after the migrations can tell a field this run newly translates from one translated before.
    const recordedBefore = await readRecordedEntities(
      adapter as unknown as DrizzleAdapter,
      configResult.config,
      error =>
        logger.warn(
          `The registry could not be read, so no translations column is judged this run: ${describeError(error)}`
        )
    );

    // Delegate to the non-exiting core (Phase 1 + Phase 2 under the lock). The
    // ledger (`nextly_schema_events`) is bootstrapped out-of-band by
    // `ensureLedger` — AFTER applyCore (so pushSchema doesn't see it as an
    // extraneous table) and BEFORE the event is recorded; idempotent. A thrown
    // error here maps to a non-zero CLI exit (the core itself never exits).
    try {
      const extensionSchema = await compileExtensionSchema({
        dialect,
        plugins: configResult.config.plugins ?? [],
        config: configResult.config,
        logger: { warn: m => logger.warn(m) },
      });
      const { applied, pluginModulesApplied, metadata } = await migrateCore({
        extensionSchema,
        dialect,
        db,
        adapter,
        migrationsDir: appMigrationsDir,
        logger,
        ...(await pluginMigrationArgs(configResult.config.plugins ?? [])),
        // A run that finds the schema lock held waits about a minute for it, then stops naming
        // what holds it.
        lockMode: "wait",
        // The command's interrupt ends the process, so the lock is released first rather than
        // left for the next run to wait out.
        lockReleaseOnInterrupt: true,
        ttlSeconds: configResult.config.db.migrateLockTtlSeconds,
        // A custom `options.junctionTable` name cannot be inferred from any
        // convention, and such a table is in no snapshot — so the drift check
        // has to be told about it or it reports a difference no migration can
        // resolve.
        // A file with a Builder name the signature does not recognise is
        // refused, never run as written.
        refuseUnrecognisedBuilderFiles: true,
        knownJunctions: resolvedSchema.knownJunctions,
        declared: {
          junctions: resolvedSchema.junctionsByEntity,
          tables: resolvedSchema.declaredTables,
        },
        allowDestructive: allowCoreDestructive,
        ...commandLineConsent(options, logger),
        dropRetiredAuthTables,
        allowDropNonEmptyRetired,
        ensureLedger: () => ensureSchemaEventsTable(dz),
        step: options.step,
        // A translations column already in place that cannot hold a field the config newly
        // translates, judged as the files left it and before the registry records them: refused
        // here, the registry keeps its definitions and the next run is refused the same way.
        // Judged only once no file is pending, since a later one may still change the column.
        beforeMetadata: async () => {
          const pending = await findPendingFiles(
            adapter,
            db,
            dialect,
            appMigrationsDir,
            logger,
            {
              junctions: resolvedSchema.junctionsByEntity,
              tables: resolvedSchema.declaredTables,
            }
          );
          if (pending.length > 0) return;
          const { refuseCompanionColumnsThatCannotHold } = await import(
            "../../domains/i18n/runtime/companion-io"
          );
          await refuseCompanionColumnsThatCannotHold(
            adapter as unknown as DrizzleAdapter,
            configResult.config,
            recordedBefore
          );
        },
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

      // Both streams count: a run that executed only plugin modules did
      // migrate, and saying "nothing to migrate" after it is untrue.
      const ran = applied + pluginModulesApplied;
      logger.success(
        ran === 0
          ? metadata.stillPending > 0 || metadata.unreadable.length > 0
            ? "No migration files to apply."
            : "Nothing to migrate. Database is up to date."
          : `${formatCount(ran, "migration")} applied.`
      );
    } catch (err) {
      fail(err, migrateExitCode(err));
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
        logger,
        {
          junctions: resolvedSchema.junctionsByEntity,
          tables: resolvedSchema.declaredTables,
        }
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
            recordedBefore,
          }
        );
        // After the migrations too, and for the same reason: the user fields'
        // table follows the config's final schema.
        const userFields = await provisionUserFieldTables(
          configResult.configPath ? configResult.config.users : null,
          adapter as unknown as DrizzleAdapter,
          logger
        );
        if (userFields > 0) {
          logger.info(
            `User fields: storage ready for ${formatCount(userFields, "field")}.`
          );
        }
      }
    } catch (err) {
      fail(err);
    }

    // Read-only, once the run has done its own work: name every registry row
    // whose table or recorded field's column does not exist, and every
    // declared entity with no row. A production start compares none of this,
    // so this is where a deploy hears of it. A comparison that cannot run
    // never fails a migrate that succeeded.
    try {
      for (const line of registryDisagreementLines(
        await findRegistryDisagreements({
          adapter: adapter as unknown as DrizzleAdapter,
          dialect,
          declared: resolvedSchema.entities,
          logger,
        })
      )) {
        logger.warn(line);
      }
    } catch (err) {
      logger.warn(
        `Could not compare the registry with the tables: ${describeError(err)}`
      );
    }

    // Read-only: accounts an earlier release left holding a password as given
    // are counted, and the command that clears them is named. Migrate changes
    // no credential, and a count it cannot read never fails a migrate that
    // succeeded. Here in the CLI run only, never in the core a boot shares.
    try {
      const notice = plainTextPasswordNotice(
        (await plainTextPasswordCleanup(adapter).find()).length
      );
      if (notice) logger.warn(notice);
    } catch (err) {
      logger.warn(
        `Could not check for passwords stored as given: ${describeError(err)}`
      );
    }

    // Read-only too: passwords an earlier release kept as given inside a
    // container are counted, and `nextly upgrade`, which hashes them, is named.
    try {
      const notice = storedPasswordsNotice(
        storedPasswordTotal(
          await countPasswordsStoredAsGiven(
            storedPasswordsOn(adapter as unknown as DrizzleAdapter)
          )
        )
      );
      if (notice) logger.warn(notice);
    } catch (err) {
      logger.warn(
        `Could not check for passwords stored before this release: ${describeError(err)}`
      );
    }

    const duration = Date.now() - startTime;
    logger.divider();
    logger.success(`migrate completed in ${formatDuration(duration)}`);
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Provision `user_ext`, the table the project's user fields are stored in, for
 * the code-defined fields and the ones defined in the admin. `nextly migrate`
 * sets up every production database, and a production boot never changes the
 * schema, so this is the step that gives such a database the table its user
 * fields are read from. Returns how many fields it holds columns for.
 *
 * `users` is null when no config file was loaded. Nothing is done then: the
 * defaults declare no fields, and syncing that empty list would delete every
 * code-defined field's definition, as a migrate run from the wrong folder
 * would otherwise do.
 */
export async function provisionUserFieldTables(
  users: UserConfig | undefined | null,
  adapter: DrizzleAdapter,
  logger: Logger
): Promise<number> {
  if (users === null) return 0;
  const fieldDefService = new UserFieldDefinitionService(adapter, logger);
  return provisionUserFieldStorage({
    codeFields: users?.fields ?? [],
    fieldDefService,
    userExtSchemaService: new UserExtSchemaService(
      adapter.dialect,
      fieldDefService,
      logger
    ),
    db: adapter.getDrizzle(),
  });
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
  /**
   * Every plugin the configuration declares, a plugin shipping no modules
   * included (`pluginMigrationArgs`), so the history check finds a module
   * the ledger records applied for a plugin whose list has since emptied.
   */
  declaredPlugins?: ReadonlySet<string>;
  /**
   * The applied plugin modules the ledger records, by ledger key. Injected
   * for tests; the default reads the ledger (`appliedPluginModules`).
   */
  appliedPluginModulesFn?: () => Promise<ReadonlyMap<string, string | null>>;
  /**
   * The database's enabled DDL event triggers, named beside the deletions a
   * run asks consent for (`eventTriggerNotice`). Injected for tests; the
   * default reads the catalog (`readDdlEventTriggers`).
   */
  readEventTriggersFn?: () => Promise<readonly string[]>;
  dialect: SupportedDialect;
  db: unknown;
  adapter: CLIDatabaseAdapter;
  migrationsDir: string;
  logger: CommandContext["logger"];
  /**
   * What a held schema lock does to this run: `wait` (the default) waits about a minute and then
   * stops naming the holder; `fail-fast` stops at once.
   */
  lockMode?: "fail-fast" | "wait";
  /** The schema lock's lease, in seconds (`db.migrateLockTtlSeconds`). */
  ttlSeconds?: number;
  /** How long `wait` waits for a held lock, in milliseconds. Default about a minute. */
  lockWaitMs?: number;
  /**
   * What holds the lock while this runs, as the refusal another run prints names it. Default
   * `nextly migrate`; the boot migrate step names itself.
   */
  lockCommand?: string;
  /**
   * Release the lock on an interrupt. Asked for by the command, whose interrupt ends the process.
   * Off by default, for the boot migrate step, production or development: it runs inside a server
   * whose shutdown may let the work run on, so it leaves the lock to lapse instead.
   */
  lockReleaseOnInterrupt?: boolean;
  isSettled?: () => Promise<boolean>;
  allowDestructive?: boolean;
  /** NEXTLY_DROP_RETIRED_AUTH_TABLES=1: drop the retired auth tables. */
  dropRetiredAuthTables?: boolean;
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
  /**
   * The consent to the data the run's files delete (`judgeFileDeletions`).
   * Absent, it is read from the environment alone, as a boot reads it.
   */
  consent?: DataLossConsent;
  /** Whether a person is at a terminal to be asked; absent reads as no. */
  interactive?: boolean;
  /** Asks that person a yes-or-no question; only called when `interactive`. */
  askToDelete?: (question: string) => Promise<boolean>;
  /** The unresolved-attempt refusal; injected for tests (`refuseUnresolvedAppAttempts`). */
  refuseUnresolvedAttemptsFn?: typeof refuseUnresolvedAppAttempts;
  /** The applied-file checksum check; injected for tests (`assertAppliedFilesUnchanged`). */
  assertAppliedFilesUnchangedFn?: typeof assertAppliedFilesUnchanged;
  /** The old Builder files' marks; injected for tests (`markOldBuilderFiles`). */
  markOldBuilderFilesFn?: typeof markOldBuilderFiles;
  /** Injected for tests; the default is `assertAppliedFilesPresent`. */
  assertAppliedFilesPresentFn?: typeof assertAppliedFilesPresent;
  /** Junction tables the config names outright; see `runFileMigrations`. */
  knownJunctions?: ReadonlySet<string>;
  /** What the declared schema names, which old Builder files are judged against. */
  declared?: DeclaredNames;
  withLock?: typeof withMigrateLock;
  /** Seam for tests; defaults to the real metadata reconciliation. */
  reconcileMetadataFn?: typeof reconcileMigrationMetadata;
  /**
   * Seam for tests; defaults to recording and retiring element owner rows
   * against the database.
   */
  syncElementOwnersFn?: (deps: MigrateCoreDeps) => Promise<void>;
  /**
   * Seam for tests; defaults to adding the per-document columns each content table lacks
   * (`addDocumentColumns`).
   */
  documentColumnsFn?: (deps: MigrateCoreDeps) => Promise<void>;
  /**
   * Runs inside the lock once the migration files have applied and before their metadata is
   * recorded (Phase 3). A throw stops the run there: the files that ran stay applied and in the
   * ledger, and the registry keeps the definitions it had, so the next run judges the same change
   * again. `nextly migrate` refuses here a translations column that cannot hold a field the config
   * newly translates.
   */
  beforeMetadata?: () => Promise<void>;
  /**
   * Refuse, before anything changes, a pending file with a Schema Builder
   * name and no snapshot that is not recognised as an earlier Builder's
   * (`refuseUnrecognisedBuilderFiles`), rather than run it as written.
   *
   * `nextly migrate` and the production boot pass it. Off by default because
   * the development boot runs this core too, over the files the Builder
   * writes into the project as it saves: there the Builder has already made
   * the change.
   */
  refuseUnrecognisedBuilderFiles?: boolean;
  /** The unrecognised-file refusal; injected for tests (`refuseUnrecognisedBuilderFiles`). */
  refuseUnrecognisedBuilderFilesFn?: typeof refuseUnrecognisedBuilderFiles;
}

export interface MigrateCoreResult {
  applied: number;
  /**
   * Plugin migration modules this run recorded as applied — run, or adopted
   * because the database already stood at their result, as an adopted app
   * file counts in `applied`. Kept apart from `applied`, which counts the
   * app's migration files, so "nothing to migrate" is said only when neither
   * stream recorded anything; a `--step` spent on an adoption is a run that
   * did something.
   */
  pluginModulesApplied: number;
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

/**
 * What `migrate --dry-run` lists: the plugin modules a real run would reach,
 * then the app's pending files, under the one `--step` budget the run spends
 * (`appStepAfter`), in the order the run takes them.
 *
 * The plugin modules come from `pluginMigrationArgs` and
 * `previewPluginMigrations`, which walks them as the plugin phase does, so a
 * pending plugin module is never left out of a preview that a real run then
 * executes. Read-only: an absent ledger reads as nothing applied, rather than
 * being created.
 */
export async function previewMigrate(args: {
  adapter: CLIDatabaseAdapter;
  db: unknown;
  dialect: SupportedDialect;
  migrationsDir: string;
  /** What the run's declared schema names, read as a real run reads them. */
  declared?: DeclaredNames;
  plugins: Parameters<typeof pluginMigrationArgs>[0];
  step?: number;
  logger: CommandContext["logger"];
  /** As `MigrateCoreDeps.readEventTriggersFn`. */
  readEventTriggers?: () => Promise<readonly string[]>;
}): Promise<void> {
  const { adapter, db, dialect, logger } = args;
  const hasLedger = await (
    adapter as unknown as { tableExists: (n: string) => Promise<boolean> }
  ).tableExists("nextly_schema_events");
  const rows = hasLedger
    ? await new SchemaEventsRepository(db, dialect).listFileApplies()
    : [];
  const { pluginMigrationSets, declaredPlugins } = await pluginMigrationArgs(
    args.plugins
  );
  const modules = await previewPluginMigrations(pluginMigrationSets, {
    dialect,
    rows,
    declaredPlugins,
    limit: args.step,
  });
  const pendingModules = modules.filter(module => !module.recorded);

  const appStep = appStepAfter(args.step, pendingModules.length);
  // The files a real run with this step applies, a move out of translation run whole included.
  const pendingFiles =
    appStep === 0
      ? []
      : filesWithinStep(
          (
            await listMigrationFiles(
              adapter,
              db,
              dialect,
              args.migrationsDir,
              logger,
              args.declared
            )
          ).map(({ file, applied }) => ({ file, done: applied })),
          appStep,
          "up"
        ).run;

  logger.newline();
  logger.keyValue(
    "Pending",
    formatCount(pendingModules.length + pendingFiles.length, "migration")
  );
  // The modules a real run applies, then its files, judged as that run's
  // consent judges them: one run, modules first (`judgeFileDeletions`).
  const moduleRuns = pluginModuleUnits(
    pluginMigrationSets,
    appliedPluginShas(rows),
    args.step,
    dialect
  );
  const judged = await pendingRunDeletions(
    [...moduleRuns, ...pendingFiles.map(file => fileUnit(file, dialect))],
    db,
    dialect
  );
  const moduleDeletions = new Map(
    judged
      .slice(0, moduleRuns.length)
      .map(({ unit, deletions }) => [unit.label, deletions])
  );
  previewModules(modules, moduleDeletions, logger);
  await previewFiles(
    judged.slice(moduleRuns.length).map(({ deletions }) => deletions),
    pendingFiles,
    args,
    logger,
    pendingModules.length > 0
  );
  await previewOldBuilderFiles({ ...args, logger });
  if (hasLedger) await previewChangedFiles(rows, args, logger);
  await previewAppHistory(args, logger);
  if (pendingModules.length + pendingFiles.length > 0) {
    await previewEventTriggers(args, logger);
  }
  await previewRetiredImageSizes(db, dialect, logger);
}

/** Each plugin module a real run reaches, with what it would refuse and what it deletes. */
function previewModules(
  modules: readonly PluginModulePreview[],
  deletions: ReadonlyMap<string, readonly Deletion[]>,
  logger: CommandContext["logger"]
): void {
  for (const module of modules) {
    logger.info(
      `  • ${module.filename}${module.recorded ? " (applied)" : ""}${module.transaction ? "" : " (runs outside a transaction)"}`
    );
    for (const refusal of module.refusals) {
      logger.info(`    ✖ a real run would refuse it: ${refusal}`);
    }
    previewDeletions(deletions.get(module.filename) ?? [], logger);
  }
}

/**
 * Each pending app file within the step, with what it deletes (`deletions`,
 * in the same order), and the required columns a real run would refuse it
 * over. `modulesFirst`: plugin modules run before
 * the files, so even the first file is not the first migration applied.
 */
async function previewFiles(
  deletions: readonly (readonly Deletion[])[],
  pendingFiles: readonly ParsedMigration[],
  args: { db: unknown; dialect: SupportedDialect; migrationsDir: string },
  logger: CommandContext["logger"],
  modulesFirst: boolean
): Promise<void> {
  for (const [at, m] of pendingFiles.entries()) {
    previewPendingFile(m, deletions[at] ?? [], args.dialect, logger);
    // The required columns a real run would refuse it over, from the same count: only for the
    // first migration the run applies, since nothing before a later one is run here.
    await previewRequiredColumns(
      args.db,
      args.dialect,
      m,
      logger,
      at > 0 || modulesFirst
    );
  }
}

/**
 * The old Schema Builder files the run ignores, named, and the refusal a real
 * run makes of a pending Builder-named file it does not recognise, before it
 * applies anything, whatever `--step` allows (`refuseUnrecognisedBuilderFiles`).
 */
async function previewOldBuilderFiles(
  args: Parameters<typeof refuseUnrecognisedBuilderFiles>[0]
): Promise<void> {
  await nameOldBuilderFiles(args);
  try {
    await refuseUnrecognisedBuilderFiles(args);
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    args.logger.info(
      `  ✖ a real run would refuse before applying anything: ${error.publicMessage}`
    );
  }
}

/**
 * An applied file edited since it ran stops a real run before it applies
 * anything (`assertAppliedFilesUnchanged`), so the preview names it.
 */
/**
 * The app history checks a real run makes before it applies anything, in its
 * order (`assertAppHistoryHolds`), read-only: an applied migration the folder
 * lacks (exit 3), then an unresolved attempt; the first that refuses is named
 * as the real run's refusal. An applied file edited since it ran is named by
 * `previewChangedFiles`, in its own words.
 */
async function previewAppHistory(
  args: AppHistoryArgs,
  logger: CommandContext["logger"]
): Promise<void> {
  const history = { ...args, command: "nextly migrate" };
  try {
    await assertAppliedFilesPresent(history);
    await refuseUnresolvedAppAttempts(history);
  } catch (error) {
    const refusal = historyRefusalOf(error);
    if (refusal === undefined) throw error;
    logger.info(
      `  ✖ a real run would refuse before applying anything (exit code ${String(migrateExitCode(error))}): ${refusal}`
    );
  }
}

async function previewChangedFiles(
  rows: Parameters<typeof appliedChecksums>[1],
  args: {
    db: unknown;
    dialect: SupportedDialect;
    migrationsDir: string;
    declared?: DeclaredNames;
  },
  logger: CommandContext["logger"]
): Promise<void> {
  const files = await discoverMigrations(
    args.migrationsDir,
    logger,
    args.dialect,
    "app",
    args.declared
  );
  const { changed } = appliedChecksums(
    files.map(m => ({ filename: `${m.name}.sql`, checksum: m.checksum })),
    rows
  );
  for (const filename of changed) {
    logger.info(
      `  ✖ a real run would refuse before applying anything: \`${filename}\` has changed since it was applied (exit code 2). Restore it, or accept the edit with \`nextly migrate:resolve --applied ${filename}\`.`
    );
  }
  // A marked old Builder file that no longer carries the signature is refused
  // with the edited ones.
  const oldBuilder = await readOldBuilderLedger(
    args,
    new SchemaEventsRepository(args.db, args.dialect),
    rows
  );
  for (const c of oldBuilder.changed) {
    logger.info(
      `  ✖ a real run would refuse before applying anything: \`${c.file}\` ${c.change === "content" ? "has changed (exit code 2)" : "has a snapshot beside it"} since it was recognised as a file an earlier Schema Builder wrote.`
    );
  }
}

/** The database's DDL event triggers, named as a real run names them beside its deletions (`eventTriggerNotice`). */
async function previewEventTriggers(
  args: {
    db: unknown;
    dialect: SupportedDialect;
    readEventTriggers?: () => Promise<readonly string[]>;
  },
  logger: CommandContext["logger"]
): Promise<void> {
  const notice = await eventTriggerNotice(
    eventTriggersOf({
      readEventTriggersFn: args.readEventTriggers,
      db: args.db,
      dialect: args.dialect,
    })
  );
  if (notice !== undefined) logger.info(`  ⚠ ${notice}`);
}

/**
 * What a real run does with the retired image-sizes column and table: keeps
 * both, always. `nextly migrate` runs before a new release takes traffic,
 * while the release before it still reads and writes them, so their drop is
 * a step of its own once the new release is serving. Said only while the
 * database has either, read with the helpers that drop decides with.
 */
export async function previewRetiredImageSizes(
  db: unknown,
  dialect: SupportedDialect,
  logger: Pick<CommandContext["logger"], "info">
): Promise<void> {
  const [{ readRetiredObjects }, { DROP_SIZES_COMMAND, REMOVE_SIZES_COMMAND }] =
    await Promise.all([
      import("../../domains/media/retired-image-sizes-store"),
      import("../../domains/media/retired-image-sizes-constants"),
    ]);
  const objects = await readRetiredObjects(db, dialect);
  // Each named only where the database has it: after a drop that stopped
  // between the two, the column can be there without the table.
  const retired = [
    ...(objects.column ? ["column media.sizes"] : []),
    ...(objects.tableRows !== null ? ["table image_sizes"] : []),
  ];
  if (retired.length > 0) {
    logger.info(
      `  • would keep the retired ${retired.join(" and ")}: \`nextly migrate\` never drops ${retired.length === 1 ? "it" : "them"}. Once this release is serving, run \`${REMOVE_SIZES_COMMAND}\`, then \`${DROP_SIZES_COMMAND}\`.`
    );
  }
  // A table of that name not shown to be the retired one is never called
  // so, and nothing drops it.
  if (objects.keptTable !== null) {
    logger.info(
      `  • would keep the table image_sizes, which is not shown to be the one image sizes left (${objects.keptTable}): nothing drops it.`
    );
  }
}

/**
 * One pending file as `migrate --dry-run` lists it: its name, whether it runs
 * outside a transaction, each refusal a real run would make, from the same
 * check, so the preview and the run cannot disagree, and the SQL it would run,
 * as `migrate:down --dry-run` prints the SQL a rollback would run. A file
 * that deletes data is listed with each deletion, read as a real run reads
 * it (`pendingRunDeletions`), and the consent that run needs.
 */
function previewPendingFile(
  m: ParsedMigration,
  deletions: readonly Deletion[],
  dialect: SupportedDialect,
  logger: CommandContext["logger"]
): void {
  logger.info(
    `  • ${m.name}.sql${m.transaction ? "" : " (runs outside a transaction)"}`
  );
  const statements = splitSqlStatements(m.upSql, dialect, m);
  for (const refusal of statementRefusals(statements, dialect, {
    transaction: m.transaction,
    unit: "file",
  })) {
    logger.info(`    ✖ a real run would refuse it: ${refusal.message}`);
  }
  previewDeletions(deletions, logger);
  // The file's own UP section. A run that finds the schema already at the file's target adopts it
  // without running these, and one that finds it at neither end refuses it for drift.
  logger.info(`    UP, as written in the file:\n${m.upSql.trim()}`);
}

/** A unit's deletions as the dry run lists them, with the consent a real run needs; nothing when none. */
function previewDeletions(
  deletions: readonly Deletion[],
  logger: Pick<CommandContext["logger"], "info">
): void {
  if (deletions.length === 0) return;
  logger.info(
    `    ⚠ deletes data: ${deletions.map(describeDeletion).join("; ")}. A real run needs ${consentToCover(deletions)}.`
  );
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
 * One SQL executor for every phase: split, run as the unit is marked to —
 * in one transaction unless it is marked to run outside one — and count.
 *
 * Shared by the app files and the plugin modules so the two paths cannot
 * drift about what "executed as one unit" means. A unit that runs outside a
 * transaction is named in the run's output before it starts. `after` records
 * the unit through the handle its statements ran on, inside the transaction
 * when there is one, so its ledger row commits or rolls back with them.
 */
function buildSqlExecutor(
  dz: DrizzleAdapter,
  dialect: SupportedDialect,
  logger: CommandContext["logger"]
): (
  sqlText: string,
  unit: MigrationUnit,
  after: (db: unknown, statementsExecuted: number) => Promise<void>
) => Promise<number> {
  return async (sqlText, unit, after) => {
    if (!unit.transaction) logger.warn(outsideTransactionNotice(unit.source));
    return runMigrationStatements(
      dz,
      splitSqlStatements(sqlText, dialect, unit),
      unit,
      after
    );
  };
}

/**
 * Per-element owner rows for the elements an owner added to a table another
 * owner declared: the app's indexes on a plugin's table, riding the app
 * migration stream, and a plugin's column or index on its dependency's
 * table, riding its own modules. Table-level rows are written by the streams
 * that carry the tables; these say who owns the ELEMENT, so a plugin's
 * reconcile can exclude it, and a full uninstall knows what it added where.
 *
 * Read from the compiled extension schema, the one record of who declared
 * each element. `contributors`, when given, keeps the rows of those plugins'
 * elements only, for a run that applied no other owner's.
 */
async function recordElementOwners(
  deps: MigrateCoreDeps,
  contributors?: ReadonlySet<string>
): Promise<void> {
  const elementOwners = deps.extensionSchema?.elementOwners;
  if (elementOwners === undefined || elementOwners.size === 0) return;
  const { SchemaOwnersRepository: OwnersRepo } = await import(
    "../../domains/schema/ownership/schema-owners-repository"
  );
  const owners = new OwnersRepo(deps.db, deps.dialect);
  // A plugin's applied schema version is the highest on any of its rows, and
  // a plugin that only contributes elements has no rows but these. Written as
  // `null`, its version never existed — the boot gate judged it behind after
  // a migration that applied — and every run overwrote whatever version had
  // been recorded. Read from the ledger by the rule `migrate:down` uses, so
  // both agree on what a plugin has applied.
  const ledger = await new SchemaEventsRepository(
    deps.db,
    deps.dialect
  ).listFileApplies();
  const pluginVersion = (pluginId: string) => {
    const set = deps.pluginMigrationSets?.find(
      candidate => candidate.pluginName === pluginId
    );
    return {
      ownerVersion: set?.pluginVersion ?? null,
      schemaVersion: set
        ? pluginSchemaVersionFromLedger(ledger, pluginId, set.migrations)
        : null,
    };
  };
  for (const [tableName, all] of elementOwners) {
    const elements = all.filter(element =>
      ofContributors(
        element.owner.kind,
        element.owner.kind === "plugin" ? element.owner.id : "",
        contributors
      )
    );
    if (elements.length === 0) continue;
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
        ...(element.owner.kind === "app"
          ? { ownerVersion: null, schemaVersion: null }
          : pluginVersion(element.owner.id)),
        state: "active" as const,
      }))
    );
  }
}

/**
 * Whether an element row's owner is among `contributors`: plugins named by
 * name, or every owner when none are named. The one test both recording and
 * retiring scope by, so the rows a run writes are the rows it may retire.
 */
function ofContributors(
  ownerKind: string,
  ownerId: string,
  contributors: ReadonlySet<string> | undefined
): boolean {
  return (
    contributors === undefined ||
    (ownerKind === "plugin" && contributors.has(ownerId))
  );
}

/**
 * Record the current element owner rows, and retire the stale ones: those
 * of `contributors` only when given, for a run that applied no other
 * owner's elements.
 */
export async function syncElementOwners(
  deps: MigrateCoreDeps,
  contributors?: ReadonlySet<string>
): Promise<void> {
  await recordElementOwners(deps, contributors);
  await retireElementOwners(deps, contributors);
}

/**
 * Table-level owner rows for the tables the APP declares.
 *
 * Plugin tables get theirs from the plugin phase and core tables from the core
 * reconcile; an app table declared through `db.schema.extend` or produced by
 * `afterDrizzle` got none. The drop guard reads a table with no owner row as
 * nobody's and allows the drop, so a plugin migration dropping one of them —
 * the app's own data — was waved through.
 *
 * Written BEFORE the plugin phase, whose drop guard is what these rows are
 * for: recorded after it, the first run after the table appeared still let a
 * plugin module drop it. A row for a declared table not yet created is still
 * true — the name is the app's, and a plugin dropping it is still foreign.
 */
export async function recordAppTableOwners(
  deps: MigrateCoreDeps
): Promise<void> {
  const appTables = [...(deps.extensionSchema?.owners.entries() ?? [])]
    .filter(([, owner]) => owner.kind === "app")
    .map(([name]) => name);
  if (appTables.length === 0) return;
  const { SchemaOwnersRepository: OwnersRepo } = await import(
    "../../domains/schema/ownership/schema-owners-repository"
  );
  // Through the registry's policy: a table another owner's row records is
  // not the app's to claim by declaring the same name, and refusing here
  // stops the run before any stream applies anything.
  await createOwnerRegistry(new OwnersRepo(deps.db, deps.dialect)).record(
    appTables.map(tableName => ({
      tableName,
      ownerKind: "app" as const,
      ownerId: "app",
      migratedBy: "app",
      ownerVersion: null,
      schemaVersion: null,
      state: "active" as const,
    }))
  );
}

/**
 * Delete element owner rows whose element is gone from the config AND the
 * database; see `retiredElementRows` for why both must hold. `contributors`,
 * when given, keeps the rows of those plugins' elements only.
 */
async function retireElementOwners(
  deps: MigrateCoreDeps,
  contributors?: ReadonlySet<string>
): Promise<void> {
  const { SchemaOwnersRepository: OwnersRepo } = await import(
    "../../domains/schema/ownership/schema-owners-repository"
  );
  const { retiredElementRows } = await import(
    "../../domains/schema/ownership/retired-elements"
  );
  const owners = new OwnersRepo(deps.db, deps.dialect);
  const elementRows = (await owners.read()).filter(
    row =>
      (row.elementKind ?? "table") !== "table" &&
      ofContributors(row.ownerKind, row.ownerId, contributors)
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
 * Refuse, before the run changes anything, a plugin history the ledger shows
 * was changed (`assertPluginHistories`): an applied module edited, removed or
 * renamed, or a pending one placed before it.
 *
 * Reads the ledger only when a plugin is declared, so a run with no plugins
 * reads nothing more than it did.
 */
async function assertPluginHistoriesHold(deps: MigrateCoreDeps): Promise<void> {
  const lists = deps.pluginMigrationSets ?? [];
  const declared = deps.declaredPlugins ?? new Set<string>();
  if (lists.length === 0 && declared.size === 0) return;
  assertPluginHistories({
    lists,
    appliedShas: await (
      deps.appliedPluginModulesFn ?? (() => appliedPluginModules(deps))
    )(),
    declaredPlugins: declared,
  });
}

/**
 * The applied plugin modules the ledger records, by ledger key — none when
 * the ledger has not been created yet, which the core reconcile does on a
 * fresh database: such a database has no applied module to check.
 */
async function appliedPluginModules(
  deps: Pick<MigrateCoreDeps, "adapter" | "db" | "dialect">
): Promise<ReadonlyMap<string, string | null>> {
  // Detected, as `migrateCore` detects the adapter's other operations: an
  // adapter without it is asked for the rows directly.
  const probe = deps.adapter as unknown as {
    tableExists?: (table: string) => Promise<boolean>;
  };
  if (
    typeof probe.tableExists === "function" &&
    !(await probe.tableExists("nextly_schema_events"))
  ) {
    return new Map();
  }
  return appliedPluginShas(
    await new SchemaEventsRepository(deps.db, deps.dialect).listFileApplies()
  );
}

/**
 * Phase 1.5 — plugin migration modules, between core and the app's files,
 * under the caller's lock. Plugins run first because an app migration may
 * index an entity table a plugin contributes. The first failure propagates
 * and stops Phase 2: later migrations assume a database state that was never
 * reached.
 */
export async function runPluginPhase(
  deps: MigrateCoreDeps
): Promise<PluginMigrationRunResult> {
  if (!deps.pluginMigrationSets || deps.pluginMigrationSets.length === 0) {
    return { applied: 0, adopted: 0, skipped: 0 };
  }
  deps.logger.info("Phase 1.5: applying plugin migrations...");
  const dz = deps.adapter as unknown as DrizzleAdapter;
  const eventsRepo = new SchemaEventsRepository(deps.db, deps.dialect);
  // Applied plugin modules, read as `migrate --dry-run` reads them, so the
  // preview and the run cannot disagree about which modules are pending.
  const appliedShas = appliedPluginShas(await eventsRepo.listFileApplies());

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
    if ((record.elementKind ?? "table") === "table") continue;
    // Keyed by KIND as well as name (`ownerRecordKey`): a column and an index
    // on one table can share a name, and a kind-blind key would let one
    // decide the other's stream.
    elementStream.set(ownerRecordKey(record), record.migratedBy);
  }
  const pluginOutcome = await runPluginMigrations(deps.pluginMigrationSets, {
    dialect: deps.dialect,
    appliedShas,
    declaredPlugins: deps.declaredPlugins,
    // `--step` counts plugin modules first, as they run first; see
    // `appStepAfter` for the app files' share.
    limit: deps.step,
    owners: ownerRows,
    elementOwners: allRows,
    liveColumns: statements =>
      readLiveColumns(deps.db, deps.dialect, [statements]),
    liveElements: statements =>
      readLiveElements(deps.db, deps.dialect, [statements]),
    liveTables: statements =>
      readLiveTables(deps.db, deps.dialect, [statements]),
    liveIndexTables: statements =>
      readLiveIndexTables(deps.db, deps.dialect, [statements]),
    // The same before-run count an app file gets: a plugin's module reaches the shared runner
    // through this phase, not through `runFileMigrations`.
    refuseRequiredColumns: (statements, source) =>
      refuseRequiredColumnsOverNulls(deps.db, deps.dialect, statements, source),
    introspect: async (names, stream) => {
      // Exactly the tables this module's snapshots name, as they stand now.
      // Not the app stream's comparable set: that is every collection, Single
      // and component table, which the plugin's snapshots never mention, so on
      // any database the app had already migrated each of them read as drift.
      const wanted = new Set(names);
      const managed = (await safeListTables(deps.adapter)).filter(name =>
        wanted.has(name)
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
          ownerRecordKey({ tableName, elementKind: kind, elementName })
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
    executeSql: buildSqlExecutor(dz, deps.dialect, deps.logger),
    repo: eventsRepo,
    recordOwner: async ({
      pluginName,
      pluginVersion,
      schemaVersion,
      tables,
      db,
    }) => {
      // Through the handle the module's statements ran on, when it ran in a
      // transaction, so these rows commit or roll back with them.
      const store =
        db === undefined ? owners : new OwnersRepo(db, deps.dialect);
      // A module that leaves this plugin owning NOTHING still moved its
      // schema version, so the rows it already has carry the new one rather
      // than keep the old. They are carried forward rather than deleted:
      // they are what records that the tables were this plugin's, which the
      // drop guard and a later uninstall both still need. A plugin with no
      // rows at all (one that only ships data migrations) records nothing
      // here, and needs nothing: the boot gate reads the applied version
      // from the ledger.
      if (tables.length === 0) {
        const existing = (await store.read()).filter(
          row => row.ownerId === pluginName
        );
        if (existing.length > 0) {
          await store.upsert(
            existing.map(row => ({
              ...row,
              ownerVersion: pluginVersion,
              schemaVersion,
            }))
          );
        }
        return;
      }

      const recorded = tables.map(tableName => ({
        tableName,
        ownerKind: "plugin" as const,
        ownerId: pluginName,
        migratedBy: `plugin:${pluginName}`,
        ownerVersion: pluginVersion,
        schemaVersion,
        state: "active" as const,
      }));
      // Through the registry's policy, which refuses a row naming a table
      // another owner holds. The runner refused such a module before it ran;
      // this decides again on the rows as they stand when the write happens.
      await createOwnerRegistry(store).record(recorded);
      // The drop guard reads `ownerRows` before every module, so it has to
      // learn what each module created as the run goes. Read once before the
      // phase, it did not know a table a dependency's module had just made,
      // and a later module in the same run could drop that table unchallenged.
      for (const row of recorded) ownerRows.set(row.tableName, row);
    },
  });
  // What each plugin's modules added to other owners' tables, claimed as
  // `syncElementOwners` claims it after every stream, and what a later module
  // stopped adding, retired. Here as well because `nextly plugins install`
  // runs this phase alone: without it, an install left the column or index
  // it added unclaimed, and so did a run of it again after one that stopped
  // between a module's ledger row and its owner rows, which skips the module
  // and repairs only its tables' rows. And a claim a later module's drop left
  // behind gave a same-named element another owner adds afterwards to this
  // plugin's stream, whose reconcile then refused the owner's next module as
  // drift. Only with the compiled schema, which alone says what is declared:
  // without it nothing can tell an element gone from the config.
  if (deps.extensionSchema !== undefined) {
    await syncElementOwners(
      deps,
      new Set(deps.pluginMigrationSets.map(set => set.pluginName))
    );
  }
  if (pluginOutcome.applied > 0 || pluginOutcome.adopted > 0) {
    deps.logger.success(
      `Plugin migrations: ${pluginOutcome.applied} applied, ${pluginOutcome.adopted} adopted, ${pluginOutcome.skipped} already recorded.`
    );
  }
  return pluginOutcome;
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
  if (!extensionSchema) return;

  // Tables a plugin owns, and elements a plugin added to somebody else's
  // table. The second counts as much as the first: a plugin that only extends
  // a dependency's table owns no table of its own, so a table-only check let
  // it through and its column or index reached development through push and
  // production never.
  const unmigratable = [
    ...[...extensionSchema.owners.entries()]
      .filter(
        ([, owner]) =>
          owner.kind === "plugin" && !pluginsWithMigrations.has(owner.id)
      )
      .map(([name]) => name),
    ...[...extensionSchema.elementOwners.entries()].flatMap(
      ([table, elements]) =>
        elements
          .filter(
            element =>
              element.owner.kind === "plugin" &&
              !pluginsWithMigrations.has(element.owner.id)
          )
          .map(element => `${table}.${element.elementName}`)
    ),
  ];
  if (unmigratable.length === 0) return;

  throw new NextlyError({
    code: "PLUGIN_MIGRATIONS_UNAVAILABLE",
    publicMessage:
      "A plugin declares tables or table elements but ships no migrations to create them. They exist in development through push; generate the plugin's migrations before deploying.",
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

/**
 * What is left of `--step` for the app's files once the plugin phase has
 * recorded `pluginRecorded` modules, applied or adopted.
 *
 * `--step N` is "run only N migrations", and the plugin phase runs first, so
 * one budget is shared: handing the whole of it to each phase let
 * `--step 1` apply every pending plugin module and then an app file as well.
 * Undefined, as no limit, when no positive step was given — the meaning
 * `runFileMigrations` already gives an absent one. Zero means the app phase
 * must not run at all, which is why it is not passed on as a step: a zero
 * step reads as no limit there.
 */
function appStepAfter(
  step: number | undefined,
  pluginRecorded: number
): number | undefined {
  if (step === undefined || !(step > 0)) return undefined;
  return Math.max(0, step - pluginRecorded);
}

/**
 * Phases 1.5 and 2: the plugins' modules, then the app's files, under one
 * `--step` budget (`appStepAfter`).
 */
async function runMigrationStreams(
  deps: MigrateCoreDeps,
  runFiles: typeof runFileMigrations,
  judged: ReadonlyMap<string, string>
): Promise<{ pluginModulesApplied: number; applied: number }> {
  const pluginOutcome = await runPluginPhase(deps);
  const pluginModulesApplied = pluginOutcome.applied + pluginOutcome.adopted;
  const appStep = appStepAfter(deps.step, pluginModulesApplied);
  if (appStep === 0) {
    deps.logger.info(
      "Phase 2: skipped; --step was spent on plugin migrations."
    );
    return { pluginModulesApplied, applied: 0 };
  }
  deps.logger.info("Phase 2: applying user migrations...");
  const applied = await runFiles({
    adapter: deps.adapter,
    db: deps.db,
    dialect: deps.dialect,
    migrationsDir: deps.migrationsDir,
    step: appStep,
    logger: deps.logger,
    knownJunctions: deps.knownJunctions,
    declared: deps.declared,
    ...(deps.refuseUnrecognisedBuilderFiles === true
      ? { refuseUnrecognisedBuilderFiles: true }
      : {}),
    judged,
  });
  return { pluginModulesApplied, applied };
}

/** The per-document columns every content table needs (`addDocumentColumns`). */
async function addDocumentColumnsFor(deps: MigrateCoreDeps): Promise<void> {
  await addDocumentColumns({
    db: deps.db,
    dialect: deps.dialect,
    logger: { info: m => deps.logger.info(m) },
  });
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
  // The history checks that need no database, before the lock is waited on:
  // a list edited by hand is refused with nothing changed.
  assertPluginListsSound(deps.pluginMigrationSets ?? []);
  // Each old Schema Builder file the run ignores, named once so a file that
  // merely carries the signature never vanishes without a word. Information:
  // the run does what it would without the file. The boot hands its own log.
  await nameOldBuilderFiles(deps);
  // The app's history, before the lock and anything else, in
  // `assertAppHistoryHolds`'s order: an older build stops with exit 3 while
  // the ledger records an app migration its folder lacks, an unresolved
  // attempt is named before any consent is asked, and an edited applied
  // file stops with exit 2. Read-only here, recording no checksum; asked
  // again under the lock, below, where no other run changes the ledger.
  const assertFilesPresent =
    deps.assertAppliedFilesPresentFn ?? assertAppliedFilesPresent;
  const refuseAttempts =
    deps.refuseUnresolvedAttemptsFn ?? refuseUnresolvedAppAttempts;
  const assertFilesUnchanged =
    deps.assertAppliedFilesUnchangedFn ?? assertAppliedFilesUnchanged;
  const historyArgs = {
    ...deps,
    command: deps.lockCommand ?? "nextly migrate",
  };
  await assertFilesPresent(historyArgs);
  await refuseAttempts(historyArgs);
  await assertFilesUnchanged({ ...historyArgs, recordChecksums: false });
  // Before the lock as well: taking it creates the lock's own table on a
  // database that has none, and a refused run leaves the schema as it was. A
  // file another run records meanwhile is only refused once more.
  const refuseUnrecognised =
    deps.refuseUnrecognisedBuilderFilesFn ?? refuseUnrecognisedBuilderFiles;
  if (deps.refuseUnrecognisedBuilderFiles === true) {
    await refuseUnrecognised(deps);
  }
  // Before the lock as well, so a person is asked without other runs waiting
  // on them; judged again under the lock, below, against the database as it
  // stands then, accepting only what was agreed here.
  const { agreement: agreedDeletions } = await judgeFileDeletions(deps);

  const reconcile = deps.reconcileCoreFn ?? reconcileCore;
  const runFiles = deps.runFileMigrationsFn ?? runFileMigrations;
  const reconcileMetadata =
    deps.reconcileMetadataFn ?? reconcileMigrationMetadata;
  const lock = deps.withLock ?? withMigrateLock;
  let applied = 0;
  let pluginModulesApplied = 0;
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
    deps.adapter as unknown as DrizzleAdapter,
    deps.dialect,
    async () => {
      // Before anything changes the database, the core reconcile included:
      // a deploy refused after the core reconcile would leave core's tables
      // at a release that never ran.
      await assertPluginHistoriesHold(deps);
      // Under the lock, so the ledger read is the one no other run changes
      // before this one writes, and before Phase 1's first write: the
      // history checks of `assertAppHistoryHolds`, in its order.
      await assertFilesPresent(historyArgs);
      await refuseAttempts(historyArgs);
      // And again under the lock, before anything writes (the checksum check
      // below records a missing checksum): a file changed while this run
      // waited for the lock is judged as it now reads.
      if (deps.refuseUnrecognisedBuilderFiles === true) {
        await refuseUnrecognised(deps);
      }
      // A file that deletes data runs only with consent covering each
      // deletion, judged from the database this run holds the lock on. The
      // files run only as they were judged here (`assertRunsAsJudged`).
      const { files: judgedFiles } = await judgeFileDeletions(
        deps,
        agreedDeletions
      );
      // An applied file edited since it ran is refused here too, before the
      // first write; one recorded without a checksum gets its checksum.
      await (deps.assertAppliedFilesUnchangedFn ?? assertAppliedFilesUnchanged)(
        {
          ...deps,
          command: deps.lockCommand ?? "nextly migrate",
        }
      );
      deps.logger.info("Phase 1: reconciling core schema...");
      // Resolved here, where a failure can still fail the command cleanly. The
      // core schema is a desired shape, so naming a registry the database does
      // not have is an instruction to create it — and an empty legacy registry
      // beside a populated migrated one is preferred by every reader.
      const fieldGroupRegistryTable = await resolveRegistryNameFromCatalog({
        dialect: deps.dialect,
        getDrizzle: <T>() => deps.db as T,
      });
      // DETECTED rather than asserted: a caller of this seam may hand an
      // adapter without these operations, and a cast to a shape with
      // `tableExists` would then call `undefined`, a TypeError that skips the
      // whole migration phase. The cleanup already reports itself as skipped
      // when these are absent, so omitting them degrades to a note instead of
      // a crash.
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
        // What hooks contributed to the core tables: carried by the app's
        // migrations, so the reconcile sets them aside when comparing, and
        // its push reaches a state that includes the ones already live.
        ...(deps.extensionSchema !== undefined
          ? { contributions: deps.extensionSchema }
          : {}),
        logger: {
          info: m => deps.logger.debug(m),
          warn: m => deps.logger.warn(m),
        },
        allowDestructive: deps.allowDestructive,
        ...(deps.dropRetiredAuthTables === true
          ? { dropRetiredAuthTables: true }
          : {}),
        ...(deps.allowDropNonEmptyRetired === true
          ? { allowDropNonEmptyRetired: true }
          : {}),
        // The operations the retired-table drop needs. Without them the
        // cleanup returned at its first guard, so the documented
        // NEXTLY_DROP_RETIRED_AUTH_TABLES flow dropped nothing and said nothing.
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
      // With the run's first write behind it, and every refusal it makes
      // before writing passed, the marks it owes.
      await (deps.markOldBuilderFilesFn ?? markOldBuilderFiles)(deps);

      // Before the app's files as well as after them (below, once Phase 3 has
      // recorded the registry): a file written after these columns existed may
      // rebuild a SQLite table, copying them from the live one.
      await (deps.documentColumnsFn ?? addDocumentColumnsFor)(deps);
      await recordAppTableOwners(deps);
      ({ pluginModulesApplied, applied } = await runMigrationStreams(
        deps,
        runFiles,
        judgedFiles
      ));

      // Element rows for contributed elements: written AFTER every stream has
      // applied, so a row exists exactly when the element does — then rows
      // whose element is gone from both the config and the database are
      // retired, so a reused name is never attributed to a stream that no
      // longer holds it. Each stream's reconcile ignores elements it does not
      // own, which is what these rows say.
      await (deps.syncElementOwnersFn ?? syncElementOwners)(deps);

      // What the caller must hold true before the registry records the files' metadata.
      await deps.beforeMetadata?.();

      /*
       * Phase 3 — make the registry agree with the tables Phase 2 just created.
       *
       * 🔴 Inside the lock. The development boot runs a snapshot pass of its
       * own after this one, outside the lock, because several dev-server
       * workers race there (`registerMigrationMetadata`). A run of this
       * function already holds the lock, so this sweep cannot interleave with
       * another migrate and needs no conflict tolerance of its own.
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
          ...(deps.declared === undefined ? {} : { declared: deps.declared }),
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

      // After the files and after Phase 3: a file written before these
      // columns creates tables without them, and an entity whose registry
      // row only Phase 3 records is found only once it has.
      await (deps.documentColumnsFn ?? addDocumentColumnsFor)(deps);
    },
    {
      command: deps.lockCommand ?? "nextly migrate",
      mode: deps.lockMode ?? "wait",
      ttlSeconds: deps.ttlSeconds,
      waitMs: deps.lockWaitMs,
      // Off unless the caller asks: a boot, production or development, runs inside a server whose
      // shutdown may let the migration run on, and the lock must not be freed under it.
      releaseOnInterrupt: deps.lockReleaseOnInterrupt === true,
      isSettled: deps.isSettled,
      logger: {
        warn: m => deps.logger.warn(m),
        info: m => deps.logger.info(m),
      },
    }
  );

  return {
    applied,
    pluginModulesApplied,
    coreChanged,
    ran: outcome.ran,
    metadata,
  };
}

/**
 * Refuses, reading only, while an app migration file in the folder has an
 * unresolved attempt that may have stopped part-way (`refuseUnresolvedAttempts`):
 * its statements are judged from the live database, and the operator records
 * with `migrate:resolve` what they did about them. Every command that runs or
 * rolls back app migrations asks this before its first write: `nextly migrate`
 * and the boot migrate step through `migrateCore`, and `migrate:down`.
 *
 * A database with no ledger yet has no attempt to refuse on.
 */
async function refuseUnresolvedAppAttempts(args: {
  adapter: CLIDatabaseAdapter;
  db: unknown;
  dialect: SupportedDialect;
  migrationsDir: string;
  logger: CommandContext["logger"];
  /** What the run's declared schema names, which old Builder files are judged against. */
  declared?: DeclaredNames;
  /** The command refusing, as the operator typed it. */
  command: string;
}): Promise<void> {
  const history = await readAppHistory(args);
  if (history === undefined) return;
  const { files, rows } = history;
  await refuseUnresolvedAttempts({
    files: files.map(m => ({
      filename: `${m.name}.sql`,
      upSql: m.upSql,
      downSql: m.downSql,
      transaction: m.transaction,
      checksum: m.checksum,
      // A file moving fields out of translation says exactly how to tell
      // whether it landed.
      ...(m.localization?.kind === "shared"
        ? {
            advice: sharedFileRecoveryAdvice(
              `${m.name}.sql`,
              m.localization.spec
            ),
          }
        : {}),
    })),
    rows,
    dialect: args.dialect,
    readLive: statements => readLiveSchema(args.db, args.dialect, statements),
    command: args.command,
  });
}

/**
 * Refuses, before the run changes anything, an app migration file it would
 * apply that deletes data (`pendingRunDeletions`, read from the files'
 * statements for this dialect, never from a header, each file against the
 * schema as the files before it leave it) unless the consent covers every
 * deletion in it, naming the file and each deletion (`judgeRunDeletions`).
 *
 * Asked twice. Before the lock (`agreed` absent), a person at a terminal is
 * shown every file's deletions, each file named above its own, and asked once
 * for the whole run; a decline stops the run with nothing changed. Under the
 * lock (`agreed` given), the files are judged again against
 * the database as it stands then, and only what was agreed is accepted without
 * asking: anything new is refused rather than asked about while other runs
 * wait. Returns the deletions agreed to.
 *
 * Every pending file within `--step` is judged; the plugin modules a run
 * applies first may leave the step fewer app files than that, so this can ask
 * about a file the run then leaves for the next one, never miss one it runs.
 */
async function judgeFileDeletions(
  deps: MigrateCoreDeps,
  agreed?: Agreement
): Promise<{ agreement: Agreement; files: ReadonlyMap<string, string> }> {
  const consent =
    deps.consent ??
    resolveDataLossConsent({
      env: process.env,
      honours: ["NEXTLY_ALLOW_CORE_DESTRUCTIVE"],
    });
  const listed = await listMigrationFiles(
    deps.adapter,
    deps.db,
    deps.dialect,
    deps.migrationsDir,
    deps.logger
  );
  const plan = fileRunPlan(listed, deps.step);
  // Each deletion keeps the file it comes from, by identity, for the listing
  // and for binding an agreement to the file as it stands.
  const sources = new Map<Deletion, DeletionSource>();
  // The plugin modules a run applies first, then the app files within the
  // step, read as one run in that order.
  const fileUnits = listed.flatMap(({ file }) =>
    plan.runs.has(file) ? [fileUnit(file, deps.dialect)] : []
  );
  const units = [...(await moduleUnits(deps)), ...fileUnits];
  for (const { unit, deletions } of await pendingRunDeletions(
    units,
    deps.db,
    deps.dialect
  )) {
    const source = deletionSource(unit.label, unit.text);
    for (const deletion of deletions) sources.set(deletion, source);
  }
  // A refusal, or a no at the terminal (`DATA_LOSS_DECLINED`, exit 1),
  // throws before anything changes.
  const agreement = await judgeRunDeletions({
    sources,
    consent,
    agreed,
    interactive: deps.interactive,
    askToDelete: deps.askToDelete,
    warn: line => deps.logger.warn(line),
    notice:
      sources.size === 0
        ? undefined
        : await eventTriggerNotice(eventTriggersOf(deps)),
  });
  // Each app file judged, by filename, with the digest of the UP judged.
  const files = new Map(
    fileUnits.map(unit => [unit.label, textDigest(unit.text)])
  );
  return { agreement, files };
}

/** How a run reads the database's DDL event triggers: injected, or from the catalog. */
function eventTriggersOf(
  deps: Pick<MigrateCoreDeps, "readEventTriggersFn" | "db" | "dialect">
): () => Promise<readonly string[]> {
  return (
    deps.readEventTriggersFn ??
    (() => readDdlEventTriggers(deps.db, deps.dialect))
  );
}

/** One unit of a run as its consent judges it: its name in the listing, its text (for binding an agreement) and its statements. */
interface RunUnit {
  label: string;
  text: string;
  statements: string[];
}

/** An app migration file as a unit of the run: its UP section. */
function fileUnit(file: ParsedMigration, dialect: SupportedDialect): RunUnit {
  return {
    label: `${file.name}.sql`,
    text: file.upSql,
    statements: splitSqlStatements(file.upSql, dialect, file),
  };
}

/**
 * The plugin modules a run applies before the app files, in that order, as
 * units of the run (`pendingPluginModules`), read against the applied
 * checksums the history checks read.
 */
async function moduleUnits(deps: MigrateCoreDeps): Promise<RunUnit[]> {
  const lists = deps.pluginMigrationSets ?? [];
  if (lists.length === 0) return [];
  const applied = await (
    deps.appliedPluginModulesFn ?? (() => appliedPluginModules(deps))
  )();
  return pluginModuleUnits(lists, applied, deps.step, deps.dialect);
}

/**
 * What the pending modules of `sets` delete, judged as one run in the order a
 * run applies them (`pluginModuleUnits`, over the ledger's applied
 * checksums): what `plugins install` asks consent for before it applies
 * them, as `nextly migrate` does for the same modules.
 */
export async function pendingPluginDeletions(
  sets: readonly PluginMigrationSet[],
  deps: Pick<MigrateCoreDeps, "adapter" | "db" | "dialect">
): Promise<{ label: string; text: string; deletions: Deletion[] }[]> {
  const applied = await appliedPluginModules(deps);
  const units = pluginModuleUnits(sets, applied, undefined, deps.dialect);
  return (await pendingRunDeletions(units, deps.db, deps.dialect)).map(
    ({ unit, deletions }) => ({ label: unit.label, text: unit.text, deletions })
  );
}

/**
 * The pending plugin modules over `applied`, within `step`, as units of the
 * run (`pendingPluginModules`): what the consent gate and `migrate --dry-run`
 * both judge, so the two cannot read different modules.
 */
function pluginModuleUnits(
  lists: readonly PluginMigrationSet[],
  applied: ReadonlyMap<string, string | null>,
  step: number | undefined,
  dialect: SupportedDialect
): RunUnit[] {
  return pendingPluginModules(lists, applied, step).map(
    ({ filename, migration }) => {
      const statements = pluginModuleStatements(migration, dialect, "up");
      return { label: filename, text: statements.join("\n;\n"), statements };
    }
  );
}

/**
 * What each unit of a run deletes, the run read as one list
 * (`runDeletions`): a unit is judged against the schema as the units before
 * it leave it, so a table an earlier one creates holds only what the run
 * put there. The live facts are read once, for every unit's statements.
 */
async function pendingRunDeletions(
  units: readonly RunUnit[],
  db: unknown,
  dialect: SupportedDialect
): Promise<{ unit: RunUnit; deletions: Deletion[] }[]> {
  const lists = units.map(unit => unit.statements);
  const facts = await readDeletionFacts(db, dialect, runStatements(lists));
  const perUnit = runDeletions(lists, dialect, facts);
  return units.map((unit, at) => ({ unit, deletions: perUnit[at] ?? [] }));
}

/**
 * The consent a file that deletes data needs, at the command line: from the
 * flag or the environment, with a person at a terminal asked instead.
 */
function commandLineConsent(
  options: Pick<MigrateCommandOptions, "acceptDataLoss">,
  logger: CommandContext["logger"]
): Pick<MigrateCoreDeps, "consent" | "interactive" | "askToDelete"> {
  return {
    consent: migrateConsent(options, m => logger.warn(m)),
    interactive: canPrompt(),
    askToDelete: askToDeleteInTerminal,
  };
}

/**
 * `nextly migrate`'s consent: `--accept-data-loss` or
 * `NEXTLY_ACCEPT_DATA_LOSS`. `NEXTLY_ALLOW_CORE_DESTRUCTIVE` is honoured for
 * what it always covered, Nextly's own tables, and so never covers an app
 * migration's deletion.
 */
function migrateConsent(
  options: Pick<MigrateCommandOptions, "acceptDataLoss">,
  warn: (message: string) => void
): DataLossConsent {
  return readDataLossConsent({
    flag: options.acceptDataLoss,
    honours: ["NEXTLY_ALLOW_CORE_DESTRUCTIVE"],
    warn,
  });
}

/** What the history checks read: how `readAppHistory` is asked. */
interface AppHistoryArgs {
  adapter: CLIDatabaseAdapter;
  db: unknown;
  dialect: SupportedDialect;
  migrationsDir: string;
  logger: CommandContext["logger"];
  /** What the run's declared schema names, which old Builder files are judged against. */
  declared?: DeclaredNames;
}

/**
 * The app's migration files as the run reads them, and every attempt and
 * outcome row of the ledger, for the history checks made before a run's
 * first write. Undefined where the database has no ledger yet: nothing ran,
 * so there is nothing to check.
 */
async function readAppHistory(args: AppHistoryArgs): Promise<
  | {
      files: ParsedMigration[];
      rows: SchemaEventRow[];
      /** The files whose removal `migrate:resolve --removed` recorded. */
      removed: ReadonlySet<string>;
      repo: SchemaEventsRepository;
      oldBuilder: OldBuilderLedger;
    }
  | undefined
> {
  const hasLedger = await (
    args.adapter as unknown as { tableExists: (n: string) => Promise<boolean> }
  ).tableExists("nextly_schema_events");
  if (!hasLedger) return undefined;
  const repo = new SchemaEventsRepository(args.db, args.dialect);
  const allRows = [
    ...(await repo.listFileApplies()),
    ...(await repo.listFailedRollbacks()),
  ];
  const oldBuilder = await readOldBuilderLedger(args, repo, allRows);
  // An old Builder file's rows are not an app migration's, for any check.
  const rows = allRows.filter(
    row => row.filename === null || !oldBuilder.ignoredRows.has(row.filename)
  );
  const files = await discoverMigrations(
    args.migrationsDir,
    args.logger,
    args.dialect,
    "app",
    args.declared
  );
  // A removal stands for the applied outcome it was recorded after.
  const removed = removedOnPurpose(rows, await repo.listFileRemovals());
  return { files, rows, removed, repo, oldBuilder };
}

/**
 * Every check of the app's history a command that runs, records or rolls back
 * app migrations, or changes core tables, makes before its first write, in
 * the order an older build's operator needs them: an applied migration the
 * folder lacks (exit 3), an unresolved attempt, then an applied file edited
 * since it ran (exit 2). `recordChecksums` false (a dry run) leaves the
 * checksum of an applied row that has none unrecorded, so nothing is written.
 */
export async function assertAppHistoryHolds(
  args: AppHistoryArgs & {
    /** The command refusing, as the operator typed it. */
    command: string;
    recordChecksums?: boolean;
  }
): Promise<void> {
  await assertAppliedFilesPresent(args);
  await refuseUnresolvedAppAttempts(args);
  await assertAppliedFilesUnchanged(args);
}

/**
 * Refuses, before the run's first write, while the ledger holds an app
 * migration this build's folder lacks that is applied, or that has an
 * unresolved attempt: a newer build migrated the database, or tried to, or the
 * file was removed. The command exits with code 3 (`migrateExitCode`), naming
 * each one. A migration's state is its latest outcome (`migrationStanding`);
 * an applied one whose removal `migrate:resolve --removed` recorded is not
 * missing, and a plugin's rows are never an app migration's.
 */
export async function assertAppliedFilesPresent(
  args: AppHistoryArgs & {
    /** The command refusing, as the operator typed it. */
    command: string;
  }
): Promise<void> {
  const history = await readAppHistory(args);
  if (history !== undefined) refuseMissing(history, args.command);
}

/**
 * `assertAppliedFilesPresent`'s judgement of one read of the ledger and the
 * folder, so a check reading them again for its own question (the checksums)
 * judges presence from the same read.
 */
function refuseMissing(
  history: NonNullable<Awaited<ReturnType<typeof readAppHistory>>>,
  command: string
): void {
  const inFolder = new Set(history.files.map(m => `${m.name}.sql`));
  // The app's rows the folder has no file for, each migration's standing read
  // as every rule reads it; a plugin's rows are its own stream's.
  const absent = standingsByFilename(
    history.rows.filter(
      row =>
        row.filename !== null &&
        !isPluginLedgerRow(row.filename) &&
        !inFolder.has(row.filename)
    )
  );
  const missing: string[] = [];
  const tried: string[] = [];
  for (const filename of [...absent.keys()].sort()) {
    const standing = absent.get(filename);
    if (standing?.unresolvedAttempt !== undefined) tried.push(filename);
    else if (standing?.state === "applied" && !history.removed.has(filename)) {
      missing.push(filename);
    }
  }
  if (missing.length > 0 || tried.length > 0) {
    throw appliedFilesMissing(command, missing, tried);
  }
}

/** Each file named in backticks, separated by commas. */
function namedFiles(files: readonly string[]): string {
  return files.map(f => `\`${f}\``).join(", ");
}

/**
 * The refusal for app migrations the folder lacks (`MIGRATION_MISSING`):
 * `missing`, applied, and `tried`, with an unresolved attempt a newer build
 * left, each said with its own reason and its own way out.
 */
export function appliedFilesMissing(
  command: string,
  missing: readonly string[],
  tried: readonly string[]
): CliError {
  const whats: string[] = [];
  const whys: string[] = [];
  const nexts: string[] = [];
  if (missing.length > 0) {
    whats.push(
      `the ledger records ${formatCount(missing.length, "applied migration")} this build's migrations folder lacks (${namedFiles(missing)})`
    );
    whys.push(
      "A newer build has migrated this database, or a file was removed from the folder after it ran."
    );
    nexts.push(
      "Deploy the build that holds the files, or put them back. If a file was removed on purpose, record that with `nextly migrate:resolve --removed <file>`: the migration stays applied, and is never run again if its file returns."
    );
  }
  if (tried.length > 0) {
    whats.push(
      `${formatCount(tried.length, "migration")} this build's folder lacks ${tried.length === 1 ? "has" : "have"} an unresolved attempt (${namedFiles(tried)})`
    );
    whys.push(
      "A newer build tried it and did not finish, so the database may hold part of it."
    );
    nexts.push(
      "Deploy the build that holds the file and let it finish; or reverse what of it ran and record it with `nextly migrate:resolve --rolled-back <file> --file-missing`."
    );
  }
  const what = whats.join("; and ");
  return new CliError("MIGRATION_MISSING", {
    what: `${what.charAt(0).toUpperCase()}${what.slice(1)}, so \`${command}\` ran nothing.`,
    why: whys.join(" "),
    next: nexts.join(" "),
    context: { files: [...missing], unresolved: [...tried] },
  });
}

/**
 * Refuses, before the run's first write, while a marked old Schema Builder
 * file no longer carries the whole signature (`oldBuilderFilesChanged`).
 * Part of `assertAppliedFilesUnchanged`; asked alone by a command that runs
 * no other checksum check.
 */
export async function refuseChangedOldBuilderFiles(
  args: AppHistoryArgs & {
    /** The command refusing, as the operator typed it. */
    command: string;
  }
): Promise<void> {
  const history = await readAppHistory(args);
  if (history !== undefined && history.oldBuilder.changed.length > 0) {
    throw oldBuilderFilesChanged(args.command, history.oldBuilder.changed);
  }
}

/**
 * Refuses a pending file that has a Schema Builder name and no snapshot but
 * is not recognised as an earlier Builder's (`classifyMigrationFile`'s
 * "partial"), naming each with the part of the signature it lacks and the
 * fix. Its statements are old Builder SQL that no snapshot checks, and the
 * signature cannot know every file an earlier Builder wrote, so a file it
 * does not recognise stops the run rather than running unchecked. One with a
 * snapshot, or an ordinary name, is judged as any migration.
 */
async function refuseUnrecognisedBuilderFiles(
  deps: AppHistoryArgs
): Promise<void> {
  const folder = await readMigrationFolder(
    deps.migrationsDir,
    deps.dialect,
    deps.declared
  );
  const snapshotless = folder.partialBuilderFiles.filter(
    file => !file.lacks.includes("snapshot")
  );
  if (snapshotless.length === 0) return;
  // The pending files as the run and the dry run find them, so all agree,
  // each by the file its dialect selects: a migration may exist only as one
  // dialect's variant, and only the file that would run is judged.
  const pending = new Set(
    (
      await findPendingFiles(
        deps.adapter,
        deps.db,
        deps.dialect,
        deps.migrationsDir,
        deps.logger,
        deps.declared
      )
    ).map(m => basename(m.filePath))
  );
  const refused = snapshotless.filter(file => pending.has(file.file));
  if (refused.length === 0) return;
  throw new NextlyError({
    code: "NEXTLY_MIGRATION_SNAPSHOT_MISSING",
    publicMessage:
      `nextly migrate does not apply a file with a Schema Builder name that is not recognised as an earlier Builder's: ` +
      refused
        .map(file => `${file.file}, which ${partialBuilderFileLacks(file)}`)
        .join("; ") +
      ". " +
      refused.map(file => builderMigrationRemedy(file.file)).join(" "),
    logContext: { files: refused.map(file => file.file) },
  });
}

/** Names each old Schema Builder file in the folder (`oldBuilderFileLine`). */
async function nameOldBuilderFiles(
  args: Pick<
    AppHistoryArgs,
    "migrationsDir" | "dialect" | "logger" | "declared"
  >
): Promise<void> {
  const folder = await readMigrationFolder(
    args.migrationsDir,
    args.dialect,
    args.declared
  );
  for (const file of folder.oldBuilderFiles) {
    args.logger.info(oldBuilderFileLine(file));
  }
}

/**
 * Records the marks a run owes (`judgeOldBuilderLedger`'s `toMark`): each old
 * Schema Builder file a ledger row names, with its checksum, where no mark of
 * that checksum stands. Called with the run's first write behind it, so
 * every refusal the run makes before writing comes first; a run refused
 * earlier records none, and the next run records them. Without a ledger no
 * row names a file, so there is nothing to mark.
 */
async function markOldBuilderFiles(args: AppHistoryArgs): Promise<void> {
  const history = await readAppHistory(args);
  if (history === undefined) return;
  for (const { file, checksum } of history.oldBuilder.toMark) {
    await history.repo.recordOldBuilderMark({
      filename: file,
      sha256: checksum,
      source: "cli-migrate",
    });
  }
}

/**
 * Refuses, before the run's first write, while an applied app migration file
 * has changed since it ran (`appliedChecksums`): the database holds what its
 * earlier text did, and running the files after it on top of that would build
 * on a history nobody has. The refusal names every such file and says how to
 * accept an intended edit; the command exits with code 2 (`migrateExitCode`).
 *
 * An applied row recorded without a checksum, by an earlier version or an
 * earlier `migrate:resolve --applied`, is taken as matching: once nothing is
 * refused, the file's checksum is recorded on it in place, and the files are
 * listed.
 */
export async function assertAppliedFilesUnchanged(
  args: AppHistoryArgs & {
    /** The command refusing, as the operator typed it. */
    command: string;
    /** False (a dry run): refuse as a run would, recording no checksum. */
    recordChecksums?: boolean;
  }
): Promise<void> {
  const history = await readAppHistory(args);
  if (history === undefined) return;
  // Presence judged again from the folder this check reads: a file removed
  // since the earlier check would otherwise drop out of the comparison.
  refuseMissing(history, args.command);
  // A marked old Builder file that no longer carries the signature: its mark's
  // checksum is its recorded one, so a change of content is an edited applied
  // file; with the content as marked, the snapshot beside it is the change.
  if (history.oldBuilder.changed.length > 0) {
    throw oldBuilderFilesChanged(args.command, history.oldBuilder.changed);
  }
  const { changed, unrecorded } = appliedChecksums(
    history.files.map(m => ({
      filename: `${m.name}.sql`,
      checksum: m.checksum,
    })),
    history.rows
  );
  if (changed.length > 0) throw appliedFilesChanged(args.command, changed);
  if (args.recordChecksums === false) return;
  for (const row of unrecorded) {
    await history.repo.recordChecksum(
      row.outcomeId,
      row.checksum,
      "checksum recorded (none was)"
    );
  }
  if (unrecorded.length > 0) {
    args.logger.info(
      `Recorded the checksum of ${formatCount(unrecorded.length, "applied migration")} that had none: ${unrecorded.map(row => row.filename).join(", ")}.`
    );
  }
}

/**
 * The refusal for marked old Builder files that changed since they were
 * recognised: `MIGRATION_TAMPERED` (exit 2) where any file's content changed,
 * as for an edited applied file, else `OLD_BUILDER_FILE_SNAPSHOT_ADDED`, naming
 * each snapshot that now stands beside one.
 */
function oldBuilderFilesChanged(
  command: string,
  changed: readonly ChangedOldBuilderFile[]
): CliError {
  const content = changed.filter(c => c.change === "content");
  const named = changed
    .map(c =>
      c.change === "content"
        ? `\`${c.file}\` has changed`
        : `\`${c.file}\` has a snapshot beside it (\`meta/${c.file.replace(/\.sql$/, "")}.snapshot.json\`)`
    )
    .join("; ");
  const what = `${named} since it was recognised as a file an earlier Schema Builder wrote, so \`${command}\` ran nothing.`;
  const settle =
    "Put the file back as it was, or remove the snapshot, and it is ignored again; delete it, and its ledger rows stay ignored; or accept it as it now stands with `nextly migrate:resolve --applied <file>`, after which it is checked as any migration.";
  const parts = {
    what,
    why: "A ledger row marks the file as an old Schema Builder file, which every command ignores, and it no longer carries the whole signature that recognised it, so it would be read as a migration.",
    next: settle,
    context: { files: changed.map(c => c.file) },
  };
  return content.length > 0
    ? new CliError("MIGRATION_TAMPERED", parts)
    : new CliError("OLD_BUILDER_FILE_SNAPSHOT_ADDED", parts);
}

/** The refusal for applied files edited since they ran (`MIGRATION_TAMPERED`). */
function appliedFilesChanged(
  command: string,
  changed: readonly string[]
): CliError {
  const [only] = changed;
  const what =
    changed.length === 1 && only !== undefined
      ? `\`${only}\` has changed since it was applied, so \`${command}\` ran nothing.`
      : `${String(changed.length)} applied migrations have changed since they were applied (${changed.map(f => `\`${f}\``).join(", ")}), so \`${command}\` ran nothing.`;
  return new CliError("MIGRATION_TAMPERED", {
    what,
    why: "A file's checksum no longer matches the one recorded when it ran on this database, so the database holds what its earlier text did.",
    next: "Restore each file as it was when it ran, and put the change in a new migration with `nextly migrate:create`. If the edit is intended and the database already stands as the file now says, accept it with `nextly migrate:resolve --applied <file>`, which compares the database with the file's snapshot (add `--skip-verify` where it has none).",
    context: { files: [...changed] },
  });
}

/** The codes the app history checks refuse with (`assertAppHistoryHolds`). */
const HISTORY_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "MIGRATION_MISSING",
  "MIGRATION_TAMPERED",
  "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
]);

/**
 * The refusal `check` (one of the app history checks) makes, as a dry run
 * reports it: its message, or undefined when the history holds. Any other
 * error travels.
 */
export async function historyRefusalIn(
  check: () => Promise<void>
): Promise<string | undefined> {
  try {
    await check();
    return undefined;
  } catch (error) {
    const refusal = historyRefusalOf(error);
    if (refusal === undefined) throw error;
    return refusal;
  }
}

/** A history check's refusal (`HISTORY_REFUSAL_CODES`) as a dry run reports it: its message; undefined for any other error. */
export function historyRefusalOf(error: unknown): string | undefined {
  return NextlyError.is(error) && HISTORY_REFUSAL_CODES.has(error.code)
    ? error.publicMessage
    : undefined;
}

/**
 * The exit code a command that checks the app's history ends with on `error`:
 * 2 for an applied file edited since it ran, 3 for an app migration the
 * folder lacks, the codes the guide documents, so a deploy script can tell
 * them from any other failure (1).
 */
export function migrateExitCode(error: unknown): 1 | 2 | 3 {
  if (!(error instanceof CliError)) return 1;
  if (error.code === "MIGRATION_TAMPERED") return 2;
  return error.code === "MIGRATION_MISSING" ? 3 : 1;
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
  logger: CommandContext["logger"],
  declared?: DeclaredNames
): Promise<ParsedMigration[]> {
  return (
    await listMigrationFiles(
      adapter,
      db,
      dialect,
      migrationsDir,
      logger,
      declared
    )
  ).flatMap(({ file, applied }) => (applied ? [] : [file]));
}

/** The app's migration files in run order, each with whether the ledger records it applied. */
async function listMigrationFiles(
  adapter: CLIDatabaseAdapter,
  db: unknown,
  dialect: SupportedDialect,
  migrationsDir: string,
  logger: CommandContext["logger"],
  declared?: DeclaredNames
): Promise<{ file: ParsedMigration; applied: boolean }[]> {
  // Passing dialect prefers {name}.{dialect}.sql over base {name}.sql when both exist
  const all = await discoverMigrations(
    migrationsDir,
    logger,
    dialect,
    "app",
    declared
  );
  // No files, nothing to look up: the ledger is not read at all.
  if (all.length === 0) return [];
  const hasLedger = await (
    adapter as unknown as { tableExists: (n: string) => Promise<boolean> }
  ).tableExists("nextly_schema_events");
  if (!hasLedger) return all.map(file => ({ file, applied: false }));
  return withApplied(all, new SchemaEventsRepository(db, dialect));
}

/** `files` in run order, each with whether the ledger records it applied. */
async function withApplied(
  files: readonly ParsedMigration[],
  repo: SchemaEventsRepository
): Promise<{ file: ParsedMigration; applied: boolean }[]> {
  const listed: { file: ParsedMigration; applied: boolean }[] = [];
  for (const file of files) {
    listed.push({
      file,
      applied: await repo.isFileApplied(`${file.name}.sql`),
    });
  }
  return listed;
}

/**
 * What a run with `step` does with `listed`: the files the ledger records applied (`done`), the
 * files it applies (`runs`, as `filesWithinStep` reads them, so the dry run lists the same), and
 * the file it goes on to past its step inside a move (`continuesAt`), with what it says there. A
 * step of zero or less reads as no limit here, as it always has; to `filesWithinStep` it would
 * mean no file at all.
 */
function fileRunPlan(
  listed: readonly { file: ParsedMigration; applied: boolean }[],
  step: number | undefined
): {
  done: ReadonlySet<ParsedMigration>;
  runs: ReadonlySet<ParsedMigration>;
  continuesAt: ParsedMigration | undefined;
  notice: string;
} {
  const within = filesWithinStep(
    listed.map(({ file, applied }) => ({ file, done: applied })),
    step !== undefined && step > 0 ? step : undefined,
    "up"
  );
  return {
    done: new Set(listed.filter(l => l.applied).map(l => l.file)),
    runs: new Set(within.run),
    // Past the budget only inside a move, so this is set exactly when `continued` is.
    continuesAt: within.run[within.budget],
    notice:
      within.continued === undefined
        ? ""
        : stepContinuedNotice(within.continued),
  };
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
 * Refuses a `unique` companion file whose per-language unique index cannot hold
 * (`refuseTranslatedUniqueMigrationThatCannotHold`), and returns the UP it should run here: the
 * file's own, less any index this database already carries.
 *
 * A companion file is snapshotless and runs verbatim, so one generated from a pre-feature
 * snapshot still creates an index that `db:sync` or a Schema Builder save may already have
 * installed on this database. PostgreSQL and SQLite adopt it through `IF NOT EXISTS`; MySQL has
 * no such spelling and would fail on the duplicate name. Any other file passes untouched.
 */
async function refuseUniqueFileThatCannotHold(
  adapter: DrizzleAdapter,
  localization: LocalizationMigrationIntent | undefined,
  filename: string,
  upSql: string
): Promise<string> {
  if (localization?.kind !== "unique") return upSql;
  const {
    installedTranslatedUniqueIndexes,
    refuseTranslatedUniqueMigrationThatCannotHold,
    withoutAlreadyInstalledIndexes,
  } = await import(
    "../../domains/i18n/migration/translated-unique-preconditions"
  );
  const installed = await installedTranslatedUniqueIndexes(
    adapter,
    localization.spec.companionTable
  );
  await refuseTranslatedUniqueMigrationThatCannotHold(
    adapter,
    localization.spec,
    filename,
    installed
  );
  const statements = splitSqlStatements(upSql, adapter.dialect);
  const keep = withoutAlreadyInstalledIndexes(statements, installed);
  return keep.length === statements.length
    ? upSql
    : keep
        .map(statement => `${statement};`)
        .join("\n--> statement-breakpoint\n");
}

/**
 * Refuses a companion file whose header records the settings a move out of translation applies
 * (an `archive` or `shared` file, or a `unique` file dropping a per-language index ahead of them),
 * where the fields' default-language values cannot take them
 * (`refuseLeavingFileThatCannotTakeItsSettings`). Any other file, and one written before headers
 * recorded settings, passes untouched.
 */
async function refuseLeavingFileThatCannotTakeItsSettings(
  adapter: DrizzleAdapter,
  localization: LocalizationMigrationIntent | undefined,
  filename: string
): Promise<void> {
  // The archive and shared files of a move out of translation carry its settings, and so does a
  // per-language unique-index drop that runs before them for a field unique before and after.
  if (
    localization?.kind !== "archive" &&
    localization?.kind !== "shared" &&
    localization?.kind !== "unique"
  )
    return;
  if (localization.spec.settings === undefined) return;
  const { refuseLeavingFileThatCannotTakeItsSettings: refuse } = await import(
    "../../domains/i18n/migration/leaving-constraint-preconditions"
  );
  // The shared file runs after the main file, so the main table has the fields' columns by then.
  await refuse(
    adapter,
    localization.spec,
    filename,
    localization.kind === "shared"
  );
}

/**
 * Phase 2 — apply pending user migration files via §4.7 drift reconciliation.
 * Walks files in lex order, carrying each file's target snapshot forward as the
 * next file's baseline. Returns the count actually applied.
 */
/**
 * Refuses, before any app file runs, a file to run whose UP is not the one its
 * deletions were judged from under the lock (`judgeFileDeletions`): the files
 * are read again to run, and one edited, or added, in between would otherwise
 * run without its deletions ever judged.
 */
function assertRunsAsJudged(
  files: readonly ParsedMigration[],
  judged: ReadonlyMap<string, string> | undefined
): void {
  // A caller that judged nothing (a boot's own run) has nothing to hold the files to.
  if (judged === undefined) return;
  for (const m of files) {
    const filename = `${m.name}.sql`;
    if (judged.get(filename) === textDigest(m.upSql)) continue;
    throw NextlyError.invalidInput({
      message: `\`${filename}\` changed after this run judged what it deletes, so none of the app's migration files ran. Run \`nextly migrate\` again to judge it as it stands.`,
      logContext: { reason: "file-changed-after-judgement", file: filename },
    });
  }
}

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
  /** What the declared schema names, which old Builder files are judged against. */
  declared?: DeclaredNames;
  /** See `MigrateCoreDeps.refuseUnrecognisedBuilderFiles`. */
  refuseUnrecognisedBuilderFiles?: boolean;
  /**
   * The app files the run judged under its lock for what they delete, by
   * filename, with the digest of the UP judged (`judgeFileDeletions`). Given,
   * a file to run that differs, or was not judged, is refused before any file
   * runs (`assertRunsAsJudged`).
   */
  judged?: ReadonlyMap<string, string>;
}): Promise<number> {
  const { adapter, db, dialect, migrationsDir, logger } = args;
  // The files about to run judged once more, as they read now: the folder may
  // have changed since the run's earlier checks.
  if (args.refuseUnrecognisedBuilderFiles === true) {
    await refuseUnrecognisedBuilderFiles(args);
  }
  // Passing dialect prefers {name}.{dialect}.sql over base {name}.sql when both exist
  const all = await discoverMigrations(
    migrationsDir,
    logger,
    dialect,
    "app",
    args.declared
  );
  if (all.length === 0) {
    logger.debug("No user migration files found.");
    return 0;
  }

  const repo = new SchemaEventsRepository(db, dialect);
  const metaDir = resolve(migrationsDir, "meta");

  const dz = adapter as unknown as DrizzleAdapter;
  const executeSql = buildSqlExecutor(dz, dialect, logger);

  // Owner rows for the drop guard: an app file dropping a plugin-migrated
  // table is refused whole, before its first statement. Read once; an absent
  // registry, a database predating it, reads as no owner rows. The guard
  // still refuses an app file dropping or renaming a core table, which needs
  // no row to be core's; any other table is the app's. Absent only when the
  // listing says so: a listing that fails stops the run rather than
  // disabling the guard.
  const {
    SchemaOwnersRepository: OwnersRepoForFiles,
    schemaOwnersTableExists,
    tableOwnersByName,
  } = await import("../../domains/schema/ownership/schema-owners-repository");
  const registryExists = await schemaOwnersTableExists(
    adapter as unknown as { listTables: () => Promise<string[]> }
  );
  const fileOwnerRows = registryExists
    ? await new OwnersRepoForFiles(db, dialect).read()
    : [];
  const fileOwners = tableOwnersByName(fileOwnerRows);

  let before: NextlySchemaSnapshot = EMPTY_SNAPSHOT;
  let beforeContributions: Record<string, ContributedElements> = {};
  let applied = 0;
  const plan = fileRunPlan(await withApplied(all, repo), args.step);
  assertRunsAsJudged(
    all.filter(m => plan.runs.has(m)),
    args.judged
  );

  for (const m of all) {
    const filename = `${m.name}.sql`;
    const targetFile = await loadTargetSnapshot(metaDir, m.name);
    const target = targetFile?.snapshot ?? null;

    if (plan.done.has(m)) {
      // Advance the baseline past applied files.
      if (targetFile) {
        before = targetFile.snapshot;
        beforeContributions = targetFile.contributions ?? {};
      }
      continue;
    }
    if (!plan.runs.has(m)) break;
    if (m === plan.continuesAt) logger.info(plan.notice);

    // Both apply routes run the same whole-file judgement, so a foreign drop
    // — or a statement the runner's transaction cannot hold — is refused
    // identically with or without a paired snapshot, before the ledger
    // records an attempt.
    const upStatements = splitSqlStatements(m.upSql, dialect, m);
    assertNoForeignDrops({
      statements: upStatements,
      stream: "app",
      owners: fileOwners,
      elementOwners: fileOwnerRows,
      // What the app's earlier files contributed to other owners' tables is
      // the app's before the run ends and writes its element rows.
      ownedElements: beforeContributions,
      dialect,
      source: filename,
      liveColumns: await readLiveColumns(db, dialect, [upStatements]),
      liveElements: await readLiveElements(db, dialect, [upStatements]),
      // Read before each file, after the files before it have run.
      liveTables: await readLiveTables(db, dialect, [upStatements]),
      liveIndexTables: await readLiveIndexTables(db, dialect, [upStatements]),
    });
    assertRunnableStatements(upStatements, dialect, filename, {
      transaction: m.transaction,
      unit: "file",
    });
    // A column made required over rows that would break it: refused here, before any statement.
    await refuseRequiredColumnsOverNulls(db, dialect, upStatements, filename);
    // A file adding per-language unique indexes is refused here, before the ledger records an
    // attempt and before any statement, where one cannot hold. It also answers with the UP to
    // run on THIS database, which leaves out an index already installed here.
    m.upSql = await refuseUniqueFileThatCannotHold(
      dz,
      m.localization,
      filename,
      m.upSql
    );
    // A file moving fields out of translation is refused here too, where their default language's
    // values cannot take the Required or Unique setting the move applies after its copy: at the
    // archive file, before the move's first statement, and again at the shared file.
    await refuseLeavingFileThatCannotTakeItsSettings(
      dz,
      m.localization,
      filename
    );

    if (!target) {
      // No paired snapshot (hand-written migration): run verbatim + record.
      logger.warn(
        `No snapshot for ${filename}; applying verbatim without drift checks.`
      );
      // With no snapshot to place the database, a failed attempt that may
      // have left statements applied is refused here as the reconcile
      // refuses it, rather than run again on top of what stayed.
      await assertNotPartiallyApplied(
        { filename, transaction: m.transaction },
        dialect,
        repo,
        "rerun",
        // A file moving fields out of translation says exactly how to tell whether it landed.
        m.localization?.kind === "shared"
          ? sharedFileRecoveryAdvice(filename, m.localization.spec)
          : undefined
      );
      // Recorded as the reconcile records a file it runs, with the attempt
      // before the first statement or inside the file's transaction. A
      // statement's own failure is named with its file, as the reconcile
      // names it; a refusal of the run's own already says what it refused.
      try {
        await runRecordedAttempt({
          file: {
            filename,
            sql: m.upSql,
            path: m.filePath,
            sha256: m.checksum,
            transaction: m.transaction,
          },
          dialect,
          repo,
          executeSql,
        });
      } catch (err) {
        throw NextlyError.is(err) ? err : applyFailedError(filename, err);
      }
      applied++;
      logger.success(`Applied ${filename}`);
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
      file: {
        filename,
        sql: m.upSql,
        path: m.filePath,
        sha256: m.checksum,
        transaction: m.transaction,
      },
      before: sides.before,
      target: sides.target,
      live: sides.live,
      dialect,
      repo,
      executeSql,
    });
    before = target;
    beforeContributions = targetFile?.contributions ?? {};
    applied++;
    logger.success(`Applied ${filename}`);
  }

  return applied;
}

async function discoverMigrations(
  migrationsDir: string,
  logger: CommandContext["logger"],
  dialect: SupportedDialect,
  source: MigrationSource = "app",
  declared?: DeclaredNames
): Promise<ParsedMigration[]> {
  const migrations: ParsedMigration[] = [];
  for (const { baseName, filePath } of await migrationFilesInRunOrder(
    migrationsDir,
    dialect,
    declared
  )) {
    if (filePath === undefined) {
      logger.warn(`No suitable migration file found for ${baseName}`);
      continue;
    }

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
        `Failed to parse migration file ${basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`
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
  const checksum = checksumOf(content);

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
    transaction: !marksNoTransaction(content),
    ...(localization === null ? {} : { localization }),
  };
}

/**
 * The splitter lives with the migration domain, where the plugin runner and
 * the drop guard read it; re-exported for the command modules and tests that
 * import it from here.
 */
export { splitSqlStatements };

// F11: dropped local generateUUID() in favor of node:crypto's randomUUID,
// which is what the rest of the codebase uses (matches schema/migration-journal
// pattern from F8 PR 5). Avoids re-implementing UUID v4 generation.

/**
 * The action of `nextly migrate`, loaded when it runs.
 */
export async function migrateAction(
  cmdOptions: MigrateCommandOptions,
  cmd: Command
): Promise<void> {
  const { context, options } = commandRun(cmdOptions, cmd);
  const resolvedOptions: ResolvedMigrateOptions = options;

  try {
    await runMigrate(resolvedOptions, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}

export { registerMigrateCommand } from "./migrate.command";
