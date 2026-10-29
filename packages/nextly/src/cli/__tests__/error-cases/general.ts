/**
 * The case for an error no other code anticipated: a driver failure arriving as a plain Error.
 *
 * @module cli/__tests__/error-cases/general
 */
import type { ErrorCases } from "./types";

export const GENERAL_CASES = {
  UNEXPECTED_ERROR: () =>
    new Error("Failed query", {
      cause: new Error("no such column: localized"),
    }),
} satisfies ErrorCases;
