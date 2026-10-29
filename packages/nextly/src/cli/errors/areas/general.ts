/**
 * The code for an error no other code anticipated.
 *
 * Every error a command ends with is printed in the same shape, so one nothing else maps still
 * says what it can: where it failed, the error's own words, and how to see more.
 *
 * @module cli/errors/areas/general
 */

import { immediateMessage } from "../../../errors/describe-error";
import { NextlyError } from "../../../errors/nextly-error";
import { CliError } from "../cli-error";
import { defineCodes } from "../define";
import { messageWithCause } from "../messages";

export const GENERAL_CODES = defineCodes({
  UNEXPECTED_ERROR: {
    cause: "The command stopped on an error that no other code describes.",
  },
});

/** Each issue of a validation error, as `path: message`. */
function issueLines(error: NextlyError): string[] {
  const data = error.publicData as
    | { errors?: Array<{ path?: unknown; message?: unknown }> }
    | undefined;
  return (data?.errors ?? [])
    .filter(issue => typeof issue.message === "string")
    .map(issue =>
      typeof issue.path === "string" && issue.path.length > 0
        ? `${issue.path}: ${String(issue.message)}`
        : String(issue.message)
    );
}

/** `error`, whatever it is, as the catch-all code, keeping its own words and its detail. */
export function unexpectedError(error: unknown): CliError {
  if (NextlyError.is(error)) {
    // The public message of an internal error is deliberately generic ("An unexpected error
    // occurred."), so its operator headline is the log message; any other error's public message
    // is the sentence written for the person reading it. The fault is the deepest cause.
    const headline =
      error.code === "INTERNAL_ERROR" && error.logMessage
        ? error.logMessage
        : error.publicMessage;
    // A validation error's summary is only "Validation failed."; its issues say what failed.
    const issues = issueLines(error);
    return new CliError(
      "UNEXPECTED_ERROR",
      {
        what: "The command stopped on an error Nextly did not expect.",
        why:
          issues.length > 0
            ? issues.join("\n")
            : messageWithCause(headline, error.cause),
        next: "Run it again with `--verbose` to see the details, and report it at https://github.com/nextlyhq/nextly/issues if it keeps happening.",
        context: { code: String(error.code), ...error.logContext },
      },
      error
    );
  }
  return new CliError(
    "UNEXPECTED_ERROR",
    {
      what: "The command stopped on an error Nextly did not expect.",
      why: messageWithCause(
        immediateMessage(error),
        error instanceof Error ? error.cause : undefined
      ),
      next: "Run it again with `--verbose` to see the details, and report it at https://github.com/nextlyhq/nextly/issues if it keeps happening.",
    },
    error instanceof Error ? error : undefined
  );
}
