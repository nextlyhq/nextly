/**
 * The check a plugin route bound to a declared action asks of every request,
 * after the route's own gate and before its handler runs.
 *
 * A route is bound when one of its plugin's row or bulk actions runs it, and
 * a bound route is reachable only as one of those actions: the request names
 * the action and the rows it acts on, `{ action, rows: [{ collection, id }] }`,
 * and is refused unless the action's own permission holds for the caller and
 * its visibility rule holds on every row, read as the caller. Hiding an action
 * in the admin is not its access control; this is.
 *
 * One function answers every case, in the order that tells a caller nothing
 * they may not know: the request's shape (400), the action's permission (the
 * gate's own refusal), each row read as the caller (the read's own not-found,
 * 404, the same for a row that is missing as for one they may not read), and
 * the rule on each row as read (403 `ACTION_NOT_AVAILABLE`, generic). A bulk
 * request is refused whole when any row fails. The check only refuses: it
 * never lets through what the route's gate refused.
 *
 * @module plugins/routes/action-route-check
 * @experimental
 */
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import type { AdminContribution } from "../admin-contributions";
import { rowMatches, type RowPredicate } from "../row-predicate";
import type { PluginSelf } from "../self";

import { resolveRoutePermission } from "./route-permission";
import { MAX_ACTION_ROWS } from "./route-types";

// The row limit lives with the route types, which hold no runtime imports, so
// the admin can read it from `nextly/config` to hold an action back before a
// request this check would refuse. Re-exported here, where it is enforced.
export { MAX_ACTION_ROWS };

/**
 * @experimental The largest body the check reads of a request to an action's
 * route: 1 MiB, room for the most rows a request may name beside a plugin's
 * own payload. A larger body is answered 400, before the handler runs.
 */
export const MAX_ACTION_BODY_BYTES = 1024 * 1024;

/** @experimental An action a route is bound to, as the check reads it. */
export interface BoundAction {
  id: string;
  kind: "rowAction" | "bulkAction";
  /** The collections it is offered on, by served slug; every one when absent. */
  collections?: readonly string[];
  /** Its own permission, as declared: resolved through the plugin's names. */
  requiredPermission?: AdminContribution["requiredPermission"];
  visibleWhen?: RowPredicate;
}

/** @experimental What the check asks of the server, for one request. */
export interface ActionCheckDeps {
  /** The plugin's names after the host's renames, for a computed permission. */
  self: PluginSelf;
  /** The route gate's refusal for this permission, or none when it holds. */
  refusalFor: (permission: string) => Promise<NextlyError | undefined>;
  /**
   * The rows of `collection` with these ids that the caller may read, as they
   * read them, by id: one read for the collection, never one per row.
   */
  readRows: (
    collection: string,
    ids: readonly string[]
  ) => Promise<ReadonlyMap<string, unknown>>;
}

/** One row a request names. */
interface NamedRow {
  collection: string;
  id: string;
}

/** A 400 that names no detail: the request is malformed for this route. */
function malformed(reason: string, logContext: Record<string, unknown>) {
  return NextlyError.invalidInput({
    message: "The request could not be processed.",
    logContext: { reason, ...logContext },
  });
}

/** The generic refusal of an action the rule hides on a row. */
function notAvailable(logContext: Record<string, unknown>): NextlyError {
  return new NextlyError({
    code: "ACTION_NOT_AVAILABLE",
    publicMessage: "This action isn't available for this entry.",
    logMessage:
      "a declared action was asked of a row it is not offered on, or whose rule hides it",
    logContext,
  });
}

/**
 * The body a request to a bound route carries, parsed at the boundary. Other
 * keys pass through to the handler untouched; the check reads these two.
 */
const ACTION_REQUEST = z
  .object({
    action: z.string().min(1),
    rows: z
      .array(
        z.object({
          collection: z.string().min(1),
          id: z.union([z.string().min(1), z.number()]),
        })
      )
      .min(1)
      .max(MAX_ACTION_ROWS),
  })
  .passthrough();

/** The action a request names and its rows, or why it cannot be one. */
function actionRequest(
  body: unknown,
  bound: readonly BoundAction[]
): { action: BoundAction; rows: NamedRow[] } | NextlyError {
  const parsed = ACTION_REQUEST.safeParse(body);
  if (!parsed.success) {
    return malformed("action-request-malformed", {
      issues: parsed.error.issues.map(issue => issue.path.join(".")),
    });
  }
  const action = bound.find(a => a.id === parsed.data.action);
  if (action === undefined) {
    return malformed("action-not-bound", {
      action: parsed.data.action,
      bound: bound.map(a => a.id),
    });
  }
  if (action.kind === "rowAction" && parsed.data.rows.length !== 1) {
    return malformed("action-rows-not-one", { action: action.id });
  }
  return {
    action,
    rows: parsed.data.rows.map(row => ({
      collection: row.collection,
      id: String(row.id),
    })),
  };
}

/** The action's own permission refusal, or none; one that cannot be computed refuses. */
async function permissionRefusal(
  action: BoundAction,
  deps: ActionCheckDeps
): Promise<NextlyError | undefined> {
  if (action.requiredPermission === undefined) return undefined;
  let permission: string | undefined;
  try {
    permission = resolveRoutePermission(action.requiredPermission, deps.self);
  } catch {
    return NextlyError.forbidden({
      logContext: {
        reason: "action-permission-uncomputable",
        action: action.id,
      },
    });
  }
  return permission === undefined ? undefined : deps.refusalFor(permission);
}

/** Each named row as the caller reads it, one read per collection. */
async function readNamedRows(
  rows: readonly NamedRow[],
  deps: ActionCheckDeps
): Promise<Map<string, unknown>> {
  const byCollection = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = byCollection.get(row.collection) ?? new Set<string>();
    ids.add(row.id);
    byCollection.set(row.collection, ids);
  }
  const read = new Map<string, unknown>();
  for (const [collection, ids] of byCollection) {
    const found = await deps.readRows(collection, [...ids]);
    for (const [id, row] of found) read.set(`${collection}\u0000${id}`, row);
  }
  return read;
}

/**
 * @experimental Why this request to a route bound to `bound` is refused, or
 * `undefined` when it may run. A route bound to no action is not asked
 * anything here.
 */
export async function actionRouteRefusal(
  body: unknown,
  bound: readonly BoundAction[],
  deps: ActionCheckDeps
): Promise<NextlyError | undefined> {
  if (bound.length === 0) return undefined;
  const request = actionRequest(body, bound);
  if (request instanceof NextlyError) return request;
  const { action, rows } = request;

  // The permission first: a caller it refuses learns nothing of the rows.
  const refused = await permissionRefusal(action, deps);
  if (refused) return refused;

  // A collection the action is not offered on is refused before any row is
  // read: what it is offered on is configuration, and says nothing of rows.
  const offered = action.collections;
  const outside = rows.find(
    row => offered !== undefined && !offered.includes(row.collection)
  );
  if (outside) {
    return notAvailable({ action: action.id, collection: outside.collection });
  }
  const read = await readNamedRows(rows, deps);
  for (const row of rows) {
    const found = read.get(`${row.collection}\u0000${row.id}`);
    // Missing and unreadable answer alike, so the refusal says nothing of
    // which rows exist.
    if (found === undefined) {
      return NextlyError.notFound({
        logContext: {
          reason: "action-row-not-readable",
          action: action.id,
          collection: row.collection,
        },
      });
    }
    if (
      action.visibleWhen !== undefined &&
      !rowMatches(action.visibleWhen, found)
    ) {
      return notAvailable({ action: action.id, collection: row.collection });
    }
  }
  return undefined;
}
