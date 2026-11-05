/**
 * The declaration of `nextly add`: its arguments, options and help, with the
 * action loaded from `./add` only when the command runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/** Register the `add` command with the program. */
export function registerAddCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("add <package>")
      .description("Install a Nextly plugin and show how to register it")
  )
    .option("-D, --dev", "Install as a dev dependency", false)
    .option(
      "--skip-install",
      "Skip the package-manager install; just print the wiring snippet",
      false
    )
    .action(lazyAction(async () => (await import("./add")).addAction));
}
