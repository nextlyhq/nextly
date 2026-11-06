/**
 * The entry list's declared row actions, ready for its table, and the one an
 * action opened, for the list to draw.
 *
 * @module components/features/entries/EntryList/useDeclaredRowActions
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

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

  const run = useCallback(
    async (action: DeclaredAction, row: Row) => {
      const rows = [{ collection, id: String(row.id) }];
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
      }
    },
    [collection, queryClient]
  );

  const rowActions = useMemo(
    () =>
      declaredRowActionsFor(contributions, collection).map(
        (action): RowAction<Row> => ({
          id: `declared:${action.id}`,
          label: action.label,
          isVisible: row => actionOfferedOn(action, row),
          onSelect: row => void run(action, row),
        })
      ),
    [contributions, collection, run]
  );

  return { rowActions, opened, close: () => setOpened(null) };
}
