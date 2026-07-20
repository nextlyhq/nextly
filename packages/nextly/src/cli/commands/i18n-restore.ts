/**
 * `nextly i18n:restore` — replay archived translations back after a localization disable.
 *
 * Disabling localization on an entity is the one data-losing transition, so its migration
 * restores the default locale onto the main table and archives every OTHER language into
 * `nextly_i18n_archive` before dropping the companion. This
 * command is the recovery half: it replays those archived rows back onto the companion.
 *
 * Recovering from a mistaken disable:
 *   1. Turn localization back on for the entity and run `nextly migrate`. The enable migration
 *      recreates the companion and seeds the DEFAULT locale from the main table.
 *   2. `nextly i18n:restore --collection <slug>` — brings the other languages back.
 *
 * The restore itself is idempotent, so re-running is safe. The archive is kept unless `--purge`
 * is passed, so a restore can be repeated and the audit trail survives.
 *
 * @module cli/commands/i18n-restore
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { resolveEntityTable } from "../../domains/i18n/migration/resolve-entity-table";
import { restoreI18nArchive } from "../../domains/i18n/migration/restore-archive";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import { createContext, type CommandContext } from "../program";
import { validateDatabaseEnv, withAdapter } from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

export interface I18nRestoreCommandOptions {
  /** Entity slug to restore, as recorded in the archive's `collection` column. */
  collection?: string;
  /** Restore only this language. Omit to restore every archived language. */
  locale?: string;
  /** Delete the replayed rows from the archive once written. */
  purge?: boolean;
  config?: string;
  cwd?: string;
  verbose?: boolean;
  quiet?: boolean;
}

export async function runI18nRestore(
  options: I18nRestoreCommandOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  const slug = options.collection;
  if (!slug) {
    logger.error("--collection <slug> is required.");
    process.exit(1);
  }

  // Fail before touching the network if the DB env is unusable.
  const dbValidation = validateDatabaseEnv();
  if (!dbValidation.valid) {
    for (const error of dbValidation.errors) logger.error(error);
    logger.newline();
    logger.info(
      "Set DATABASE_URL and optionally DB_DIALECT environment variables."
    );
    process.exit(1);
  }

  const configResult = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
    debug: options.verbose,
  });

  // Resolve the slug from the code config first, then fall back to the UI-built
  // entities in ui-schema.json. A Builder-created collection/single/component is
  // not in nextly.config.ts, but its disable migration still archives rows under
  // its slug — so restore must resolve its table name from the manifest too,
  // mirroring how migrate:create folds the manifest. Without this fallback,
  // `--collection <ui-slug>` exits before replaying anything. An absent manifest
  // is an empty one, so a code-only project keeps the previous behavior.
  let entity = resolveEntityTable(configResult.config, slug);
  if (!entity) {
    const manifest = await loadUiSchema({
      projectRoot: options.cwd ?? process.cwd(),
      uiSchemaFile: configResult.config.db.uiSchemaFile,
    });
    entity = resolveEntityTable(manifest, slug);
  }
  if (!entity) {
    logger.error(
      `No collection, single, or component named "${slug}" was found in your config or ui-schema.json.`
    );
    process.exit(1);
  }

  const { companionTableName } = entity;
  logger.keyValue("Entity", `${slug} (${entity.kind})`);
  logger.keyValue("Companion", companionTableName);
  if (options.locale) logger.keyValue("Locale", options.locale);

  await withAdapter(
    async adapter => {
      const result = await restoreI18nArchive({
        adapter: adapter as unknown as DrizzleAdapter,
        collection: slug,
        companionTableName,
        locale: options.locale,
        purge: options.purge,
      });

      if (result.rowsRead === 0) {
        logger.warn(
          `Nothing archived for "${slug}"${options.locale ? ` in ${options.locale}` : ""} — nothing to restore.`
        );
        return;
      }

      logger.success(
        `Restored ${result.rowsRestored} translation row(s) across ${result.locales.join(", ")}.`
      );
      if (options.purge) {
        logger.info(`Purged ${result.rowsRead} archived value(s).`);
      } else {
        logger.info(
          "The archive was kept. Re-run with --purge to remove the replayed rows."
        );
      }
    },
    { logger }
  );
}

export function registerI18nRestoreCommand(program: Command): void {
  program
    .command("i18n:restore")
    .description(
      "Replay archived translations back onto an entity after a localization disable"
    )
    .requiredOption(
      "--collection <slug>",
      "Collection, single, or component slug to restore"
    )
    .option(
      "--locale <code>",
      "Restore only this language (default: every archived language)"
    )
    .option(
      "--purge",
      "Remove the replayed rows from the archive once restored",
      false
    )
    .action(async (cmdOptions: I18nRestoreCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);
      try {
        await runI18nRestore(
          {
            ...cmdOptions,
            config: globalOpts.config,
            verbose: globalOpts.verbose,
            quiet: globalOpts.quiet,
            cwd: globalOpts.cwd,
          },
          context
        );
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
