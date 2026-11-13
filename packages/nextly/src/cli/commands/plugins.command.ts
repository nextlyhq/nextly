/**
 * The declaration of `nextly plugins` and its subcommands: their arguments,
 * options and help, with each action loaded from `./plugins` only when it
 * runs.
 */
import type { Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { withBusyTableBounds } from "../busy-table-options";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

import { defineAddCommand } from "./add.command";

/** Register the `nextly plugins` command group (D48). */
export function registerPluginsCommand(program: Command): void {
  const plugins = program
    .command("plugins")
    .description("Add, install and inspect plugins");

  // The one command that adds a plugin to a site; `nextly add` is the same.
  defineAddCommand(plugins.command("add <package>"));

  plugins
    .command("list")
    .description("List installed plugins and their contributions")
    .action(
      lazyAction(async () => (await import("./plugins")).pluginsListAction)
    );

  // `--dry-run` and the busy-table bounds carry the one meaning and help they have everywhere.
  withBusyTableBounds(
    withDryRun(
      plugins
        .command("install [name]")
        .description(
          "Apply a plugin's migrations and run its onInstall hook, or every configured plugin's with --all"
        )
    )
  )
    .option(
      "--all",
      "Install every configured plugin, dependencies first",
      false
    )
    // A pending module that deletes data takes the data-loss consent, as
    // `nextly migrate` asks for the same module.
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    .action(
      lazyAction(async () => (await import("./plugins")).pluginsInstallAction)
    );

  // A module's DOWN waits for a busy table as its UP does.
  withBusyTableBounds(
    withDryRun(
      plugins
        .command("uninstall <name>")
        .description("Undo a plugin's schema and run its onUninstall hook")
    )
  )
    .option("--keep-data", "Leave the plugin's tables in place", false)
    // A full uninstall drops the plugin's tables, which takes the data-loss
    // consent; `--keep-data` drops nothing and needs none.
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    // Still accepted, so a script passing it is not refused as malformed, but
    // it no longer consents to dropping tables: no `--yes` authorises
    // deleting data, and the refusal says so.
    .option(
      "--yes",
      "No longer consents to dropping tables; use --accept-data-loss",
      false
    )
    .action(
      lazyAction(async () => (await import("./plugins")).pluginsUninstallAction)
    );

  plugins
    .command("info <name>")
    .description(
      "Show one plugin's details (collections, permissions, routes, admin)"
    )
    .action(
      lazyAction(async () => (await import("./plugins")).pluginsInfoAction)
    );
}
