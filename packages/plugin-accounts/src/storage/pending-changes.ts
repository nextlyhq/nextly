import { and, eq, gt, lte } from "@nextlyhq/plugin-sdk/db";
import type { InferRow } from "@nextlyhq/plugin-sdk/schema";

import { pendingAddressChanges } from "../schema/tables";

import { normaliseAddress, type AccountsDb } from "./accounts";

/** An address change waiting for its confirmation. */
export type PendingChangeRow = InferRow<typeof pendingAddressChanges>;

/** Cancels the account's pending address change, if it has one. Answers whether it had. */
export async function cancelPendingAddressChange(
  db: AccountsDb,
  accountId: string
): Promise<boolean> {
  const columns = db.table(pendingAddressChanges);

  return (
    (await db
      .delete(pendingAddressChanges)
      .where(eq(columns.accountId, accountId))) > 0
  );
}

/** Asks for an address change, replacing any the account already had pending. */
export async function askAddressChange(
  db: AccountsDb,
  input: { accountId: string; newAddress: string; expiresAt: Date }
): Promise<PendingChangeRow> {
  await cancelPendingAddressChange(db, input.accountId);

  return db.insertReturning(pendingAddressChanges, {
    accountId: input.accountId,
    newAddress: input.newAddress.trim(),
    newAddressNormalised: normaliseAddress(input.newAddress),
    expiresAt: input.expiresAt,
  });
}

/** The account's pending change, if it has one. */
export async function pendingChangeOf(
  db: AccountsDb,
  accountId: string
): Promise<PendingChangeRow | null> {
  const columns = db.table(pendingAddressChanges);

  return db
    .select(pendingAddressChanges)
    .where(eq(columns.accountId, accountId))
    .first();
}

/** The change by its id, while it is still pending. */
export async function pendingChangeById(
  db: AccountsDb,
  id: string
): Promise<PendingChangeRow | null> {
  const columns = db.table(pendingAddressChanges);

  return db.select(pendingAddressChanges).where(eq(columns.id, id)).first();
}

/**
 * Takes a pending change for its confirmation or its cancellation, by
 * deleting it, before `now` reaches its expiry: true for exactly one of a
 * confirmation and a cancellation that race, and never for a change past
 * its time.
 */
export async function takePendingChange(
  db: AccountsDb,
  id: string,
  now: Date
): Promise<boolean> {
  const columns = db.table(pendingAddressChanges);
  const live = and(eq(columns.id, id), gt(columns.expiresAt, now));
  if (live === undefined) throw new TypeError("The take lost its condition.");

  return (await db.delete(pendingAddressChanges).where(live)) === 1;
}

/** Removes every pending change past its expiry. Answers how many. */
export async function sweepPendingChanges(
  db: AccountsDb,
  now: Date
): Promise<number> {
  const columns = db.table(pendingAddressChanges);

  return db.delete(pendingAddressChanges).where(lte(columns.expiresAt, now));
}
