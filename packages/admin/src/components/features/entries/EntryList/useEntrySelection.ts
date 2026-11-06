import { useCallback, useMemo, useState } from "react";

import type { DataTableSelection } from "@admin/components/ui/table/data-table";
import { versionOf } from "@admin/lib/document-version";

/** One entry as the list's table holds it. */
export type EntryRow = Record<string, unknown>;

/** Each selected entry's version as the list read it, by id. */
export type EntryVersions = Readonly<Record<string, string>>;

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
  /**
   * Each selected row's version as it was when selected, for a bulk action
   * to be judged by what the list showed. A row read without one has none.
   */
  versions: EntryVersions;
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
  // Taken as each row is selected, and dropped with it: a later read of the
  // list does not move it, so a document changed since is refused rather
  // than judged by a version the editor never saw.
  const [versionsById, setVersionsById] = useState<Record<string, string>>({});
  const remember = (rows: readonly EntryRow[]) =>
    setVersionsById(prev => {
      const next = { ...prev };
      for (const row of rows) {
        const version = versionOf(row);
        if (version === undefined) delete next[rowId(row)];
        else next[rowId(row)] = version;
      }
      return next;
    });
  const forget = (ids: readonly string[]) =>
    setVersionsById(prev => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });

  const toggling = useMemo<DataTableSelection<EntryRow>>(
    () => ({
      selectedIds,
      onToggle: row => {
        const id = rowId(row);
        if (selectedIds.includes(id)) forget([id]);
        else remember([row]);
        setSelectedIds(prev =>
          prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
      },
      onToggleAll: (rows, allSelected) => {
        const ids = rows.map(rowId);
        if (allSelected) forget(ids);
        else remember(rows.filter(row => !selectedIds.includes(rowId(row))));
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
      if (!selectable) return;
      setSelectedIds(rows.map(rowId));
      setVersionsById({});
      remember(rows);
    },
    [selectable]
  );
  const clear = useCallback(() => {
    setSelectedIds([]);
    setVersionsById({});
  }, []);
  const versions = useMemo(
    () =>
      Object.fromEntries(
        selected.flatMap(id =>
          versionsById[id] === undefined ? [] : [[id, versionsById[id]]]
        )
      ),
    [selected, versionsById]
  );

  return {
    selection: selectable ? toggling : undefined,
    selected,
    versions,
    selectAll,
    clear,
  };
}
