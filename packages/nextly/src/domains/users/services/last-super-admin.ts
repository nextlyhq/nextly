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
import { randomUUID } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  type Column,
  type SQL,
} from "drizzle-orm";

import { NextlyError } from "../../../errors";
import { roleAssignmentInForce } from "../../../services/lib/role-assignments";
import { refuseUnlessSuperAdminCaller } from "../../auth/services/role-change-caller";

const SUPER_ADMIN_ROLE_SLUG = "super-admin";

/** What the refusal tells the caller of a change to an account. */
export const LAST_SUPER_ADMIN_MESSAGE =
  "This user is the last active super-admin. Make another user super-admin first.";

/** What the refusal tells the caller of a change to a role. */
export const LAST_SUPER_ADMIN_ROLE_MESSAGE =
  "This change would leave no active super-admin. Make another user super-admin first.";

/** A write that could stop someone being an active super-admin. */
export type SuperAdminChange =
  /** The account `userId` is deleted. */
  | { kind: "delete"; userId: string | number }
  /** The account `userId` is deactivated. */
  | { kind: "deactivate"; userId: string | number }
  /** The account's roles are replaced by exactly `roleIds`, with no expiry. */
  | {
      kind: "replaceRoles";
      userId: string | number;
      roleIds: readonly string[];
    }
  /** One role, `roleId`, is taken from the account. */
  | { kind: "unassignRole"; userId: string | number; roleId: string }
  /** `parentRoleId` stops inheriting `childRoleId`. */
  | { kind: "removeInheritance"; parentRoleId: string; childRoleId: string }
  /** What `roleId` inherits is replaced by exactly `childRoleIds`. */
  | { kind: "replaceChildren"; roleId: string; childRoleIds: readonly string[] }
  /** The role `roleId` is deleted, with its assignments and inheritance. */
  | { kind: "deleteRole"; roleId: string };

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

/** The tables the first-administrator questions read, with role inheritance. */
export interface FirstAdministratorTables extends LastSuperAdminTables {
  roleInherits: { parentRoleId: Column; childRoleId: Column };
}

/**
 * Refuse, inside `tx`'s transaction, a change that would leave the install
 * without an active super-admin.
 *
 * Call it before the write it guards, and before the write takes any row lock
 * of its own, so every change takes the locks in the same order.
 *
 * The `super-admin` role's row is the lock every such change takes first: on
 * PostgreSQL `FOR NO KEY UPDATE`, which two changes cannot hold at once but
 * which leaves a concurrent grant's foreign-key check free to proceed; on
 * MySQL `FOR UPDATE`. SQLite takes none, because its write transactions open
 * with `BEGIN IMMEDIATE` and so run one at a time already. The second of two
 * racing changes waits there until the first commits, and only then reads.
 * The reads are locking reads, which read the latest committed rows: under
 * MySQL's repeatable read a plain read would answer from a snapshot that
 * could predate the first change's commit.
 *
 * Who counts is an active account holding super-admin authority that won't
 * lapse: the `super-admin` role, or a role inheriting it at any depth,
 * assigned with no expiry. One that holds it only until an expiry is not
 * kept, since it ends with no request to guard. The set is worked out as it
 * stands and as the change would leave it, and the change is refused when it
 * would take the set from some to none. A failed read refuses, by throwing.
 *
 * Before that, a change that would take super-admin authority from anyone,
 * the last or not, is refused unless a super-admin person or trusted server
 * code makes it, as giving that authority is: a role change, and deleting or
 * deactivating the account alike. Here everyone holding it
 * now counts, an expiring assignment or a deactivated account included, since
 * it is theirs until it lapses or they are reactivated.
 *
 * @throws NextlyError(FORBIDDEN) when the change would take super-admin
 *   authority from someone and its caller may not.
 * @throws NextlyError(CONFLICT) when the change would leave no active
 *   super-admin.
 */
