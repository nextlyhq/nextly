/**
 * `nextly migrate:baseline` — adopt a database that already exists.
 *
 * The graduation path from `db:sync` to migrations runs through here. A project
 * developed with `db:sync` has real tables and no snapshot, so its first
 * `migrate:create` diffs the config against nothing and emits `CREATE TABLE`
 * for the whole schema — a file that can never be applied, because the live
 * database matches neither the empty baseline it assumes nor the target it
 * describes. This records where the history begins, and the next
 * `migrate:create` emits a delta.
 *
 * **This command connects to the database, and `migrate:create` still does
 * not.** That invariant (`migrate-create.ts`) is what makes generation work
 * offline and in CI, and it survives: generation reads the config, adoption
 * reads the database. They are different questions, so they are different
 * commands rather than a flag on one.
 *
 * The reasoning for writing a real migration file rather than only a marker,
 * and for doing both halves in one command, is in
 * `domains/schema/migrate/baseline.ts`.
 *
 * **Runtime restriction (F11):** CLI-only; never import from runtime code.
 *
 * @module cli/commands/migrate-baseline
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import type { Command } from "commander";

import { deriveCompanionSpec } from "../../domains/i18n/migration/derive-companion-spec";
import {
  buildCompanionCreateFromLive,
  buildCompanionCreateOnlySql,
  COMPANION_STATUS_COLUMN,
  COMPANION_STRUCTURAL_COLUMNS,
} from "../../domains/i18n/migration/generate-up";
import { assertNoLegacyBookkeeping } from "../../domains/schema/events/legacy-detection";
import { getSchemaEventsDdl } from "../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import {
  EMPTY_SNAPSHOT,
  planBaseline,
} from "../../domains/schema/migrate/baseline";
import {
  resolveDeclaredSchema,
  type ResolvedEntity,
} from "../../domains/schema/migrate/resolved-schema";
import {
  formatMigrationFile,
  formatTimestamp,
  slugify,
} from "../../domains/schema/migrate-create/format-file";
import {
  loadLatestSnapshot,
  writeSnapshot,
} from "../../domains/schema/migrate-create/snapshot-io";
import { diffSnapshots } from "../../domains/schema/pipeline/diff/diff";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import {
  isCompanionTable,
  isManagedTable,
  junctionTablesAmong,
  snapshotComparableTables,
} from "../../domains/schema/pipeline/managed-tables";
import { generateSQL } from "../../domains/schema/pipeline/sql-templates/index";
import { describeError, NextlyError } from "../../errors/index";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

import { maybeForceUnlock } from "./migrate";

interface BaselineOptions {
  name?: string;
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
  forceUnlock?: boolean;
  adoptUnknown?: boolean;
}

/** The migration name used when the operator supplies none. */
const DEFAULT_BASELINE_NAME = "baseline";

/**
 * The tables in the database, as the source of truth for what to adopt.
 *
 * Deliberately not guarded. Elsewhere an unreadable table list degrades to an
 * empty scope and the command still does something useful; here it IS the
 * command, and an empty list is indistinguishable from a database with nothing
 * in it. A permissions error swallowed into `[]` would report "nothing to
 * adopt" and leave the operator believing their schema was already recorded.
 */
async function listManagedTables(
  adapter: CLIDatabaseAdapter,
  knownJunctions: ReadonlySet<string>
): Promise<string[]> {
  const names = await (
    adapter as unknown as { listTables: () => Promise<string[]> }
  ).listTables();
  // A custom `options.junctionTable` name need not carry a managed prefix, and
  // the production DDL uses it verbatim — so filtering on the prefix alone
  // drops an existing relationship table from adoption entirely, and a fresh
  // environment rebuilt from the baseline has nowhere to write links.
  return names.filter(n => isManagedTable(n) || knownJunctions.has(n));
}

/**
 * The migration files already on disk, earliest first.
 *
 * A missing directory is a project that has never generated one, which is the
 * normal state for everything this command exists to adopt.
 */
