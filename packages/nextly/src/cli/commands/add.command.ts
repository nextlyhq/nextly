/**
 * The declaration of `nextly add` and `nextly plugins add`, one command under
 * two names: its arguments, options and help, with the action loaded from
 * `./add` only when the command runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/** What `nextly add` and `nextly plugins add` do, in their help. */
const ADD_DESCRIPTION =
  "Install a plugin, register it in nextly.config.ts, add it to the build and apply its schema";

/** Collects a repeated option into a list, in the order given. */
const collect = (value: string, previous: string[]): string[] => [
  ...previous,
  value,
];

/** Gives `command` the add command's arguments, options and action. */
export function defineAddCommand(command: Command): Command {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  return withDryRun(command.description(ADD_DESCRIPTION))
    .option(
      "--option <name=value>",
      "A value the plugin asks for at install; repeat for each",
      collect,
      []
    )
    .option("-D, --dev", "Install as a dev dependency", false)
    .option(
      "--skip-install",
      "Skip the package-manager install: the package is installed already",
      false
    )
    .action(lazyAction(async () => (await import("./add")).addAction));
}

/** Register the `add` command with the program. */
export function registerAddCommand(program: Command): void {
  defineAddCommand(program.command("add <package>"));
}
