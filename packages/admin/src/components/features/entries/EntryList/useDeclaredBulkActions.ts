/**
 * The entry list's declared bulk actions, ready for its bulk bar, and the one
 * an action opened, for the list to draw.
 *
 * An action is offered on a selection when its rule holds for every selected
 * row as listed, judged as a row action's is. That is a courtesy, not the
 * access control: the action's route checks its permission and its rule on
 * every row before its handler runs, and refuses the whole request when one
 * row fails. A selected row not on this page cannot be judged here, so an
 * action carrying a rule is not offered while one is selected. Nor is any
 * action on more rows than one request to its route may name, which the
 * route would refuse whole: the bar says why.
 *
 * @module components/features/entries/EntryList/useDeclaredBulkActions
 */
import { MAX_ACTION_ROWS } from "nextly/config";
import { useCallback, useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";

import {
  actionOfferedOn,
  declaredBulkActionsFor,
  type DeclaredAction,
} from "./declared-actions";
import {
  useDeclaredActionRunner,
  type OpenedAction,
} from "./useDeclaredActionRunner";

/** A declared bulk action as the bulk bar offers it, on the selected ids. */
export interface DeclaredBulkAction {
  id: string;
  label: string;
  /** Whether it is held back for this selection. */
  isDisabled: (selectedIds: readonly string[]) => boolean;
  /** Why it is held back, where the bar should say so. */
  heldBackNote: (selectedIds: readonly string[]) => string | undefined;
  onSelect: (selectedIds: readonly string[]) => void;
}

export function useDeclaredBulkActions<Row extends { id?: unknown }>(
  collection: string,
  /** The rows the list shows, which each selected id is judged by. */
  rows: readonly Row[]
): {
  bulkActions: DeclaredBulkAction[];
  opened: OpenedAction | null;
  close: () => void;
} {
  const { contributions } = useBranding();
  // Each run is keyed by its action alone: the bar offers it once, on the
  // whole selection.
  const {
    run: runOn,
    pending,
    opened,
    close,
  } = useDeclaredActionRunner(collection);

  const byId = useMemo(
    () => new Map(rows.map(row => [String(row.id), row])),
    [rows]
  );

  const offeredOn = useCallback(
    (action: DeclaredAction, ids: readonly string[]) =>
      ids.length > 0 &&
      ids.every(id => {
        const row = byId.get(id);
        return row === undefined
          ? action.visibleWhen === undefined
          : actionOfferedOn(action, row);
      }),
    [byId]
  );

  const run = useCallback(
    (action: DeclaredAction, ids: readonly string[]) =>
      runOn(
        action,
        ids.map(id => ({ collection, id })),
        action.id
      ),
    [collection, runOn]
  );

  const bulkActions = useMemo(
    () =>
      declaredBulkActionsFor(contributions, collection).map(
        (action): DeclaredBulkAction => ({
          id: `declared:${action.id}`,
          label: action.label,
          isDisabled: ids =>
            pending.has(action.id) ||
            ids.length > MAX_ACTION_ROWS ||
            !offeredOn(action, ids),
          heldBackNote: ids =>
            ids.length > MAX_ACTION_ROWS
              ? `${action.label} runs on at most ${MAX_ACTION_ROWS} entries at a time.`
              : undefined,
          onSelect: ids => void run(action, ids),
        })
      ),
    [contributions, collection, run, pending, offeredOn]
  );

  return { bulkActions, opened, close };
}
