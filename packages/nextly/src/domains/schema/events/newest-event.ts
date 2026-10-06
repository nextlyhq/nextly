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

/**
 * The newest event for each filename, decided by `newestEvent` so the two can
 * never disagree — including on a startedAt tie, where `newestEvent`'s stable
 * sort keeps the row that came first in `rows`.
 *
 * Rows with no filename are skipped: they are not file applies of anything a
 * caller could ask about by name.
 */
export function newestEventsByFilename(
  rows: SchemaEventRow[]
): Map<string, SchemaEventRow> {
  const byFilename = new Map<string, SchemaEventRow[]>();
  for (const row of rows) {
    if (!row.filename) continue;
    const list = byFilename.get(row.filename);
    if (list) list.push(row);
    else byFilename.set(row.filename, [row]);
  }
  const newest = new Map<string, SchemaEventRow>();
  for (const [filename, list] of byFilename) {
    const event = newestEvent(list);
    if (event) newest.set(filename, event);
  }
  return newest;
}

/**
 * Filenames whose NEWEST event is `applied` — what "is this file applied?"
 * means everywhere the ledger is read.
 *
 * Not "has an `applied` row": `migrate:down` and `plugins uninstall` record a
 * rollback by INSERTING a `rolled_back` event after the `applied` one, and a
 * failed re-apply inserts a `failed` one, so an older `applied` row says
 * nothing about the file's current state.
 */
export function appliedFilenames(rows: SchemaEventRow[]): Set<string> {
  const applied = new Set<string>();
  for (const [filename, event] of newestEventsByFilename(rows)) {
    if (event.status === "applied") applied.add(filename);
  }
  return applied;
}
