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
 *      (operator deleted the snapshot or the file was added by hand). A
 *      blank migration has none by design and passes: one any of whose
 *      files, its dialect variants with it, carries the blank mark
 *      (`blankMigrationNames`).
 *      A dialect's variant (`<base>.mysql.sql`) pairs with its group's
 *      `<base>.snapshot.json` and is held to no hash (`groupFileOf`).
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
import { refuseWhileSaveLeftPartWay } from "../../domains/schema/builder-save/save-in-progress";
import {
  describeDeletion,
  type Deletion,
} from "../../domains/schema/migrate/data-loss-consent";
import { migrationNameOf } from "../../domains/schema/migrate/dialect-variant";
import {
  fileDeletions,
  functionsDefinedBy,
} from "../../domains/schema/migrate/file-deletions";
import {
  blankMigrationNames,
  forkedHistoryError,
  unrecordedMerges,
} from "../../domains/schema/migrate/history-line";
import { offlineDeletionFacts } from "../../domains/schema/migrate/offline-deletion-facts";
import { declaredNamesOf } from "../../domains/schema/migrate/resolved-schema";
import {
  marksNoTransaction,
  splitSqlStatements,
  statementRefusals,
} from "../../domains/schema/migrate/split-sql";
import { parseSqlSections } from "../../domains/schema/migrate/sql-sections";
import {
  changesBesideMoves,
  nothingUnwritten,
  settingsAlone,
  type UnwrittenChanges,
  unwrittenChangeLines,
  unwrittenChangesOf,
} from "../../domains/schema/migrate/unwritten-changes";
import { reportMigrationAddresses } from "../../domains/schema/migrate-create/addresses";
import { describeSettingsChange } from "../../domains/schema/migrate-create/entity-settings";
import type { MinimalConfigEntity } from "../../domains/schema/migrate-create/generate";
import { reportMigrationSiblingFields } from "../../domains/schema/migrate-create/sibling-fields";
import {
  EMPTY_SNAPSHOT,
  isOlderFormatSnapshot,
  loadLatestSnapshot,
  parseSnapshotFile,
  SnapshotFileError,
  type TemplateStart,
  verifyMigrationHash,
} from "../../domains/schema/migrate-create/snapshot-io";
import { templateStartFor } from "../../domains/schema/migrate-create/template-start";
import {
  SETTINGS_NOT_RECORDED_NOTICE,
  translationsNotRecordedNotice,
} from "../../domains/schema/pending/pending-changes";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import { siblingClashesErrorFor } from "../../domains/schema/sibling-fields";
import {
  type BuilderDefinitions,
  judgeBuilderDefinitions,
  readBuilderDefinitions,
} from "../../domains/schema/ui-schema/builder-definitions";
import { addressRefusalsError } from "../../shared/address-rule";
import {
  type CliError,
  configDeclarationError,
  exitWithError,
} from "../errors";
import {
  builderDefinitionIgnored,
  migrationFileEdited,
  migrationSnapshotInvalid,
  migrationSnapshotMissing,
  permissionChangeWithoutMigration,
  schemaChangeWithoutMigration,
  settingsChangeWithoutMigration,
  snapshotWithoutMigration,
} from "../errors/areas/migrations";
import { createContext, type CommandContext } from "../program";
import type { SupportedDialect } from "../utils/adapter";
import { loadDeclaredConfigOrExit } from "../utils/command-prerequisites";
import {
  discoverMigrationGroups,
  type DeclaredNames,
  getSortedBaseNames,
  oldBuilderFileLine,
  partialBuilderFileLine,
  readMigrationFolder,
  selectVariant,
} from "../utils/migration-discovery";
import { readWithoutDatabase } from "../utils/project-dialect";

// ============================================================================
// Types
// ============================================================================