export async function refuseRemovingLastSuperAdmin(
  tx: LastSuperAdminTx,
  tables: FirstAdministratorTables,
  dialect: SupportedDialect,
  change: SuperAdminChange
): Promise<void> {
  const superAdminRoleId = await lockSuperAdminRole(tx, tables, dialect);
  // No role, no super-admin to protect.
  if (superAdminRoleId === undefined) return;

  const { roleInherits } = tables;
  const edges = (
    await latestRows(
      tx
        .select({
          parentRoleId: roleInherits.parentRoleId,
          childRoleId: roleInherits.childRoleId,
        })
        .from(roleInherits)
        .where(undefined),
      dialect
    )
  ).map(row => ({
    parent: String(row.parentRoleId),
    child: String(row.childRoleId),
  }));

  const before = conferringFrom(edges, superAdminRoleId);
  const after = conferringFrom(edgesAfter(edges, change), superAdminRoleId);
  if (change.kind === "deleteRole") after.delete(change.roleId);
  const roleIds = new Set([...before, ...after]);

  // Who may make the change comes first: a caller who may not is refused
  // whether or not the last super-admin would go. Every kind of change asks
  // it, an account's deletion or deactivation as much as a role change,
  // since each takes the authority from whoever it removes.
  const held = holdersAround(
    await assignments(tx, tables, dialect, roleIds, "in-force"),
    before,
    after,
    change
  );
  const losing = [...held.before].filter(userId => !held.after.has(userId));
  if (losing.length > 0) {
    await refuseUnlessSuperAdminCaller(tx, {
      reason: "super-admin-removal-refused",
      change: change.kind,
      userIds: losing,
    });
  }

  const kept = holdersAround(
    await assignments(tx, tables, dialect, roleIds, "permanent"),
    before,
    after,
    change
  );
  // Nobody to keep: the install already has no permanent super-admin.
  if (kept.before.size === 0) return;
  if (kept.after.size > 0) return;

  const toAccount =
    change.kind === "delete" ||
    change.kind === "deactivate" ||
    change.kind === "replaceRoles" ||
    change.kind === "unassignRole";
  throw NextlyError.conflict({
    reason: "state",
    message: toAccount
      ? LAST_SUPER_ADMIN_MESSAGE
      : LAST_SUPER_ADMIN_ROLE_MESSAGE,
    logContext: {
      refusal: "last-active-super-admin",
      change: change.kind,
      ...(toAccount ? { userId: String(change.userId) } : {}),
      ...("roleId" in change ? { roleId: change.roleId } : {}),
    },
  });
}

/** One role inheriting another: `parent` holds everything `child` does. */
interface Edge {
  parent: string;
  child: string;
}

/**
 * The roles that confer super-admin over `edges`: the role itself and every
 * role that inherits it, at any depth.
 */
function conferringFrom(
  edges: readonly Edge[],
  superAdminRoleId: string
): Set<string> {
  const conferring = new Set([superAdminRoleId]);
  let frontier = [superAdminRoleId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const { parent, child } of edges) {
      if (frontier.includes(child) && !conferring.has(parent)) {
        conferring.add(parent);
        next.push(parent);
      }
    }
    frontier = next;
  }
  return conferring;
}

/** The inheritance as the change would leave it. */
function edgesAfter(edges: readonly Edge[], change: SuperAdminChange): Edge[] {
  switch (change.kind) {
    case "removeInheritance":
      return edges.filter(
        e =>
          !(e.parent === change.parentRoleId && e.child === change.childRoleId)
      );
    case "replaceChildren":
      return [
        ...edges.filter(e => e.parent !== change.roleId),
        ...change.childRoleIds.map(child => ({
          parent: change.roleId,
          child: String(child),
        })),
      ];
    case "deleteRole":
      return edges.filter(
        e => e.parent !== change.roleId && e.child !== change.roleId
      );
    default:
      return [...edges];
  }
}

/** An account's assignment of a role. */
interface Assignment {
  userId: string;
  roleId: string;
}

/**
 * The assignments of `roleIds`: `permanent`, those of active accounts with no
 * expiry, the super-admins the guard keeps; `in-force`, every assignment not
 * yet lapsed, whatever the account, the super-admins a change can take the
 * authority from.
 */
async function assignments(
  tx: LastSuperAdminTx,
  tables: LastSuperAdminTables,
  dialect: SupportedDialect,
  roleIds: ReadonlySet<string>,
  held: "permanent" | "in-force"
): Promise<Assignment[]> {
  const { users, userRoles } = tables;
  const rows = await latestRows(
    tx
      .select({ userId: userRoles.userId, roleId: userRoles.roleId })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        held === "permanent"
          ? and(
              inArray(userRoles.roleId, [...roleIds]),
              isNull(userRoles.expiresAt),
              eq(users.isActive, true)
            )
          : and(
              inArray(userRoles.roleId, [...roleIds]),
              roleAssignmentInForce(userRoles, new Date())
            )
      ),
    dialect
  );
  return rows.map(row => ({
    userId: String(row.userId),
    roleId: String(row.roleId),
  }));
}

