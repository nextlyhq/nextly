/**
 * `nextly trash list`, `nextly trash restore` and `nextly trash empty`.
 *
 * Each starts the application from its `nextly.config.ts`, in this process,
 * and goes through the Direct API's `trash` namespace as trusted local code,
 * so a restore puts an entry back exactly as the admin's would: its rows in
 * every language, its history event, and the site's created event marked as
 * a restore. The application is shut down when the command ends.
 *
 * A restore that finds a unique value taken since (another entry took the
 * slug) asks for a new one at a terminal, and otherwise names it and the
 * `--set` that supplies one.
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @experimental
 * @module cli/commands/trash
 * @example
 * ```bash
 * nextly trash list
 * nextly trash restore 6f1c… --set slug=hello-2
 * nextly trash empty --collection posts
 * ```
 */
import * as p from "@clack/prompts";
import type { Command } from "commander";

import type { Nextly } from "../../direct-api/nextly";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import type {
  NotPutBack,
  TrashConflict,
} from "../../domains/trash/restore-entry";
import { NextlyError } from "../../errors/nextly-error";
import { reportDryRun, type DryRunChange } from "../dry-run";
import { CliError, exitWithError, failWithError } from "../errors";
import { createContext, type CommandContext } from "../program";
import { loadConfig } from "../utils/config-loader";
import { answered } from "../utils/prompt-cancelled";

/** The longest stored value a line of output shows. */
const MAX_SHOWN = 120;

/**
 * A stored value as one printable line: a label is content someone typed, and
 * a newline or a terminal escape in it would split a row or act on the
 * operator's terminal.
 */
function printable(value: unknown): string {
  const text = asText(value);
  const line = Array.from(text, char => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? " " : char;
  })
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
  return line.length > MAX_SHOWN ? `${line.slice(0, MAX_SHOWN - 1)}…` : line;
}

/** A stored value as text: a scalar as itself, anything else as JSON. */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return `${value}`;
  }
  return JSON.stringify(value) ?? "";
}

/** Start the application from its configuration, run `work`, then stop it. */
async function withNextly<T>(
  context: CommandContext,
  work: (nextly: Nextly) => Promise<T>
): Promise<T> {
  // Started from the config as the app wrote it (`appConfig`): the boot runs
  // every plugin transformer and fold itself, so the loaded `config`, which
  // already holds their result, would fold each a second time. Migrations
  // stay off at this boot, as every command that starts the runtime keeps
  // them: a trash command changes no schema.
  const { appConfig, pluginConsent } = await loadConfig({
    // Reads the app's entities: with no configuration file it refuses rather
    // than act on none.
    missing: "refuse",
    configPath: context.options.config,
    cwd: context.options.cwd,
  });
  const { getNextly } = await import("../../init");
  const nextly = await getNextly({
    config: {
      ...appConfig,
      db: { ...appConfig.db, runMigrationsOnBoot: false },
    },
    pluginConsent,
  });
  try {
    return await work(nextly as unknown as Nextly);
  } finally {
    await (
      nextly as unknown as { shutdown?: () => Promise<void> }
    ).shutdown?.();
  }
}

/** Who deleted an item, as a line names them. */
function deletedBy(item: {
  trashedByKind: string | null;
  trashedByName: string | null;
  trashedById: string | null;
}): string {
  if (item.trashedByName) return printable(item.trashedByName);
  if (item.trashedByKind === "apiKey")
    return `API key ${printable(item.trashedById)}`;
  if (item.trashedByKind === "user") return printable(item.trashedById);
  return item.trashedByKind === "principal" ? "a site member" : "the system";
}

/** A positive whole number from an option, or the refusal naming it. */
function wholeNumber(
  option: string,
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw NextlyError.validation({
      errors: [
        {
          path: option,
          code: "invalid",
          message: `--${option} takes a whole number from 1.`,
        },
      ],
    });
  }
  return number;
}

