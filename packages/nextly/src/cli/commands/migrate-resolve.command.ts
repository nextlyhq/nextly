/**
 * The declaration of `nextly migrate:resolve`: its options and help, with the
 * action loaded from `./migrate-resolve` only when the command runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

export function registerMigrateResolveCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("migrate:resolve")
      .description(
        "Recover migration bookkeeping: mark a file applied/rolled-back, or clean up a failed or unfinished attempt"
      )
  )
    .option(
      "--applied <filename>",
      "Mark <filename> as applied, or accept an edit to an applied one (verifies live == target snapshot unless --skip-verify)"
    )
    .option(
      "--rolled-back <filename>",
      "Record a rolled_back event so <filename> re-runs on next migrate"
    )
    .option(
      "--removed <filename>",
      "Record that an applied migration's file was removed from the folder on purpose; it stays applied"
    )
    .option(
      "--file-missing",
      "With --rolled-back, say the file is gone from the migrations folder, so it is not read",
      false
    )
    .option(
      "--failed-cleanup <filename>",
      "Flip the stuck failed or unfinished attempts of <filename> to rolled_back (edit the .sql before retrying)"
    )
    .option(
      "--skip-verify",
      "With --applied, skip the live-vs-snapshot equivalence check",
      false
    )
    // This command takes the shared migrate lock, and the lock-busy error
    // tells operators to re-run with this flag — so every lock-taking
    // command must register it. Same escape hatch as `nextly migrate`.
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before running",
      false
    )
    .action(
      lazyAction(
        async () => (await import("./migrate-resolve")).migrateResolveAction
      )
    );
}
