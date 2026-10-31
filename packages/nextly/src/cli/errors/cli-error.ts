/**
 * The error a `nextly` command ends with.
 *
 * A command's failure is read by a person at a terminal, a CI log or an agent, and each needs the
 * same four things: what happened, why, what to run next, and where to read more. The HTTP-facing
 * `NextlyError` carries a public message and a log context instead, so printing one gave an
 * envelope (`[INVALID_INPUT] … | context: {…}`) and no next step. This keeps those four parts
 * apart, under a code of the CLI's own that keeps its meaning once released.
 *
 * It is a `NextlyError`, so code that recognises one (telemetry's classifier, `describeError`)
 * still does, and its `code` is one of the codes in `registry.ts`.
 *
 * @module cli/errors/cli-error
 */

import { NextlyError } from "../../errors/nextly-error";

import type { CliErrorCode } from "./registry";

/** The parts of an error as the terminal shows them. */
export interface CliErrorParts {
  /** What happened, in one plain sentence. */
  what: string;
  /** The cause, in this run's own terms: the file, the line, the holder, the value. */
  why: string;
  /** The command or action that fixes it. */
  next: string;
  /** Internal detail for `--verbose`, never shown without it. */
  context?: Record<string, unknown>;
}

export class CliError extends NextlyError {
  declare readonly code: CliErrorCode;
  readonly what: string;
  readonly why: string;
  readonly next: string;

  constructor(code: CliErrorCode, parts: CliErrorParts, cause?: Error) {
    super({
      code,
      publicMessage: parts.what,
      logContext: parts.context,
      cause,
    });
    this.name = "CliError";
    this.what = parts.what;
    this.why = parts.why;
    this.next = parts.next;
  }
}
