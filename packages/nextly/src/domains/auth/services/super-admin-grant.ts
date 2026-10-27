/**
 * Who may give anyone super-admin authority, asked by every role change.
 *
 * Super-admin authority is held through the super-admin role or through any
 * role that inherits it, so every change that can create it is one act:
 * assigning such a role, giving a user one among their roles, and making a
 * role inherit one, by adding inheritance or through `childRoleIds`. Each of
 * them asks {@link refuseGrantingSuperAdmin} before it writes, in the service
 * that owns the write, so a route added later meets the rule without having
 * to remember it.
 *
 * Only a super-admin person may make such a change, never an API key,
 * whoever made it, as `refuseUnlessSuperAdminCaller` judges the request's
 * caller. Work with no request caller, which is trusted server code such as
 * the Direct API, a seed or the CLI, keeps being allowed. Plugin callers are
 * refused before they get here, by the user service.
 *
 * @module domains/auth/services/super-admin-grant
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray } from "drizzle-orm";

import { getDialectTables } from "../../../database";
import { SUPER_ADMIN_SLUG } from "../../../services/access/super-admin";
import {
  lockSuperAdminRole,
  type LastSuperAdminTx,
} from "../../users/services/last-super-admin";

import { refuseUnlessSuperAdminCaller } from "./role-change-caller";
import { walkDescendantRoleIds } from "./role-descendants";

/**
 * Whether holding or inheriting any of `roleIds` confers super-admin: one of
 * them is the super-admin role, or inherits it however far down.
 *
 * Read through `db`, which may be the transaction of the write being decided.
 * Throws when a role or its inheritance can't be read, and answers yes when
 * the walk of a role's inheritance was cut short at its limit, so a caller
 * refuses a change it could not judge rather than allowing it.
 */
export async function rolesConferSuperAdmin(
  db: LastSuperAdminTx,
  dialect: SupportedDialect,
  roleIds: readonly string[]
): Promise<boolean> {
  if (roleIds.length === 0) return false;

  // The roles AND everything they reach. The walk returns descendants only,
  // never the role it was asked about, so seeding the set with the requested
  // ids is what keeps the direct case beside the inherited one.
  const reachable = new Set<string>(roleIds);
  for (const roleId of roleIds) {
    const { ids, complete } = await walkDescendantRoleIds(db, dialect, roleId);
    // A walk cut short can't say super-admin is out of reach.
    if (!complete) return true;
    for (const descendant of ids) reachable.add(descendant);
  }

  // The tables of the database `db` reads, named by its dialect rather than
  // the environment's setting, which a custom adapter need not match.
  const { roles } = getDialectTables(dialect);
  const found = await db
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(
        inArray(roles.id, Array.from(reachable)),
        eq(roles.slug, SUPER_ADMIN_SLUG)
      )
    )
    .limit(1);
  return found.length > 0;
}

/**
 * Refuse a role change that would give someone super-admin authority, unless
 * a super-admin person makes it.
 *
 * `roleIds` are the roles the change would have someone hold or a role
 * inherit. Asked inside the change's own transaction, `tx`, before it writes
 * anything, since it is the change's precondition. A super-admin person is
 * judged on their roles as stored, inheritance included, never on what a
 * request claims; a key is refused whoever made it, as is a request with no
 * credentials.
 *
 * The `super-admin` role's row is locked first, the lock every change to who
 * is a super-admin takes (`lockSuperAdminRole`). So the decision and the write
 * are one step: a change that would make one of these roles inherit
 * super-admin waits for this one to commit, or this one for it, and is then
 * judged on what that one wrote.
 *
 * @throws {NextlyError} `forbidden` when the change is refused. Any failure
 *   to read the roles it needs propagates, which refuses the change too.
 */
export async function refuseGrantingSuperAdmin(
  tx: LastSuperAdminTx,
  dialect: SupportedDialect,
  roleIds: readonly string[],
  logContext: Record<string, unknown>
): Promise<void> {
  if (roleIds.length === 0) return;
  await lockSuperAdminRole(tx, getDialectTables(dialect), dialect);
  if (!(await rolesConferSuperAdmin(tx, dialect, roleIds))) return;

  await refuseUnlessSuperAdminCaller(tx, {
    ...logContext,
    reason: "super-admin-grant-refused",
  });
}
