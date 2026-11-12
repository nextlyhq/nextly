/**
 * Prune Command
 *
 * Implements `nextly prune` — explicitly drop orphaned plugin/code schema
 * (collections in the registry that are no longer in the config). Orphans are
 * never dropped without the data-loss consent: with none, a terminal is asked
 * and a run that cannot ask lists them, drops nothing and exits 1.
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @module cli/commands/prune
 * @example
 * ```bash
 * nextly prune                          # list them, and ask at a terminal
 * nextly prune --accept-data-loss       # drop every orphan, listing each
 * nextly prune --accept-data-loss=dc_a  # drop only what is named
 * ```
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import type { Command } from "commander";
import { and, count, eq } from "drizzle-orm";

import { CollectionRegistryService } from "../../domains/collections/services/collection-registry-service";
import { registerComponentSchemas } from "../../domains/field-groups/services/register-field-group-schemas";
import {
  teardownEntityI18n,
  type TeardownI18nAdapter,
} from "../../domains/i18n/migration/teardown-entity-i18n";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import {
  countDeletions,
  judgeDataLoss,
  type DataLossConsent,
  type Deletion,
} from "../../domains/schema/migrate/data-loss-consent";
import { planChangedAfterConsent } from "../../domains/schema/migrate/plan-changed-after-consent";
import type { ExtensionSchemaRecord } from "../../domains/schema/ownership/dependent-elements";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { isCompanionTable } from "../../domains/schema/pipeline/managed-tables";
import { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import { NextlyError } from "../../errors/nextly-error";
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections/types";
import { nextlyI18nArchiveTables } from "../../schemas/nextly-i18n-archive";
import { UNKNOWN_ARCHIVE_KIND } from "../../schemas/nextly-i18n-archive/ddl";
import { reportDryRun } from "../dry-run";
import { exitWithError } from "../errors/index";
import { createContext, type CommandContext } from "../program";
import {
  openOrConnect,
  requireDatabaseEnv,
} from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";
import {
  askToDeleteInTerminal,
  deletionChanges,
  readDataLossConsent,
  requireConsented,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";
import { installRegistryResolver } from "../utils/registry-resolver";

import {
  configuredTypes,
  currentTypes,
  keptColumnsFor,
  type KeptColumn,
} from "./prune-kept-columns";

export { registerPruneCommand } from "./prune.command";

export interface PruneResult {
  /** Slugs detected as orphaned (in the registry, not in the config). */
  orphans: string[];
  /** Slugs actually dropped (empty unless the drop was approved). */
  dropped: string[];
  /**
   * Companion `_locales` tables whose main table no longer exists. No registry entry points
   * at them, so only a catalog sweep can find them.
   */
  orphanedCompanions: string[];
  /** Companion tables actually dropped (empty unless the drop was approved). */
  droppedCompanions: string[];
  /** Every table the prune drops, and what goes with each, as the consent lists them. */
  planned: Deletion[];
  /** Under `--dry-run`, why a real prune would refuse before its first drop. */
  refusal?: string;
  /**
   * The columns a plugin's scope keeps on types switched off, as
   * `table.column`, and those the prune dropped (`prune-kept-columns.ts`).
   */
  keptColumns: string[];
  droppedColumns: string[];
  /** Whether the consent agreed to every deletion listed, and the prune ran. */
  consented: boolean;
}

