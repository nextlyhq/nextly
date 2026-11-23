/**
 * The server's refusals of a save's field type changes, by the changed field's id, each with its
 * message as the server wrote it: shown at the field, as a refused move is. A save refuses a type
 * change over the values it would lose, over a pair no value survives, and over a field whose
 * translations the change would leave behind. Each names the field by its path among the fields
 * it saves: `fields.` then the names of the fields holding it and its own.
 *
 * @module lib/builder/type-change-refusals
 */
import { validationIssues } from "@admin/lib/api/parseApiError";

import type { PendingChange } from "./pending-changes";

/** The codes a save refuses a field's type change with. */
const TYPE_CHANGE_REFUSALS: ReadonlySet<string> = new Set([
  "TYPE_CHANGE_BLOCKED",
  "TYPE_CHANGE_LOSES_VALUES",
  "RESHAPED_FIELD_LEAVES_TRANSLATION",
  "RESHAPED_FIELD_JOINS_TRANSLATION",
]);

/**
 * Each refusal of a type change among `changes`, by field id. One that names no type change of the
 * draft marks no field; the save's toast still carries every message.
 */
export function refusedTypeChangesOf(
  error: unknown,
  changes: readonly PendingChange[]
): ReadonlyMap<string, string> {
  const fieldAt = new Map<string, string>();
  for (const change of changes) {
    if (change.kind === "typeChanged" && change.path !== undefined) {
      fieldAt.set(`fields.${change.path.join(".")}`, change.fieldId);
    }
  }
  const refused = new Map<string, string>();
  for (const issue of validationIssues(error)) {
    if (
      issue.code === undefined ||
      !TYPE_CHANGE_REFUSALS.has(issue.code) ||
      issue.message === undefined
    ) {
      continue;
    }
    const fieldId =
      issue.path === undefined ? undefined : fieldAt.get(issue.path);
    if (fieldId !== undefined && !refused.has(fieldId)) {
      refused.set(fieldId, issue.message);
    }
  }
  return refused;
}