async function listMigrationFiles(migrationsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(migrationsDir);
    return entries.filter(f => f.endsWith(".sql")).sort();
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * A migration the ledger already records, when there is one.
 *
 * A database managed by `db:sync` has never run `migrate`, so its ledger holds
 * no `file_apply` rows — and on the oldest such databases the table does not
 * exist at all, which is why a failure here reads as "no history" rather than
 * propagating. Anything that DOES have rows has a history, whatever the
 * migrations directory currently contains.
 */
async function firstAppliedMigration(
  repo: SchemaEventsRepository,
  adapter: CLIDatabaseAdapter
): Promise<string | undefined> {
  if (!(await ledgerExists(adapter))) return undefined;
  // Past the existence check, a failure is a real one — permissions, a wrong
  // schema, a broken table. Swallowing it would read as "never migrated" and
  // write a second origin beside whatever history the ledger already holds.
  const rows = await repo.listFileApplies();
  const names = rows
    .map(r => (r as { filename?: string | null }).filename)
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .sort();
  return names[0];
}

/** Whether the migration ledger table is there at all. */
async function ledgerExists(adapter: CLIDatabaseAdapter): Promise<boolean> {
  return (adapter as unknown as DrizzleAdapter).tableExists(
    "nextly_schema_events"
  );
}

/**
 * Mark the tables that have a companion standing beside them.
 *
 * An introspected snapshot is a PRE-MARKER snapshot: it records columns and
 * nothing about localization. `planCompanionMigrations` derives a transition
 * from those markers and deliberately treats their absence as unknown rather
 * than inferring from column shape — so after a baseline, DISABLING
 * localization would emit only the column re-add, leaving the translations in
 * `_locales` unrestored, unarchived and the companion undropped.
 *
 * The database answers this without needing the config: a companion table
 * standing beside a main table IS the statement that the main table is
 * localized. `localizedColumns` is left for the transition planner to resolve
 * from the companion itself, which is where it already reads them.
 */
function annotateLocalization(
  snapshot: NextlySchemaSnapshot,
  companionColumns: ReadonlyMap<string, string[]>
): NextlySchemaSnapshot {
  if (companionColumns.size === 0) return snapshot;
  return {
    ...snapshot,
    tables: snapshot.tables.map(table => {
      const columns = companionColumns.get(table.name);
      if (!columns) return table;
      // Both markers, because the consumer needs both: `buildDisableSpec`
      // returns null when `localizedColumns` is absent, so a table marked
      // localized with no recorded columns still leaves a later disable
      // emitting nothing and the translations orphaned.
      return { ...table, localized: true, localizedColumns: columns };
    }),
  };
}
/**
 * `CREATE TABLE` for each companion standing in the database.
 *
 * The database decides WHICH companions exist; the config decides what each
 * one looks like. Both are needed: introspection knows a `_locales` table is
 * there but not that it cascades, and the config knows the shape but not
 * whether `db:sync` ever created it.
 *
 * A companion whose entity is no longer in the config is skipped rather than
 * guessed at. Its main table is about to be dropped by the next
 * `migrate:create` anyway, and emitting a table with a foreign key to
 * something that will not exist would produce a baseline that cannot be
 * applied at all.
 */
function buildCompanionStatements(args: {
  companionTables: string[];
  liveCompanions: NextlySchemaSnapshot;
  entities: ResolvedEntity[];
  dialect: SupportedDialect;
  defaultLocale: string;
  /** Rebuild a companion from the live table when config cannot describe it. */
  adoptUnknown: boolean;
}): {
  statements: string[];
  columnsByMain: Map<string, string[]>;
  undescribed: CompanionMismatch[];
} {
  if (args.companionTables.length === 0) {
    return { statements: [], columnsByMain: new Map(), undescribed: [] };
  }
  const present = new Set(args.companionTables);
  const liveByTable = new Map(args.liveCompanions.tables.map(t => [t.name, t]));
  const statements: string[] = [];
  const columnsByMain = new Map<string, string[]>();
  const undescribed: CompanionMismatch[] = [];

  for (const entity of args.entities) {
    const companionTable = `${entity.tableName}${STORAGE_FORMAT.companionSuffix}`;
    if (!present.has(companionTable)) continue;
    const liveTable = liveByTable.get(companionTable);
    // The database is the authority on WHICH columns the companion has, and
    // the config is the only source for what each one means. So the config
    // derives the specs and the live table decides which of them survive:
    // adopting is exactly the moment the two can disagree, because the drift
    // recovery walks an operator into editing the config first, and a baseline
    // that recorded the config's answer would describe a database that never
    // existed.
    const liveColumns = new Set((liveTable?.columns ?? []).map(c => c.name));
    const spec = deriveCompanionSpec({
      builtBy: entity.builtBy,
      slug: entity.slug,
      dbName: entity.tableName,
      fields: entity.fields as Parameters<
        typeof deriveCompanionSpec
      >[0]["fields"],
      dialect: args.dialect,
      defaultLocale: args.defaultLocale,
      // Asserted rather than read from the entity: the table is standing in
      // the database, so this entity IS localized whatever the config's flag
      // currently says, and a false flag would derive no companion at all.
      collectionLocalized: true,
      // From the live table too: `_status` is a physical column, and deriving
      // it from the config's Draft/Published flag would emit a companion the
      // adopted one does not match in either direction.
      status: liveColumns.has(COMPANION_STATUS_COLUMN),
    });
    if (!spec) continue;

    const described = new Set(spec.columns.map(c => c.name));
    const missing = [...liveColumns].filter(
      name => !COMPANION_STRUCTURAL_COLUMNS.has(name) && !described.has(name)
    );
    if (missing.length > 0) {
      // A column standing in the database that the config no longer describes
      // has no logical kind, and the kind is what decides the DDL type. So the
      // spec-derived rendering cannot express it, and emitting the companion
      // without it would produce a baseline that rebuilds the table missing a
      // column holding translations.
      //
      // Refused by default, because adopting a schema nobody can describe
      // should be a decision rather than a silent one. When the operator makes
      // it, the table is rebuilt from what the database actually has, which
      // reproduces every column including this one.
      if (!args.adoptUnknown || !liveTable) {
        undescribed.push({ table: companionTable, columns: missing.sort() });
        continue;
      }
      statements.push(
        buildCompanionCreateFromLive({
          live: liveTable,
          mainTable: entity.tableName,
          dialect: args.dialect,
        })
      );
      // Every translated column the companion holds, undescribed ones
      // included: a later disable has to bring all of them home, and one it
      // does not know about is one it strands.
      columnsByMain.set(
        entity.tableName,
        [...liveColumns]
          .filter(n => !COMPANION_STRUCTURAL_COLUMNS.has(n))
          .sort()
      );
      continue;
    }

    // Config columns the live table does not have are dropped, not emitted:
    // the recorded starting point has to be the schema that is actually there.
    const reconciled = spec.columns.filter(c => liveColumns.has(c.name));
    if (reconciled.length === 0) continue;

    statements.push(
      buildCompanionCreateOnlySql(
        { ...spec, columns: reconciled },
        { emittedToFile: true }
      )
    );
    // The column names the companion actually declares, which is what a
    // later disable transition restores, archives and drops.
    columnsByMain.set(
      entity.tableName,
      reconciled.map(c => c.name)
    );
  }
  return { statements, columnsByMain, undescribed };
}

export interface BaselineCoreDeps {
  adapter: CLIDatabaseAdapter;
  db: unknown;
  dialect: SupportedDialect;
  /** Absolute path to the `migrations/` directory. */
  migrationsDir: string;
  logger: CommandContext["logger"];
  /** Migration name; slug-cased here. */
  name?: string;
  /**
   * The config's entities, used only to rebuild localized companions.
   *
   * A companion's real DDL carries a composite key and a foreign key to its
   * main table with `ON DELETE CASCADE`, and the snapshot model has no concept
   * of a foreign key at all — so a companion reconstructed from introspection
   * silently loses the cascade. These let the production companion DDL be
   * emitted instead. Which companions to emit is still decided from the
   * database; only their shape comes from here.
   */
  localizedEntities?: ResolvedEntity[];
  /** From `config.localization.defaultLocale`; defaults to `"en"`. */
  defaultLocale?: string;
  /**
   * Junction tables the schema names outright.
   *
   * A many-to-many field may carry `options.junctionTable`, which the
   * production DDL uses verbatim, so no naming convention can infer it. A
   * junction recorded in the snapshot makes the next `migrate:create` see an
   * undeclared table and emit `DROP TABLE`, taking the relationship rows.
   */
  knownJunctions?: ReadonlySet<string>;
  /**
   * From `config.db.migrateLockTtlSeconds`.
   *
   * The stored expiry is what every later command reads to decide whether a
   * lock is stale, so a crashed run that wrote the 900s default would block a
   * project that configured a shorter takeover for far longer than it asked.
   */
  ttlSeconds?: number;
  /**
   * Adopt a companion holding translated columns the config does not describe.
   *
   * Off by default: such a column cannot be rendered from its logical kind,
   * so adopting one means recording a schema nobody can describe, which should
   * be the operator's decision rather than a silent one. On, the companion is
   * rebuilt from the live table instead of from the config's spec.
   */
  adoptUnknown?: boolean;
  /** Override the clock so a test can predict the filename. */
  now?: Date;
}

/** A companion holding translated columns the config no longer describes. */
export interface CompanionMismatch {
  table: string;
  columns: string[];
}

export type BaselineCoreResult =
  | { kind: "already-baselined"; snapshotName: string }
  | { kind: "history-not-empty"; filename: string }
  | { kind: "empty-database" }
  | { kind: "companion-mismatch"; mismatches: CompanionMismatch[] }
  | {
      kind: "baselined";
      sqlPath: string;
      snapshotPath: string;
      /** How many tables the recorded starting point describes. */
      tableCount: number;
    };

/**
 * Adopt the live database, without exiting the process.
 *
 * Shared by the CLI wrapper below and by tests driving the real
 * `db:sync` → baseline → `migrate:create` → `migrate` sequence.
 */
export async function baselineCore(
  deps: BaselineCoreDeps
): Promise<BaselineCoreResult> {
  const { adapter, db, dialect, migrationsDir, logger } = deps;
  const metaDir = resolve(migrationsDir, "meta");
  const repo = new SchemaEventsRepository(db, dialect);

  // The same lock every other migrate command takes: adopting writes a file
  // AND a journal row, and a concurrent `migrate` deciding what to apply must
  // not see one without the other.
  const result = await withMigrateLock<BaselineCoreResult>(
    db,
    dialect,
    async () => {
      const latest = await loadLatestSnapshot(metaDir);
      const existingMigrations = await listMigrationFiles(migrationsDir);

      const known = deps.knownJunctions ?? new Set<string>();
      const managed = await listManagedTables(adapter, known);
      // A companion is excluded from the SNAPSHOT for the same reason drift
      // excludes it: it is derived, never declared by config, and adopting it
      // as a first-class table would make the next diff want to drop it. It is
      // NOT excluded from the SQL — see below.
      const companionTables = managed.filter(isCompanionTable);
      // Derived tables are kept OUT of the snapshot and put INTO the SQL, for
      // the same reason in both cases: the config never declares them, so a
      // diff that saw one would want to drop it, while a fresh environment
      // still needs it built. The same exclusion runs in `migrate`'s drift
      // check, from the same helper, because a live snapshot that includes a
      // junction cannot match a recorded one that never could have held it.
      // The config's own tables, so a collection whose resolved name happens
      // to look like a junction is not mistaken for one.
      const declared = new Set(
        (deps.localizedEntities ?? []).map(e => e.tableName)
      );
      const junctionTables = junctionTablesAmong(managed, declared, known);
      const snapshotTables = snapshotComparableTables(managed, declared, known);

      const live = await introspectLiveSnapshot(db, dialect, snapshotTables);

      const plan = planBaseline({
        live,
        latestSnapshotName: latest?.filename,
        existingMigrationFile: existingMigrations[0],
        appliedMigration: await firstAppliedMigration(repo, adapter),
      });

      if (plan.kind === "already-baselined") {
        return { kind: "already-baselined", snapshotName: plan.snapshotName };
      }
      if (plan.kind === "history-not-empty") {
        return { kind: "history-not-empty", filename: plan.filename };
      }
      if (plan.kind === "empty-database") {
        return { kind: "empty-database" };
      }

      const name = slugify(deps.name ?? DEFAULT_BASELINE_NAME);
      const now = deps.now ?? new Date();
      const baseName = `${formatTimestamp(now)}_${name}`;

      // The body is what would build this schema from nothing. It is never run
      // against THIS database — it is recorded as applied below — but it is
      // what lets a new environment, CI, or `migrate:fresh` build the same
      // schema from the history alone.
      //
      // Companions are part of that even though they are not part of the
      // snapshot. `migrate:create` emits one only when it can see the
      // transition in the previous snapshot: after a baseline the main table
      // is recorded already missing its translatable columns, which reads as
      // "already localized, the companion exists" and emits nothing. So if the
      // baseline does not carry them, no file ever will, and a fresh
      // environment gets main tables with nowhere to put translations.
      //
      // They are emitted through the production companion DDL rather than
      // from their introspected shape, because a companion is more than its
      // columns: it carries a composite key and a foreign key to its main
      // table with `ON DELETE CASCADE`, and the snapshot model has no concept
      // of a foreign key. Rebuilt from a snapshot, the cascade is gone and
      // deleting a document strands its translations.
      // A junction has no config-derived shape to rebuild it from — unlike a
      // companion, nothing declares its columns — so it is emitted from what
      // the database actually has.
      const junctionLive =
        junctionTables.size > 0
          ? await introspectLiveSnapshot(db, dialect, [...junctionTables])
          : { tables: [] };
      const junctionSql = diffSnapshots(EMPTY_SNAPSHOT, junctionLive).map(op =>
        generateSQL(op, dialect)
      );

      // The companion's own columns, read from the database for the same
      // reason the junction's are: what is standing there is the schema being
      // adopted. Only its structure — the composite key and the cascading
      // foreign key, neither of which a snapshot can hold — comes from the
      // config's DDL builder.
      const companionLive =
        companionTables.length > 0
          ? await introspectLiveSnapshot(db, dialect, companionTables)
          : EMPTY_SNAPSHOT;

      const companionSql = buildCompanionStatements({
        companionTables,
        liveCompanions: companionLive,
        entities: deps.localizedEntities ?? [],
        dialect,
        defaultLocale: deps.defaultLocale ?? "en",
        adoptUnknown: deps.adoptUnknown === true,
      });
      if (companionSql.undescribed.length > 0) {
        // Before anything is written. A baseline that silently omitted these
        // would rebuild the companion without them, so the failure would not
        // appear until a fresh environment came up missing translations.
        return {
          kind: "companion-mismatch",
          mismatches: companionSql.undescribed,
        };
      }

      // Companions carry a foreign key to their main table, so every main
      // table has to exist before any of them runs.
      const sqlStatements = [
        ...plan.operations.map(op => generateSQL(op, dialect)),
        ...junctionSql,
        ...companionSql.statements,
      ];
      const sqlContent = formatMigrationFile({
        name,
        dialect,
        sqlStatements,
        // No down section: reversing a baseline means dropping the schema it
        // adopted, which is never what an operator undoing a migration wants.
        downSqlStatements: [],
        collections: [],
        singles: [],
        components: [],
        hasUserExt: false,
        now,
        // The entity arrays above are empty because this caller does not
        // compute them, not because the migration changes nothing.
        entitiesAreScoped: false,
      });

      await mkdir(migrationsDir, { recursive: true });
      const sqlPath = resolve(migrationsDir, `${baseName}.sql`);
      await writeFile(sqlPath, sqlContent, "utf-8");
      const snapshotPath = await writeSnapshot(
        metaDir,
        baseName,
        annotateLocalization(plan.snapshot, companionSql.columnsByMain),
        sqlContent
      );

      // The ledger is bootstrapped out of band by `migrate`, which has never
      // run on a database managed by `db:sync` — so this command is the first
      // thing that ever writes to it and has to create it. Without this the
      // insert below throws AFTER the migration and snapshot are on disk,
      // leaving files that look committed and will be replayed against the
      // database they were taken from.
      //
      // Guarded on the table rather than replayed, matching `migrate`: MySQL
      // has no `CREATE INDEX IF NOT EXISTS`, so re-running the DDL against a
      // ledger that already exists fails on a duplicate key name — in exactly
      // the same window, after both files are written.
      const dz = adapter as unknown as DrizzleAdapter;
      if (!(await dz.tableExists("nextly_schema_events"))) {
        for (const stmt of getSchemaEventsDdl(dialect)) {
          await dz.executeQuery(stmt);
        }
      }

      // Recorded as applied without executing: the tables it describes are
      // already standing. Doing this in the same command is the point — the
      // file alone would be re-run against a database that already has them.
      const eventId = await repo.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: `${baseName}.sql`,
        // `migrate:status` compares this against the file's checksum and reads
        // a missing value as the empty string, so a row recorded without it
        // reports the file as edited since it was applied — on a project that
        // has just generated it and touched nothing.
        sha256: createHash("sha256").update(sqlContent).digest("hex"),
      });
      await repo.markApplied(eventId, {
        statementsExecuted: 0,
        uniqueFilename: `${baseName}.sql`,
      });

      logger.debug(`Baseline recorded as applied: ${baseName}.sql`);

      return {
        kind: "baselined",
        sqlPath,
        snapshotPath,
        tableCount: plan.snapshot.tables.length,
      };
    },
    { ttlSeconds: deps.ttlSeconds }
  );

  // `withMigrateLock` reports `ran: false` only in "wait" mode. Adoption is
  // never a case where someone else did the work: nobody else is going to
  // baseline this database, so returning here would mean reporting success for
  // a history that was never started.
  if (!result.ran) {
    throw new NextlyError({
      code: "NEXTLY_BASELINE_LOCK_NOT_HELD",
      publicMessage:
        "The migrate lock was released without adopting the database. " +
        "Nothing was written; retry once no other schema operation is running.",
    });
  }
  return result.value;
}