interface RunPruneArgs {
  registry: Pick<
    CollectionRegistryService,
    "findOrphanedCollections" | "deleteCollection" | "assertNothingDependsOn"
  >;
  adapter: TeardownI18nAdapter & {
    getCapabilities(): { dialect: string };
    listTables(): Promise<string[]>;
  };
  currentSlugs: string[];
  /**
   * Whether the tables listed may be dropped: the data-loss consent's
   * judgement (`pruneApproval`). False drops nothing; a throw stops the run
   * before anything changes, as `pruneApproval` does for every outcome but
   * consent.
   */
  approve: (deletions: Deletion[]) => Promise<boolean>;
  /**
   * How many archived translations an orphaned collection has, which its
   * teardown removes from the archive every entity shares; undefined when
   * that cannot be read. Absent, the listing says the collection's archived
   * translations go with it, uncounted.
   */
  countArchived?: (slug: string) => Promise<number | undefined>;
  /**
   * The columns a plugin's scope keeps on types the site switched off, which
   * the prune drops with the rest it lists. Absent, none: a site that keeps
   * migration files drops them through a migration instead.
   */
  keptColumns?: () => Promise<KeptColumn[]>;
  /**
   * The kept columns a migration drops, on a site that keeps migration files:
   * asked about with the rest, under the one consent, so nothing is dropped
   * before every deletion is agreed to, and never dropped here.
   */
  releasedByMigration?: readonly KeptColumn[];
  /**
   * The extension schema the configuration declares, compiled with the
   * orphans' tables in it: their entities are no longer configured, so a
   * plugin hook still extending one would otherwise not compile, and what it
   * adds to the table could not be named. Without it, the schema this
   * process published is read, as every other delete reads it.
   */
  extensionSchema?: (
    orphans: readonly DynamicCollectionRecord[]
  ) => Promise<ExtensionSchemaRecord | null>;
  /**
   * Holds the schema lock for the drop (`pruneUnderSchemaLock`), taken after
   * `approve` has answered so no lock is held while a person is asked.
   */
  lock: PruneLock;
  /**
   * `--dry-run`: plan the drops and check what depends on the orphans, as a
   * real prune does before its first drop, then drop nothing, ask nothing and
   * take no lock.
   */
  dryRun?: boolean;
}

/** Runs `work` while holding the schema lock, and returns what it returned. */
export type PruneLock = <T>(work: () => Promise<T>) => Promise<T>;

/** What a prune's claim on the schema lock names as its holder. */
const PRUNE_LOCK_COMMAND = "nextly prune";

/**
 * The lock `nextly prune` drops under: the one schema lock, waited for as
 * every command waits for it (about a minute, or `waitMs`), and then refused
 * naming its holder.
 */
export function pruneUnderSchemaLock(
  adapter: DrizzleAdapter,
  options: {
    waitMs?: number;
    ttlSeconds?: number;
    logger?: { warn?: (m: string) => void; info?: (m: string) => void };
  } = {}
): PruneLock {
  return async work => {
    const outcome = await withMigrateLock(
      adapter,
      adapter.getCapabilities().dialect,
      work,
      {
        command: PRUNE_LOCK_COMMAND,
        mode: "wait",
        waitMs: options.waitMs,
        ttlSeconds: options.ttlSeconds,
        releaseOnInterrupt: true,
        logger: options.logger,
      }
    );
    // Only a wait given `isSettled` ends without running, and this one is not.
    if (!outcome.ran) {
      throw NextlyError.internal({
        logContext: { reason: "the prune ended without running" },
      });
    }
    return outcome.value;
  };
}

/**
 * What goes with an orphan's table: the collection's archived translations,
 * which its teardown deletes from the shared archive. Listed with the table,
 * and covered by naming it: they are the collection's data, and naming the
 * shared archive instead would cover every other entity's too. Left out when
 * the archive holds none for it, or when the caller has no way to count.
 */
async function archivedAlongside(
  slug: string,
  countArchived: RunPruneArgs["countArchived"]
): Promise<string | undefined> {
  if (countArchived === undefined) return undefined;
  const count = await countArchived(slug);
  if (count === 0) return undefined;
  return count === undefined
    ? "the collection's archived translations, if any"
    : `the collection's ${String(count)} archived ${count === 1 ? "translation" : "translations"}`;
}

/** The main table a companion belongs to (`dc_pages_locales` -> `dc_pages`). */
function companionMainTable(companionTable: string): string {
  return companionTable.replace(/_locales$/, "");
}

/** A kept column as the listing names it. */
function columnName({ table, column }: KeptColumn): string {
  return `${table}.${column}`;
}

