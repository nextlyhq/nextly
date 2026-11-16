/**
 * A record's id in a list's ID column: its first eight characters in the
 * table's monospace, the whole id on hover. One cell for every list that
 * shows an id, so they cut and show it alike.
 *
 * @module components/ui/table/data-table/short-id-cell
 */
import type { JSX } from "react";

/** The characters of an id the cell shows before it cuts. */
const SHOWN = 8;

/** The id cell for a column's value: the id cut short, or nothing for none. */
export function ShortIdCell({ value }: { value: unknown }): JSX.Element {
  const id = typeof value === "string" ? value : "";
  return (
    <span className="font-mono text-xs text-muted-foreground" title={id}>
      {id.length > SHOWN ? `${id.slice(0, SHOWN)}...` : id}
    </span>
  );
}
