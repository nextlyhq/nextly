import type { PluginContext, PluginTransaction } from "@nextlyhq/plugin-sdk";
import { and, asc, eq, inArray, isNull, lte } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type InferInsert,
  type InferRow,
} from "@nextlyhq/plugin-sdk/schema";

import { accounts } from "../schema/tables";

/** An account as its row holds it. */
export type AccountRow = InferRow<typeof accounts>;

/**
 * Either handle the plugin writes through: `ctx.db`, or the `tx` that
 * `ctx.db.transaction` passes its work. Every function here takes one, so a
 * flow runs them inside its own transaction or outside any.
 */
export type AccountsDb = PluginTransaction;

/** The fields a guarded write may set: never the id, the address's key or the version. */
export type AccountChange = Omit<
  Partial<InferInsert<typeof accounts>>,
  "id" | "addressNormalised" | "securityVersion" | "createdAt"
>;

/**
 * An address as the plugin finds and keys it: trimmed and lower-cased, as
 * core compares staff addresses.
 */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Creates an unverified account, or answers `taken` when the address already
 * has one. The database decides, by the unique normalised address, so of two
 * sign-ups that race for one address exactly one is created. On PostgreSQL a
 * refusal inside a transaction aborts it, so a caller in one ends it there.
 */
export async function createAccount(
  db: AccountsDb,
  dialect: PluginContext["dialect"],
  input: {
    address: string;
    name: string;
    passwordHash: string | null;
    /** When it was made, on the flows' clock; the database's when absent. */
    createdAt?: Date;
  }
): Promise<{ status: "created"; account: AccountRow } | { status: "taken" }> {
  try {
    const account = await db.insertReturning(accounts, {
      address: input.address.trim(),
      addressNormalised: normaliseAddress(input.address),
      name: input.name,
      passwordHash: input.passwordHash,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    });
    return { status: "created", account };
  } catch (error) {
    if (isUniqueViolation(dialect, error)) return { status: "taken" };
    throw error;
  }
}

export async function accountById(
  db: AccountsDb,
  id: string
): Promise<AccountRow | null> {
  const columns = db.table(accounts);

  return db.select(accounts).where(eq(columns.id, id)).first();
}

/** The account an address belongs to, however the visitor cased or spaced it. */
export async function accountByAddress(
  db: AccountsDb,
  address: string
): Promise<AccountRow | null> {
  const columns = db.table(accounts);

  return db
    .select(accounts)
    .where(eq(columns.addressNormalised, normaliseAddress(address)))
    .first();
}

/**
 * Writes `change` only while the account's security version is still
 * `version`, the one the flow read when it began, and moves the version on
 * when the change ends the account's sessions (`endsSessions`). False when
 * nothing was written: a change that ends sessions committed since the flow
 * read the version, and the flow's effect must not land. Run it in the
 * transaction that writes the rest of the effect, so the check and the
 * effect commit together.
 */
export async function writeAtVersion(
  db: AccountsDb,
  account: Pick<AccountRow, "id" | "securityVersion">,
  change: AccountChange,
  options: { endsSessions?: boolean } = {}
): Promise<boolean> {
  const columns = db.table(accounts);
  const atVersion = and(
    eq(columns.id, account.id),
    eq(columns.securityVersion, account.securityVersion)
  );
  // `and` of two conditions is never empty; the guard keeps an update from
  // ever running without its version check.
  if (atVersion === undefined) {
    throw new TypeError("The guarded write lost its version check.");
  }
  const written = await db
    .update(accounts, {
      ...change,
      ...(options.endsSessions === true
        ? { securityVersion: account.securityVersion + 1 }
        : {}),
    })
    .where(atVersion);

  return written === 1;
}

/** Deletes an account; its sessions, known browsers and pending change go with it. Answers whether it was there. */
export async function deleteAccount(
  db: AccountsDb,
  id: string
): Promise<boolean> {
  const columns = db.table(accounts);

  return (await db.delete(accounts).where(eq(columns.id, id))) === 1;
}

/**
 * Deletes, oldest first and at most `limit` at a time, accounts nobody
 * verified that were made at or before `madeBy`; an account verified since
 * it was read is never deleted. Answers the ids it deleted.
 */
export async function deleteStaleUnverified(
  db: AccountsDb,
  madeBy: Date,
  limit: number
): Promise<string[]> {
  const columns = db.table(accounts);
  const stale = and(isNull(columns.verifiedAt), lte(columns.createdAt, madeBy));
  if (stale === undefined) throw new TypeError("The sweep lost its filter.");
  const found = await db
    .select(accounts)
    .where(stale)
    .orderBy(asc(columns.createdAt), asc(columns.id))
    .limit(limit)
    .all();
  if (found.length === 0) return [];

  const ids = found.map(account => account.id);
  const still = and(stale, inArray(columns.id, ids));
  if (still === undefined) throw new TypeError("The sweep lost its filter.");
  await db.delete(accounts).where(still);
  const kept = await db.select(accounts).where(inArray(columns.id, ids)).all();
  const keptIds = new Set(kept.map(account => account.id));

  return ids.filter(id => !keptIds.has(id));
}
