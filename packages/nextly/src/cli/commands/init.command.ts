/**
 * The declaration of `nextly init`: its options and help, with the action
 * loaded from `./init` only when the command runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/**
 * Register the init command with the program
 *
 * @param program - Commander program instance
 */
export function registerInitCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program.command("init").description("Initialize a new Nextly project")
  )
    .option("-y, --yes", "Skip prompts and use defaults", false)
    .option("-f, --force", "Overwrite existing files", false)
    .action(lazyAction(async () => (await import("./init")).initAction));
}
