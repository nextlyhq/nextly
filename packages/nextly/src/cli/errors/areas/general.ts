/**
 * The code for an error no other code anticipated.
 *
 * Every error a command ends with is printed in the same shape, so one nothing else maps still
 * says what it can: where it failed, the error's own words, and how to see more.
 *
 * @module cli/errors/areas/general
 */

import {
  perLanguageMoveNext,
  perLanguageMovesFrom,
  perLanguageMoveWhy,
} from "../../../domains/i18n/per-language-move-guidance";
import { immediateMessage } from "../../../errors/describe-error";
import { NextlyError } from "../../../errors/nextly-error";
import { CliError, type CliErrorParts } from "../cli-error";
import { defineCodes } from "../define";
import { messageWithCause, sentences } from "../messages";

/** An input refusal in the refusing check's own words: its first sentence, then the rest. */
function refusedInput(error: NextlyError): CliErrorParts {
  const [what, ...rest] = sentences(error.publicMessage);
  return {
    what: what ?? error.publicMessage,
    why: rest.join(" ") || "The check that refused it gave no more detail.",
    next: "Correct what the message names, then run the command again; `--verbose` shows where it was refused.",
  };
}

export const GENERAL_CODES = defineCodes({
  INPUT_REFUSED: {
    cause:
      "A command refused something it was given or read as not valid, for the reason its message names.",
    from: [
      {
        // `migrate:create` refusing to move text-like fields to their per-language tables while
        // the config declares no language: the fields named as a move, not a loss, with the two
        // safe ways forward, in the words `nextly migrate` uses for the same move.
        code: "INVALID_INPUT",
        reason: "per-language-seed-language-undeclared",
        describe: error => {
          const moves = perLanguageMovesFrom(error.logContext?.moves);
          if (moves.length === 0) return refusedInput(error);
          return {
            what: "This migration would move existing content into per-language tables, and the config declares no `localization` block to say which language that content is in.",
            why: perLanguageMoveWhy(moves),
            next: perLanguageMoveNext(
              moves,
              "run `nextly migrate:create` again."
            ),
          };
        },
      },
      {
        // What is left of INVALID_INPUT once every code reading a reason or a shape has had it:
        // still a refusal of the input, never a fault in Nextly.
        code: "INVALID_INPUT",
        describe: refusedInput,
      },
      // A deleted entry a restore refused to put back, its message saying why: the entry stays
      // in the trash, and nothing was written.
      ...[
        "published-with-pending-edits",
        "restore-collection-changed",
        "restore-fields-changed",
        "restore-id-taken",
      ].map(reason => ({
        code: "CONFLICT" as const,
        reason,
        describe: refusedInput,
      })),
      {
        // A trash command named an entry, or a collection, the trash holds nothing of for this
        // caller: one they may not read is answered as one that is not there.
        code: "NOT_FOUND",
        reason: "trash-item-not-found",
        describe: () => ({
          what: "The trash holds no deleted entry by that id, or none of that collection.",
          why: "A deleted entry stays in the trash for 30 days, until it is restored or the trash is emptied.",
          next: "Run `nextly trash list` to see what the trash holds.",
        }),
      },
    ],
  },
  UNEXPECTED_ERROR: {
    cause: "The command stopped on an error that no other code describes.",
  },
});

/**
 * Each issue of a validation error, as `path: message`: the words a run stopped by it prints, and
 * a dry run's refusals repeat.
 */
export function issueLines(error: NextlyError): string[] {
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
