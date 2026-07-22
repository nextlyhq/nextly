/**
 * Prune Command
 *
 * Implements `nextly prune` — explicitly drop orphaned plugin/code schema
 * (collections in the registry that are no longer in the config). Orphans are
 * RETAINED by default (never auto-dropped, D14); `--force` drops them.
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @module cli/commands/prune
 * @example
 * ```bash
 * nextly prune           # dry-run: list orphaned collections
 * nextly prune --force   # drop the orphaned tables + metadata
 * ```
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import { CollectionRegistryService } from "../../domains/collections/services/collection-registry-service";
import { registerComponentSchemas } from "../../domains/components/services/register-component-schemas";
import {
  teardownEntityI18n,
  type TeardownI18nAdapter,
} from "../../domains/i18n/migration/teardown-entity-i18n";
import { isCompanionTable } from "../../domains/schema/pipeline/managed-tables";
import { describeError } from "../../errors/index";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

export interface PruneResult {
  /** Slugs detected as orphaned (in the registry, not in the config). */
  orphans: string[];
  /** Slugs actually dropped (empty unless `force`). */
  dropped: string[];
  /**
   * Companion `_locales` tables whose main table no longer exists. No registry entry points
   * at them, so only a catalog sweep can find them.
   */
  orphanedCompanions: string[];
  /** Companion tables actually dropped (empty unless `force`). */
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
  force: boolean;
}

/** The main table a companion belongs to (`dc_pages_locales` -> `dc_pages`). */
function companionMainTable(companionTable: string): string {
  return companionTable.replace(/_locales$/, "");
}

/**
 * Core prune logic (D14): detect orphaned pipeline collections, then either
 * list them (dry-run) or drop their physical table + metadata (`force`). Kept
 * free of CLI/IO concerns for unit/integration testing.
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

  if (!args.force) {
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

interface PruneCommandOptions {
  force?: boolean;
  config?: string;
  cwd?: string;
}

/** Execute the `nextly prune` command. */
export async function runPruneCommand(
  options: PruneCommandOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  logger.header("Prune");

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
    adapter = await createAdapter({
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
    schemaRegistry.registerStaticSchemas(getDialectTables(dialect));
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
      force: options.force ?? false,
    });

    if (result.orphans.length === 0) {
      logger.info("No orphaned plugin/code collections found.");
    } else if (!options.force) {
      logger.info(
        `Orphaned (retained — re-run with --force to drop): ${result.orphans.join(", ")}`
      );
    } else {
      logger.info(
        `Dropped ${result.dropped.length} orphaned collection(s): ${result.dropped.join(", ")}`
      );
    }

    // Reported separately: these have no registry row, so they are not "collections" from
    // the operator's point of view and would be confusing to fold into the counts above.
    if (result.orphanedCompanions.length > 0) {
      if (!options.force) {
        logger.info(
          `Orphaned localization tables (retained — re-run with --force to drop): ${result.orphanedCompanions.join(", ")}`
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
      "Drop orphaned plugin/code schema (retained by default — never auto-dropped) (D14)"
    )
    .option(
      "--force",
      "Actually drop the orphaned tables + metadata (default lists them only)",
      false
    )
    .action(async (cmdOptions: { force?: boolean }, cmd: Command) => {
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
    });
}
