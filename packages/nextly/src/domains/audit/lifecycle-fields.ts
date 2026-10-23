/**
 * The fields the status lifecycle writes on its own, and whether a write
 * carries anything else: ONE reading for the trail's writer and its readers.
 *
 * @module domains/audit/lifecycle-fields
 */

import { SYSTEM_COLUMNS } from "../../lib/system-columns";

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
 * Whether `data`, what a request writes, carries content of its own: a field
 * other than the lifecycle's. What a publish states as `requestEdits`.
 */
export function carriesContent(data: Record<string, unknown>): boolean {
  return Object.keys(data).some(name => !LIFECYCLE_FIELDS.has(name));
}
