/**
 * Whether a person or a role holds a permission, for deciding who may be assigned review work.
 *
 * Asked of the existing role and permission resolution, read-only, by the roles that hold a
 * permission (`rolesHolding`: the roles granted it directly and the super-admin role, and every
 * role inheriting one of those). A role holds it when it is one of them; a person when a role
 * assigned to them, in force now (`directRoleIdsOfUsers`), is one of them: the person's roles with
 * inheritance reach a holding role exactly when one of their own is a holding role or inherits one.
 * That is `decidePermission`'s answer for a person (super-admin authority, or a grant through their
 * roles), retired `manage-` permissions included, asked of many people in a few statements.
 *
 * The roles holding a permission are found the same way the other way round: the roles granted it
 * directly and the super-admin role, and every role inheriting one of those
 * (`listAncestorRoles`). The same walk answers who would hold it once a write about to be made
 * grants it directly to a given set of roles (`holderAnswerOnceGranted`), so a write that sets
 * grants and default reviewers together judges the reviewers by what it is about to store.
 *
 * These read on the pool, not on a transaction: a caller asks before it opens the transaction its
 * writes go in, so no statement runs beside that transaction on another connection.
 *
 * @module domains/workflows/holders
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  RETIRED_MANAGE_PLAIN_ACTIONS,
  isRetiredManage,
} from "../../auth/access/retired-manage-permissions";
import { container } from "../../di/container";
import { NextlyError } from "../../errors";
import { SUPER_ADMIN_SLUG } from "../../services/access/super-admin";
import {
  directRoleIdsOfUsers,
  resolveUserRoles,
} from "../../services/lib/permissions";
import type { Logger } from "../../services/shared";
import { consoleLogger } from "../../shared/types";
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

/** The person `userId`, or null when there is none: {@link readPersons} asked of one. */
export async function readPerson(
  adapter: DrizzleAdapter,
  userId: string
): Promise<PersonRow | null> {
  return (await readPersons(adapter, [userId])).get(userId) ?? null;
}

/** Ids per statement: SQLite's lowest per-statement parameter limit is 999. */
const ID_CHUNK = 500;

/** `ids`, each once, in statement-sized runs. */
function chunks(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)];
  const runs: string[][] = [];
  for (let at = 0; at < unique.length; at += ID_CHUNK) {
    runs.push(unique.slice(at, at + ID_CHUNK));
  }
  return runs;
}

/** The people among `userIds` that exist, by id, read a statement per 500. */
export async function readPersons(
  adapter: DrizzleAdapter,
  userIds: readonly string[]
): Promise<Map<string, PersonRow>> {
  const people = new Map<string, PersonRow>();
  for (const run of chunks(userIds)) {
    const rows = await adapter.select<{
      id: string;
      name: string | null;
      isActive: boolean | number | null;
    }>("users", {
      columns: ["id", "name", "isActive"],
      where: { and: [{ column: "id", op: "IN", value: run }] },
    });
    for (const row of rows) {
      // SQLite stores a boolean as 0 or 1.
      people.set(row.id, {
        id: row.id,
        name: row.name ?? null,
        active: Boolean(row.isActive),
      });
    }
  }
  return people;
}

/**
 * Whether the person or role `holder` holds `action` on `resource`. A person who does not exist,
 * or is deactivated, holds nothing, and says which; a role that does not exist says so.
 * {@link holderAnswers} asked of one.
 */
export async function holderAnswer(
  adapter: DrizzleAdapter,
  holder: ReviewAssignee,
  action: string,
  resource: string
): Promise<HolderAnswer> {
  const answers = await holderAnswers(adapter, [holder], action, resource);
  return answers.get(holderKey(holder)) ?? "not-found";
}

/** The key {@link holderAnswers} answers a person or role under. */
export function holderKey(holder: ReviewAssignee): string {
  return `${holder.kind}:${holder.id}`;
}

/**
 * Whether each of `holders` holds `action` on `resource`, by {@link holderKey}, asked of them all
 * at once: the roles holding it are walked once, and the people, their roles and the roles named
 * are each read a statement per 500, however many there are. A person who does not exist, or is
 * deactivated, holds nothing, and says which; a role that does not exist says so.
 */
export async function holderAnswers(
  adapter: DrizzleAdapter,
  holders: readonly ReviewAssignee[],
  action: string,
  resource: string
): Promise<Map<string, HolderAnswer>> {
  const users = holders
    .filter(each => each.kind === "user")
    .map(each => each.id);
  const roles = holders
    .filter(each => each.kind === "role")
    .map(each => each.id);
  const answers = new Map<string, HolderAnswer>();
  if (users.length > 0) {
    for (const [id, answer] of await peopleAnswers(
      adapter,
      users,
      action,
      resource
    )) {
      answers.set(holderKey({ kind: "user", id }), answer);
    }
  }
  if (roles.length > 0) {
    const holding = new Set(await rolesHolding(adapter, action, resource));
    const existing = await existingRoleIds(adapter, roles);
    for (const id of roles) {
      answers.set(
        holderKey({ kind: "role", id }),
        !existing.has(id) ? "not-found" : holding.has(id) ? "holds" : "lacks"
      );
    }
  }
  return answers;
}

/**
 * Each person's answer, by id. A retired `manage-` permission is held as the plain four it stood
 * for are, each as stored, as `decidePermission` answers a person.
 */