/**
 * Who holds super-admin authority through `held`: `before` the change, over
 * the roles that confer it now, and `after`, over the roles that will, through
 * the assignments the change leaves and any it gives.
 */
function holdersAround(
  held: readonly Assignment[],
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  change: SuperAdminChange
): { before: Set<string>; after: Set<string> } {
  const holdersBefore = new Set(
    held.filter(a => before.has(a.roleId)).map(a => a.userId)
  );
  const holdersAfter = new Set(
    held
      .filter(a => after.has(a.roleId) && survives(a, change))
      .map(a => a.userId)
  );
  if (
    change.kind === "replaceRoles" &&
    change.roleIds.some(id => after.has(String(id)))
  ) {
    holdersAfter.add(String(change.userId));
  }
  return { before: holdersBefore, after: holdersAfter };
}

/** Whether `assignment` is still held once the change lands. */
function survives(assignment: Assignment, change: SuperAdminChange): boolean {
  switch (change.kind) {
    case "delete":
    case "deactivate":
      return assignment.userId !== String(change.userId);
    case "replaceRoles":
      // Replaced whole; what it is replaced by is added by the caller.
      return assignment.userId !== String(change.userId);
    case "unassignRole":
      return !(
        assignment.userId === String(change.userId) &&
        assignment.roleId === change.roleId
      );
    case "deleteRole":
      return assignment.roleId !== change.roleId;
    case "removeInheritance":
    case "replaceChildren":
      return true;
  }
}

/**
 * Lock the `super-admin` role's row inside `tx`'s transaction, and return its
 * id, or `undefined` when the role does not exist. Exported for the
 * first-administrator grant, which takes it before its transaction writes
 * anything (grantFirstAdministratorInTx).
 *
 * Every write that adds or removes the install's administrator takes this lock
 * first, so they take it in one order and run one at a time: on PostgreSQL
 * `FOR NO KEY UPDATE`, which leaves a concurrent grant's foreign-key check free
 * to proceed; on MySQL `FOR UPDATE`; on SQLite none, since its write
 * transactions open with `BEGIN IMMEDIATE` and so run one at a time already.
 */
export async function lockSuperAdminRole(
  tx: LastSuperAdminTx,
  tables: LastSuperAdminTables,
  dialect: SupportedDialect
): Promise<string | undefined> {
  const { roles } = tables;
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
  return superAdmin ? String(superAdmin.id) : undefined;
}

/**
 * The accounts holding one of `roleIds` in force, narrowed by `who`, and to
 * active accounts when `activeOnly` is set.
 */
function superAdminHolders(
  tx: LastSuperAdminTx,
  tables: LastSuperAdminTables,
  roleIds: readonly string[],
  who: SQL | undefined,
  { activeOnly }: { activeOnly: boolean }
): FilteredRead {
  const { users, userRoles } = tables;
  return tx
    .select({ userId: userRoles.userId, roleId: userRoles.roleId })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        who,
        inArray(userRoles.roleId, [...roleIds]),
        roleAssignmentInForce(userRoles, new Date()),
        activeOnly ? eq(users.isActive, true) : undefined
      )
    );
}

/**
 * A read of the latest committed rows. Locking on PostgreSQL and MySQL, where
 * a plain read under MySQL's repeatable read could answer from a snapshot that
 * predates a racing write's commit; plain on SQLite, whose write transactions
 * already run one at a time.
 */
function latestRows(
  read: LockableRead,
  dialect: SupportedDialect
): PromiseLike<Rows> {
  return dialect === "sqlite" ? read : read.for("share");
}

/**
 * Whether anyone holds the `super-admin` role in force, read without a lock.
 *
 * A cheap answer for skipping the first-administrator grant on an install that
 * already has one. It decides nothing that matters: the grant itself checks
 * again under the role row's lock (grantFirstAdministratorInTx).
 */
export async function superAdminRoleHeld(
  db: LastSuperAdminTx,
  tables: FirstAdministratorTables
): Promise<boolean> {
  const { roles } = tables;
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.slug, SUPER_ADMIN_ROLE_SLUG))
    .limit(1);
  if (!role) return false;
  const conferring = await rolesConferringSuperAdmin(
    db,
    tables,
    String(role.id)
  );
  const held = await superAdminHolders(db, tables, conferring, undefined, {
    activeOnly: false,
  }).limit(1);
  return held.length > 0;
}

