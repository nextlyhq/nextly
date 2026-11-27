/**
 * The declaration of `nextly trash` and its subcommands: their arguments,
 * options and help, with each action loaded from `./trash` only when it runs.
 *
 * @experimental
 */
import type { Command } from "commander";

import { DATABASE_LINE, declareFirstLine } from "../first-line";
import { lazyAction } from "../lazy-action";

/** Collect repeated `--set field=value` options into one list. */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Register the `nextly trash` command group. */
export function registerTrashCommand(program: Command): void {
  const trash = program
    .command("trash")
    .description(
      "List, restore and empty deleted entries, kept for 30 days (experimental)"
    );

  declareFirstLine(
    trash
      .command("list")
      .description("List deleted entries, newest first, with who deleted each and when")
      .option("--collection <slug>", "Only this collection's entries")
      .option("--limit <n>", "At most this many (1 to 100)", "25")
      .option("--page <n>", "This page of the list", "1")
      .action(lazyAction(async () => (await import("./trash")).trashListAction)),
    DATABASE_LINE
  );

  declareFirstLine(
    trash
      .command("restore <id>")
      .description(
        "Bring a deleted entry back as it was, as a draft where it had been published"
      )
      .option(
        "--collection <slug>",
        "Its collection, where two collections have a deleted entry with this id"
      )
      .option(
        "--set <field=value>",
        "A new value for a field another entry has taken since, such as --set slug=hello-2",
        collect
      )
      .action(
        lazyAction(async () => (await import("./trash")).trashRestoreAction)
      ),
    DATABASE_LINE
  );

  declareFirstLine(
    trash
      .command("empty")
      .description("Remove deleted entries for good")
      .option("--collection <slug>", "Only this collection's entries")
      .action(lazyAction(async () => (await import("./trash")).trashEmptyAction)),
    DATABASE_LINE
  );
}