/** Execute `nextly trash list`. */
export async function runTrashListCommand(
  options: { collection?: string; limit?: string; page?: string },
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  logger.header("Deleted entries");
  await withNextly(context, async nextly => {
    const page = await nextly.trash.list({
      overrideAccess: true,
      ...(options.collection === undefined
        ? {}
        : { collection: options.collection }),
      limit: wholeNumber("limit", options.limit, 25),
      page: wholeNumber("page", options.page, 1),
    });
    if (page.items.length === 0) {
      logger.info("The trash is empty.");
      return;
    }
    logger.table(
      [
        "Id",
        "Collection",
        "Entry",
        "Deleted by",
        "Deleted",
        "Removed for good",
      ],
      page.items.map(item => [
        printable(item.itemId),
        printable(item.scopeSlug),
        printable(item.label ?? ""),
        deletedBy(item),
        item.trashedAt.toISOString(),
        item.purgeAt.toISOString(),
      ])
    );
    logger.info(
      `Page ${page.meta.page} of ${page.meta.totalPages}, ${page.meta.total} in all. Bring one back with \`nextly trash restore <id>\`.`
    );
  });
}

/** `--set field=value` options as values by field. */
function valuesOf(sets: readonly string[] = []): Record<string, string> {
  const values: Record<string, string> = {};
  for (const set of sets) {
    const at = set.indexOf("=");
    if (at <= 0) {
      throw NextlyError.validation({
        errors: [
          {
            path: "set",
            code: "invalid",
            message: `--set takes field=value, such as --set slug=hello-2; got "${set}".`,
          },
        ],
      });
    }
    values[set.slice(0, at)] = set.slice(at + 1);
  }
  return values;
}

/** A conflict as a line names it. */
function conflictLine(conflict: TrashConflict): string {
  const where =
    conflict.locale === undefined ? "" : ` (${printable(conflict.locale)})`;
  // A value behind a field read rule is not answered, so not named.
  const value =
    conflict.value === undefined
      ? "its value"
      : `"${printable(conflict.value)}"`;
  return `${printable(conflict.field)}${where}: ${value} is taken by another entry`;
}

/** What a restore could not put back as it was, said plainly. */
function reportNotPutBack(
  logger: CommandContext["logger"],
  notPutBack: NotPutBack | undefined
): void {
  if (notPutBack === undefined) return;
  if (notPutBack.links > 0) {
    logger.warn(
      `${notPutBack.links} link(s) to or from entries deleted since were not put back.`
    );
  }
  for (const field of notPutBack.relationsCleared) {
    logger.warn(
      `${printable(field)} pointed at an entry deleted since, and is empty now.`
    );
  }
}

/** New values for the conflicting fields, asked at the terminal. */
async function askNewValues(
  conflicts: readonly TrashConflict[],
  values: Record<string, string>
): Promise<Record<string, string>> {
  const asked = { ...values };
  for (const conflict of conflicts) {
    asked[conflict.field] = await answered(
      await p.text({
        message: `${conflictLine(conflict)}. New ${conflict.field}:`,
        validate: value => (value?.trim() ? undefined : "A value is needed."),
      })
    );
  }
  return asked;
}

/** The largest page the trash list answers. */
const PAGE_SIZE = 100;

/** A trashed item as a dry run lists it. */
interface ListedItem {
  itemId: string;
  scopeSlug: string;
  label: string | null;
}

/** Every trashed item, or every one of `collection`, page by page. */
async function everyTrashed(
  nextly: Nextly,
  collection: string | undefined
): Promise<ListedItem[]> {
  const items: ListedItem[] = [];
  for (let page = 1; ; page += 1) {
    const listed = await nextly.trash.list({
      overrideAccess: true,
      ...(collection === undefined ? {} : { collection }),
      limit: PAGE_SIZE,
      page,
    });
    items.push(...listed.items);
    if (page >= listed.meta.totalPages) return items;
  }
}

/** A trashed item as a dry run's line names it. */
function itemTarget(item: ListedItem): string {
  const label = item.label ? ` "${printable(item.label)}"` : "";
  return `${printable(item.scopeSlug)} entry ${printable(item.itemId)}${label}`;
}

/**
 * `nextly trash restore --dry-run`: the entry it would bring back, read from
 * the trash list. Whether a value it held is taken since is found by the
 * real run, which asks for a new one before writing anything.
 */