/** What a prune would drop, read from the database as it stands. */
interface PrunePlan {
  orphans: DynamicCollectionRecord[];
  orphanedCompanions: string[];
  keptColumns: KeptColumn[];
  /** Every table the drop would take, as the consent is asked about them. */
  deletions: Deletion[];
}

/**
 * Detect the orphaned pipeline collections and the companion tables whose main
 * table is gone, and list every table dropping them would take.
 */
async function planPrune(args: RunPruneArgs): Promise<PrunePlan> {
  const orphans = await args.registry.findOrphanedCollections(
    args.currentSlugs
  );

  // Catalog sweep for companions whose main table is already gone. With no registry row
  // pointing at them they are invisible to `findOrphanedCollections`; only a table listing
  // surfaces them.
  const allTables = await args.adapter.listTables();
  const liveTables = new Set(allTables);
  const orphanedCompanions = allTables
    .filter(isCompanionTable)
    .filter(t => !liveTables.has(t.replace(/_locales$/, "")));

  // Every table the drop would take, each orphan's companion with it, judged
  // as one: a consent that leaves one out drops none of them.
  const deletions: Deletion[] = [];
  for (const orphan of orphans) {
    deletions.push({
      kind: "table",
      table: orphan.tableName,
      alongside: await archivedAlongside(orphan.slug, args.countArchived),
    });
    if (liveTables.has(`${orphan.tableName}_locales`)) {
      deletions.push({ kind: "table", table: `${orphan.tableName}_locales` });
    }
  }
  deletions.push(
    ...orphanedCompanions.map(table => ({ kind: "table" as const, table }))
  );
  // Asked about with the tables, under the one consent: their values go too.
  const keptColumns = (await args.keptColumns?.()) ?? [];
  deletions.push(
    ...[...keptColumns, ...(args.releasedByMigration ?? [])].map(
      ({ table, column }) => ({ kind: "column" as const, table, column })
    )
  );
  return { orphans, orphanedCompanions, keptColumns, deletions };
}

/**
 * A plan as one comparable value: each orphan by slug and table, and each
 * deletion as the consent listed it, in a fixed order so two reads of an
 * unchanged database compare equal whatever order the database returned.
 */
function planKey(plan: PrunePlan): string {
  return JSON.stringify({
    orphans: plan.orphans.map(o => `${o.slug}:${o.tableName}`).sort(),
    deletions: plan.deletions
      .map(d =>
        d.kind === "table"
          ? JSON.stringify([d.table, d.alongside ?? ""])
          : JSON.stringify(d)
      )
      .sort(),
  });
}

/**
 * A plan's deletions as the consent listed them (`dc_a`, or `dc_a, with the
 * collection's 3 archived translations`), for a refusal to show what changed.
 */
function plannedTables(plan: PrunePlan): string[] {
  return plan.deletions
    .flatMap(d =>
      d.kind === "table"
        ? [
            d.alongside === undefined
              ? d.table
              : `${d.table}, with ${d.alongside}`,
          ]
        : []
    )
    .sort();
}

/**
 * Core prune logic (D14): detect orphaned pipeline collections, then drop
 * their physical table + metadata once `approve` allows every table it would
 * drop, or drop nothing. A prune that drops refuses, before its first drop
 * and for the whole set, while anything outside the orphans depends on one
 * of them (`assertNothingDependsOn`). Kept free of CLI/IO concerns for
 * unit/integration testing.
 *
 * The drop runs inside `lock`, taken only once `approve` has answered so no
 * lock is held while a person is asked. Inside it the plan is read again, and
 * a plan that differs from the one approved is refused with nothing dropped:
 * the consent was given for that list and no other.
 */
