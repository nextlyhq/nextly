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
  KIND_NAMES,
  kindOption,
  resolveEntityTables,
} from "../../domains/i18n/migration/resolve-entity-table";
import {
  restoreI18nArchive,
  type RestoreArchiveResult,
} from "../../domains/i18n/migration/restore-archive";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import { NextlyError } from "../../errors/nextly-error";
import { createContext, type CommandContext } from "../context";
import { reportDryRun, type DryRunChange } from "../dry-run";
import { exitWithError } from "../errors";
import {
  restoreCollectionRequired,
  restoreEntityRefusal,
} from "../errors/areas/sync";
import { openCommandAdapter, withAdapter } from "../utils/adapter";
import { requireDatabaseEnv } from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";
import {
  judgeDataLossAtTerminal,
  readDataLossConsent,
  requireConsented,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";

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
  /** The data-loss consent `--purge` needs, which deletes from the archive. */
  acceptDataLoss?: AcceptDataLossOption;
  /** `--dry-run`: read and check as a restore does, name its writes, make none. */
  dryRun?: boolean;
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
    exitWithError(logger, restoreCollectionRequired());
  }

  // Fail before touching the network if the DB env is unusable.
  requireDatabaseEnv(logger);

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
    exitWithError(
      logger,
      restoreEntityRefusal({
        slug,
        kind: options.kind,
        found: matches.length,
        problem: chosen.problem,
      })
    );
  }
  const { entity } = chosen;

  const { companionTableName } = entity;
  logger.keyValue("Entity", `${slug} (${entity.kind})`);
  logger.keyValue("Companion", companionTableName);
  if (options.locale) logger.keyValue("Locale", options.locale);
  if (options.field) logger.keyValue("Field", options.field);

  // What a restore reads and checks, the same for a real run and a dry run.
  const restoreArgs = {
    collection: slug,
    kind: entity.kind,
    // Naming the kind is what lets a restore take rows whose owner the archive does not know.
    claimUnknown: options.kind !== undefined,
    companionTableName,
    locale: options.locale,
    field: options.field,
    purge: options.purge,
  };

  // A dry run deletes nothing, so it needs no consent, and opens read-only.
  if (options.dryRun === true) {
    await previewRestore(restoreArgs, logger);
    return;
  }

  // `--purge` deletes the replayed rows from the archive, so it takes the
  // data-loss consent, decided before the database is reached: without it, a
  // person is asked where one can be, and otherwise nothing changes, not even
  // the restore, and the run names the consent.
  if (options.purge) {
    requireConsented(
      await judgeDataLossAtTerminal({
        deletions: [{ kind: "rows", table: "nextly_i18n_archive" }],
        consent: readDataLossConsent({
          flag: options.acceptDataLoss,
          warn: message => logger.warn(message),
        }),
        print: line => logger.info(line),
      })
    );
  }

  await withAdapter(
    async adapter => {
      const result = await restoreI18nArchive({
        adapter: adapter as unknown as DrizzleAdapter,
        ...restoreArgs,
      });

      const reportUnattributed = () => {
        if (result.rowsUnattributed === 0) return;
        logger.warn(
          `${result.rowsUnattributed} archived value(s) for "${slug}" were written before the archive ` +
            "recorded which kind of entity they belong to, and could not be matched to one. " +
            `They are kept. If they are this ${KIND_NAMES[entity.kind]}'s, ` +
            `restore them with --kind ${kindOption(entity.kind)}.`
        );
      };
      if (result.rowsClaimed > 0) {
        logger.info(
          `Took ${result.rowsClaimed} archived value(s) of unknown kind as this entity's.`
        );
      }

      if (result.rowsRead === 0) {
        logger.warn(
          `Nothing archived for "${slug}"${options.field ? ` field ${options.field}` : ""}${options.locale ? ` in ${options.locale}` : ""} — nothing to restore.`
        );
        reportUnattributed();
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
      reportUnattributed();
    },
    { logger }
  );
}

/**
 * The changes a restore's dry run names, in the order the restore makes them: the archive brought
 * up to date (created, its kind column added, its legacy rows labelled), then the translation rows
 * written, the values claimed and, with `--purge`, those deleted.
 */
export function restoreDryRunChanges(
  result: RestoreArchiveResult,
  restoreArgs: { companionTableName: string; purge?: boolean }
): DryRunChange[] {
  const changes: DryRunChange[] = [];
  const upgrade = result.archiveUpgrade;
  if (upgrade?.createTable !== undefined) {
    changes.push({
      action: "create",
      target: `the archive table ${upgrade.createTable}`,
    });
  }
  if (upgrade?.addColumn !== undefined) {
    changes.push({
      action: "add",
      target: `the ${upgrade.addColumn.column} column to ${upgrade.addColumn.table}`,
    });
  }
  for (const { kind, rows } of upgrade?.labels ?? []) {
    changes.push({ action: "label", target: `${rows} legacy rows as ${kind}` });
  }
  if (result.rowsRestored > 0) {
    changes.push({
      action: "write",
      target: `${result.rowsRestored} translation row(s) into ${restoreArgs.companionTableName} (${result.locales.join(", ")})`,
    });
  }
  if (result.rowsClaimed > 0) {
    changes.push({
      action: "record",
      target: `${result.rowsClaimed} archived value(s) of unknown kind as this entity's`,
    });
  }
  if (restoreArgs.purge && result.rowsRead > 0) {
    changes.push({
      action: "remove",
      target: `${result.rowsRead} archived value(s) from the archive`,
    });
  }
  return changes;
}

/**
 * What a restore would do, named and not done: the translation rows it writes,
 * the archived values it claims, and with `--purge` the ones it deletes, from
 * the database opened read-only. A field the restore refuses is named as the
 * real run's refusal.
 */
async function previewRestore(
  restoreArgs: Omit<Parameters<typeof restoreI18nArchive>[0], "adapter">,
  logger: CommandContext["logger"]
): Promise<void> {
  const adapter = await openCommandAdapter({ dryRun: true }, logger);
  // Its database is not there, which the open has already said.
  if (adapter === undefined) return;
  try {
    const result = await restoreI18nArchive({
      adapter: adapter as unknown as DrizzleAdapter,
      ...restoreArgs,
      dryRun: true,
    });
    reportDryRun(logger, {
      changes: restoreDryRunChanges(result, restoreArgs),
    });
  } catch (error) {
    // A field not translated now: the real restore's refusal.
    if (!NextlyError.is(error) || error.code !== "CONFLICT") throw error;
    reportDryRun(logger, { changes: [], refusals: [error.publicMessage] });
  } finally {
    await adapter.disconnect();
  }
}

/** The action of `nextly i18n:restore`, loaded when it runs. */
export async function i18nRestoreAction(
  cmdOptions: I18nRestoreCommandOptions,
  cmd: Command
) {
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
    exitWithError(context.logger, error);
  }
}
