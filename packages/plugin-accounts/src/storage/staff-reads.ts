import {
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  like,
  or,
} from "@nextlyhq/plugin-sdk/db";

import type { AccountState } from "../admin-contract";
import { accounts, sessions } from "../schema/tables";

import { normaliseAddress, type AccountRow, type AccountsDb } from "./accounts";

/** One page of the list, as staff ask for it. */
export interface AccountsPageQuery {
  /** Part of an address or a name; empty or absent lists every account. */
  search?: string;
  state?: AccountState;
  /** From 1. */
  page: number;
  perPage: number;
}

type Condition = ReturnType<typeof eq>;

/**
 * One page of accounts, newest first, matching the search and the state,
 * and whether another page follows. An address matches whatever its case;
 * a name matches as the database compares text, which on PostgreSQL is
 * case-sensitive. `%` and `_` in the search match as `LIKE` reads them, so
 * a search can only match more accounts than it names, never fewer.
 */
export async function accountsPage(
  db: AccountsDb,
  query: AccountsPageQuery
): Promise<{ rows: AccountRow[]; hasNext: boolean }> {
  const columns = db.table(accounts);
  const conditions: Condition[] = [];
  const search = query.search?.trim() ?? "";
  if (search !== "") {
    const matches = or(
      like(columns.addressNormalised, `%${normaliseAddress(search)}%`),
      like(columns.name, `%${search}%`)
    );
    if (matches === undefined)
      throw new TypeError("The search lost its condition.");
    conditions.push(matches);
  }
  if (query.state !== undefined)
    conditions.push(stateCondition(columns, query.state));

  const filter = and(...conditions);
  const select = db.select(accounts);
  const filtered = filter === undefined ? select : select.where(filter);
  const found = await filtered
    .orderBy(desc(columns.createdAt), desc(columns.id))
    .limit(query.perPage + 1)
    .offset((query.page - 1) * query.perPage)
    .all();

  return {
    rows: found.slice(0, query.perPage),
    hasNext: found.length > query.perPage,
  };
}

/** How many of an account's sessions are live at `now`. */
export async function liveSessionCount(
  db: AccountsDb,
  accountId: string,
  now: Date
): Promise<number> {
  const columns = db.table(sessions);
  const live = and(
    eq(columns.accountId, accountId),
    gt(columns.idleExpiresAt, now),
    gt(columns.absoluteExpiresAt, now)
  );
  if (live === undefined)
    throw new TypeError("The count lost its account filter.");

  return (await db.select(sessions).where(live).all()).length;
}

type Column = Parameters<typeof isNull>[0];

/** The condition an account in `state` meets. */
function stateCondition(
  columns: {
    verifiedAt: Column;
    deactivatedAt: Column;
    resetRequiredAt: Column;
  },
  state: AccountState
): Condition {
  switch (state) {
    case "verified":
      return isNotNull(columns.verifiedAt);
    case "unverified":
      return isNull(columns.verifiedAt);
    case "active":
      return isNull(columns.deactivatedAt);
    case "deactivated":
      return isNotNull(columns.deactivatedAt);
    case "reset-required":
      return isNotNull(columns.resetRequiredAt);
  }
}