export async function runPrune(args: RunPruneArgs): Promise<PruneResult> {
  const consented = await planPrune(args);
  const slugs = consented.orphans.map(o => o.slug);
  const nothingDropped: PruneResult = {
    orphans: slugs,
    dropped: [],
    orphanedCompanions: consented.orphanedCompanions,
    droppedCompanions: [],
    planned: consented.deletions,
    keptColumns: consented.keptColumns.map(columnName),
    droppedColumns: [],
    consented: false,
  };
  // A dry run asks the question a real prune asks before its first drop,
  // without asking for consent first: its refusal is the real run's.
  if (args.dryRun === true) {
    if (consented.deletions.length === 0) return nothingDropped;
    const compile = args.extensionSchema;
    try {
      await args.registry.assertNothingDependsOn(
        slugs,
        compile === undefined
          ? {}
          : { extensionSchema: () => compile(consented.orphans) }
      );
    } catch (error) {
      // Something still depends on an orphan: the real prune's refusal.
      if (!NextlyError.is(error) || error.code !== "CONFLICT") throw error;
      return { ...nothingDropped, refusal: error.publicMessage };
    }
    return nothingDropped;
  }
  if (
    consented.deletions.length === 0 ||
    !(await args.approve(consented.deletions))
  ) {
    return nothingDropped;
  }
  return args.lock(async () => {
    const current = await planPrune(args);
    if (planKey(current) !== planKey(consented)) {
      throw planChangedAfterConsent({
        command: PRUNE_LOCK_COMMAND,
        message:
          "What `nextly prune` would drop changed after it was agreed to, so nothing was dropped. " +
          "Run `nextly prune` again to see what it would drop now.",
        agreed: plannedTables(consented),
        current: plannedTables(current),
      });
    }
    return dropPlanned(args, consented);
  });
}

/** Drop what `plan` lists: the orphans' tables and metadata, then the stray companions. */
async function dropPlanned(
  args: RunPruneArgs,
  plan: PrunePlan
): Promise<PruneResult> {
  const { orphans, orphanedCompanions } = plan;
  const slugs = orphans.map(o => o.slug);

  // Before the first drop and for the whole set: a refusal part way through
  // would leave some orphans dropped and the rest not, and orphans that point
  // only at each other go together.
  const compile = args.extensionSchema;
  await args.registry.assertNothingDependsOn(
    slugs,
    compile === undefined ? {} : { extensionSchema: () => compile(orphans) }
  );

  // Dialect-safe identifier quoting + FK-safe drop, mirroring the sibling drop
  // sites (collection-sync-service.ts): MySQL uses backticks; Postgres needs
  // CASCADE; SQLite uses neither.
  const { dialect } = args.adapter.getCapabilities();
  const q = dialect === "mysql" ? "`" : '"';
  const cascade = dialect !== "sqlite" && dialect !== "mysql" ? " CASCADE" : "";

  // The kept columns first, so a column that cannot be dropped stops the prune
  // before any table goes. A type's own table stays, with only the column the
  // site no longer keeps taken from it.
  const droppedColumns = await dropKeptColumns(
    args.adapter,
    dialect,
    q,
    plan.keptColumns
  );

  const dropped: string[] = [];
  for (const orphan of orphans) {
    // Companion first — it holds an FK to `<main>.id`, so the main-table drop below would
    // otherwise orphan it (Postgres CASCADE) or be rejected by the FK (MySQL). This also
    // purges the collection's rows from the shared `nextly_i18n_archive`.
    await teardownEntityI18n({
      adapter: args.adapter,
      slug: orphan.slug,
      tableName: orphan.tableName,
      kind: "collection",
    });
    // Drop the physical data table, then the metadata row (force-bypass the
    // pipeline lock — prune is the explicit, authorized drop path).
    await args.adapter.executeQuery(
      `DROP TABLE IF EXISTS ${q}${orphan.tableName}${q}${cascade}`
    );
    await args.registry.deleteCollection(orphan.slug, { force: true });
    dropped.push(orphan.slug);
  }

  // Sweep the companions whose main table is already gone. There is no FK left to order
  // around, and no registry row to name the entity — a slug cannot be derived from the
  // table name because entities may declare a custom `tableName`, so `dc_articles` can
  // belong to slug `blog`. Passing `null` drops the table and leaves the shared archive
  // untouched rather than purging rows that may belong to a different entity.
  const droppedCompanions: string[] = [];
  for (const companion of orphanedCompanions) {
    await teardownEntityI18n({
      adapter: args.adapter,
      slug: null,
      tableName: companionMainTable(companion),
    });
    droppedCompanions.push(companion);
  }

  return {
    orphans: slugs,
    dropped,
    orphanedCompanions,
    droppedCompanions,
    planned: plan.deletions,
    keptColumns: plan.keptColumns.map(columnName),
    droppedColumns,
    consented: true,
  };
}

