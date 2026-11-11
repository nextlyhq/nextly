/**
 * The save of a form refuses a one response per email it could not keep:
 * no Email field chosen, or one that is missing, optional or hidden by a
 * condition. The builder and Settings refuse the same, and this holds it for
 * every other way a form is written (the API, an import).
 *
 * @module handlers/one-response-field-check
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import type { AnyFormField } from "../types";
import { normalizeFormSettings } from "../utils/form-settings";
import { oneResponseFieldProblem } from "../utils/one-response-field";

/** A stored value as written: itself, or a JSON string before a read decodes it. */
function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Refuse a form save whose one response per email has no Email field it can
 * compare. What the save leaves out is read as stored, so a save of the
 * fields alone is judged against the stored settings, and the other way
 * round.
 */
export function refuseOneResponseFieldProblem(context: unknown): void {
  const ctx = context as {
    data?: Record<string, unknown>;
    originalData?: Record<string, unknown>;
  };
  const data = ctx.data;
  if (!data || (data.settings === undefined && data.fields === undefined)) {
    return;
  }
  const settings = normalizeFormSettings(
    decoded(data.settings ?? ctx.originalData?.settings)
  );
  const fields = decoded(data.fields ?? ctx.originalData?.fields);
  const problem = oneResponseFieldProblem(
    settings,
    Array.isArray(fields) ? (fields as AnyFormField[]) : []
  );
  if (problem === undefined) return;
  throw NextlyError.validation({
    errors: [
      { path: "settings.oneResponseField", code: "INVALID", message: problem },
    ],
  });
}
