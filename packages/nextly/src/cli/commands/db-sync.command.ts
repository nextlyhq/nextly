/**
 * The declaration of `nextly db:sync`: its options and help, with the action
 * loaded from `./db-sync` only when the command runs.
 */
import { basename } from "node:path";

import { Option, type Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { DEFAULT_TYPESCRIPT_CONFIG } from "../../shared/types/typescript-config-defaults";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/**
 * Register the dev command with the program
 *
 * @param program - Commander program instance
 */
// What: registers `nextly db:sync` (with `nextly sync` as a shorter alias).
// also dropped the `--seed` flag — demo seeding is now Payload-style and
// runs from the project's auth-gated POST route.
export function registerDbSyncCommand(program: Command): void {
  const command = program
    .command("db:sync")
    .alias("sync")
    .description("Sync database schema with nextly.config.ts.")
    .option("-w, --watch", "Watch for config file changes", false)
    .option(
      "--types",
      `Generate TypeScript types (to typescript.outputFile, ${basename(DEFAULT_TYPESCRIPT_CONFIG.outputFile)} by default)`,
      false
    )
    .option(
      "--schemas",
      "Generate Zod validation schema files to src/db/schemas/zod/",
      false
    )
    .option(
      "--no-auto-sync",
      "Disable auto-sync of schema changes (use migrations instead)"
    )
    // Retired: it never had an effect, since the schema pipeline asks before
    // destructive changes (or reads the data-loss consent, --accept-data-loss
    // or NEXTLY_ACCEPT_DATA_LOSS, where nobody can be asked). Still parsed, so
    // a script passing it is refused with a notice naming --accept-data-loss
    // rather than an unknown-option error; kept out of the help.
    .addOption(
      new Option(
        "-f, --force",
        "Retired: refused; use --accept-data-loss where nobody can be asked"
      )
        .default(false)
        .hideHelp()
    )
    .option(
      "--remove-orphaned",
      "Remove code-first collections/singles/components that no longer exist in config",
      false
    )
    // --promote moves a UI-owned collection to code; --demote does the
    // reverse. Either flag bypasses the normal sync flow and runs the
    // dedicated handler. See conflict-detector for the reason these exist.
    .option(
      "--promote <slug>",
      "Move a UI-owned collection to code (prints TS snippet, removes UI record)"
    )
    .option(
      "--demote <slug>",
      "Move a code-owned collection to UI (writes to dynamic_collections)"
    )
    .option("--yes", "Answer a confirmation that is not a data-loss consent")
    // The data-loss consent for the push's column drops, handed on as
    // NEXTLY_ACCEPT_DATA_LOSS (`exportDataLossConsent`). Only drops: renames
    // and type changes still need a terminal to answer their prompts.
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP);
  // `--dry-run` carries the one meaning and help line it has everywhere. Refused with `--watch`,
  // which never ends: a dry run reports once and exits 0.
  withDryRun(command, { conflicts: ["watch"] }).action(
    lazyAction(async () => (await import("./db-sync")).dbSyncAction)
  );
}
