import { and, eq, ne } from "@nextlyhq/plugin-sdk/db";

type Column = Parameters<typeof eq>[0];
type Condition = ReturnType<typeof eq>;

/**
 * An account's rows in a table keyed by token hash (its sessions, its known
 * browsers), or all of them but the one `except` names: what signing out
 * everywhere, and a change that keeps the browser that made it, both end.
 */
export function accountRowsExcept(
  columns: { accountId: Column; tokenHash: Column },
  accountId: string,
  except: string | undefined
): Condition {
  if (except === undefined) return eq(columns.accountId, accountId);
  const condition = and(
    eq(columns.accountId, accountId),
    ne(columns.tokenHash, except)
  );
  // `and` of two conditions is never empty; the guard keeps a delete from
  // ever running without its account.
  if (condition === undefined)
    throw new TypeError("The filter lost its account.");

  return condition;
}
