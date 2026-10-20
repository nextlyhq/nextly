/**
 * The write that sets an account's password, and ends its sessions with it.
 *
 * An administrator setting a password (`updateUser`, and the raw-hash
 * `PATCH /users/:id/password`) and a user setting their own (a change
 * through the auth service or the users service, a reset through its link,
 * an accepted invite, and the forced first-sign-in change) all write through
 * here, so no path can set a password and leave the account's refresh tokens
 * renewing the sessions the new password was meant to end. A user's own
 * password is also conditional on the account not being deactivated, in the
 * same statement.
 *
 * @module domains/users/services/password-write
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";

import { forgetSessionStanding } from "../../../auth/session/session-standing";
import type { getDialectTables } from "../../../database/index";
import { affectedRowCount } from "../../../shared/lib/affected-row-count";
import type { UserUpdateData } from "../../../types/database-operations";

/** The slice of a Drizzle transaction the write uses. */
export interface PasswordWriteTx {
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

type Tables = Pick<
  ReturnType<typeof getDialectTables>,
  "users" | "refreshTokens"
>;

/**
 * The columns every password write sets, whoever chose the password.
 *
 * A new password satisfies any admin-set must-change requirement, so the
 * account is not sent through the first-sign-in change again.
 *
 * Takes a hash its caller computed. Every path that sets a password hashes
 * first, with core's hasher or an app's configured `passwordHasher`, so this
 * write imposes no format of its own; the one write whose hash comes from
 * outside, `updatePasswordHash`, checks it before calling this.
 */
export function passwordColumns(
  passwordHash: string
): Required<
  Pick<
    UserUpdateData,
    "passwordHash" | "passwordUpdatedAt" | "mustChangePassword" | "updatedAt"
  >
> {
  const now = new Date();
  return {
    passwordHash,
    passwordUpdatedAt: now,
    mustChangePassword: false,
    updatedAt: now,
  };
}

/**
 * The columns that remove an account's password with nothing in its place,
 * as the clean-up of passwords stored as typed does. Its own type because
 * `UserUpdateData` only ever carries a hash, so only a write that means to
 * clear the password can put `null` there.
 */
export interface PasswordRemoval {
  passwordHash: null;
  passwordUpdatedAt: Date;
  updatedAt: Date;
}

/**
 * Update the user row and delete every refresh token the account holds, both
 * inside the transaction `tx` belongs to.
 *
 * The same update raises the account's session epoch, which ends the access
 * tokens it already holds as well: every one carries the epoch it was signed
 * at, and every place a session is read refuses one signed before this write
 * (`auth/session/session-standing`). Deleting the refresh rows alone stops a
 * session from renewing, and leaves each access token working until it
 * expires, which for the Direct API's is thirty days.
 *
 * Returns the number of user rows the update changed. With `unlessDeactivated`
 * the update is conditional on the account not being deactivated, and `when`
 * adds a condition of the caller's own to the same statement; a conditional
 * update that changes no row deletes nothing and raises nothing, so the caller
 * refuses on a zero.
 *
 * Also the write a deactivation goes through: it ends the account's sessions
 * for the same reason a new password does.
 */
export async function updateUserEndingSessions(
  tx: PasswordWriteTx,
  tables: Tables,
  dialect: SupportedDialect,
  args: {
    userId: string | number;
    set: UserUpdateData | PasswordRemoval;
    unlessDeactivated?: boolean;
    when?: SQL;
  }
): Promise<number> {
  const { users, refreshTokens } = tables;
  const conditions = [
    eq(users.id, String(args.userId)),
    ...(args.unlessDeactivated ? [isNull(users.deactivatedAt)] : []),
    ...(args.when ? [args.when] : []),
  ];
  const updated = await tx
    .update(users)
    .set({
      ...args.set,
      // Raised by the database in the same statement, so two writes ending
      // the same account's sessions at once raise it twice rather than one
      // of them being lost. Null on a row from before the column existed,
      // which is epoch zero.
      sessionEpoch: sql`coalesce(${users.sessionEpoch}, 0) + 1`,
    })
    .where(and(...conditions));
  const changed = affectedRowCount(updated, dialect);
  if (conditions.length > 1 && changed === 0) return 0;
  await tx
    .delete(refreshTokens)
    .where(eq(refreshTokens.userId, String(args.userId)));
  // This process stops answering from what it holds for the account now
  // rather than when its cache entry would lapse. The write may not have
  // committed yet, so a read in between still sees the old row; the cache
  // answers that read but keeps nothing for the account until this flow's
  // transaction has finished, so the first request after the commit reads
  // the new row.
  forgetSessionStanding(args.userId);
  return changed;
}
