/**
 * Prune Command
 *
 * Implements `nextly prune` — explicitly drop orphaned plugin/code schema
 * (collections in the registry that are no longer in the config). Orphans are
 * never dropped without the data-loss consent: with none, a terminal is asked
 * and a run with no terminal lists them and drops nothing.
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

import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import { CollectionRegistryService } from "../../domains/collections/services/collection-registry-service";
import { registerComponentSchemas } from "../../domains/field-groups/services/register-field-group-schemas";
import { getFieldGroupRegistryAliases } from "../../domains/field-groups/storage/registry-schemas";
import {
  teardownEntityI18n,
  type TeardownI18nAdapter,
} from "../../domains/i18n/migration/teardown-entity-i18n";
import {
  ACCEPT_DATA_LOSS_HELP,
  countDeletions,
  isInteractiveTerminal,
  judgeDataLoss,
  type DataLossConsent,
  type Deletion,
} from "../../domains/schema/migrate/data-loss-consent";
import { isCompanionTable } from "../../domains/schema/pipeline/managed-tables";
import { describeError } from "../../errors/index";
import { NextlyError } from "../../errors/nextly-error";
import { nextlyI18nArchiveTables } from "../../schemas/nextly-i18n-archive";
import { UNKNOWN_ARCHIVE_KIND } from "../../schemas/nextly-i18n-archive/ddl";
import { createContext, type CommandContext } from "../program";
import {
  createCliAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";
import {
  askToDeleteInTerminal,
  readDataLossConsent,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";

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
}

interface RunPruneArgs {
  registry: Pick<
    CollectionRegistryService,
    "findOrphanedCollections" | "deleteCollection"
  >;
  adapter: TeardownI18nAdapter & {
    getCapabilities(): { dialect: string };
    listTables(): Promise<string[]>;
  };
  currentSlugs: string[];
  /**
   * Whether the tables listed may be dropped: the data-loss consent's
   * judgement (`pruneApproval`). False drops nothing; a throw stops the run
   * before anything changes.
   */
  approve: (deletions: Deletion[]) => Promise<boolean>;
  /**
   * How many archived translations an orphaned collection has, which its
   * teardown removes from the archive every entity shares; undefined when
   * that cannot be read. Absent, the listing says the collection's archived
   * translations go with it, uncounted.
   */
  countArchived?: (slug: string) => Promise<number | undefined>;
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

/**
 * Core prune logic (D14): detect orphaned pipeline collections, then drop
 * their physical table + metadata once `approve` allows every table it would
 * drop, or drop nothing. Kept free of CLI/IO concerns for unit/integration
 * testing.
 */
export async function runPrune(args: RunPruneArgs): Promise<PruneResult> {
  const orphans = await args.registry.findOrphanedCollections(
    args.currentSlugs
  );
  const slugs = orphans.map(o => o.slug);

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
  if (deletions.length === 0 || !(await args.approve(deletions))) {
    return {
      orphans: slugs,
      dropped: [],
      orphanedCompanions,
      droppedCompanions: [],
    };
  }

  // Dialect-safe identifier quoting + FK-safe drop, mirroring the sibling drop
  // sites (collection-sync-service.ts): MySQL uses backticks; Postgres needs
  // CASCADE; SQLite uses neither.
  const { dialect } = args.adapter.getCapabilities();
  const q = dialect === "mysql" ? "`" : '"';
  const cascade = dialect !== "sqlite" && dialect !== "mysql" ? " CASCADE" : "";

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

  return { orphans: slugs, dropped, orphanedCompanions, droppedCompanions };
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
  config?: string;
  cwd?: string;
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
 * they are dropped. With no consent and no terminal, the refusal is printed
 * as the listing — the command still lists what it would drop, as it always
 * has, and now names the consent that drops it — and nothing is dropped. A
 * consent naming tables that leaves one out is refused outright: the
 * operator named what may go, and this is not it.
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
    if (verdict.kind === "proceed") return true;
    if (verdict.kind === "declined") {
      args.print("Nothing was dropped.");
      return false;
    }
    if (verdict.reason === "needs-consent") {
      args.print(verdict.message);
      return false;
    }
    throw NextlyError.invalidInput({
      message: verdict.message,
      logContext: { reason: "data-loss-not-covered" },
    });
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

  const dbValidation = validateDatabaseEnv();
  if (!dbValidation.valid) {
    for (const error of dbValidation.errors) logger.error(error);
    process.exit(1);
  }

  const configResult = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
  });
  const currentSlugs = (configResult.config.collections ?? []).map(c => c.slug);

  let adapter: CLIDatabaseAdapter;
  try {
    adapter = await createCliAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
    });
  } catch (error) {
    logger.error(`Failed to connect to database: ${describeError(error)}`);
    process.exit(1);
  }

  try {
    // The ORM resolves tables through a SchemaRegistry, and this command creates none of
    // its own, so registry-table reads and the component sweep both need one. Static system
    // tables first, then every component's `comp_` table, which the sweep deletes rows from.
    const drizzleAdapter = adapter as unknown as DrizzleAdapter;
    const { dialect } = drizzleAdapter.getCapabilities();
    const schemaRegistry = new SchemaRegistry(dialect);
    // Both spellings of the field-group registry: a database whose storage
    // migration has run has no handle for its registry otherwise.
    schemaRegistry.registerStaticSchemas({
      ...getDialectTables(dialect),
      ...getFieldGroupRegistryAliases(dialect),
    });
    drizzleAdapter.setTableResolver(schemaRegistry);
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
    const result = await runPrune({
      registry,
      adapter: adapter as unknown as Parameters<typeof runPrune>[0]["adapter"],
      currentSlugs,
      countArchived: slug =>
        countArchivedTranslations(drizzleAdapter, dialect, slug),
      approve: pruneApproval({
        consent,
        interactive: isInteractiveTerminal(),
        ask: askToDeleteInTerminal,
        print: line => logger.info(line),
        db: drizzleAdapter.getDrizzle(),
        dialect,
      }),
    });

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

/** Register the `nextly prune` command. */
export function registerPruneCommand(program: Command): void {
  program
    .command("prune")
    .description(
      "Drop orphaned plugin/code schema (retained by default — never auto-dropped)"
    )
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    .option("--force", "Deprecated: use --accept-data-loss", false)
    .action(
      async (
        cmdOptions: { acceptDataLoss?: AcceptDataLossOption; force?: boolean },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals();
        const context = createContext(globalOpts);
        try {
          await runPruneCommand(
            { ...cmdOptions, config: globalOpts.config, cwd: globalOpts.cwd },
            context
          );
        } catch (error) {
          context.logger.error(describeError(error));
          process.exit(1);
        }
      }
    );
}
