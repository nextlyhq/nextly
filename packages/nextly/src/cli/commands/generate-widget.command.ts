/**
 * The declaration of `nextly generate:widget`: its arguments, options and
 * help, with the action loaded from `./generate-widget` only when the command
 * runs.
 */
import type { Command } from "commander";

import { lazyAction } from "../lazy-action";

export function registerGenerateWidgetCommand(program: Command): void {
  program
    .command("generate:widget [id]")
    .description(
      "Scaffold a dashboard widget, with its test, in this site or plugin"
    )
    .option(
      "--view <kind>",
      "figure, list, table, bars, series, or component (its own)"
    )
    .option("--collection", "Read from a collection the reader chooses")
    .option("--no-collection", "Read no collection")
    .option("--site", "Generate into the site, whatever is detected")
    .option("--plugin", "Generate into the plugin, whatever is detected")
    .option("--force", "Overwrite files that already exist")
    .option("--dry-run", "Print the files and edits; write nothing")
    .action(
      lazyAction(
        async () => (await import("./generate-widget")).generateWidgetAction
      )
    );
}
