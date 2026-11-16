/**
 * Whether a person or a role holds a permission, for deciding who may be assigned review work.
 *
 * Asked of the existing role and permission resolution, read-only: a person through their actor
 * (`actorForUser`: their roles in force, inherited roles included) and the one decision
 * (`decidePermission`); a role through the role services the admin uses: the role, the roles it
 * inherits (`listDescendantRoles`), the permissions it holds directly or through them
 * (`getAllPermissionsForRole`), and the super-admin role found by its slug. Nothing here walks
 * roles or reads grants itself, so a holder is what the rest of Nextly says it is.
 *
 * The roles holding a permission are found the same way the other way round: the roles granted it
 * directly and the super-admin role, and every role inheriting one of those
 * (`listAncestorRoles`).
 *
 * These read on the pool, not on a transaction: a caller asks before it opens the transaction its
 * writes go in, so no statement runs beside that transaction on another connection.
 *
 * @module domains/workflows/holders
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { decidePermission } from "../../auth/access/decide";
import { actorForUser } from "../../auth/access/resolve-actor";
import { container } from "../../di/container";
import { NextlyError } from "../../errors";
import { SUPER_ADMIN_SLUG } from "../../services/access/super-admin";
import type { Logger } from "../../services/shared";
import { consoleLogger } from "../../shared/types";
import { PermissionCheckerService } from "../auth/services/permission-checker-service";
import { PermissionService } from "../auth/services/permission-service";
import { RoleInheritanceService } from "../auth/services/role-inheritance-service";
import { RoleService } from "../auth/services/role-service";

import type { ReviewAssignee } from "./review-state-repository";

/** What holding a permission came to for one person or role. */
export type HolderAnswer = "holds" | "lacks" | "not-found" | "deactivated";

/** A person as the users table keeps them: what the answer and an event's name need. */
export interface PersonRow {
  id: string;
  name: string | null;
  active: boolean;
}

/** The person `userId`, or null when there is none. */
export async function readPerson(
  adapter: DrizzleAdapter,
  userId: string
): Promise<PersonRow | null> {
  const [row] = await adapter.select<{
    id: string;
    name: string | null;
    isActive: boolean | number | null;
  }>("users", {
    columns: ["id", "name", "isActive"],
    where: { and: [{ column: "id", op: "=", value: userId }] },
    limit: 1,
  });
  if (!row) return null;
  // SQLite stores a boolean as 0 or 1.
  return { id: row.id, name: row.name ?? null, active: Boolean(row.isActive) };
}

/**
 * Whether the person or role `holder` holds `action` on `resource`. A person who does not exist,
 * or is deactivated, holds nothing, and says which; a role that does not exist says so.
 */
export async function holderAnswer(
  adapter: DrizzleAdapter,
  holder: ReviewAssignee,
  action: string,
  resource: string
): Promise<HolderAnswer> {
  if (holder.kind === "user") {
    const person = await readPerson(adapter, holder.id);
    if (!person) return "not-found";
    if (!person.active) return "deactivated";
    const actor = await actorForUser(person.id);
    return decidePermission(actor, action, resource).allowed
      ? "holds"
      : "lacks";
  }
  return roleAnswer(adapter, holder.id, action, resource);
}

function logger(): Logger {
  return container.has("logger")
    ? container.get<Logger>("logger")
    : consoleLogger;
}

/** The stored permission for `action` on `resource`, or undefined when there is none. */
async function permissionFor(
  adapter: DrizzleAdapter,
  log: Logger,
  action: string,
  resource: string
): Promise<{ id: string } | undefined> {
  const listed = await new PermissionService(adapter, log).listPermissions({
    action,
    resource,
    includeOrphaned: true,
    limit: 10,
  });
  return listed.data.find(
    permission =>
      permission.action === action && permission.resource === resource
  );
}

/**
 * The ids of every role holding `action` on `resource`, as {@link holderAnswer} would answer each:
 * the roles granted it directly and the super-admin role, and every role inheriting one of them.
 */
export async function rolesHolding(
  adapter: DrizzleAdapter,
  action: string,
  resource: string
): Promise<string[]> {
  const log = logger();
  const wanted = await permissionFor(adapter, log, action, resource);
  const granted = wanted
    ? await adapter.select<{ roleId: unknown }>("role_permissions", {
        columns: ["roleId"],
        where: {
          and: [{ column: "permissionId", op: "=", value: wanted.id }],
        },
      })
    : [];
  const superAdmin = await new RoleService(adapter, log).findRoleIdBySlug(
    SUPER_ADMIN_SLUG
  );
  const holding = new Set([
    ...granted.map(row => String(row.roleId)),
    ...(superAdmin ? [superAdmin.id] : []),
  ]);
  const inheritance = new RoleInheritanceService(adapter, log);
  for (const roleId of [...holding]) {
    for (const inheriting of await inheritance.listAncestorRoles(roleId)) {
      holding.add(inheriting);
    }
  }
  return [...holding];
}

/** The names of these people and these roles, by id, each read in one statement. */
export async function namesOf(
  adapter: DrizzleAdapter,
  ids: { users: readonly string[]; roles: readonly string[] }
): Promise<{
  users: Map<string, string | null>;
  roles: Map<string, string | null>;
}> {
  const read = async (table: "users" | "roles", wanted: readonly string[]) =>
    wanted.length === 0
      ? []
      : adapter.select<{ id: unknown; name: unknown }>(table, {
          columns: ["id", "name"],
          where: { and: [{ column: "id", op: "IN", value: [...wanted] }] },
        });
  const users = await read("users", [...new Set(ids.users)]);
  const roles = await read("roles", [...new Set(ids.roles)]);
  // A name is text where the row holds one, and null otherwise.
  const nameOf = (value: unknown): string | null =>
    typeof value === "string" ? value : null;
  return {
    users: new Map(users.map(row => [String(row.id), nameOf(row.name)])),
    roles: new Map(roles.map(row => [String(row.id), nameOf(row.name)])),
  };
}

async function roleAnswer(
  adapter: DrizzleAdapter,
  roleId: string,
  action: string,
  resource: string
): Promise<HolderAnswer> {
  const log = logger();
  const roles = new RoleService(adapter, log);
  let role: { id: string };
  try {
    role = await roles.getRoleById(roleId);
  } catch (error) {
    // An id that is not a role's (absent, or not shaped like one) names no role.
    if (NextlyError.isNotFound(error) || NextlyError.isValidation(error)) {
      return "not-found";
    }
    throw error;
  }
  // A role holds what every role it inherits holds, super-admin authority included.
  const inherited = await new RoleInheritanceService(
    adapter,
    log
  ).listDescendantRoles(role.id);
  const superAdmin = await roles.findRoleIdBySlug(SUPER_ADMIN_SLUG);
  if (superAdmin && [role.id, ...inherited].includes(superAdmin.id)) {
    return "holds";
  }
  const wanted = await permissionFor(adapter, log, action, resource);
  if (!wanted) return "lacks";
  const held = await new PermissionCheckerService(
    adapter,
    log
  ).getAllPermissionsForRole(role.id);
  return held.includes(wanted.id) ? "holds" : "lacks";
}
