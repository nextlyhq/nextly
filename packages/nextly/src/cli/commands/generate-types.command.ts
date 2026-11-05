/**
 * The declaration of `nextly generate:types`: its options and help, with the
 * action loaded from `./generate-types` only when the command runs.
 */
import type { Command } from "commander";

import { DEFAULT_TYPESCRIPT_CONFIG } from "../../shared/types/typescript-config-defaults";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/**
 * Register the generate:types command with the program
 *
 * @param program - Commander program instance
 */
export function registerGenerateTypesCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere;
  // `--check` stays the CI check of the component map.
  withDryRun(
    program
      .command("generate:types")
      .description(
        "Generate TypeScript type definitions and Zod schemas from collections and singles"
      ),
    // Each sets its own exit code, so the two together are refused.
    { conflicts: ["check"] }
  )
    // The help names the default from the value the config falls back to, so
    // the two cannot disagree.
    .option(
      "-o, --output <path>",
      `Output file path for TypeScript types (default: typescript.outputFile, or ${DEFAULT_TYPESCRIPT_CONFIG.outputFile})`
    )
    .option("--no-declare", "Skip module declaration/augmentation")
    .option("--no-zod", "Skip Zod schema generation")
    .option(
      "--check",
      "Only check that the committed component map agrees with the config, writing nothing"
    )
    .action(
      lazyAction(
        async () => (await import("./generate-types")).generateTypesAction
      )
    );
}
