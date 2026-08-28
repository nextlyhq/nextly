"use client";

/**
 * A list's column policy: which columns are pinned, which are offered to the
 * reader, and which are hidden right now.
 *
 * Every entity list in the admin carried the same three decisions, written by
 * hand: some columns are never offered to the toggle because a reader must not
 * be able to hide the one cell that says which row this is; the reader's choice
 * is stored per list; and a column is hidden exactly when the control says it
 * is not visible. Ten copies of a policy drift, and the drift is silent because
 * each copy still looks correct — so the policy lives here once.
 *
 * This composes the remembered-choice adapter rather than replacing it: the
 * persistence, the per-list storage and the "a column the control never
 * received is not a column it hides" boundary all stay in one place underneath.
 *
 * @module components/ui/table/list-view/useTableColumns
 */

import { useMemo } from "react";

import type { NextlyColumn } from "../data-table";

import type { ListColumnsControl } from "./types";
import { useListColumns } from "./useListColumns";

export interface UseTableColumnsOptions<Row extends object> {
  /**
   * Identifies the list whose choice is being stored; part of the storage key,
   * so it must be stable across renders and unique to the surface. Changing it
   * silently discards every reader's saved column choice.
   */
  storageKey: string;
  /** Every column of the list, pinned and toggleable alike, in render order. */
  columns: NextlyColumn<Row>[];
  /**
   * Column names the reader cannot hide. They are withheld from the toggle and
   * always reported visible, whatever a stored choice says.
   */
  alwaysVisible: ReadonlySet<string>;
}

export interface UseTableColumnsResult<Row extends object> {
  /** The input columns with `hidden` set from the reader's stored choice. */
  columns: NextlyColumn<Row>[];
  /** The control `ListView` takes, offering only the toggleable columns. */
  columnsControl: ListColumnsControl<Row>;
}

/**
 * Returns the columns to render and the control that manages them, from one
 * policy and one stored choice.
 */
export function useTableColumns<Row extends object>({
  storageKey,
  columns,
  alwaysVisible,
}: UseTableColumnsOptions<Row>): UseTableColumnsResult<Row> {
  /*
   * The pinned set is stabilised BY VALUE, not by identity: a surface that
   * rebuilds its set on each render must not lose the stable arrays below, the
   * same rule the adapter underneath applies to its own array arguments.
   * Sorting the key normalises it, because set iteration order follows
   * insertion order and two equal sets built differently would otherwise key
   * two different stable values.
   */
  const pinnedKey = [...alwaysVisible].sort().join("\u0000");
  const stablePins = useMemo(
    () => new Set(pinnedKey ? pinnedKey.split("\u0000") : []),
    [pinnedKey]
  );

  const toggleableColumns = useMemo(
    () => columns.filter(column => !stablePins.has(column.name)),
    [columns, stablePins]
  );

  /* The reader's column choice outlives the tab it was made in. */
  const columnsControl = useListColumns({
    storageKey,
    columns: toggleableColumns,
  });

  const columnsWithVisibility = useMemo(
    () =>
      columns.map(column => ({
        ...column,
        hidden: !columnsControl.isColumnVisible(column.name),
      })),
    [columns, columnsControl]
  );

  return useMemo(
    () => ({ columns: columnsWithVisibility, columnsControl }),
    [columnsWithVisibility, columnsControl]
  );
}
