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
import { and, eq, isNull, type SQL } from "drizzle-orm";

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
 * Update the user row and delete every refresh token the account holds, both
 * inside the transaction `tx` belongs to.
 *
 * Returns the number of user rows the update changed. With `unlessDeactivated`
 * the update is conditional on the account not being deactivated, and `when`
 * adds a condition of the caller's own to the same statement; a conditional
 * update that changes no row deletes nothing, so the caller refuses on a zero.
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
    set: UserUpdateData;
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
    .set(args.set)
    .where(and(...conditions));
  const changed = affectedRowCount(updated, dialect);
  if (conditions.length > 1 && changed === 0) return 0;
  await tx
    .delete(refreshTokens)
    .where(eq(refreshTokens.userId, String(args.userId)));
  return changed;
}