/**
 * Drop the kept columns, each covering index first where the dialect needs
 * it: SQLite drops neither a column an index covers nor the index with it,
 * and MySQL no column a functional index names; PostgreSQL takes them with
 * the column. Each index once, though several kept columns share it.
 */
async function dropKeptColumns(
  adapter: RunPruneArgs["adapter"],
  dialect: string,
  q: string,
  keptColumns: readonly KeptColumn[]
): Promise<string[]> {
  const indexes = new Map<string, { table: string; index: string }>();
  for (const kept of keptColumns) {
    for (const index of kept.indexes ?? []) {
      indexes.set(`${kept.table}\u0000${index}`, { table: kept.table, index });
    }
  }
  for (const { table, index } of indexes.values()) {
    if (dialect === "sqlite") {
      await adapter.executeQuery(`DROP INDEX IF EXISTS ${q}${index}${q}`);
    } else if (dialect === "mysql") {
      await adapter.executeQuery(
        `DROP INDEX ${q}${index}${q} ON ${q}${table}${q}`
      );
    }
  }
  const dropped: string[] = [];
  for (const kept of keptColumns) {
    await adapter.executeQuery(
      `ALTER TABLE ${q}${kept.table}${q} DROP COLUMN ${q}${kept.column}${q}`
    );
    dropped.push(columnName(kept));
  }
  return dropped;
}

/** The select surface of a Drizzle handle the archive count reads through. */
interface ArchiveCountDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<{ n: number | string }>>;
    };
  };
}

/**
 * How many archived translations a collection's teardown removes: its rows in
 * the shared archive, by slug and kind, as the teardown scopes its delete. 0
 * when there is no archive. Undefined when that cannot be told: the count
 * failed, or the archive holds rows for the slug whose kind is not yet known,
 * which the teardown labels and may then remove.
 */
export async function countArchivedTranslations(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  slug: string
): Promise<number | undefined> {
  try {
    if (!(await adapter.tableExists("nextly_i18n_archive"))) return 0;
    const db = adapter.getDrizzle<ArchiveCountDb>();
    const { nextlyI18nArchive } = nextlyI18nArchiveTables(dialect);
    const rowsOfKind = async (kind: string) => {
      const [row] = await db
        .select({ n: count() })
        .from(nextlyI18nArchive)
        .where(
          and(
            eq(nextlyI18nArchive.collection, slug),
            eq(nextlyI18nArchive.entityKind, kind)
          )
        );
      return Number(row?.n ?? 0);
    };
    if ((await rowsOfKind(UNKNOWN_ARCHIVE_KIND)) > 0) return undefined;
    return await rowsOfKind("collection");
  } catch {
    return undefined;
  }
}

interface PruneCommandOptions {
  acceptDataLoss?: AcceptDataLossOption;
  /** The earlier spelling of the consent, honoured with a deprecation notice. */
  force?: boolean;
  /** `--dry-run`: name what would be dropped, drop and ask nothing. */
  dryRun?: boolean;
  config?: string;
  cwd?: string;
  /**
   * How long a held schema lock is waited for, in milliseconds, before the
   * run stops naming its holder. Absent, the lock's own wait.
   */
  lockWaitMs?: number;
}

/**
 * `prune`'s data-loss consent: `--accept-data-loss` or
 * `NEXTLY_ACCEPT_DATA_LOSS`, with `--force` honoured as the earlier spelling
 * and named deprecated.
 */