async function peopleAnswers(
  adapter: DrizzleAdapter,
  userIds: readonly string[],
  action: string,
  resource: string
): Promise<Map<string, HolderAnswer>> {
  if (isRetiredManage(action, resource)) {
    const each = [];
    for (const plain of RETIRED_MANAGE_PLAIN_ACTIONS) {
      each.push(await peopleAnswers(adapter, userIds, plain, resource));
    }
    return new Map(
      [...new Set(userIds)].map(id => [
        id,
        each
          .map(answers => answers.get(id) ?? "not-found")
          .find(answer => answer !== "holds") ?? "holds",
      ])
    );
  }
  const people = await readPersons(adapter, userIds);
  const active = [...people.values()].filter(person => person.active);
  const assigned = new Map<string, ReadonlySet<string>>();
  for (const run of chunks(active.map(person => person.id))) {
    for (const [id, roleIds] of await directRoleIdsOfUsers(run)) {
      assigned.set(id, roleIds);
    }
  }
  const holding = new Set(await rolesHolding(adapter, action, resource));
  const answers = new Map<string, HolderAnswer>();
  for (const id of new Set(userIds)) {
    const person = people.get(id);
    answers.set(
      id,
      !person
        ? "not-found"
        : !person.active
          ? "deactivated"
          : [...(assigned.get(id) ?? [])].some(roleId => holding.has(roleId))
            ? "holds"
            : "lacks"
    );
  }
  return answers;
}

/** The ids among `roleIds` that name a role, read a statement per 500. */
async function existingRoleIds(
  adapter: DrizzleAdapter,
  roleIds: readonly string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const run of chunks(roleIds)) {
    const rows = await adapter.select<{ id: unknown }>("roles", {
      columns: ["id"],
      where: { and: [{ column: "id", op: "IN", value: run }] },
    });
    for (const row of rows) found.add(String(row.id));
  }
  return found;
}

function logger(): Logger {
  return container.has("logger")
    ? container.get<Logger>("logger")
    : consoleLogger;
}

/**
 * The ids of the roles `slugs` name, as a caller's scope names its roles (a scope speaks in slugs,
 * the way role rules read it), in the spelling assignments store (ids). A slug naming no role is
 * left out.
 *
 * @experimental
 */
export async function roleIdsOfSlugs(
  adapter: DrizzleAdapter,
  slugs: readonly string[]
): Promise<string[]> {
  const roles = new RoleService(adapter, logger());
  const found = await Promise.all(
    slugs.map(slug => roles.findRoleIdBySlug(slug))
  );
  return found.flatMap(role => (role ? [role.id] : []));
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
  const wanted = await permissionFor(adapter, logger(), action, resource);
  const granted = wanted
    ? await adapter.select<{ roleId: unknown }>("role_permissions", {
        columns: ["roleId"],
        where: {
          and: [{ column: "permissionId", op: "=", value: wanted.id }],
        },
      })
    : [];
  return [
    ...(await rolesHoldingThrough(
      adapter,
      granted.map(row => String(row.roleId))
    )),
  ];
}

/**
 * The roles holding a permission granted directly to `granted`: those, the super-admin role, and
 * every role inheriting one of them.
 */
async function rolesHoldingThrough(
  adapter: DrizzleAdapter,
  granted: readonly string[]
): Promise<Set<string>> {
  const log = logger();
  const superAdmin = await new RoleService(adapter, log).findRoleIdBySlug(
    SUPER_ADMIN_SLUG
  );
  const holding = new Set([...granted, ...(superAdmin ? [superAdmin.id] : [])]);
  const inheritance = new RoleInheritanceService(adapter, log);
  for (const roleId of [...holding]) {
    for (const inheriting of await inheritance.listAncestorRoles(roleId)) {
      holding.add(inheriting);
    }
  }
  return holding;
}

/**
 * Whether the person or role `holder` would hold a permission once it is granted directly to
 * exactly the roles `granted`, as a write about to store those grants will leave it: by the roles
 * that would then hold it ({@link rolesHolding}'s walk), and a person by the roles they hold now,
 * inherited ones included. Answers as {@link holderAnswer} does for a person or role that does not
 * exist or is deactivated. Read on the pool, before the write's transaction opens.
 */
export async function holderAnswerOnceGranted(
  adapter: DrizzleAdapter,
  holder: ReviewAssignee,
  granted: readonly string[]
): Promise<HolderAnswer> {
  const holding = await rolesHoldingThrough(adapter, granted);
  if (holder.kind === "user") {
    const person = await readPerson(adapter, holder.id);
    if (!person) return "not-found";
    if (!person.active) return "deactivated";
    const { roleIds } = await resolveUserRoles(person.id);
    return [...roleIds].some(roleId => holding.has(roleId)) ? "holds" : "lacks";
  }
  const role = await existingRole(adapter, holder.id);
  if (role === null) return "not-found";
  return holding.has(role.id) ? "holds" : "lacks";
}

/** The role `roleId`, or null where no role has that id (absent, or not shaped like one). */
async function existingRole(
  adapter: DrizzleAdapter,
  roleId: string
): Promise<{ id: string } | null> {
  try {
    return await new RoleService(adapter, logger()).getRoleById(roleId);
  } catch (error) {
    if (NextlyError.isNotFound(error) || NextlyError.isValidation(error)) {
      return null;
    }
    throw error;
  }
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
