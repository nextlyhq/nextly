/**
 * Read the optional `localized` flag off a schema preview/apply request body.
 *
 * The Schema Builder sends the toggle as it stands in the unsaved form, so one
 * save can flip Internationalization AND change fields: the DDL then runs for
 * the state the user is saving rather than the one still in the registry.
 * Preview and apply must read it the same way — the preview is what collects
 * the resolutions the apply runs with, so a preview that diffed against a
 * different localization state can miss a prompt the apply turns out to need,
 * and the save fails after the user already confirmed it.
 *
 * Absent means "no opinion": callers fall back to the persisted flag. A
 * present value must be a real boolean. Coercing instead (`x === true`) would
 * read `"false"`, `"true"`, `0` and `null` alike as `false`, which on an
 * already-localized entity selects a DISABLE transition — restoring the
 * companion's columns onto the main table and archiving it — from what was
 * meant to be an ordinary save.
 *
 * @module dispatcher/helpers/request-localized
 */

import { NextlyError } from "../../errors";

export function readRequestLocalized(body: unknown): boolean | undefined {
  const value = (body as { localized?: unknown } | null | undefined)?.localized;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw NextlyError.validation({
      errors: [
        {
          path: "localized",
          code: "invalid_type",
          message: "`localized` must be a boolean when provided.",
        },
      ],
      logContext: {
        reason: "localized-not-boolean",
        received: typeof value,
      },
    });
  }
  return value;
}
