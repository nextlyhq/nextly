/**
 * The declaration of `nextly migrate:baseline`: its options and help,
 * with the action loaded from `./migrate-baseline` only when the command runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/** The migration name used when the operator supplies none. */
export const DEFAULT_BASELINE_NAME = "baseline";

export function registerMigrateBaselineCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("migrate:baseline")
      .description(
        "Adopt an existing database into the migration history (run once, when graduating from db:sync)"
      )
  )
    .option(
      "--name <name>",
      `Migration name (default: "${DEFAULT_BASELINE_NAME}")`
    )
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before taking it (use after a crashed run)"
    )
    .option(
      "--adopt-unknown",
      "Adopt translation tables holding columns your config no longer describes, rebuilding them from the database"
    )
    .action(
      lazyAction(
        async () => (await import("./migrate-baseline")).migrateBaselineAction
      )
    );
}
