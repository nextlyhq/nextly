/**
 * `nextly migrate:check`.
 *
 * CI-friendly integrity verification for migration files. Does NOT
 * connect to a database. Six checks run in order; first failure
 * exits non-zero with a specific error code:
 *
 *   1. CHECKSUM_MISMATCH  - A `.sql` file's content differs from the
 *      hash recorded in its paired `.snapshot.json` (someone edited
 *      the file after `migrate:create` generated it).
 *   2. MISSING_SNAPSHOT   - A `.sql` file has no paired `.snapshot.json`
 *      (operator deleted the snapshot or the file was added by hand).
 *   3. INVALID_SNAPSHOT   - A `.snapshot.json` file is malformed
 *      (corrupted JSON, hand-edited, or written by a future nextly
 *      version with an incompatible envelope).
 *   4. MISSING_MIGRATION  - A `.snapshot.json` file has no paired `.sql`
 *      (someone deleted the SQL but kept the snapshot).
 *   5. SCHEMA_DRIFT       - `nextly.config.ts` has uncommitted changes
 *      relative to the latest snapshot (operator forgot to run
 *      `migrate:create` after editing config).
 *   6. SETTINGS_DRIFT     - An entity's settings (labels, description, admin
 *      options, a field's help text...) differ from the latest snapshot's
 *      record of them. Skipped when that snapshot predates the record.
 *
 * Before the drift check it also warns, without failing, about each file
 * holding a statement `nextly migrate` or `migrate:down` would refuse
 * (`REFUSED_STATEMENT`), and about each file whose UP or DOWN deletes data,
 * naming what it deletes (`DESTRUCTIVE`), and names each file marked
 * `-- nextly:no-transaction`. A warning, because the check does not connect:
 * a file already applied is never run again, and failing CI over one would
 * leave the operator nothing to fix.
 *
 * Exit codes:
 *   0 - All checks passed.
 *   1 - Any check failed; see printed reason.
 *
 * @module cli/commands/migrate-check
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # CI integrity gate
 * nextly migrate:check
 * ```
 *
 * **Runtime restriction (F11):** This module is CLI-only. Do NOT import
 * it from runtime code (init/, route-handler/, dispatcher/, api/,
 * actions/, direct-api/, routeHandler.ts, next.ts). The deployed
 * Next.js app must not perform schema migrations at boot. Enforced by
 * ESLint (`no-restricted-imports`); see
 * docs/guides/production-migrations.mdx.
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Command } from "commander";

import { LOCALIZATION_MIGRATION_MARKER } from "../../domains/i18n/migration/write-migration-file";
import {
  describeDeletion,
  type Deletion,
} from "../../domains/schema/migrate/data-loss-consent";
import {
  fileDeletions,
  functionsDefinedBy,
} from "../../domains/schema/migrate/file-deletions";
import { offlineDeletionFacts } from "../../domains/schema/migrate/offline-deletion-facts";
import { declaredNamesOf } from "../../domains/schema/migrate/resolved-schema";
import {
  marksNoTransaction,
  splitSqlStatements,
  statementRefusals,
} from "../../domains/schema/migrate/split-sql";
import { parseSqlSections } from "../../domains/schema/migrate/sql-sections";
import { reportMigrationAddresses } from "../../domains/schema/migrate-create/addresses";
import {
  appStreamSnapshots,
  compileAppStreamTables,
  NO_APP_STREAM_TABLES,
  type AppStreamTables,
} from "../../domains/schema/migrate-create/app-stream";
import { toMinimalEntities } from "../../domains/schema/migrate-create/config-entities";
import {
  describeSettingsChange,
  settingsChangesFor,
  type EntitySettingsRecord,
} from "../../domains/schema/migrate-create/entity-settings";
import type { MinimalConfigEntity } from "../../domains/schema/migrate-create/generate";
import { buildDesiredSnapshotFromConfig } from "../../domains/schema/migrate-create/generate";
import { reportMigrationSiblingFields } from "../../domains/schema/migrate-create/sibling-fields";
import {
  EMPTY_SNAPSHOT,
  loadLatestSnapshot,
  parseSnapshotFile,
  SnapshotFileError,
  verifyMigrationHash,
} from "../../domains/schema/migrate-create/snapshot-io";
import { describeOp } from "../../domains/schema/pipeline/diff/describe-operation";
import { diffSnapshots } from "../../domains/schema/pipeline/diff/diff";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import { siblingClashesErrorFor } from "../../domains/schema/sibling-fields";
import { validateCrossFile } from "../../domains/schema/ui-schema/cross-file";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import {
  applyDeferredExtendsToManifest,
  mergeUiEntities,
} from "../../domains/schema/ui-schema/merge";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../../domains/schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name";
import { addressRefusalsError } from "../../shared/address-rule";
import { assertPluginFieldDeclarations } from "../../shared/lib/assert-plugin-field-declarations";
import {
  type CliError,
  configDeclarationError,
  exitWithError,
} from "../errors";
import {
  migrationFileEdited,
  migrationSnapshotInvalid,
  migrationSnapshotMissing,
  schemaChangeWithoutMigration,
  settingsChangeWithoutMigration,
  snapshotWithoutMigration,
} from "../errors/areas/migrations";
import { builderSchemaConflict } from "../errors/areas/plugin-config";
import { createContext, type CommandContext } from "../program";
import type { SupportedDialect } from "../utils/adapter";
import {
  loadDeclaredConfigOrExit,
  requireDatabaseEnv,
} from "../utils/command-prerequisites";
import {
  discoverMigrationGroups,
  type DeclaredNames,
  getSortedBaseNames,
  oldBuilderFileLine,
  partialBuilderFileLine,
  readMigrationFolder,
  selectVariant,
} from "../utils/migration-discovery";

// ============================================================================
// Types
// ============================================================================

// F11 PR 4: no command-specific options today. Global options
// (--config, --cwd, --verbose, --quiet) are inherited from the program.
// `Record<string, never>` is the idiomatic "intentionally empty" shape;
// avoids the `_placeholder?: never` workaround the first draft used.
export type MigrateCheckCommandOptions = Record<string, never>;

interface ResolvedMigrateCheckOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

export async function runMigrateCheck(
  options: ResolvedMigrateCheckOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  logger.header("Migrate Check");

  // F11 PR 4: dialect comes from DATABASE_URL but we don't connect —
  // we just need to know which SQL flavor the diff engine should target
  // when computing the desired snapshot. Without this, drift-check
  // results would be inconsistent across dialects.
  const dbValidation = requireDatabaseEnv(logger);
  const dialect = dbValidation.dialect;

  // Load config.
  // The configuration with its plugin field declarations checked; an invalid
  // one is reported and the check exits, like every other check failure.
  const configResult = await loadDeclaredConfigOrExit(
    {
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    },
    logger
  );
  if (configResult === undefined) return;

  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

  // Layer 5: load + validate ui-schema.json (intra-file via loadUiSchema's Zod).
  let manifest;
  try {
    manifest = await loadUiSchema({
      projectRoot: cwd,
      uiSchemaFile: configResult.config.db.uiSchemaFile,
    });
  } catch (error) {
    exitWithError(logger, error);
  }

  // Materialize plugin extends that target Builder-made entities (P8) so the
  // drift comparison below sees the same schema migrate:create would produce.
  manifest = applyDeferredExtendsToManifest(
    manifest,
    configResult.deferredExtends ?? []
  );

  // The manifest gets the same check the code-first config got above, once its
  // deferred extends are materialized: a Builder-owned entity can carry a
  // plugin field too, and a plugin extending one contributes its fields here
  // rather than in the config. Only entities a code-first entity does not
  // shadow are checked, because a shadowed one never reaches the snapshot.
  const surviving = <T extends { slug: string }>(
    list: readonly T[] | undefined,
    codeFirst: ReadonlyArray<{ slug: string }> | undefined
  ): T[] => {
    const shadowed = new Set((codeFirst ?? []).map(e => e.slug));
    return (list ?? []).filter(e => !shadowed.has(e.slug));
  };

  try {
    assertPluginFieldDeclarations({
      collections: surviving(
        manifest.collections,
        configResult.config.collections
      ),
      singles: surviving(manifest.singles, configResult.config.singles),
      fieldGroups: surviving(
        manifest.components,
        configResult.config.fieldGroups
      ),
    });
  } catch (error) {
    exitWithError(logger, configDeclarationError(error) ?? error);
  }

  // Cross-file checks (slug collision, relation targets).
  const crossIssues = validateCrossFile({
    codeCollectionSlugs: configResult.config.collections.map(
      (c: { slug: string }) => c.slug
    ),
    manifest,
  });
  if (crossIssues.length > 0) {
    exitWithError(logger, builderSchemaConflict(crossIssues));
  }

  // Merge code + UI entities (code-first wins) for the drift comparison.
  const merged = mergeUiEntities({
    codeCollections: toMinimalEntities(configResult.config.collections, e =>
      resolveCollectionTableName(e.slug, e.dbName)
    ),
    codeSingles: toMinimalEntities(configResult.config.singles ?? [], e =>
      resolveSingleTableName({ slug: e.slug, dbName: e.dbName })
    ),
    codeComponents: toMinimalEntities(
      configResult.config.fieldGroups ?? [],
      e => resolveComponentTableName(e.slug)
    ),
    manifest,
  });

  // Built once the latest snapshot is read, as `migrate:create` builds it:
  // a field a plugin holds back from a type switched off keeps its column
  // while that snapshot has it.
  const desiredSnapshot = (existing: NextlySchemaSnapshot) =>
    buildDesiredSnapshotFromConfig(
      merged.collections,
      merged.singles,
      merged.components,
      dialect,
      existing
    );

  // The app stream's extension schema, compiled exactly as `migrate:create`
  // compiles it. Without it every table an app declared through
  // `db.schema.extend` was in the latest snapshot and absent from this side,
  // so the check reported a drop of each one — on every run, for every app
  // that used the documented hook.
  const appStream = await compileAppStreamTables({
    config: configResult.config,
    dialect,
    logger: { warn: m => logger.warn(m) },
  });

  // Read as `nextly migrate` reads the folder.
  const declared = await declaredNamesOf({
    ...configResult,
    projectRoot: cwd,
  });

  await runChecks({
    migrationsDir,
    desiredSnapshot,
    appStream,
    dialect,
    declared,
    // Each entity with its settings, as `migrate:create` records them; the
    // merge sets a Builder entity's (`uiToMinimal`).
    entities: merged,
    logger,
  });
}

/**
 * F11 PR 4: pure-input check pipeline. Extracted so unit tests can call
 * it with a tmp `migrationsDir` + a hand-built desired snapshot, without
 * spinning up the loadConfig + validateDatabaseEnv plumbing.
 *
 * The CLI entry point (`runMigrateCheck`) loads config + dialect, builds
 * the desired snapshot, then delegates here. All `process.exit(1)` calls
 * happen inside this function — callers don't need to handle exit codes.
 */
