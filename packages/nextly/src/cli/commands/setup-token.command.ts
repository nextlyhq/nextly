/**
 * The declaration of `nextly setup-token`: its options and help, with the
 * action loaded from `./setup-token` only when the command runs.
 */
import type { Command } from "commander";

import type { CommandContext, GlobalOptions } from "../context";
import { withDryRun } from "../dry-run";
import { declareFirstLine, startLine } from "../first-line";
import { lazyAction } from "../lazy-action";

/**
 * Register the `nextly setup-token` command. The program hands in its context
 * factory, so this module imports nothing at runtime from the program that
 * imports it.
 */
export function registerSetupTokenCommand(
  program: Command,
  createContext: (options: GlobalOptions) => CommandContext
): void {
  // `--generate` touches nothing, so the run starts with its own line; one that
  // replaces the token names its database when it connects (once a run).
  // `--dry-run` carries the one meaning and help line it has everywhere.
  declareFirstLine(
    withDryRun(
      program
        .command("setup-token")
        .description(
          "Replace the production setup token and print the new one, or print a value for NEXTLY_SETUP_TOKEN"
        )
    )
      .option(
        "--generate",
        "Print a value suitable for NEXTLY_SETUP_TOKEN, touching nothing",
        false
      )
      .action(
        lazyAction(async () =>
          (await import("./setup-token")).setupTokenAction(createContext)
        )
      ),
    startLine("Setting up the setup token...")
  );
}
