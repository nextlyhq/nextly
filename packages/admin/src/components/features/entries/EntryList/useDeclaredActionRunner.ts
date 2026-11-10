/**
 * Running a plugin's declared action on the entry list, shared by its row and
 * bulk actions: the one guard against running an action again before it
 * answers, the one answer to what running it did, and the component one
 * opened, for the list to draw.
 *
 * Running again before the last run answers sends nothing: a plugin's handler
 * need not be safe to run twice. An action that calls its route says it ran
 * and reads the list again, since it may have changed the rows; one that
 * opens a component is held here for the list's dialog; a refusal is said in
 * the route's own words.
 *
 * @module components/features/entries/EntryList/useDeclaredActionRunner
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { toast } from "@admin/components/ui";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { entryKeys } from "@admin/services/entryApi";

import {
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

export function useDeclaredActionRunner(collection: string): {
  /** Run `action` on `rows`; `key` names the run the guard holds back. */
  run: (
    action: DeclaredAction,
    rows: ActionRow[],
    key: string
  ) => Promise<void>;
  /** The keys of the runs that have not answered yet. */
  pending: ReadonlySet<string>;
  opened: OpenedAction | null;
  close: () => void;
} {
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState<OpenedAction | null>(null);
  // Held in a ref for the guard, mirrored in state for what the list offers.
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const settle = useCallback((key: string, running: boolean) => {
    if (running) inFlight.current.add(key);
    else inFlight.current.delete(key);
    setPending(new Set(inFlight.current));
  }, []);

  const run = useCallback(
    async (action: DeclaredAction, rows: ActionRow[], key: string) => {
      if (inFlight.current.has(key)) return;
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

  return { run, pending, opened, close: () => setOpened(null) };
}
