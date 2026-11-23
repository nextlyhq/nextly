/**
 * The declaration of `nextly migrate:check`: its options and help, with the
 * action loaded from `./migrate-check` only when the command runs.
 */
import type { Command } from "commander";

import { dialectOption } from "../dialect-option";
import { declareFirstLine, startLine } from "../first-line";
import { lazyAction } from "../lazy-action";

export function registerMigrateCheckCommand(program: Command): void {
  declareFirstLine(
    program
      .command("migrate:check")
      .description(
        "Verify migration file integrity and config drift (CI-friendly; no DB connection)"
      )
      // The check reads no database, so the dialect comes from the history, the environment or here.
      .addOption(dialectOption())
      .action(
        lazyAction(
          async () => (await import("./migrate-check")).migrateCheckAction
        )
      ),
    startLine("Checking the migrations...")
  );
}
