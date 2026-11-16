/**
 * The declaration of `nextly build`: its options and help, with the action
 * loaded from `./build` only when the command runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/**
 * Register the build command with the program
 *
 * @param program - Commander program instance
 */
export function registerBuildCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("build")
      .description("Production build - validate collections and generate files")
  )
    .option("--strict", "Fail on any validation warnings", false)
    .option(
      "--skip-migrations-check",
      "Skip migration status verification",
      false
    )
    .option("--no-types", "Skip TypeScript type generation")
    .option("--no-zod", "Skip Zod validation schema generation")
    .action(lazyAction(async () => (await import("./build")).buildAction));
}