export async function runMigrateBaseline(
  options: BaselineOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  logger.header("Migrate Baseline");

  const dbValidation = validateDatabaseEnv();
  if (!dbValidation.valid || !dbValidation.dialect) {
    for (const err of dbValidation.errors ?? []) logger.error(err);
    process.exit(1);
  }
  const dialect = dbValidation.dialect;

  const configResult = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
    debug: options.verbose,
  });
  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

  const adapter: CLIDatabaseAdapter = await createAdapter({
    dialect,
    databaseUrl: dbValidation.databaseUrl,
    logger: options.verbose ? logger : undefined,
  });

  try {
    const db = (adapter as unknown as DrizzleAdapter).getDrizzle();

    // The same Phase 0 gate `migrate` runs. A database still carrying the
    // pre-consolidation tables has to be upgraded first; adopting before that
    // writes a baseline and a ledger row into bookkeeping that `nextly upgrade`
    // is about to consolidate, and the next `migrate` then stops at this gate
    // with the baseline already mixed in.
    await assertNoLegacyBookkeeping(
      adapter as unknown as { tableExists: (n: string) => Promise<boolean> }
    );

    await maybeForceUnlock(
      { forceUnlock: options.forceUnlock === true },
      db,
      dialect
    );

    const config = configResult.config;
    // Config and the Builder manifest, merged the way generation merges them
    // and resolved once. Every command that compares a live database against a
    // snapshot reads the same answer, because assembling it per call site is
    // how it kept being assembled differently.
    const resolved = await resolveDeclaredSchema({
      projectRoot: cwd,
      config,
      deferredExtends: configResult.deferredExtends,
    });

    const result = await baselineCore({
      adapter,
      db,
      dialect,
      migrationsDir,
      logger,
      name: options.name,
      // Every kind that can carry a companion, reduced the same way
      // `migrate:create` reduces them so the emitted DDL matches what a
      // generated companion migration would have produced.
      localizedEntities: resolved.entities,
      defaultLocale: config.localization?.defaultLocale,
      ttlSeconds: config.db.migrateLockTtlSeconds,
      knownJunctions: resolved.knownJunctions,
      adoptUnknown: options.adoptUnknown,
    });

    if (result.kind === "already-baselined") {
      logger.info(
        `This project already has a migration history (${result.snapshotName}).`
      );
      logger.info(
        "Baselining again would give it a second starting point. Nothing was written."
      );
      return;
    }

    if (result.kind === "history-not-empty") {
      logger.info(
        `This project already has migrations (${result.filename}), but no starting point.`
      );
      logger.info(
        "Adopting now would put the baseline after them, and a fresh database would"
      );
      logger.info(
        "replay them against tables it has not created yet. Move them aside, baseline,"
      );
      logger.info("then re-apply what they did as a new migration.");
      return;
    }

    if (result.kind === "companion-mismatch") {
      logger.info(
        "Some translation tables hold columns this project no longer describes."
      );
      logger.newline();
      for (const m of result.mismatches) {
        logger.info(`  ${m.table}: ${m.columns.join(", ")}`);
      }
      logger.newline();
      logger.info(
        "A baseline records where the schema starts, so it has to describe every"
      );
      logger.info(
        "column that is there. These have no field to say what they hold, and"
      );
      logger.info(
        "adopting without them would rebuild the table missing translations."
      );
      logger.newline();
      logger.info(
        "Either restore the localized fields to your config, or drop"
      );
      logger.info("the columns if the content is no longer needed.");
      return;
    }

    if (result.kind === "empty-database") {
      logger.info("No managed tables found, so there is nothing to adopt.");
      logger.info(
        "Create your first migration instead:  pnpm nextly migrate:create --name init"
      );
      return;
    }

    logger.newline();
    logger.success(`Adopted ${result.tableCount} existing tables.`);
    logger.info(`  Migration: ${result.sqlPath}`);
    logger.info(`  Snapshot:  ${result.snapshotPath}`);
    logger.newline();
    logger.info("Recorded as applied — it will not run against this database.");
    logger.info(
      "Commit both files: they are how another environment builds this schema."
    );
    logger.newline();
    logger.info("Next:  pnpm nextly migrate:create --name <your_change>");
  } finally {
    await adapter.disconnect();
  }
}

