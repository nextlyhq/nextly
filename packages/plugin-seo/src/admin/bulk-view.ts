/**
 * What the bulk edit screen works out from the rows it read and the cells a
 * person typed in: which edits are changes, the changes a save sends, which
 * rows a filter shows, and what each cell says under its text. Pure, so the
 * screen and its tests read one answer.
 *
 * @module admin/bulk-view
 */
import type { BulkChange, BulkRow } from "../bulk/contract";
import { characters, DESCRIPTION_LIMIT, TITLE_LIMIT } from "../tab/problems";

/** A cell of the table: a page's title or its description. */
export type BulkField = "title" | "description";

/** What a person typed, by `editKey`; a row's own value where none. */
export type BulkEdits = Readonly<Record<string, string>>;

/** Which rows the table shows. */
export type BulkFilter = "all" | "typed" | "auto";

/** The key an edit is kept under. */
export const editKey = (id: string, field: BulkField): string =>
  `${id}:${field}`;

/** A cell's text: what was typed in it here, else what the page holds. */
export function cellValue(
  row: BulkRow,
  field: BulkField,
  edits: BulkEdits
): string {
  return edits[editKey(row.id, field)] ?? row[field];
}

/** Whether a cell holds an edit that differs from what the page holds. */
export function changed(
  row: BulkRow,
  field: BulkField,
  edits: BulkEdits
): boolean {
  const edit = edits[editKey(row.id, field)];
  return row.editable && edit !== undefined && edit !== row[field];
}

/**
 * The changes a save sends: one per row with a changed cell, each with the
 * version its page was read at when it was first edited (`revs`), so a page
 * saved by someone else since, and read again here, is refused rather than
 * overwritten.
 */
export function changesOf(
  rows: readonly BulkRow[],
  edits: BulkEdits,
  revs: Readonly<Record<string, string>> = {}
): BulkChange[] {
  const changes: BulkChange[] = [];
  for (const row of rows) {
    const title = changed(row, "title", edits);
    const description = changed(row, "description", edits);
    if (!title && !description) continue;
    const rev = revs[row.id] ?? row.rev;
    changes.push({
      id: row.id,
      ...(rev === undefined ? {} : { rev }),
      ...(title ? { title: cellValue(row, "title", edits) } : {}),
      ...(description
        ? { description: cellValue(row, "description", edits) }
        : {}),
    });
  }
  return changes;
}

/** How many cells a save of `changes` sends. */
export function changeCount(changes: readonly BulkChange[]): number {
  return changes.reduce(
    (count, change) =>
      count +
      (change.title === undefined ? 0 : 1) +
      (change.description === undefined ? 0 : 1),
    0
  );
}

/**
 * The rows as a save of `changes` left them: each saved value in place, and
 * each saved page at the version the save gave it.
 */
export function savedRows(
  rows: readonly BulkRow[],
  changes: readonly BulkChange[],
  revs: Readonly<Record<string, string>>
): BulkRow[] {
  const byId = new Map(changes.map(change => [change.id, change]));
  return rows.map(row => {
    const change = byId.get(row.id);
    if (change === undefined) return row;
    const rev = revs[row.id];
    return {
      ...row,
      ...(change.title === undefined ? {} : { title: change.title }),
      ...(change.description === undefined
        ? {}
        : { description: change.description }),
      ...(rev === undefined ? {} : { rev }),
    };
  });
}

/**
 * The rows `filter` shows: every one, those with typed text, or none typed,
 * judged by what each page holds, so a row does not leave the table while
 * someone types in it.
 */
export function shownRows(
  rows: readonly BulkRow[],
  filter: BulkFilter
): BulkRow[] {
  if (filter === "all") return [...rows];
  return rows.filter(row => {
    const typed = row.title !== "" || row.description !== "";
    return filter === "typed" ? typed : !typed;
  });
}

/** What a cell says under its text: typed or automatic, and its length. */
export function cellMeta(
  row: BulkRow,
  field: BulkField,
  edits: BulkEdits
): { typed: boolean; length: number; limit: number; over: boolean } {
  const value = cellValue(row, field, edits);
  const automatic =
    (field === "title" ? row.autoTitle : row.autoDescription) ?? "";
  const limit = field === "title" ? TITLE_LIMIT : DESCRIPTION_LIMIT;
  // Counted as the SEO tab and the problem list count it, in characters.
  const length = characters(value === "" ? automatic : value);
  return { typed: value !== "", length, limit, over: length > limit };
}
