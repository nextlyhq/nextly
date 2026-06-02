// Event-sourced "current state" rule shared by the migration bookkeeping:
// the newest file_apply event (by startedAt) decides whether a file is applied.
import type { SchemaEventRow } from "./schema-events-repository";

/** The most-recently-started event in the set, or undefined if empty. */
export function newestEvent(
  rows: SchemaEventRow[]
): SchemaEventRow | undefined {
  return [...rows].sort(
    (a, b) => +new Date(b.startedAt) - +new Date(a.startedAt)
  )[0];
}
