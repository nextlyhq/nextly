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
 * action that calls its route on more rows than one request to it may name,
 * which the route would refuse whole: the bar says why. One that opens a
 * component takes any number, as nothing is sent.
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

/**
 * Whether `ids` are more rows than one request to `action`'s route may name.
 * Only an action that calls its route sends them: one that opens a component
 * hands them to it in the page, and takes any number.
 */
function overRouteLimit(
  action: DeclaredAction,
  ids: readonly string[]
): boolean {
  return "run" in action.action && ids.length > MAX_ACTION_ROWS;
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
        (action): DeclaredBulkAction => {
          const overLimit = (ids: readonly string[]) =>
            overRouteLimit(action, ids);
          return {
            id: `declared:${action.id}`,
            label: action.label,
            isDisabled: ids =>
              pending.has(action.id) ||
              overLimit(ids) ||
              !offeredOn(action, ids),
            heldBackNote: ids =>
              overLimit(ids)
                ? `${action.label} runs on at most ${MAX_ACTION_ROWS} entries at a time.`
                : undefined,
            onSelect: ids => void run(action, ids),
          };
        }
      ),
    [contributions, collection, run, pending, offeredOn]
  );

  return { bulkActions, opened, close };
}
