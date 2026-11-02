import { useCallback, useMemo, useState } from "react";

import type { DataTableSelection } from "@admin/components/ui/table/data-table";

/** One entry as the list's table holds it. */
export type EntryRow = Record<string, unknown>;

/** The id the table keys an entry's row by. */
export const rowId = (row: EntryRow): string => String(row.id);

/** The entry list's row selection, and what it may be used for. */
export interface EntrySelection {
  /**
   * The checkbox column's state, or `undefined` where no bulk action is
   * offered, which leaves the table without a checkbox column.
   */
  selection: DataTableSelection<EntryRow> | undefined;
  /** The ids selected, empty where rows are not selectable. */
  selected: string[];
  /** Select every one of `rows`, where rows are selectable. */
  selectAll: (rows: readonly EntryRow[]) => void;
  clear: () => void;
}

/**
 * The entry list's row selection, offered only where `selectable`: some bulk
 * action is allowed on the rows. A selection kept from before the answer
 * changed counts as none, so no bar or shortcut acts on rows the caller may
 * no longer act on.
 */
export function useEntrySelection(selectable: boolean): EntrySelection {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggling = useMemo<DataTableSelection<EntryRow>>(
    () => ({
      selectedIds,
      onToggle: row => {
        const id = rowId(row);
        setSelectedIds(prev =>
          prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
      },
      onToggleAll: (rows, allSelected) => {
        const ids = rows.map(rowId);
        setSelectedIds(prev =>
          allSelected
            ? prev.filter(id => !ids.includes(id))
            : Array.from(new Set([...prev, ...ids]))
        );
      },
    }),
    [selectedIds]
  );

  const selected = useMemo(
    () => (selectable ? selectedIds : []),
    [selectable, selectedIds]
  );
  const selectAll = useCallback(
    (rows: readonly EntryRow[]) => {
      if (selectable) setSelectedIds(rows.map(rowId));
    },
    [selectable]
  );
  const clear = useCallback(() => setSelectedIds([]), []);

  return {
    selection: selectable ? toggling : undefined,
    selected,
    selectAll,
    clear,
  };
}
