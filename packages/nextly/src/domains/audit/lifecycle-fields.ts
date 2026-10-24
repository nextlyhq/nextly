/**
 * The fields the status lifecycle writes on its own, and whether a write
 * edits anything else: ONE reading for the trail's writer and its readers.
 *
 * @module domains/audit/lifecycle-fields
 */

import { SYSTEM_COLUMNS } from "../../lib/system-columns";
import { deepEqual } from "../../shared/lib/deep-equal";

/**
 * The fields the status lifecycle stamps on its own: `updatedAt`, which every
 * write stamps, and every system column that exists only with Draft/Published,
 * by the name a document carries it under. Taken from the declarations rather
 * than listed, so a lifecycle column added there is one here too.
 */
export const LIFECYCLE_FIELDS: ReadonlySet<string> = new Set([
  "updatedAt",
  ...SYSTEM_COLUMNS.filter(
    column => column.presence === "withStatusLifecycle"
  ).map(column => column.camelName),
]);

/**
 * Every field the system writes rather than a person: the lifecycle's, and the
 * system columns every document carries (`id`, `createdAt`, `createdBy`, ...),
 * which a write ignores whatever a request says. Not `title` or `slug`: they
 * are system columns only until an author declares their own, and a person
 * writes them either way.
 */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  ...LIFECYCLE_FIELDS,
  ...SYSTEM_COLUMNS.filter(column => column.presence === "always").map(
    column => column.camelName
  ),
]);

/**
 * Whether `caller`, what a request writes over a document it promotes, edits
 * its content: a field a person writes whose value differs from the
 * `draft`'s. What a publish states as `requestEdits`.
 *
 * The caller's OWN keys alone, so a draft value the request left alone is not
 * read as an edit; a system field, which no write takes from a request, is
 * not one either; and a value equal to the draft's, a full document echoed
 * back, changes nothing.
 */
export function editsOver(
  draft: Record<string, unknown>,
  caller: Record<string, unknown>
): boolean {
  return Object.keys(caller).some(
    name => !SYSTEM_FIELDS.has(name) && !deepEqual(caller[name], draft[name])
  );
}
