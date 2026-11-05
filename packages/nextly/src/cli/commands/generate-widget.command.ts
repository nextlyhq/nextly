/**
 * The declaration of `nextly generate:widget`: its arguments, options and
 * help, with the action loaded from `./generate-widget` only when the command
 * runs.
 */
import { Option, type Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

export function registerGenerateWidgetCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("generate:widget [id]")
      .description(
        "Scaffold a dashboard widget, with its test, in this site or plugin"
      )
  )
    .option(
      "--view <kind>",
      "figure, list, table, bars, series, or component (its own)"
    )
    .option("--collection", "Read from a collection the reader chooses")
    .option("--no-collection", "Read no collection")
    .option("--site", "Generate into the site, whatever is detected")
    .option("--plugin", "Generate into the plugin, whatever is detected")
    .option("--overwrite", "Overwrite files that already exist")
    // The earlier spelling of --overwrite, honoured for one release with a
    // notice naming it, and kept out of the help.
    .addOption(new Option("--force", "Deprecated: use --overwrite").hideHelp())
    .action(
      lazyAction(
        async () => (await import("./generate-widget")).generateWidgetAction
      )
    );
}