// F11 PR 4: no command-specific options today. Global options
// (--config, --cwd, --verbose, --quiet) are inherited from the program.
// `Record<string, never>` is the idiomatic "intentionally empty" shape;
// avoids the `_placeholder?: never` workaround the first draft used.
export interface MigrateCheckCommandOptions {
  /** The dialect the migrations are for, where nothing else says (`projectDialect`). */
  dialect?: SupportedDialect;
}

interface ResolvedMigrateCheckOptions {
  dialect?: SupportedDialect;
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * `logger`, saying each warning once in the run. The comparison of the changes not yet in a
 * migration reads the inputs this command has read already (the Builder's definitions, the
 * entities' addresses and sibling fields), by the same rules, so what it would warn about them a
 * second time is said once.
 */
function warningsOnce(
  logger: CommandContext["logger"]
): CommandContext["logger"] {
  const said = new Set<string>();
  return {
    ...logger,
    warn: (message: string) => {
      if (said.has(message)) return;
      said.add(message);
      logger.warn(message);
    },
  };
}

export async function runMigrateCheck(
  options: ResolvedMigrateCheckOptions,
  context: CommandContext
): Promise<void> {
  const logger = warningsOnce(context.logger);

  logger.header("Migrate Check");

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

  // The check reads no database: the dialect comes from `--dialect`, the migration history or the
  // environment, without connecting. The changes are computed from what the project commits, so a
  // Builder definition file git ignores, which would make this check pass on one machine and fail
  // on another, is refused, whether or not this checkout holds it.
  const definitionFile = configResult.config.db.uiSchemaFile;
  const { dialect, definitionIgnored } = await readWithoutDatabase({
    flag: options.dialect,
    projectRoot: cwd,
    migrationsDir,
    definitionFile,
    logger,
  });
  if (definitionIgnored) {
    return exitWithError(logger, builderDefinitionIgnored(definitionFile));
  }

  // A Builder save this machine left part-way against this database refuses the check: the
  // migrations it reads do not describe the database until the save is settled. Asked before the
  // check reads anything, and again before it reports a pass, so a save that started while it read
  // the folder refuses it too. Another machine's or another database's is named only.
  const refuseLeftSave = async (notice: (line: string) => void) =>
    refuseWhileSaveLeftPartWay({
      projectRoot: cwd,
      postgresSchema: configResult.config.db.postgres?.schema,
      notice,
    });
  try {
    await refuseLeftSave(line => logger.warn(line));
  } catch (error) {
    exitWithError(logger, error);
  }

  // The Builder's definitions, read by the rules `migrate:create` reads them
  // by (`readBuilderDefinitions`), and judged against the newest snapshot once
  // `runChecks` reads it, as `migrate:create` judges them: the same definition
  // is refused by both with the same message, and a shadowed entity is warned
  // about, naming its kind. Plugin extends that target a Builder entity are
  // materialised, so the drift comparison below sees the schema
  // `migrate:create` would produce.
  let definitions: BuilderDefinitions;
  try {
    definitions = await readBuilderDefinitions({
      config: configResult.config,
      deferredExtends: configResult.deferredExtends ?? [],
      projectRoot: cwd,
      logger,
    });
  } catch (error) {
    exitWithError(logger, configDeclarationError(error) ?? error);
  }
  const { merged } = definitions;

  // Read as `nextly migrate` reads the folder.
  const declared = await declaredNamesOf({
    ...configResult,
    projectRoot: cwd,
  });

  await runChecks({
    migrationsDir,
    // The changes not yet in a migration, as `migrate:create` plans them from the inputs it reads:
    // the configuration, the plugins, the Builder's definitions and the app's extension tables.
    // This check reads no database, so settings an earlier snapshot never recorded are a notice.
    unwritten: () =>
      unwrittenChangesOf({
        config: configResult.config,
        ...(configResult.deferredExtends === undefined
          ? {}
          : { deferredExtends: configResult.deferredExtends }),
        projectRoot: cwd,
        migrationsDir,
        dialect,
        logger,
      }),
    dialect,
    declared,
    // Each entity with its settings, as `migrate:create` records them; the
    // merge sets a Builder entity's (`uiToMinimal`).
    entities: merged,
    // A project made from a template starts from the template's snapshot,
    // read as `migrate:create` reads it.
    templateStart: templateStartFor({
      collections: merged.collections,
      singles: merged.singles,
      plugins: configResult.config.plugins,
      dialect,
    }),
    definitions,
    // Asked again, its notices already given once.
    beforePass: () => refuseLeftSave(() => undefined),
    logger,
  });
}

/**
 * Ends the check, in the CLI's error shape, where the folder's history holds
 * migrations written without each other that no migration records together
 * (`history-line.ts`).
 */
async function failOnUnrecordedMerge(
  migrationsDir: string,
  logger: CommandContext["logger"]
): Promise<void> {
  // A history whose line cannot be read (a migration whose files state different places) is
  // refused by a throw, ended in the error shape by the command's own catch.
  const forked = forkedHistoryError(await unrecordedMerges(migrationsDir));
  if (forked !== undefined) exitWithError(logger, forked);
}

/**
 * How one migration file fails its pairing with its snapshot, or undefined where it passes:
 * the snapshot is malformed (INVALID_SNAPSHOT), missing (MISSING_SNAPSHOT), or records a hash
 * the file no longer has (CHECKSUM_MISMATCH). Its own function so `runChecks` stays one list of
 * checks rather than every branch of each.
 */
async function snapshotPairingError(
  migrationsDir: string,
  metaDir: string,
  sqlName: string,
  blank: boolean
): Promise<CliError | undefined> {
  const sqlContent = await readFile(resolve(migrationsDir, sqlName), "utf-8");
  // Localization/companion migrations are snapshot-less by design (they carry
  // cross-table seed SQL run verbatim), so skip the snapshot-pairing checks
  // rather than flagging them MISSING_SNAPSHOT.
  if (sqlContent.includes(LOCALIZATION_MIGRATION_MARKER)) return undefined;
  let result;
  try {
    result = await verifyMigrationHash(
      metaDir,
      groupFileOf(sqlName),
      sqlContent
    );
  } catch (err) {
    // A distinct INVALID_SNAPSHOT code so the operator can tell "snapshot file
    // is corrupt / version-mismatched" (fix = regenerate or upgrade nextly)
    // apart from "snapshot is missing entirely" (fix = git checkout).
    if (err instanceof SnapshotFileError) {
      return migrationSnapshotInvalid(err.message);
    }
    throw err;
  }
  return pairingOutcome(sqlName, blank, metaDir, result);
}

/**
 * What the hash read of `sqlName` against its group's snapshot comes to (`snapshotPairingError`):
 * nothing where it matches, MISSING_SNAPSHOT where no snapshot is there and the file's migration
 * is not `blank`, CHECKSUM_MISMATCH where the file is not the one recorded.
 */
function pairingOutcome(
  sqlName: string,
  blank: boolean,
  metaDir: string,
  result: { ok: boolean; expected?: string; actual: string }
): CliError | undefined {
  if (result.ok) return undefined;
  if (result.expected === undefined) {
    // A blank migration is its author's SQL, which `migrate:create --blank` pairs with no
    // snapshot, so none is missing. One that does have a snapshot is held to it above, as
    // any file is. `blank` is the migration's, read with its dialect variants: a mark in any
    // of its files marks each of them.
    if (blank) return undefined;
    return migrationSnapshotMissing(sqlName, metaDir);
  }
  // A dialect's variant is held to no hash: its group's snapshot records the base file's, which
  // the base file is held to, and none is recorded for a variant.
  if (groupFileOf(sqlName) !== sqlName) return undefined;
  return migrationFileEdited(sqlName, result.expected, result.actual);
}

/**
 * The `.sql` name of the migration `sqlName` is a file of: a dialect's variant (`<base>.mysql.sql`)
 * is its group's (`<base>.sql`), as the runner groups the folder, so its snapshot is the group's
 * `meta/<base>.snapshot.json`; any other file is its own. `migrate:create` writes no snapshot per
 * variant.
 */
function groupFileOf(sqlName: string): string {
  return `${migrationNameOf(sqlName)}.sql`;
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
   * The changes not yet in a migration, as `migrate:create` plans them from the same inputs
   * (`unwrittenChangesOf`). Required: a caller that left it out would pass a project whose
   * changes nothing looked at.
   */
  unwritten: () => Promise<UnwrittenChanges>;
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
  /**
   * How a template's older-format snapshot, where it is the newest, is read
   * as starting tables (`templateStartFor`). Omitted, such a snapshot is
   * refused as invalid.
   */
  templateStart?: TemplateStart;
  /**
   * The Builder's definitions as `readBuilderDefinitions` read them, judged
   * against the newest snapshot as `migrate:create` judges them: a Builder
   * entity the file lost, then each relationship's target. Omitted, neither is
   * checked.
   */
  definitions?: BuilderDefinitions;
  /**
   * Asked once every check has read what it reads, before the check reports a pass: a Builder save
   * that started while the check read the folder refuses it then. Omitted, nothing is asked.
   */
  beforePass?: () => Promise<void>;
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

  // Check 1+2: hash + missing snapshot per .sql file. A template's own
  // migration is passed over: its snapshot carries no hash to hold it to.
  const templateFiles = await templateMigrationFiles(migrationsDir, metaDir);
  // Read once for the folder: a migration with no snapshot is blank where any of its files says
  // so. One with a snapshot is held to it, whatever its files say.
  const blankNames = await blankMigrationNames(
    migrationsDir,
    new Set(snapshotFiles.map(name => name.replace(/\.snapshot\.json$/, "")))
  );
  for (const sqlName of sqlFiles) {
    if (templateFiles.has(sqlName)) continue;
    const unpaired = await snapshotPairingError(
      migrationsDir,
      metaDir,
      sqlName,
      blankNames.has(migrationNameOf(sqlName))
    );
    if (unpaired !== undefined) return exitWithError(logger, unpaired);
  }

  // Check 3: missing migration per snapshot. A dialect's variant is a file of
  // its group's migration (`migrationNameOf`), so a group written only as
  // variants has its migration.
  const sqlBaseNames = new Set(sqlFiles.map(migrationNameOf));
  for (const snapName of snapshotFiles) {
    const baseName = snapName.replace(/\.snapshot\.json$/, "");
    if (!sqlBaseNames.has(baseName)) {
      return exitWithError(
        logger,
        snapshotWithoutMigration(snapName, baseName)
      );
    }
  }

  // One line of history: migrations written without each other, by two
  // writers at once or on two branches merged since, fail the check with
  // each named until a migration records the merge, as `nextly migrate`
  // refuses them.
  await failOnUnrecordedMerge(migrationsDir, logger);

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

  // Check 4: the changes not yet in a migration. The newest snapshot is read here for the checks
  // of the definitions and the addresses; the changes themselves are `migrate:create`'s own plan
  // (`unwritten`), so a change it has written is never reported here as pending.
  let latest: Awaited<ReturnType<typeof loadLatestSnapshot>>;
  try {
    latest = await loadLatestSnapshot(metaDir, args.templateStart);
  } catch (err) {
    // F11 PR 4 review fix #3: see INVALID_SNAPSHOT comment above.
    if (err instanceof SnapshotFileError) {
      return exitWithError(logger, migrationSnapshotInvalid(err.message));
    }
    throw err;
  }

  // The Builder's definitions, judged before the drift that would show a lost
  // entity as a drop: `migrate:create` refuses each of these with this message.
  if (args.definitions !== undefined) {
    try {
      judgeBuilderDefinitions({
        definitions: args.definitions,
        recorded: latest?.data.entities,
      });
    } catch (error) {
      return exitWithError(logger, error);
    }
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

  let changes: UnwrittenChanges;
  try {
    changes = await args.unwritten();
  } catch (error) {
    // A declaration `migrate:create` would refuse ends the check with its message.
    return exitWithError(logger, error);
  }
  const drift = checkDriftError(changes);
  if (drift !== undefined) return exitWithError(logger, drift);
  // Settings an earlier snapshot never recorded: a notice, as `migrate:create` gives it.
  if (changes.settingsNotRecorded === true) {
    logger.warn(SETTINGS_NOT_RECORDED_NOTICE);
  }
  if (changes.besideNotRecorded !== undefined) {
    logger.warn(translationsNotRecordedNotice(changes.besideNotRecorded));
  }

  try {
    await args.beforePass?.();
  } catch (error) {
    exitWithError(logger, error);
  }

  logger.success(
    `migrate:check OK — ${sqlFiles.length} migration file(s), no drift.`
  );
}

/**
 * The changes not yet in a migration as this check ends on them, or undefined where there are none:
 * the one list every surface reports (`unwrittenChangeLines`), in the check's own words, since it
 * reads no database and changes nothing. Settings alone are named as their own change, and
 * permissions alone as theirs.
 */
function checkDriftError(changes: UnwrittenChanges): CliError | undefined {
  if (nothingUnwritten(changes)) return undefined;
  if (settingsAlone(changes)) {
    return settingsChangeWithoutMigration(
      changes.settings.length,
      changes.settings.map(change => `~ ${describeSettingsChange(change)}`)
    );
  }
  const lines = unwrittenChangeLines(changes);
  if (changes.permissions.length === lines.length) {
    return permissionChangeWithoutMigration(lines.length, lines);
  }
  return schemaChangeWithoutMigration(
    lines.length,
    lines,
    changes.perLanguageMoves ?? [],
    changesBesideMoves(changes)
  );
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * The `.sql` files of each migration a template ships: the one whose snapshot
 * is in the older format (`isOlderFormatSnapshot`), every dialect's file of
 * it. Such a migration is written by hand and runs as written; its snapshot
 * lists entities and records no hash, and the per-dialect files share the one
 * snapshot, so neither the hash nor a snapshot per file can be asked of them.
 */
async function templateMigrationFiles(
  migrationsDir: string,
  metaDir: string
): Promise<Set<string>> {
  const files = new Set<string>();
  for (const group of (await discoverMigrationGroups(migrationsDir)).values()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        await readFile(
          resolve(metaDir, `${group.baseName}.snapshot.json`),
          "utf-8"
        )
      );
    } catch {
      // No snapshot, or not JSON: the checks below say so.
      continue;
    }
    if (!isOlderFormatSnapshot(parsed)) continue;
    for (const variant of group.variants) files.add(variant.file);
  }
  return files;
}

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
  for (const { file, migration, transaction, sections } of files) {
    // UP runs against the schema before the file, DOWN against the one the
    // file leaves, which its migration's snapshot records: a dialect's
    // variant's is its group's.
    const after = await pairedSnapshot(metaDir, migration);
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
    /** The migration the file is of, by name: a dialect's variant's is its group's. */
    migration: string;
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
      migration: baseName,
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
 * The schema recorded by the snapshot of `migration` (`meta/<migration>.snapshot.json`, the one
 * snapshot of a migration and its dialect variants), or undefined when it has none or it cannot
 * be read. `runChecks` has already
 * failed on an unreadable snapshot by then; this reader only judges what a
 * file deletes, which then falls back to leaving a rebuild to the run.
 */
async function pairedSnapshot(
  metaDir: string,
  migration: string
): Promise<NextlySchemaSnapshot | undefined> {
  const name = `${migration}.snapshot.json`;
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
  cmdOptions: MigrateCheckCommandOptions,
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);

  const resolvedOptions: ResolvedMigrateCheckOptions = {
    ...(cmdOptions.dialect !== undefined
      ? { dialect: cmdOptions.dialect }
      : {}),
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