export async function runChecks(args: {
  migrationsDir: string;
  /**
   * What the entities alone describe; the extension schema is `appStream`.
   * Or how to build it from the latest snapshot's tables, which keep the
   * columns of fields a plugin holds back from a type switched off.
   */
  desiredSnapshot:
    | NextlySchemaSnapshot
    | ((existing: NextlySchemaSnapshot) => NextlySchemaSnapshot);
  /** The app stream's extension schema. Omitted, there is none. */
  appStream?: AppStreamTables;
  /**
   * The dialect the files will run on, for the statement check. Omitted, the
   * check is skipped.
   */
  dialect?: SupportedDialect;
  /** What the declared schema names, which old Builder files are judged against. */
  declared?: DeclaredNames;
  /**
   * The declared entities with their settings, compared with the newest
   * snapshot's settings record. Omitted, settings are not checked.
   */
  entities?: {
    collections: readonly MinimalConfigEntity[];
    singles: readonly MinimalConfigEntity[];
    components: readonly MinimalConfigEntity[];
  };
  logger: CommandContext["logger"];
}): Promise<void> {
  const { migrationsDir, logger } = args;
  const metaDir = resolve(migrationsDir, "meta");

  let sqlFiles: string[];
  try {
    sqlFiles = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql"));
  } catch {
    sqlFiles = [];
  }
  sqlFiles = await withoutOldBuilderFiles(
    sqlFiles,
    migrationsDir,
    args.dialect,
    args.declared,
    logger
  );

  let snapshotFiles: string[];
  try {
    snapshotFiles = (await readdir(metaDir)).filter(f =>
      f.endsWith(".snapshot.json")
    );
  } catch {
    snapshotFiles = [];
  }

  logger.debug(
    `Inspecting ${sqlFiles.length} .sql file(s) and ${snapshotFiles.length} snapshot file(s).`
  );

  // Check 1+2: hash + missing snapshot per .sql file.
  for (const sqlName of sqlFiles) {
    const sqlContent = await readFile(resolve(migrationsDir, sqlName), "utf-8");
    // Localization/companion migrations are snapshot-less by design (they carry
    // cross-table seed SQL run verbatim), so skip the snapshot-pairing checks
    // rather than flagging them MISSING_SNAPSHOT.
    if (sqlContent.includes(LOCALIZATION_MIGRATION_MARKER)) continue;
    let result;
    try {
      result = await verifyMigrationHash(metaDir, sqlName, sqlContent);
    } catch (err) {
      // F11 PR 4 review fix #3: distinct INVALID_SNAPSHOT code so the
      // operator can tell "snapshot file is corrupt / version-mismatched"
      // (fix = regenerate or upgrade nextly) apart from "snapshot is
      // missing entirely" (fix = git checkout).
      if (err instanceof SnapshotFileError) {
        return exitWithError(logger, migrationSnapshotInvalid(err.message));
      }
      throw err;
    }
    if (!result.ok && result.expected === undefined) {
      return exitWithError(logger, migrationSnapshotMissing(sqlName, metaDir));
    }
    if (!result.ok) {
      return exitWithError(
        logger,
        migrationFileEdited(sqlName, result.expected, result.actual)
      );
    }
  }

  // Check 3: missing migration per snapshot.
  const sqlBaseNames = new Set(sqlFiles.map(f => f.replace(/\.sql$/, "")));
  for (const snapName of snapshotFiles) {
    const baseName = snapName.replace(/\.snapshot\.json$/, "");
    if (!sqlBaseNames.has(baseName)) {
      return exitWithError(
        logger,
        snapshotWithoutMigration(snapName, baseName)
      );
    }
  }

  // Statements a run would refuse, judged by the check the run makes, so CI
  // shows them before a deploy meets them. Warned rather than failed: this
  // check cannot tell a pending file from an applied one, which never runs
  // again.
  if (args.dialect !== undefined) {
    reportStatements(
      await judgeStatements(migrationsDir, args.dialect, args.declared),
      logger
    );
  }

  // Check 4: schema drift (config vs latest snapshot).
  //
  // Both sides come from `appStreamSnapshots`, the function `migrate:create`
  // diffs through, so a change the generator has written is never reported
  // here as pending.
  let previousSnapshot: NextlySchemaSnapshot;
  let desiredSnapshot: NextlySchemaSnapshot;
  let latest: Awaited<ReturnType<typeof loadLatestSnapshot>>;
  try {
    latest = await loadLatestSnapshot(metaDir);
    const existing = latest?.data.snapshot ?? EMPTY_SNAPSHOT;
    const stream = appStreamSnapshots({
      previous: existing,
      previousContributions: latest?.data.contributions ?? {},
      desired:
        typeof args.desiredSnapshot === "function"
          ? args.desiredSnapshot(existing)
          : args.desiredSnapshot,
      tables: args.appStream ?? NO_APP_STREAM_TABLES,
    });
    previousSnapshot = stream.previous;
    desiredSnapshot = stream.desired;
  } catch (err) {
    // F11 PR 4 review fix #3: see INVALID_SNAPSHOT comment above.
    if (err instanceof SnapshotFileError) {
      return exitWithError(logger, migrationSnapshotInvalid(err.message));
    }
    throw err;
  }

  // Addresses, by the one address rule, before the drift a new entity also
  // shows. A new one the rule refuses fails the check; one an entity already
  // has (its table is in the latest snapshot) keeps working, and is reported
  // once as a warning naming the address and the reason. A refusal ends in the
  // CLI's error shape, as every other failed check here does.
  const refused = reportMigrationAddresses(args.entities, latest, logger);
  if (refused.length > 0) {
    return exitWithError(logger, addressRefusalsError(refused));
  }
  // Sibling fields, by the one sibling rule: a new pair fails the check; one an entity already
  // holds (the latest snapshot records it) keeps working and is warned about once.
  const refusedSiblings = reportMigrationSiblingFields(
    args.entities,
    latest,
    logger
  );
  if (refusedSiblings.length > 0) {
    return exitWithError(logger, siblingClashesErrorFor(refusedSiblings));
  }

  const ops = diffSnapshots(previousSnapshot, desiredSnapshot);
  if (ops.length > 0) {
    // Cap the listed ops at 10 to keep CI logs readable on large drifts.
    const listed = ops.slice(0, 10).map(op => `+ ${describeOp(op)}`);
    if (ops.length > 10) listed.push(`... and ${ops.length - 10} more`);
    return exitWithError(
      logger,
      schemaChangeWithoutMigration(ops.length, listed)
    );
  }

  const settingsDrift = settingsInStep(args.entities, latest?.data.entities);
  if (settingsDrift !== undefined) return exitWithError(logger, settingsDrift);

  logger.success(
    `migrate:check OK — ${sqlFiles.length} migration file(s), no drift.`
  );
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * `sqlFiles` as every reader of the folder reads them: an old Builder file is
 * named and checked no further, and a file with only part of its signature is
 * named with what it lacks and checked as any migration. Classifying reads
 * statements, so without a dialect no file is set aside.
 */
async function withoutOldBuilderFiles(
  sqlFiles: string[],
  migrationsDir: string,
  dialect: SupportedDialect | undefined,
  declared: DeclaredNames | undefined,
  logger: CommandContext["logger"]
): Promise<string[]> {
  if (dialect === undefined) return sqlFiles;
  const folder = await readMigrationFolder(migrationsDir, dialect, declared);
  const ignored = new Set(folder.oldBuilderFiles.map(f => f.file));
  for (const file of folder.oldBuilderFiles) {
    logger.info(oldBuilderFileLine(file));
  }
  for (const file of folder.partialBuilderFiles) {
    logger.warn(partialBuilderFileLine(file));
  }
  return sqlFiles.filter(f => !ignored.has(f));
}

/**
 * Check 6: settings changed with no migration for them, as the error the
 * check ends with; undefined when there are none.
 *
 * The delta is the one `migrate:create` writes a migration for. A newest
 * snapshot written before settings were recorded says nothing about them, so
 * its silence is never a difference: there is nothing to compare until the
 * first `migrate:create` after upgrading records them.
 */
function settingsInStep(
  entities:
    | {
        collections: readonly MinimalConfigEntity[];
        singles: readonly MinimalConfigEntity[];
        components: readonly MinimalConfigEntity[];
      }
    | undefined,
  recorded: EntitySettingsRecord | undefined
): CliError | undefined {
  if (entities === undefined || recorded === undefined) return undefined;
  const changes = settingsChangesFor(entities, recorded);
  if (changes.length === 0) return undefined;
  const listed = changes
    .slice(0, 10)
    .map(change => `~ ${describeSettingsChange(change)}`);
  if (changes.length > 10) listed.push(`... and ${changes.length - 10} more`);
  return settingsChangeWithoutMigration(changes.length, listed);
}

/**
 * Prints what `judgeStatements` found: each file marked to run outside a
 * transaction, each statement a run would refuse (`REFUSED_STATEMENT`), and
 * each UP or DOWN that deletes data (`DESTRUCTIVE`). Warnings only.
 */
function reportStatements(
  judged: Awaited<ReturnType<typeof judgeStatements>>,
  logger: CommandContext["logger"]
): void {
  for (const file of judged.outsideTransaction) {
    logger.info(
      `${file} is marked -- nextly:no-transaction: it runs outside a transaction, and a failure part-way leaves the statements before it applied.`
    );
  }
  for (const { file, message } of judged.refused) {
    logger.warn(
      `REFUSED_STATEMENT: ${file}: nextly migrate and migrate:down refuse it while it is pending. ${message}`
    );
  }
  for (const { file, section, deletions } of judged.destructive) {
    const command = section === "UP" ? "nextly migrate" : "migrate:down";
    logger.warn(
      `DESTRUCTIVE: ${file} (${section}) deletes data: ${deletions.map(describeDeletion).join("; ")}. ${command} runs it only with --accept-data-loss covering each.`
    );
  }
}

/**
 * What `nextly migrate` and `migrate:down` would make of each migration
 * file's statements on `dialect`: the files marked to run outside a
 * transaction, and every statement either would refuse. The file judged is
 * the variant the run selects for the dialect, and both its UP and DOWN are
 * read, through `statementRefusals`, the check both commands make.
 */
export async function judgeStatements(
  migrationsDir: string,
  dialect: SupportedDialect,
  declared?: DeclaredNames
): Promise<{
  outsideTransaction: string[];
  refused: { file: string; message: string }[];
  destructive: {
    file: string;
    section: "UP" | "DOWN";
    deletions: Deletion[];
  }[];
}> {
  const outsideTransaction: string[] = [];
  const refused: { file: string; message: string }[] = [];
  const destructive: {
    file: string;
    section: "UP" | "DOWN";
    deletions: Deletion[];
  }[] = [];
  const groups = await discoverMigrationGroups(
    migrationsDir,
    dialect,
    declared
  );
  const metaDir = resolve(migrationsDir, "meta");
  // The schema before the file being read: nothing before the first file,
  // then the snapshot paired with the file before it (undefined when that
  // file has none, as a localisation file does).
  let before: NextlySchemaSnapshot | undefined = EMPTY_SNAPSHOT;
  const files = await readSections(migrationsDir, groups, dialect);
  // Without a catalog, a function counts as user-defined when a migration
  // file defines it (a qualified one outside pg_catalog always does).
  const functions = new Set(
    files.flatMap(({ sections }) =>
      sections.flatMap(([, statements]) =>
        functionsDefinedBy(statements, dialect)
      )
    )
  );
  for (const { file, transaction, sections } of files) {
    // UP runs against the schema before the file, DOWN against the one the
    // file leaves, which its own snapshot records.
    const after = await pairedSnapshot(metaDir, file);
    const schemaFor = { UP: before, DOWN: after };
    before = after;
    if (!transaction) outsideTransaction.push(file);
    for (const [section, statements] of sections) {
      for (const refusal of statementRefusals(statements, dialect, {
        transaction,
        unit: "file",
      })) {
        refused.push({ file, message: refusal.message });
      }
      const deletions = fileDeletions(
        statements,
        dialect,
        offlineDeletionFacts(schemaFor[section], functions)
      );
      if (deletions.length > 0) destructive.push({ file, section, deletions });
    }
  }
  return { outsideTransaction, refused, destructive };
}

/** Each migration file in run order, the dialect's variant, with its UP and DOWN split into statements. */
async function readSections(
  migrationsDir: string,
  groups: Awaited<ReturnType<typeof discoverMigrationGroups>>,
  dialect: SupportedDialect
): Promise<
  {
    file: string;
    transaction: boolean;
    sections: (readonly ["UP" | "DOWN", string[]])[];
  }[]
> {
  const files = [];
  for (const baseName of getSortedBaseNames(groups)) {
    const file = selectVariant(groups.get(baseName)?.variants ?? [], dialect);
    if (file === undefined) continue;
    const content = await readFile(resolve(migrationsDir, file), "utf-8");
    const transaction = !marksNoTransaction(content);
    const { upSql, downSql } = parseSqlSections(content);
    const split = (sql: string) =>
      splitSqlStatements(sql, dialect, { transaction });
    files.push({
      file,
      transaction,
      sections: [
        ["UP", split(upSql)],
        ["DOWN", split(downSql)],
      ] as const satisfies (readonly ["UP" | "DOWN", string[]])[],
    });
  }
  return files;
}

/**
 * The schema recorded by the snapshot paired with migration `file`, or
 * undefined when it has none or it cannot be read. `runChecks` has already
 * failed on an unreadable snapshot by then; this reader only judges what a
 * file deletes, which then falls back to leaving a rebuild to the run.
 */
async function pairedSnapshot(
  metaDir: string,
  file: string
): Promise<NextlySchemaSnapshot | undefined> {
  const name = `${file.replace(/\.sql$/, "")}.snapshot.json`;
  try {
    const content = await readFile(resolve(metaDir, name), "utf-8");
    return parseSnapshotFile(content, name).snapshot;
  } catch {
    return undefined;
  }
}

// SupportedDialect is the runtime dialect used to build the desired
// snapshot. Re-exported so tests can construct one without pulling in
// the adapter package.
export type { SupportedDialect };

// ============================================================================
// Command Action
// ============================================================================

/**
 * The action of `nextly migrate:check`, loaded when it runs.
 */
export async function migrateCheckAction(
  _cmdOptions: MigrateCheckCommandOptions,
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);

  const resolvedOptions: ResolvedMigrateCheckOptions = {
    config: globalOpts.config,
    verbose: globalOpts.verbose,
    quiet: globalOpts.quiet,
    cwd: globalOpts.cwd,
  };

  try {
    await runMigrateCheck(resolvedOptions, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
