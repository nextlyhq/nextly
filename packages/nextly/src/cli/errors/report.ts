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

/**
 * Whether the error, which goes to standard error, is coloured. picocolors judges standard output,
 * so `nextly migrate 2> errors.log` from a terminal would write escape codes into the log. Its
 * answer still decides `NO_COLOR` and `--no-color`; a terminal on standard error decides the rest.
 */
function colorsOnStandardError(): boolean {
  return pc.isColorSupported && process.stderr.isTTY === true;
}

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
      color: options.noColor !== true && colorsOnStandardError(),
    })
  );
  return cliError;
}

/**
 * Prints `error` in the error shape with the run's `--verbose` and `--no-color`, and returns it as
 * read: for a command that sets its own exit code after.
 */
export function printCliError(
  logger: Pick<Logger, "getOptions">,
  error: unknown
): CliError {
  const { verbose, noColor } = logger.getOptions();
  return reportCliError(error, { verbose, noColor });
}

/** Prints `error` in the error shape, with the run's `--verbose` and `--no-color`, and exits 1. */
export function exitWithError(
  logger: Pick<Logger, "getOptions">,
  error: unknown
): never {
  printCliError(logger, error);
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
  printCliError(logger, error);
  process.exitCode = 1;
}
