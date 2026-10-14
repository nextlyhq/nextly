import type { PluginContext, PluginTransaction } from "@nextlyhq/plugin-sdk";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "@nextlyhq/plugin-sdk/db";
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
 * A state a guarded write applies only in: an address still unverified, or
 * an account still deactivated. Neither moves the security version when it
 * changes, so a write that must apply once asks for the state itself.
 */
export type AccountState = "unverified" | "deactivated";

/**
 * Writes `change` only while the account's security version is still
 * `version`, the one the flow read when it began, and, with `only`, while
 * the account is still in that state; and moves the version on when the
 * change ends the account's sessions (`endsSessions`). False when nothing
 * was written: a change committed since the flow read the account, and the
 * flow's effect must not land. Run it in the transaction that writes the
 * rest of the effect, so the check and the effect commit together.
 */
export async function writeAtVersion(
  db: AccountsDb,
  account: Pick<AccountRow, "id" | "securityVersion">,
  change: AccountChange,
  options: { endsSessions?: boolean; only?: AccountState } = {}
): Promise<boolean> {
  return updateAtVersion(
    db,
    account,
    change,
    options.endsSessions === true,
    options.only === undefined ? undefined : inState(db, options.only)
  );
}

/** The condition a row in `state` meets. */
function inState(db: AccountsDb, state: AccountState) {
  const columns = db.table(accounts);

  return state === "unverified"
    ? isNull(columns.verifiedAt)
    : isNotNull(columns.deactivatedAt);
}

/**
 * Moves the account to a new address, only at the version its flow read,
 * moving the version on, since a change of address ends the account's other
 * sessions. `taken` when the address has come to belong to another account,
 * which the unique normalised address decides even against a race; on
 * PostgreSQL that refusal aborts the transaction, so the caller ends it.
 */
export async function changeAddressAtVersion(
  db: AccountsDb,
  dialect: PluginContext["dialect"],
  account: Pick<AccountRow, "id" | "securityVersion">,
  address: string
): Promise<"changed" | "moved" | "taken"> {
  try {
    const written = await updateAtVersion(
      db,
      account,
      { address: address.trim(), addressNormalised: normaliseAddress(address) },
      true
    );
    return written ? "changed" : "moved";
  } catch (error) {
    if (isUniqueViolation(dialect, error)) return "taken";
    throw error;
  }
}

/**
 * Holds the account at the version its flow read, for a transaction whose
 * writes are elsewhere: the row is written with the values it has, which
 * locks it until the transaction ends. A change that moves the version
 * either committed first, and this answers false, or waits for this
 * transaction and then sees what it wrote. MySQL's driver counts the rows
 * an update matched, not only those it changed, so an unchanged row counts.
 */
export async function holdAtVersion(
  db: AccountsDb,
  account: Pick<AccountRow, "id" | "securityVersion">
): Promise<boolean> {
  return updateAtVersion(
    db,
    account,
    { securityVersion: account.securityVersion },
    false
  );
}

/**
 * Holds the account as `holdAtVersion` does, and only while its address is
 * still unverified: a verification moves no version, so a write that
 * applies only to an unverified address asks for it too. False when the
 * version moved or the address has been verified since it was read.
 */
export async function holdWhileUnverified(
  db: AccountsDb,
  account: Pick<AccountRow, "id" | "securityVersion">
): Promise<boolean> {
  return updateAtVersion(
    db,
    account,
    { securityVersion: account.securityVersion },
    false,
    inState(db, "unverified")
  );
}

/** The one guarded update every guarded write goes through. */
async function updateAtVersion(
  db: AccountsDb,
  account: Pick<AccountRow, "id" | "securityVersion">,
  set: Partial<InferInsert<typeof accounts>>,
  endsSessions: boolean,
  /** A further condition the row must meet, for a write that applies only to some states. */
  also?: Parameters<typeof and>[number]
): Promise<boolean> {
  const columns = db.table(accounts);
  const atVersion = and(
    eq(columns.id, account.id),
    eq(columns.securityVersion, account.securityVersion),
    also
  );
  // `and` of two conditions is never empty; the guard keeps an update from
  // ever running without its version check.
  if (atVersion === undefined) {
    throw new TypeError("The guarded write lost its version check.");
  }
  const written = await db
    .update(accounts, {
      ...set,
      ...(endsSessions ? { securityVersion: account.securityVersion + 1 } : {}),
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
 * Deletes an account only while its address is still unverified, the
 * condition in the delete itself, so a verification that committed after
 * the account was read keeps it. Its sessions, known browsers and pending
 * change go with it. Answers whether it was deleted.
 */
export async function deleteUnverifiedAccount(
  db: AccountsDb,
  id: string
): Promise<boolean> {
  const columns = db.table(accounts);
  const unverified = and(eq(columns.id, id), isNull(columns.verifiedAt));
  if (unverified === undefined)
    throw new TypeError("The deletion lost its condition.");

  return (await db.delete(accounts).where(unverified)) === 1;
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

/** How many times a counter re-reads a count another request moved first, before giving up. */
const COUNT_RETRIES = 50;

/**
 * Counts a failed password check toward the account's failures in a row, by
 * compare-and-set so no two failures at once are counted as one, and marks
 * the account as needing a reset when the count reaches `threshold`. The
 * check was made against the password at `account.securityVersion`, so it
 * counts only while the account is still at that version: a failure against
 * a password a reset or a change has since replaced says nothing about the
 * new one, and is dropped. Answers the count, or null for an account no
 * longer there or no longer at that version.
 */
export async function recordFailedPassword(
  db: AccountsDb,
  account: Pick<AccountRow, "id" | "securityVersion">,
  now: Date,
  threshold: number
): Promise<{ failuresInARow: number; resetRequired: boolean } | null> {
  const columns = db.table(accounts);
  const { id } = account;
  for (let attempt = 0; attempt < COUNT_RETRIES; attempt += 1) {
    const current = await db.select(accounts).where(eq(columns.id, id)).first();
    if (current === null || current.securityVersion !== account.securityVersion)
      return null;
    const next = current.failuresInARow + 1;
    const unchanged = and(
      eq(columns.id, id),
      eq(columns.securityVersion, account.securityVersion),
      eq(columns.failuresInARow, current.failuresInARow)
    );
    if (unchanged === undefined)
      throw new TypeError("The count lost its compare.");
    const reachesReset = next >= threshold && current.resetRequiredAt === null;
    const written = await db
      .update(
        accounts,
        reachesReset
          ? { failuresInARow: next, resetRequiredAt: now }
          : { failuresInARow: next }
      )
      .where(unchanged);
    if (written === 1)
      return {
        failuresInARow: next,
        resetRequired: next >= threshold || current.resetRequiredAt !== null,
      };
  }
  throw new Error(
    "The failure count kept moving: too many failed checks at once for one account."
  );
}

/**
 * Claims the day's reset-required email for the account: true for exactly
 * one caller a day, however many failures reach the threshold at once, by
 * one conditional write; false when one went within the last day.
 */
export async function claimResetRequiredEmail(
  db: AccountsDb,
  id: string,
  now: Date
): Promise<boolean> {
  const columns = db.table(accounts);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const due = or(
    isNull(columns.resetRequiredEmailedAt),
    lte(columns.resetRequiredEmailedAt, dayAgo)
  );
  const claim = due === undefined ? undefined : and(eq(columns.id, id), due);
  if (claim === undefined) throw new TypeError("The claim lost its condition.");

  return (
    (await db
      .update(accounts, { resetRequiredEmailedAt: now })
      .where(claim)) === 1
  );
}