export function pruneConsent(
  options: Pick<PruneCommandOptions, "acceptDataLoss" | "force">,
  warn: (message: string) => void
): DataLossConsent {
  return readDataLossConsent({
    flag: options.acceptDataLoss,
    honours: ["prune --force"],
    earlierFlags: options.force ? ["prune --force"] : [],
    warn,
  });
}

/**
 * The `approve` a prune runs with: the tables counted where the database
 * answers, then judged by the consent. Covered, or agreed to at a terminal,
 * they are dropped. Otherwise the run stops before anything is dropped, and
 * exits 1: a no at the terminal names the consent that drops without asking;
 * with no consent and nobody to ask, the refusal lists what it would drop and
 * that consent; and a consent naming tables that leaves one out is refused
 * outright: the operator named what may go, and this is not it.
 */
export function pruneApproval(args: {
  consent: DataLossConsent;
  interactive: boolean;
  ask: (question: string) => Promise<boolean>;
  print: (line: string) => void;
  db: unknown;
  dialect: SupportedDialect;
}): (deletions: Deletion[]) => Promise<boolean> {
  return async deletions => {
    const verdict = await judgeDataLoss({
      deletions: await countDeletions(deletions, args.db, args.dialect),
      consent: args.consent,
      interactive: args.interactive,
      ask: args.ask,
      print: args.print,
    });
    requireConsented(verdict);
    return true;
  };
}

/** Execute the `nextly prune` command. */
export async function runPruneCommand(
  options: PruneCommandOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  logger.header("Prune");
  // Read, and a malformed one refused, before anything connects.
  const consent = pruneConsent(options, m => logger.warn(m));

  const dbValidation = requireDatabaseEnv(logger);

  const configResult = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
  });
  const currentSlugs = (configResult.config.collections ?? []).map(c => c.slug);

  const adapter = await openOrConnect(
    { dialect: dbValidation.dialect, databaseUrl: dbValidation.databaseUrl },
    options.dryRun === true,
    logger
  );
  if (adapter === undefined) return;

  try {
    // The ORM resolves tables through a SchemaRegistry, and this command creates none of
    // its own, so registry-table reads and the component sweep both need one. Static system
    // tables first, then every component's `comp_` table, which the sweep deletes rows from.
    const drizzleAdapter = adapter as unknown as DrizzleAdapter;
    const { dialect } = drizzleAdapter.getCapabilities();
    const schemaRegistry = installRegistryResolver(drizzleAdapter);
    await registerComponentSchemas({
      adapter: drizzleAdapter,
      registry: schemaRegistry,
      dialect,
      logger,
    });

    const registry = new CollectionRegistryService(
      adapter as unknown as DrizzleAdapter,
      logger
    );
    // What a plugin's scope keeps on types switched off: dropped with the rest
    // here, or, on a site that keeps migration files, by a migration below.
    const kept = await keptColumnsFor({
      cwd: options.cwd,
      migrationsDir: configResult.config.db.migrationsDir,
      adapter: drizzleAdapter,
      dialect,
      types: () =>
        currentTypes({
          configured: configuredTypes(configResult.config),
          deferredExtends: configResult.deferredExtends ?? [],
          registries: {
            collections: registry,
            singles: new SingleRegistryService(drizzleAdapter, logger),
          },
        }),
    });
    const result = await runPrune({
      keptColumns: kept.live,
      releasedByMigration: kept.inMigration,
      dryRun: options.dryRun === true,
      registry,
      adapter: adapter as unknown as Parameters<typeof runPrune>[0]["adapter"],
      currentSlugs,
      countArchived: slug =>
        countArchivedTranslations(drizzleAdapter, dialect, slug),
      approve: pruneApproval({
        consent,
        interactive: canPrompt(),
        ask: askToDeleteInTerminal,
        print: line => logger.info(line),
        db: drizzleAdapter.getDrizzle(),
        dialect,
      }),
      // Taken once the consent has answered, never while a prompt waits.
      lock: pruneUnderSchemaLock(drizzleAdapter, {
        waitMs: options.lockWaitMs,
        ttlSeconds: configResult.config.db.migrateLockTtlSeconds,
        logger: {
          warn: message => logger.warn(message),
          info: message => logger.info(message),
        },
      }),
      // Compiled here, not published: this command serves nothing, and only
      // reads what the configured plugins and the app declare.
      extensionSchema: async orphans => {
        // Loaded when a prune that drops asks, not with every command.
        const { compileExtensionSchemaWith } = await import(
          "../../domains/collections/services/collection-dependents-schema"
        );
        return compileExtensionSchemaWith({
          config: configResult.config,
          dialect,
          removedCollections: orphans,
          logger: { warn: message => logger.warn(message) },
        });
      },
    });

    // A dry run names what the real prune drops, in the consent's words.
    if (options.dryRun === true) {
      reportDryRun(logger, {
        changes: result.refusal ? [] : deletionChanges(result.planned),
        refusals: result.refusal ? [result.refusal] : [],
      });
      return;
    }

    // The listing and the consent that drops it were printed by the
    // judgement; what remains is what was done.
    if (result.orphans.length === 0) {
      logger.info("No orphaned plugin/code collections found.");
    } else if (result.dropped.length === 0) {
      logger.info(`Orphaned (retained): ${result.orphans.join(", ")}`);
    } else {
      logger.info(
        `Dropped ${result.dropped.length} orphaned collection(s): ${result.dropped.join(", ")}`
      );
    }

    await finishKeptColumns(result, kept.inMigration, options, context);

    // Reported separately: these have no registry row, so they are not "collections" from
    // the operator's point of view and would be confusing to fold into the counts above.
    if (result.orphanedCompanions.length > 0) {
      if (result.droppedCompanions.length === 0) {
        logger.info(
          `Orphaned localization tables (retained): ${result.orphanedCompanions.join(", ")}`
        );
      } else {
        logger.info(
          `Dropped ${result.droppedCompanions.length} orphaned localization table(s): ${result.droppedCompanions.join(", ")}`
        );
      }
    }
  } finally {
    await adapter.disconnect();
  }
}

