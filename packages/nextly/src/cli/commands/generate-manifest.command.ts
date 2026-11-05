/**
 * The declaration of `nextly generate:manifest`: its options and help, with
 * the action loaded from `./generate-manifest` only when the command runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/**
 * Register the generate:manifest command with the program
 *
 * @param program - Commander program instance
 */
export function registerGenerateManifestCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere;
  // `--check` stays the CI gate that exits non-zero on drift.
  withDryRun(
    program
      .command("generate:manifest")
      .description(
        "Generate the block manifest from plugin declarations, or check it is current"
      ),
    // Each sets its own exit code, so the two together are refused.
    { conflicts: ["check"] }
  )
    .option(
      "-o, --output <path>",
      "Types output path the manifest is written beside"
    )
    .option(
      "--check",
      "Write nothing; exit non-zero if the committed manifest is stale"
    )
    .action(
      lazyAction(
        async () => (await import("./generate-manifest")).generateManifestAction
      )
    );
}
