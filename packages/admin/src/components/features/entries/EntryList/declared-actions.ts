/**
 * Plugins' declared actions on the entry list: which a list offers, on which
 * rows, and what running one does.
 *
 * The workspace metadata already holds only the actions this reader may run,
 * each named for the collections it is offered on. A row is offered one when
 * the action's rule holds for the row as listed, by the same `rowMatches` the
 * server judges the request with. That is a courtesy, not the access control:
 * the action's route checks its permission and its rule on every row it is
 * asked about, read as the caller, before its handler runs.
 *
 * @module components/features/entries/EntryList/declared-actions
 */
import {
  rowMatches,
  type AdminContributionsMeta,
  type DeliveredAdminContribution,
} from "nextly/config";

import { writePluginRoute } from "@admin/hooks/queries/usePluginRouteMutation";

/** A declared row or bulk action, as the workspace metadata delivers it. */
export type DeclaredAction = Extract<
  DeliveredAdminContribution,
  { kind: "rowAction" | "bulkAction" }
>;

/** A row an action is asked about: its collection and its id. */
export interface ActionRow {
  collection: string;
  id: string;
}

/** What running an action did: called its route, or asked for its component. */
export type ActionOutcome = { ran: true } | { open: string };

/** Whether a delivered entry is a declared action, not a built-in part. */
function isDeclaredAction(entry: unknown): entry is DeclaredAction {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "kind" in entry &&
    (entry.kind === "rowAction" || entry.kind === "bulkAction")
  );
}

/** The row actions this collection's list offers, in their declared order. */
export function declaredRowActionsFor(
  contributions: AdminContributionsMeta | undefined,
  collection: string
): DeclaredAction[] {
  return (contributions?.["collection.list"]?.rowAction ?? []).filter(
    (entry): entry is DeclaredAction =>
      isDeclaredAction(entry) &&
      (entry.collections === undefined ||
        entry.collections.includes(collection))
  );
}

/** Whether an action is offered on a row as listed: its rule holds there. */
export function actionOfferedOn(action: DeclaredAction, row: unknown): boolean {
  return (
    action.visibleWhen === undefined || rowMatches(action.visibleWhen, row)
  );
}

/**
 * Run an action on `rows`. One that runs a route is called with the action
 * and the rows, which the route checks before its handler runs; the request
 * carries the CSRF token as every admin write does. One that opens a
 * component answers which component to draw with the rows.
 */
export async function runDeclaredAction(
  action: DeclaredAction,
  rows: readonly ActionRow[]
): Promise<ActionOutcome> {
  if ("open" in action.action) return { open: action.action.open };
  const { method, path, mount } = action.action.run;
  await writePluginRoute({
    plugin: action.plugin,
    path,
    method,
    ...(mount ? { mount } : {}),
    body: { action: action.id, rows },
  });
  return { ran: true };
}