/**
 * What the prune did with the columns kept for switched-off types: names the
 * ones it dropped, and on a site that keeps migration files writes the
 * migration that drops them, agreed to with the rest before anything was
 * dropped.
 */
async function finishKeptColumns(
  result: PruneResult,
  inMigration: readonly KeptColumn[],
  options: PruneCommandOptions,
  context: CommandContext
): Promise<void> {
  if (result.droppedColumns.length > 0) {
    context.logger.info(
      `Dropped ${result.droppedColumns.length} column(s) kept for switched-off types: ${result.droppedColumns.join(", ")}`
    );
  }
  if (result.consented && inMigration.length > 0) {
    await writeReleaseMigration(options, context, inMigration);
  }
}

/**
 * On a site that keeps migration files, write the migration that drops the
 * kept columns the consent agreed to: every environment then drops them at
 * its next `nextly migrate`, and none is left with a history listing columns
 * its database lacks. The columns the consent agreed to are handed on, so the
 * migration is written without asking about them again.
 */
async function writeReleaseMigration(
  options: PruneCommandOptions,
  context: CommandContext,
  agreed: readonly KeptColumn[]
): Promise<void> {
  // Loaded only when a migration is written, not with every prune.
  const { runMigrateCreate } = await import("./migrate-create");
  await runMigrateCreate(
    "drop-columns-kept-for-switched-off-types",
    {
      cwd: options.cwd,
      config: options.config,
      releaseHeldBack: true,
      approvedDeletions: agreed.map(({ table, column }) => ({
        kind: "column" as const,
        table,
        column,
      })),
    },
    context
  );
}

/** The action of `nextly prune`, loaded when it runs. */
export async function pruneAction(
  cmdOptions: {
    acceptDataLoss?: AcceptDataLossOption;
    force?: boolean;
    dryRun?: boolean;
  },
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);
  try {
    await runPruneCommand(
      { ...cmdOptions, config: globalOpts.config, cwd: globalOpts.cwd },
      context
    );
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
