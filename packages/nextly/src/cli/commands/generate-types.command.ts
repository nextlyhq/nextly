/**
 * The declaration of `nextly generate:types`: its options and help, with the
 * action loaded from `./generate-types` only when the command runs.
 */
import type { Command } from "commander";

import { DEFAULT_TYPESCRIPT_CONFIG } from "../../shared/types/typescript-config-defaults";
import { lazyAction } from "../lazy-action";

/**
 * Register the generate:types command with the program
 *
 * @param program - Commander program instance
 */
export function registerGenerateTypesCommand(program: Command): void {
  program
    .command("generate:types")
    .description(
      "Generate TypeScript type definitions and Zod schemas from collections and singles"
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
      "Only check that the committed component map agrees with the config, writing nothing (exit 1 when it does not, 2 when it cannot be checked)"
    )
    .action(
      lazyAction(
        async () => (await import("./generate-types")).generateTypesAction
      )
    );
}
