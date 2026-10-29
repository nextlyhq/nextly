/**
 * Printing the error a command ends with, and ending it.
 *
 * Every path that ends a command with an error comes here, so every one prints the same shape:
 * a command's own catch through {@link exitWithError}, and the entry point, for an error thrown
 * out of a command, through {@link reportCliError}.
 *
 * @module cli/errors/report
 */

import pc from "picocolors";

import type { Logger } from "../utils/logger";

import type { CliError } from "./cli-error";
import { toCliError } from "./from-thrown";
import { formatCliError } from "./render";

export interface ReportOptions {
  verbose?: boolean;
  noColor?: boolean;
}

/**
 * Prints `error` in the error shape on standard error, whatever its quiet setting, and returns it
 * as read. `DEBUG=1` or `DEBUG=true` counts as `--verbose`, as it did before the flag reached
 * errors.
 */
export function reportCliError(
  error: unknown,
  options: ReportOptions = {}
): CliError {
  const cliError = toCliError(error);
  const debug = process.env.DEBUG === "true" || process.env.DEBUG === "1";
  console.error(
    formatCliError(cliError, {
      verbose: options.verbose === true || debug,
      color: options.noColor !== true && pc.isColorSupported,
    })
  );
  return cliError;
}

/** Prints `error` in the error shape, with the run's `--verbose` and `--no-color`, and exits 1. */
export function exitWithError(
  logger: Pick<Logger, "getOptions">,
  error: unknown
): never {
  const { verbose, noColor } = logger.getOptions();
  reportCliError(error, { verbose, noColor });
  return process.exit(1);
}

/**
 * Prints `error` in the error shape and sets the exit code to 1, letting the process end on its
 * own: for a command whose pending output or handles must finish before it exits.
 */
export function failWithError(
  logger: Pick<Logger, "getOptions">,
  error: unknown
): void {
  const { verbose, noColor } = logger.getOptions();
  reportCliError(error, { verbose, noColor });
  process.exitCode = 1;
}