async function dryRunRestore(
  nextly: Nextly,
  id: string,
  collection: string | undefined,
  logger: CommandContext["logger"]
): Promise<void> {
  const found = (await everyTrashed(nextly, collection)).filter(
    item => item.itemId === id
  );
  reportDryRun(logger, {
    changes: found
      .slice(0, 1)
      .map(item => ({ action: "restore", target: itemTarget(item) })),
    refusals:
      found.length === 0
        ? [`${printable(id)} is not in the trash.`]
        : found.length > 1
          ? [
              `Two collections have a deleted entry with the id ${printable(id)}: name one with --collection.`,
            ]
          : [],
    notes: [
      "A published entry comes back as a draft.",
      "Whether a value it held is taken by another entry since is checked by the real run, which asks for a new one before writing anything.",
    ],
  });
}

/** Execute `nextly trash restore`. */
export async function runTrashRestoreCommand(
  id: string,
  options: { collection?: string; set?: string[]; dryRun?: boolean },
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  logger.header("Restore a deleted entry");
  let values = valuesOf(options.set);
  await withNextly(context, async nextly => {
    if (options.dryRun === true) {
      await dryRunRestore(nextly, id, options.collection, logger);
      return;
    }
    for (;;) {
      const { item: result } = await nextly.trash.restore({
        overrideAccess: true,
        id,
        ...(options.collection === undefined
          ? {}
          : { collection: options.collection }),
        ...(Object.keys(values).length === 0 ? {} : { values }),
      });
      if (result.restored) {
        logger.success(
          `Restored ${printable(result.id)} to ${printable(result.collection)}, as a draft where it had been published.`
        );
        reportNotPutBack(logger, result.notPutBack);
        return;
      }
      for (const conflict of result.conflicts)
        logger.warn(conflictLine(conflict));
      if (!canPrompt()) {
        const asked = `nextly trash restore ${printable(id)} --set ${printable(result.conflicts[0]?.field ?? "slug")}=<new value>`;
        logger.info(
          `Nothing was restored. Give each a new value, such as \`${asked}\`.`
        );
        // In the error shape every command ends with, its run left to end.
        failWithError(
          logger,
          new CliError("INPUT_REFUSED", {
            what: "Nothing was restored: a value it held is taken by another entry.",
            why: "Each value named above must be unique, and another entry has it now.",
            next: `Give each a new value, such as \`${asked}\`.`,
          })
        );
        return;
      }
      values = await askNewValues(result.conflicts, values);
    }
  });
}

/** Execute `nextly trash empty`. */
export async function runTrashEmptyCommand(
  options: { collection?: string; dryRun?: boolean },
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  logger.header("Empty the trash");
  await withNextly(context, async nextly => {
    if (options.dryRun === true) {
      const changes: DryRunChange[] = (
        await everyTrashed(nextly, options.collection)
      ).map(item => ({
        action: "remove",
        target: `${itemTarget(item)} for good`,
      }));
      reportDryRun(logger, { changes });
      return;
    }
    const {
      item: { removed },
    } = await nextly.trash.empty({
      overrideAccess: true,
      ...(options.collection === undefined
        ? {}
        : { collection: options.collection }),
    });
    logger.success(
      removed.length === 1
        ? "Removed 1 entry for good."
        : `Removed ${removed.length} entries for good.`
    );
  });
}

/** The action of `nextly trash list`, loaded when it runs. */
export async function trashListAction(
  options: { collection?: string; limit?: string; page?: string },
  cmd: Command
): Promise<void> {
  const context = createContext(cmd.optsWithGlobals());
  try {
    await runTrashListCommand(options, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}

/** The action of `nextly trash restore`, loaded when it runs. */
export async function trashRestoreAction(
  id: string,
  options: { collection?: string; set?: string[]; dryRun?: boolean },
  cmd: Command
): Promise<void> {
  const context = createContext(cmd.optsWithGlobals());
  try {
    await runTrashRestoreCommand(id, options, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}

/** The action of `nextly trash empty`, loaded when it runs. */
export async function trashEmptyAction(
  options: { collection?: string; dryRun?: boolean },
  cmd: Command
): Promise<void> {
  const context = createContext(cmd.optsWithGlobals());
  try {
    await runTrashEmptyCommand(options, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
