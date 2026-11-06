/**
 * The entry list's declared bulk actions, ready for its bulk bar, and the one
 * an action opened, for the list to draw.
 *
 * An action is offered on a selection when its rule holds for every selected
 * row as listed, judged as a row action's is. That is a courtesy, not the
 * access control: the action's route checks its permission and its rule on
 * every row before its handler runs, and refuses the whole request when one
 * row fails. A selected row not on this page cannot be judged here, so an
 * action carrying a rule is not offered while one is selected.
 *
 * @module components/features/entries/EntryList/useDeclaredBulkActions
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { toast } from "@admin/components/ui";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { entryKeys } from "@admin/services/entryApi";

import {
  actionOfferedOn,
  declaredBulkActionsFor,
  runDeclaredAction,
  type DeclaredAction,
} from "./declared-actions";
import type { OpenedAction } from "./useDeclaredRowActions";

/** A declared bulk action as the bulk bar offers it, on the selected ids. */
export interface DeclaredBulkAction {
  id: string;
  label: string;
  /** Whether it is held back for this selection. */
  isDisabled: (selectedIds: readonly string[]) => boolean;
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
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState<OpenedAction | null>(null);
  // The actions with a request in flight, so choosing one again before it
  // answers sends nothing: a plugin's handler need not be safe to run twice.
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const settle = useCallback((id: string, running: boolean) => {
    if (running) inFlight.current.add(id);
    else inFlight.current.delete(id);
    setPending(new Set(inFlight.current));
  }, []);

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
    async (action: DeclaredAction, ids: readonly string[]) => {
      if (inFlight.current.has(action.id)) return;
      const actionRows = ids.map(id => ({ collection, id }));
      settle(action.id, true);
      try {
        const outcome = await runDeclaredAction(action, actionRows);
        if ("open" in outcome) {
          setOpened({
            label: action.label,
            component: outcome.open,
            rows: actionRows,
          });
          return;
        }
        toast.success(`${action.label}: done.`);
        await queryClient.invalidateQueries({
          queryKey: entryKeys.listsByCollection(collection),
        });
      } catch (error) {
        toast.error(apiErrorMessage(error, `${action.label} couldn't run.`));
      } finally {
        settle(action.id, false);
      }
    },
    [collection, queryClient, settle]
  );

  const bulkActions = useMemo(
    () =>
      declaredBulkActionsFor(contributions, collection).map(
        (action): DeclaredBulkAction => ({
          id: `declared:${action.id}`,
          label: action.label,
          isDisabled: ids => pending.has(action.id) || !offeredOn(action, ids),
          onSelect: ids => void run(action, ids),
        })
      ),
    [contributions, collection, run, pending, offeredOn]
  );

  return { bulkActions, opened, close: () => setOpened(null) };
}
