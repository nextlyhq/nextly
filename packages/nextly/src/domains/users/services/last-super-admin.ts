/**
 * The guard that keeps an install administrable: no write may leave it
 * without an active super-admin.
 *
 * Deleting the last active super-admin, deactivating them, or taking the role
 * from them leaves nobody who can sign in to the admin and grant it again, and
 * the way back is editing the database by hand. So each of those writes asks
 * this guard first, inside its own transaction, and is refused while the
 * account it removes is the only active super-admin. Removing the last one
 * takes two steps instead: make another user super-admin, then remove them.
 *
 * Asked where every path meets — the services that delete, deactivate and
 * unassign — rather than per route, so REST, the admin, the Direct API and a
 * plugin are all held to it. And asked under a lock, so two requests that
 * each remove one of the last two super-admins cannot both see the other
 * still there: a check that reads and then decides lets both through.
 *
 * @module domains/users/services/last-super-admin
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, ne, type Column, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../errors";
import { roleAssignmentInForce } from "../../../services/lib/role-assignments";

const SUPER_ADMIN_ROLE_SLUG = "super-admin";

/** What the refusal tells the caller, on every path. */
export const LAST_SUPER_ADMIN_MESSAGE =
  "This user is the last active super-admin. Make another user super-admin first.";

/** How the write would stop the account being an active super-admin. */
export type SuperAdminRemoval =
  /** The account is deleted. */
  | { kind: "delete" }
  /** The account is deactivated. */
  | { kind: "deactivate" }
  /** The account's roles are replaced by exactly `roleIds`. */
  | { kind: "replaceRoles"; roleIds: readonly string[] }
  /** One role, `roleId`, is taken from the account. */
  | { kind: "unassignRole"; roleId: string };

type Rows = Array<Record<string, unknown>>;

/** A read that can be awaited as it is, or taken with a row lock. */
interface LockableRead extends PromiseLike<Rows> {
  // On the PostgreSQL and MySQL builders only; never called on SQLite.
  for(strength: string): Promise<Rows>;
}

interface FilteredRead extends LockableRead {
  limit(count: number): LockableRead;
}

/**
 * The slice of a Drizzle transaction the guard reads through. The real type
 * is dialect-specific; the fluent surface used here is the same on all three.
 */
export interface LastSuperAdminTx {
  select(fields: unknown): {
    from(table: unknown): {
      where(condition: unknown): FilteredRead;
      innerJoin(
        table: unknown,
        on: unknown
      ): { where(condition: unknown): FilteredRead };
    };
  };
}

/** The columns the guard reads, on any dialect. */
export interface LastSuperAdminTables {
  users: { id: Column; isActive: Column };
  roles: { id: Column; slug: Column };
  userRoles: { userId: Column; roleId: Column; expiresAt: Column };
}

/**
 * Refuse, inside `tx`'s transaction, a removal that would leave the install
 * without an active super-admin.
 *
 * Call it before the write it guards, and before the write takes any row lock
 * of its own, so every removal takes the locks in the same order.
 *
 * The `super-admin` role's row is the lock every removal takes first: on
 * PostgreSQL `FOR NO KEY UPDATE`, which two removals cannot hold at once but
 * which leaves a concurrent grant's foreign-key check free to proceed; on
 * MySQL `FOR UPDATE`. SQLite takes none, because its write transactions open
 * with `BEGIN IMMEDIATE` and so run one at a time already. The second of two
 * racing removals waits there until the first commits, and only then counts.
 * The counts are locking reads, which read the latest committed rows: under
 * MySQL's repeatable read a plain read would answer from a snapshot that
 * could predate the first removal's commit.
 *
 * What is kept is an active account holding the `super-admin` role itself, in
 * force. Not a role built on it: that role's inheritance can be edited away
 * and the role deleted, neither of which is a write to an account, so nothing
 * here would be asked. The `super-admin` role is a system role, which can be
 * neither edited nor deleted, so an account holding it directly stays a
 * super-admin until a write to that account says otherwise, and every such
 * write asks this guard. Only an active account counts, since a deactivated
 * one cannot sign in to administer anything. An account that is not one, or
 * stays one after the write, is never refused. A failed read refuses, by
 * throwing.
 *
 * @throws NextlyError(CONFLICT) when the account is the last active
 *   super-admin and the write would remove it.
 */
export async function refuseRemovingLastSuperAdmin(
  tx: LastSuperAdminTx,
  tables: LastSuperAdminTables,
  dialect: SupportedDialect,
  userId: string | number,
  removal: SuperAdminRemoval
): Promise<void> {
  const { roles, users, userRoles } = tables;
  const target = String(userId);

  const roleRow = tx
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.slug, SUPER_ADMIN_ROLE_SLUG))
    .limit(1);
  const [superAdmin] =
    dialect === "sqlite"
      ? await roleRow
      : await roleRow.for(
          dialect === "postgresql" ? "no key update" : "update"
        );
  // No role, no super-admin to protect.
  if (!superAdmin) return;
  const superAdminRoleId = String(superAdmin.id);

  // The active accounts holding, in force, the `super-admin` role itself.
  const now = new Date();
  const holders = (who: SQL) =>
    tx
      .select({ userId: userRoles.userId, roleId: userRoles.roleId })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          who,
          eq(userRoles.roleId, superAdminRoleId),
          roleAssignmentInForce(userRoles, now),
          eq(users.isActive, true)
        )
      );
  const latest = (read: LockableRead): PromiseLike<Rows> =>
    dialect === "sqlite" ? read : read.for("share");

  const held = await latest(holders(eq(userRoles.userId, target)));
  if (held.length === 0) return;
  if (keepsTheRole(removal, superAdminRoleId)) return;

  const others = await latest(holders(ne(userRoles.userId, target)).limit(1));
  if (others.length > 0) return;

  throw NextlyError.conflict({
    reason: "state",
    message: LAST_SUPER_ADMIN_MESSAGE,
    logContext: {
      refusal: "last-active-super-admin",
      removal: removal.kind,
      userId: target,
    },
  });
}

/**
 * Whether the account still holds the `super-admin` role once the write lands.
 */
function keepsTheRole(
  removal: SuperAdminRemoval,
  superAdminRoleId: string
): boolean {
  switch (removal.kind) {
    case "delete":
    case "deactivate":
      return false;
    case "replaceRoles":
      // The replacement assigns exactly these, without an expiry.
      return removal.roleIds.some(id => String(id) === superAdminRoleId);
    case "unassignRole":
      return removal.roleId !== superAdminRoleId;
  }
}