/**
 * The roles that make their holder a super-admin: the role itself and every
 * role that inherits it, at any depth.
 *
 * The same edges the permission check resolves a holder's roles along
 * (PermissionChecker.resolveRoles), walked the other way: a holder of a role
 * has every role below it in `role_inherits`, so an administrator whose
 * authority comes through such a role is an administrator, and must close
 * setup and the first-administrator grant like a direct holder does.
 */
async function rolesConferringSuperAdmin(
  db: LastSuperAdminTx,
  tables: FirstAdministratorTables,
  superAdminRoleId: string
): Promise<string[]> {
  const { roleInherits } = tables;
  const conferring = new Set([superAdminRoleId]);
  let frontier = [superAdminRoleId];
  while (frontier.length > 0) {
    const parents = (await db
      .select({ parentRoleId: roleInherits.parentRoleId })
      .from(roleInherits)
      .where(inArray(roleInherits.childRoleId, frontier))) as Array<{
      parentRoleId: unknown;
    }>;
    frontier = [];
    for (const { parentRoleId } of parents) {
      const id = String(parentRoleId);
      if (conferring.has(id)) continue;
      conferring.add(id);
      frontier.push(id);
    }
  }
  return [...conferring];
}

const FIRST_ADMINISTRATOR_TAKEN = "first-administrator-taken";

/**
 * The refusal of a setup whose account could not become the install's first
 * administrator, because one already exists or another setup won the grant.
 * Thrown before the account's transaction commits, so nothing is created.
 */
export function firstAdministratorTaken(): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    logContext: { reason: FIRST_ADMINISTRATOR_TAKEN },
  });
}

/** Whether `error` is that refusal. */
export function isFirstAdministratorTaken(error: unknown): boolean {
  return (
    NextlyError.is(error) &&
    error.logContext?.reason === FIRST_ADMINISTRATOR_TAKEN
  );
}

/** The slice of a Drizzle transaction the first-administrator grant writes through. */
export interface FirstAdministratorTx extends LastSuperAdminTx {
  insert(table: unknown): { values(row: unknown): PromiseLike<unknown> };
}

/**
 * Make `userId` the install's first administrator, inside `tx`'s transaction,
 * when nobody holds the `super-admin` role yet. Returns whether it did.
 *
 * For an account the app itself provisions on an install with no
 * administrator: how a fresh install gets one. The caller takes the role row's
 * lock with lockSuperAdminRole before its transaction writes anything, the
 * order every removal takes it in, and passes the role id here once the
 * account is inserted. Of two accounts provisioned at once on an empty install
 * exactly one is then granted; a check made before the insert, and a grant
 * made after its commit, let both through. Taking the lock after the insert
 * instead deadlocks on MySQL, where the holders read below can wait on the
 * other transaction's uncommitted account while it waits on the lock. Any
 * in-force holder counts, active or not, so a racing grant to an account that
 * is not yet active still counts as the one.
 */
export async function grantFirstAdministratorInTx(
  tx: FirstAdministratorTx,
  tables: FirstAdministratorTables,
  dialect: SupportedDialect,
  superAdminRoleId: string,
  userId: string | number,
  {
    onlyAsFirstAccount = false,
  }: {
    /**
     * Grant only when no other account exists, read here among the latest
     * committed rows: the app's own provisioning promotes only the install's
     * first account, and a sign-up that committed after the caller last looked
     * must still stop it. Setup leaves it off, as it may create the
     * administrator over role-less accounts.
     */
    onlyAsFirstAccount?: boolean;
  } = {}
): Promise<boolean> {
  if (onlyAsFirstAccount) {
    const { users } = tables;
    const others = await latestRows(
      tx
        .select({ id: users.id })
        .from(users)
        .where(ne(users.id, String(userId)))
        .limit(1),
      dialect
    );
    if (others.length > 0) return false;
  }
  // An administrator through a role that inherits `super-admin` counts too.
  const conferring = await rolesConferringSuperAdmin(
    tx,
    tables,
    superAdminRoleId
  );
  const held = await latestRows(
    superAdminHolders(tx, tables, conferring, undefined, {
      activeOnly: false,
    }).limit(1),
    dialect
  );
  if (held.length > 0) return false;
  await tx.insert(tables.userRoles).values({
    id: randomUUID(),
    userId: String(userId),
    roleId: superAdminRoleId,
    expiresAt: null,
  });
  return true;
}
