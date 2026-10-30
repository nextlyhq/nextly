/**
 * How a CLI error code is declared.
 *
 * Each area of the CLI declares its codes in a file of its own under `areas/`: the one cause each
 * code stands for, and the errors from below the CLI (a `NextlyError` a domain service throws)
 * that end a command as that code, with how each reads. `registry.ts` joins the areas into the one
 * list every test and docs page is checked against.
 *
 * @module cli/errors/define
 */

import type { NextlyError } from "../../errors/nextly-error";

import type { CliErrorParts } from "./cli-error";

/**
 * An error from below the CLI that ends a command as a given code.
 *
 * `code` and `reason` (the error's `logContext.reason`) pick the error out; `issue` and `when`
 * tell apart errors that share both: `issue` by the code of an entry in a validation error's
 * `publicData.errors` (a `VALIDATION_ERROR` carries many causes, each as an issue), and `when` by
 * any other property, such as a configuration that failed to compile and one that threw while it
 * ran. A mapping with neither is the one used when no narrower one matches.
 */
export interface FromError {
  readonly code: string;
  readonly reason?: string;
  readonly issue?: string;
  readonly when?: (error: NextlyError) => boolean;
  readonly describe: (error: NextlyError) => CliErrorParts;
}

export interface CliCodeDefinition {
  /**
   * The one cause this code stands for, as its docs page states it. Released with the code and
   * never given another: `released-codes.json` holds each released code to it.
   */
  readonly cause: string;
  /** The errors from below the CLI that end a command as this code. */
  readonly from?: readonly FromError[];
}

/** Declares an area's codes, keeping each key a literal so the registry can type them. */
export function defineCodes<const T extends Record<string, CliCodeDefinition>>(
  codes: T
): T {
  return codes;
}