export function registerMigrateBaselineCommand(program: Command): void {
  program
    .command("migrate:baseline")
    .description(
      "Adopt an existing database into the migration history (run once, when graduating from db:sync)"
    )
    .option(
      "--name <name>",
      `Migration name (default: "${DEFAULT_BASELINE_NAME}")`
    )
    .option("-c, --config <path>", "Path to nextly.config.ts")
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before taking it (use after a crashed run)"
    )
    .option(
      "--adopt-unknown",
      "Adopt translation tables holding columns your config no longer describes, rebuilding them from the database"
    )
    .action(async (opts: BaselineOptions, command: Command) => {
      const globalOpts = command.parent?.opts() ?? {};
      const context = createContext(globalOpts);
      try {
        await runMigrateBaseline(
          {
            ...opts,
            // `nextly --config <path> migrate:baseline` is the documented
            // global form, and it puts the path only on the parent. Taking the
            // subcommand's alone would silently load the default config and
            // write the baseline against a different `migrationsDir`.
            config: opts.config ?? globalOpts.config,
            verbose: globalOpts.verbose,
            quiet: globalOpts.quiet,
            cwd: globalOpts.cwd,
          },
          context
        );
      } catch (error) {
        context.logger.error(describeError(error));
        process.exit(1);
      }
    });
}
