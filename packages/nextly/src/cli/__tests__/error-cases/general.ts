/**
 * The case for an error no other code anticipated: a driver failure arriving as a plain Error.
 *
 * @module cli/__tests__/error-cases/general
 */
import type { ErrorCases } from "./types";
import { NextlyError } from "../../../errors/nextly-error";

export const GENERAL_CASES = {
  UNEXPECTED_ERROR: () =>
    new Error("Failed query", {
      cause: new Error("no such column: localized"),
    }),
  // A refusal no other code reads, as a check below the CLI raises one.
  INPUT_REFUSED: () =>
    NextlyError.invalidInput({
      message:
        'The block "hero" declares the prop "size" twice. Each prop name may appear once.',
    }),
} satisfies ErrorCases;
