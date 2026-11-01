/**
 * One cell as a row or a table draws it: its text, and for a date, a `<time>`
 * whose tooltip holds the full date the short form leaves out.
 *
 * Every list and table card presents its cells through this, so a date reads
 * the same in a meta line and in a table column.
 *
 * @module components/features/widgets/archetypes/presented-cell
 */

import type { ReactNode } from "react";

import { asPresentedText, type CellColumn, presentedDate } from "./cell-text";

/** `value` as its column presents it, read against `now`. */
export function presentedCell(
  value: unknown,
  column: CellColumn | undefined,
  now: number = Date.now()
): ReactNode {
  const shown = asPresentedText(value, column, now);
  if (
    shown === undefined ||
    column?.type !== "date" ||
    typeof value !== "string"
  ) {
    return shown;
  }
  const date = presentedDate(value, now);
  if (date === undefined) return shown;
  return (
    <time dateTime={value} title={date.full}>
      {date.short}
    </time>
  );
}
