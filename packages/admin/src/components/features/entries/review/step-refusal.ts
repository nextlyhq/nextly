/**
 * Why a workflow step was refused, in words a person can act on, from the
 * refusal the server sends (`{ error: { code, message, data } }`, read through
 * `parseApiError`).
 *
 * The server's message for some refusals is the generic "You don't have
 * permission" or "The resource has changed": what is wrong, and who could do
 * it instead, is in `data`. This says it: an approval covering fields the
 * reviewer cannot read names the fields and the people who could approve, a
 * self-approval says someone else must, a missing permission names it.
 *
 * @module components/features/entries/review/step-refusal
 */

import { apiErrorMessage, isApiError } from "@admin/lib/api/parseApiError";

import { listWords } from "./approve-all";

/** The step's label as a verb inside a sentence: "Approve" reads "approve". */
function verbOf(label: string): string {
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** The strings of `value`, where it is a list; none otherwise. */
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((each: unknown): each is string => typeof each === "string")
    : [];
}

/** The names of the people a refusal says could approve instead. */
function approverNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each: unknown) => {
    if (typeof each !== "object" || each === null) return [];
    const name: unknown = "name" in each ? each.name : null;
    return [typeof name === "string" && name !== "" ? name : "an unnamed user"];
  });
}

/** The words for a refused step labelled `label`. */
export function stepRefusalWords(reason: unknown, label: string): string {
  const verb = verbOf(label);
  const fallback = `${label} didn't go through.`;
  if (!isApiError(reason) || reason.data === undefined) {
    return apiErrorMessage(reason, fallback);
  }
  const { data } = reason;
  switch (data.reason) {
    case "field-hidden": {
      const fields = strings(data.fields);
      const names = approverNames(data.approvers);
      const which =
        fields.length === 0
          ? "fields you can't read"
          : `${fields.length === 1 ? "a field" : "fields"} you can't read (${fields.join(", ")})`;
      const who =
        names.length === 0
          ? "No one who can read them may approve it yet."
          : `It can be approved by ${listWords(names)}.`;
      return `You can't ${verb} this: it changes ${which}. ${who}`;
    }
    case "self-approval":
      return `You can't ${verb} your own submission: someone else needs to.`;
    case "no-permission":
      return typeof data.permission === "string"
        ? `You need the “${data.permission}” permission for “${label}”.`
        : apiErrorMessage(reason, fallback);
    case "stale":
      return `It changed since you looked, so nothing was done. Look it over again, then try “${label}” again.`;
    case "not-from-stage":
      return `“${label}” isn't offered from where the document stands now.`;
    default:
      return apiErrorMessage(reason, fallback);
  }
}
