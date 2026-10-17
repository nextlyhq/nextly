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
 * A single field that stopped being translated archives its other languages the same way.
 * Make the field translated again, then `nextly i18n:restore --collection <slug> --field <name>`
 * brings back just that field's values.
 *
 * The restore itself is idempotent, so re-running is safe. The archive is kept unless `--purge`
 * is passed, so a restore can be repeated and the audit trail survives.
 *
 * @module cli/commands/i18n-restore
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import {
  chooseRestoreEntity,
  resolveEntityTables,
} from "../../domains/i18n/migration/resolve-entity-table";
import { restoreI18nArchive } from "../../domains/i18n/migration/restore-archive";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import { describeError } from "../../errors/index";
import { createContext, type CommandContext } from "../program";
import { validateDatabaseEnv, withAdapter } from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

export interface I18nRestoreCommandOptions {
  /** Entity slug to restore, as recorded in the archive's `collection` column. */
  collection?: string;
  /**
   * Which kind of entity the slug names: `collection`, `single` or `field-group`. Needed only when
   * the slug names more than one, which a field group can share with a collection or a Single.
   */
  kind?: string;
  /** Restore only this language. Omit to restore every archived language. */
  locale?: string;
  /** Restore only this field's archived values, by its name or its column name. */
  field?: string;
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

  // Resolve the slug in the code config and in the UI-built entities in ui-schema.json. A
  // Builder-created collection/single/field group is not in nextly.config.ts, but its disable
  // migration still archives rows under its slug — so restore must resolve its table name from
  // the manifest too, mirroring how migrate:create folds the manifest. An absent manifest is an
  // empty one, so a code-only project keeps the previous behavior. The config wins for a kind both
  // know; a kind only the manifest knows is added, since a field group may share the slug.
  const manifest = await loadUiSchema({
    projectRoot: options.cwd ?? process.cwd(),
    uiSchemaFile: configResult.config.db.uiSchemaFile,
  });
  const fromConfig = resolveEntityTables(configResult.config, slug);
  const matches = [
    ...fromConfig,
    ...resolveEntityTables(manifest, slug).filter(
      m => !fromConfig.some(c => c.kind === m.kind)
    ),
  ];
  const chosen = chooseRestoreEntity(slug, matches, options.kind);
  if ("problem" in chosen) {
    logger.error(`${chosen.problem} Looked in your config and ui-schema.json.`);
    process.exit(1);
  }
  const { entity } = chosen;

  const { companionTableName } = entity;
  logger.keyValue("Entity", `${slug} (${entity.kind})`);
  logger.keyValue("Companion", companionTableName);
  if (options.locale) logger.keyValue("Locale", options.locale);
  if (options.field) logger.keyValue("Field", options.field);

  await withAdapter(
    async adapter => {
      const result = await restoreI18nArchive({
        adapter: adapter as unknown as DrizzleAdapter,
        collection: slug,
        kind: entity.kind,
        companionTableName,
        locale: options.locale,
        field: options.field,
        purge: options.purge,
      });

      if (result.rowsRead === 0) {
        logger.warn(
          `Nothing archived for "${slug}"${options.field ? ` field ${options.field}` : ""}${options.locale ? ` in ${options.locale}` : ""} — nothing to restore.`
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
      "Collection, single, or field group slug to restore"
    )
    .option(
      "--kind <kind>",
      "collection, single or field-group: which entity the slug names, when more than one has it"
    )
    .option(
      "--locale <code>",
      "Restore only this language (default: every archived language)"
    )
    .option(
      "--field <name>",
      "Restore only this field's archived values (default: every archived field)"
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
        context.logger.error(describeError(error));
        process.exit(1);
      }
    });
}
