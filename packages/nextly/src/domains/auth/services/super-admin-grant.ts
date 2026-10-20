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
 * whoever made it. Work with no request caller, which is trusted server code
 * such as the Direct API, a seed or the CLI, keeps being allowed. Plugin
 * callers are refused before they get here, by the user service.
 *
 * The caller is the one the transport resolved, pinned for the request by
 * {@link runAsRoleChangeCaller}. A request reaches the services carrying it
 * whether or not a route thought to pass it on, so a route that forgets
 * cannot be read as trusted.
 *
 * @module domains/auth/services/super-admin-grant
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { RBACDatabaseInstance } from "@nextly/types/rbac-operations";

import { NextlyError } from "../../../errors";
import { SUPER_ADMIN_SLUG } from "../../../services/access/super-admin";
import { isSuperAdminOrThrow } from "../../../services/lib/permissions";

import { listDescendantRoleIds } from "./role-descendants";

/**
 * Who is making a role change, as the transport resolved them. `visitor` is a
 * request that arrived with no credentials at all.
 */
export type RoleChangeCaller =
  | { kind: "person"; userId: string }
  | { kind: "key" }
  | { kind: "visitor" };

const roleChangeCaller = new AsyncLocalStorage<RoleChangeCaller>();

/**
 * Run `operation` with `caller` as the one every role change inside it is
 * judged for. The transport pins it once per request, around the dispatch.
 */
export function runAsRoleChangeCaller<T>(
  caller: RoleChangeCaller,
  operation: () => T
): T {
  return roleChangeCaller.run(caller, operation);
}

/**
 * Whether holding or inheriting any of `roleIds` confers super-admin: one of
 * them is the super-admin role, or inherits it however far down.
 *
 * Throws when a role or its inheritance can't be read, so a caller refuses a
 * change it could not judge rather than allowing it.
 */
export async function rolesConferSuperAdmin(
  db: RBACDatabaseInstance,
  roleIds: readonly string[]
): Promise<boolean> {
  if (roleIds.length === 0) return false;

  // The roles AND everything they reach. `listDescendantRoles` returns
  // descendants only, never the role it was asked about, so seeding the set
  // with the requested ids is what keeps the direct case beside the
  // inherited one.
  const reachable = new Set<string>(roleIds);
  for (const roleId of roleIds) {
    for (const descendant of await listDescendantRoleIds(db, roleId)) {
      reachable.add(descendant);
    }
  }

  const found = await db.query.roles.findMany({
    where: { id: { in: Array.from(reachable) }, slug: SUPER_ADMIN_SLUG },
    columns: { id: true },
  });
  return found.length > 0;
}

/**
 * Refuse a role change that would give someone super-admin authority, unless
 * a super-admin person makes it.
 *
 * `roleIds` are the roles the change would have someone hold or a role
 * inherit. Asked before the change writes anything, since it is the change's
 * precondition. A super-admin person is judged on their roles as stored,
 * inheritance included, never on what a request claims; a key is refused
 * whoever made it, as is a request with no credentials.
 *
 * @throws {NextlyError} `forbidden` when the change is refused. Any failure
 *   to read the roles it needs propagates, which refuses the change too.
 */
export async function refuseGrantingSuperAdmin(
  db: RBACDatabaseInstance,
  roleIds: readonly string[],
  logContext: Record<string, unknown>
): Promise<void> {
  if (!(await rolesConferSuperAdmin(db, roleIds))) return;

  const caller = roleChangeCaller.getStore();
  // No request caller: trusted server code, which decides for itself.
  if (caller === undefined) return;
  if (
    caller.kind === "person" &&
    (await isSuperAdminOrThrow(caller.userId, db))
  ) {
    return;
  }

  throw NextlyError.forbidden({
    logContext: {
      ...logContext,
      reason: "super-admin-grant-refused",
      caller: caller.kind,
    },
  });
}
