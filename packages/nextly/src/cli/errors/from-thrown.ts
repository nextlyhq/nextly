/**
 * Any thrown value, as the error a command ends with.
 *
 * A `CliError` is already one. A `NextlyError` from below the CLI is matched against the
 * mappings the areas declare, by its code and `logContext.reason`, and read as the code it maps
 * to. Anything else is `UNEXPECTED_ERROR`, in the same shape, so no path prints an envelope.
 *
 * @module cli/errors/from-thrown
 */

import { NextlyError } from "../../errors/nextly-error";

import { unexpectedError } from "./areas/general";
import { CliError } from "./cli-error";
import type { FromError } from "./define";
import { CLI_ERROR_CODES, type CliErrorCode } from "./registry";

/** A mapping with the code it maps to. */
export interface CliErrorMapping extends FromError {
  readonly to: CliErrorCode;
}

/** Every mapping the areas declare, in the registry's order. */
export const CLI_ERROR_MAPPINGS: readonly CliErrorMapping[] = (
  Object.entries(CLI_ERROR_CODES) as [
    CliErrorCode,
    (typeof CLI_ERROR_CODES)[CliErrorCode],
  ][]
).flatMap(([to, definition]) =>
  ("from" in definition ? (definition.from ?? []) : []).map(
    (mapping: FromError) => ({ ...mapping, to })
  )
);

/** The codes of the issues a validation error carries in `publicData.errors`. */
function issueCodes(error: NextlyError): string[] {
  const data = error.publicData as
    | { errors?: Array<{ code?: unknown }> }
    | undefined;
  return (data?.errors ?? [])
    .map(issue => issue.code)
    .filter((code): code is string => typeof code === "string");
}

/** Whether a mapping is narrower than its code and reason: by an issue, or by `when`. */
const narrows = (mapping: FromError) =>
  mapping.issue !== undefined || mapping.when !== undefined;

/**
 * The mapping `error` reads by, or undefined when none declares it.
 *
 * Among the mappings for its code and reason, one whose issue the error carries, or whose `when`
 * holds, wins over the one with neither, which is what is left when no narrower one fits.
 */
function mappingFor(error: NextlyError): CliErrorMapping | undefined {
  const reason = error.logContext?.reason;
  const issues = issueCodes(error);
  const candidates = CLI_ERROR_MAPPINGS.filter(
    mapping =>
      mapping.code === error.code &&
      (mapping.reason === undefined || mapping.reason === reason)
  );
  return (
    candidates.find(
      mapping =>
        (mapping.issue === undefined || issues.includes(mapping.issue)) &&
        narrows(mapping) &&
        (mapping.when === undefined || mapping.when(error))
    ) ??
    candidates.find(
      mapping => !narrows(mapping) && mapping.reason === reason
    ) ??
    candidates.find(
      mapping => !narrows(mapping) && mapping.reason === undefined
    )
  );
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (NextlyError.is(error)) {
    const mapping = mappingFor(error);
    if (mapping !== undefined) {
      // The error it reads stays its cause, so `--verbose` shows that error's own code and
      // context rather than a copy of them.
      return new CliError(mapping.to, mapping.describe(error), error);
    }
  }
  return unexpectedError(error);
}
