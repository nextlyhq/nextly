/**
 * The entry list's declared row actions, ready for its table, and the one an
 * action opened, for the list to draw.
 *
 * @module components/features/entries/EntryList/useDeclaredRowActions
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { toast } from "@admin/components/ui";
import type { RowAction } from "@admin/components/ui/table/data-table";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { entryKeys } from "@admin/services/entryApi";

import {
  actionOfferedOn,
  declaredRowActionsFor,
  runDeclaredAction,
  type ActionRow,
  type DeclaredAction,
} from "./declared-actions";

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

/** An action that opened a component: what to draw, titled, with its rows. */
export interface OpenedAction {
  label: string;
  component: string;
  rows: ActionRow[];
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
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState<OpenedAction | null>(null);
  // The action and row each request in flight is for, so choosing it again
  // before it answers sends nothing: a plugin's handler need not be safe to
  // run twice. Held in a ref for the guard, mirrored in state for the menu.
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const settle = useCallback((key: string, running: boolean) => {
    if (running) inFlight.current.add(key);
    else inFlight.current.delete(key);
    setPending(new Set(inFlight.current));
  }, []);

  const run = useCallback(
    async (action: DeclaredAction, row: Row) => {
      const key = pendingKey(action, row);
      if (inFlight.current.has(key)) return;
      const rows = [{ collection, id: String(row.id) }];
      settle(key, true);
      try {
        const outcome = await runDeclaredAction(action, rows);
        if ("open" in outcome) {
          setOpened({ label: action.label, component: outcome.open, rows });
          return;
        }
        toast.success(`${action.label}: done.`);
        await queryClient.invalidateQueries({
          queryKey: entryKeys.listsByCollection(collection),
        });
      } catch (error) {
        toast.error(apiErrorMessage(error, `${action.label} couldn't run.`));
      } finally {
        settle(key, false);
      }
    },
    [collection, queryClient, settle]
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

  return { rowActions, opened, close: () => setOpened(null) };
}
