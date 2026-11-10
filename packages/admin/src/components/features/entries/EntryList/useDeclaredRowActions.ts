/**
 * The entry list's declared row actions, ready for its table, and the one an
 * action opened, for the list to draw.
 *
 * @module components/features/entries/EntryList/useDeclaredRowActions
 */
import { useCallback, useMemo } from "react";

import type { RowAction } from "@admin/components/ui/table/data-table";
import { useBranding } from "@admin/context/providers/BrandingProvider";

import {
  actionOfferedOn,
  declaredRowActionsFor,
  type DeclaredAction,
} from "./declared-actions";
import {
  useDeclaredActionRunner,
  type OpenedAction,
} from "./useDeclaredActionRunner";

export type { OpenedAction } from "./useDeclaredActionRunner";

/** Whether a listed row carries an id an action can name it by. */
function hasId(row: { id?: unknown }): boolean {
  return (
    (typeof row.id === "string" && row.id !== "") || typeof row.id === "number"
  );
}

/** The key of one action's run on one row. */
function pendingKey(action: DeclaredAction, row: { id?: unknown }): string {
  return `${action.id}\u0000${String(row.id)}`;
}

/**
 * The row actions plugins declared for `collection`'s list, each offered on a
 * row only where its rule holds for the row as listed, and the action they
 * opened, if any. Running one that calls a route says whether it ran, and
 * reads the list again, since it may have changed the rows.
 */
export function useDeclaredRowActions<Row extends { id?: unknown }>(
  collection: string
): {
  rowActions: RowAction<Row>[];
  opened: OpenedAction | null;
  close: () => void;
} {
  const { contributions } = useBranding();
  // Each run is keyed by its action and row, so the same action on another
  // row is not held back.
  const {
    run: runOn,
    pending,
    opened,
    close,
  } = useDeclaredActionRunner(collection);
  const run = useCallback(
    (action: DeclaredAction, row: Row) =>
      runOn(
        action,
        [{ collection, id: String(row.id) }],
        pendingKey(action, row)
      ),
    [collection, runOn]
  );

  const rowActions = useMemo(
    () =>
      declaredRowActionsFor(contributions, collection).map(
        (action): RowAction<Row> => ({
          id: `declared:${action.id}`,
          label: action.label,
          // A row the list returned without an id has nothing to name it by.
          isVisible: row => hasId(row) && actionOfferedOn(action, row),
          isDisabled: row => pending.has(pendingKey(action, row)),
          onSelect: row => void run(action, row),
        })
      ),
    [contributions, collection, run, pending]
  );

  return { rowActions, opened, close };
}
