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
  const listed = await new PermissionService(adapter, log).listPermissions({
    action,
    resource,
    includeOrphaned: true,
    limit: 10,
  });
  const wanted = listed.data.find(
    permission =>
      permission.action === action && permission.resource === resource
  );
  if (!wanted) return "lacks";
  const held = await new PermissionCheckerService(
    adapter,
    log
  ).getAllPermissionsForRole(role.id);
  return held.includes(wanted.id) ? "holds" : "lacks";
}
