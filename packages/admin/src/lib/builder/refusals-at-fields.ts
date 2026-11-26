/**
 * The server's refusals of a save, by the id of the field each names, each with its message as the
 * server wrote it: every refusal coded one of `codes`, at a path `fieldAt` places. A field refused
 * twice keeps its first message. A save's refused moves and refused type changes are read so
 * (`refusedMovesOf`, `refusedTypeChangesOf`).
 *
 * @module lib/builder/refusals-at-fields
 */
import { validationIssues } from "@admin/lib/api/parseApiError";

export function refusalsAtFields(
  error: unknown,
  codes: ReadonlySet<string>,
  fieldAt: ReadonlyMap<string, string>
): ReadonlyMap<string, string> {
  const refused = new Map<string, string>();
  for (const issue of validationIssues(error)) {
    if (
      issue.code === undefined ||
      !codes.has(issue.code) ||
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
