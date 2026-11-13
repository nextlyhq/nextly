/**
 * Read the roles a session is issued with, from the account's assignments.
 *
 * Shared by every sign-in that mints a token: the auth router's handlers and
 * the Direct API's `login`. Each must carry the same roles and end at the same
 * moment, so they read them one way rather than two that agree until one of
 * them is edited.
 *
 * @module auth/session/read-session-roles
 */

import { getDialectTables } from "../../database/index";
import {
  soonestExpiry,
  userRoleAssignmentsInForce,
} from "../../services/lib/role-assignments";

import type { SessionRoles } from "./session-roles";

/** The adapter surface the read needs. */
export interface SessionRolesAdapter {
  getDrizzle(): unknown;
}

/**
 * The account's roles in force now, and the soonest moment one of them lapses.
 *
 * Only the assignments in force: an expired role granted nothing, and put into
 * the claims it would be handed back to every reader of them until the token
 * expired. The condition is the one every reader of `user_roles` that decides
 * access shares.
 *
 * Errors propagate, so a failed read refuses the sign-in. Answered with no
 * roles, it would issue a session whose claims said the person held nothing,
 * with nothing to say a read had failed.
 */
export async function readSessionRoles(
  adapter: SessionRolesAdapter,
  userId: string
): Promise<SessionRoles> {
  const db = adapter.getDrizzle() as {
    select(columns: Record<string, unknown>): {
      from(table: unknown): { where(condition: unknown): Promise<unknown> };
    };
  };
  const schema = getDialectTables();
  const rows = (await db
    .select({
      roleId: schema.userRoles.roleId,
      expiresAt: schema.userRoles.expiresAt,
    })
    .from(schema.userRoles)
    .where(
      userRoleAssignmentsInForce(schema.userRoles, userId, new Date())
    )) as Array<{ roleId: string; expiresAt: Date | null }>;
  return {
    roleIds: rows.map(r => r.roleId),
    validUntil: soonestExpiry(rows),
  };
}
