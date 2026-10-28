import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { eq, getColumns } from "drizzle-orm";

import type {
  RBACDatabaseInstance,
  RolePermissionInsertData,
} from "@nextly/types/rbac-operations";

import {
  MANAGE_BRIDGED_ACTIONS,
  isRetiredManage,
} from "../../../auth/access/manage-bridge";
import { NextlyError } from "../../../errors/nextly-error";
import { permissionName, permissionSlug } from "../../../schemas/_zod/rbac";
import { BaseService } from "../../../services/base-service";
import { writingPermissions } from "../../../services/lib/permissions";
import type { Logger } from "../../../services/shared";

import { afterRoleGrantsChanged } from "./role-grants-changed";

/**
 * The transaction methods this service calls.
 *
 * `withTransaction` hands back a dialect-specific instance typed `unknown`,
 * because naming all three would bind this file to all three driver packages.
 * Narrowing to what is actually used keeps the body typed without an `any`.
 *
 * `onConflictDoNothing` is optional because only some dialect builders expose
 * it; the call site tests for it before using it.
 */
interface TransactionLike {
  insert(table: unknown): {
    values(data: unknown): Promise<unknown> & {
      onConflictDoNothing?: () => Promise<unknown>;
    };
  };
}

/**
 * RolePermissionService handles role-permission relationship management.
 *
 * Responsibilities:
 * - Assign permissions to roles
 * - Remove permissions from roles
 * - List all permissions for a role
 * - Invalidate permission cache on changes
 *
 * @example
 * ```typescript
 * const service = new RolePermissionService(adapter, logger);
 * await service.addPermissionToRole(roleId, { action: 'read', resource: 'users' });
 * ```
 */
export class RolePermissionService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * Add a permission to a role.
   *
   * This method wraps both permission creation (if needed) and role-permission assignment
   * in a transaction to ensure atomicity. If any operation fails, all changes are rolled back.
   *
   * Note: This method requires PermissionService to ensure permission exists.
   * Currently calls ensurePermission directly - will be refactored for composition.
   *
   * @param roleId - Role ID to assign permission to
   * @param perm - Permission specification (action, resource, optional name/slug)
   * @returns void
   */
  async addPermissionToRole(
    roleId: string,
    perm: { action: string; resource: string; name?: string; slug?: string }
  ): Promise<void> {
    // A retired `manage-` permission is added as the plain four it stands
    // for, each as a permission of its own.
    if (isRetiredManage(perm.action, perm.resource)) {
      for (const action of MANAGE_BRIDGED_ACTIONS) {
        await this.addPermissionToRole(roleId, {
          action,
          resource: perm.resource,
        });
      }
      return;
    }
    // Composed by the shared helpers rather than written out. This method
    // creates the permission row when the pair has none, and it is reached from
    // the REST surface with neither field supplied — so what these fallbacks
    // produce IS the identity every later authorization check looks up.
    const permName = perm.name || permissionName(perm.action, perm.resource);
    const permSlug = perm.slug || permissionSlug(perm.action, perm.resource);

    let permissionId: string;

    const existing = await (
      this.db as RBACDatabaseInstance
    ).query.permissions.findFirst({
      where: { action: perm.action, resource: perm.resource },
      columns: {
        id: true,
        slug: true,
      },
    });

    if (existing) {
      permissionId = String(existing.id);
      await this.healReversedSlug(permissionId, String(existing.slug), perm);

      // Under the lock on the role's row that every other writer of its
      // permissions takes, and only where the role does not hold it yet: a
      // plain insert of an assignment the role holds fails on MySQL, which
      // has no conflict clause to fall back on.
      const assigned = permissionId;
      await this.adapter.transaction(async tx => {
        await tx.lockRow("roles", roleId);
        if (!(await this.heldIn(tx, roleId)).has(assigned)) {
          await this.insertAssignments(tx, roleId, [assigned]);
        }
      });
    } else {
      const newPermId = randomUUID();
      const rolePermId = randomUUID();

      // `withTransaction`, not Drizzle's `db.transaction`. better-sqlite3 is
      // synchronous and rejects any callback returning a promise, so calling
      // the driver directly threw `Transaction function cannot return a
      // promise` on SQLite — this whole branch, the one that CREATES the
      // permission, was unreachable there. The base-service helper runs it
      // through the adapter's transaction on that dialect and uses the
      // native transaction on Postgres and MySQL.
      // The gate wraps the TRANSACTION, not the statement inside it. Retiring
      // the caches before the commit would leave a window in which a check
      // refills them from the state this is replacing, and the refilled answer
      // then outlives the change that was supposed to retire it.
      await writingPermissions(this.tables.permissions, permissionsTable =>
        this.withTransaction(async txRaw => {
          const tx = txRaw as TransactionLike;
          const permissionData = {
            id: newPermId,
            name: permName,
            slug: permSlug,
            action: perm.action,
            resource: perm.resource,
            description: null,
          };
          const permInsert = tx.insert(permissionsTable).values(permissionData);
          if (typeof permInsert.onConflictDoNothing === "function") {
            await permInsert.onConflictDoNothing();
          } else {
            await permInsert;
          }

          const rolePermissionData: RolePermissionInsertData = {
            id: rolePermId,
            roleId,
            permissionId: newPermId,
          };
          const rpInsert = tx
            .insert(this.tables.rolePermissions)
            .values(rolePermissionData);
          if (typeof rpInsert.onConflictDoNothing === "function") {
            await rpInsert.onConflictDoNothing();
          } else {
            await rpInsert;
          }
        })
      );

      permissionId = newPermId;
    }

    await afterRoleGrantsChanged(roleId);
  }

  /**
   * Bring a row written by the reversed composition back onto the convention.
   *
   * An install upgraded from a version that composed `resource-action` still
   * holds those rows, and creating-if-missing never reaches them: identity is
   * `(action, resource)`, so the lookup finds the row and the corrected
   * composition is simply not used. The permission stays one that no
   * authorization check can resolve — which is the original bug, surviving the
   * fix.
   *
   * Renaming is safe here for the reason `ensurePermission` gives for doing the
   * same thing: a slug is a label rather than a key, grants reference the row
   * by id, so bringing a stale one into line renames without revoking.
   *
   * Deliberately narrow. It repairs ONLY a slug that is exactly the reversed
   * composition, and only where the caller supplied none of its own — so a
   * deliberately custom slug (`manage-api-keys` on action `update`, say) is
   * left alone rather than renamed to something its declarer never chose.
   */
  private async healReversedSlug(
    permissionId: string,
    currentSlug: string,
    perm: { action: string; resource: string; slug?: string }
  ): Promise<void> {
    if (perm.slug !== undefined) return;
    const reversed = permissionSlug(perm.resource, perm.action);
    if (currentSlug !== reversed) return;

    const canonical = permissionSlug(perm.action, perm.resource);
    if (canonical === reversed) return;

    try {
      // The stored slug is what a coarse grant check and an API key's copied
      // grants compare against, so a repaired one makes every copy of the old
      // spelling wrong.
      await writingPermissions(this.tables.permissions, table =>
        (this.db as RBACDatabaseInstance)
          .update(table)
          .set({ slug: canonical })
          .where(eq(table.id, permissionId))
      );
    } catch {
      // `slug` is unique, so another row may already answer to the canonical
      // name — a swapped pair of `(action, resource)` produces exactly that.
      // The repair is opportunistic and the GRANT is what was asked for, so a
      // collision leaves the stale slug and the assignment goes ahead. Failing
      // here would turn a tidy-up into a refusal to do the requested work, and
      // the boot-time pass makes the same choice for the same reason.
    }
  }

  /**
   * Remove a permission from a role.
   *
   * @param roleId - Role ID to remove permission from
   * @param perm - Permission specification (action, resource)
   * @returns void
   */
  async removePermissionFromRole(
    roleId: string,
    perm: { action: string; resource: string }
  ): Promise<void> {
    const permission = await (
      this.db as RBACDatabaseInstance
    ).query.permissions.findFirst({
      where: { action: perm.action, resource: perm.resource },
      columns: {
        id: true,
      },
    });
    if (!permission) return;

    // Under the lock on the role's row that every other writer of its
    // permissions takes, so a removal never lands between another writer's
    // read of what the role holds and its write.
    await this.adapter.transaction(async tx => {
      await tx.lockRow("roles", roleId);
      await tx.delete("role_permissions", {
        and: [
          { column: "roleId", op: "=", value: roleId },
          { column: "permissionId", op: "=", value: String(permission.id) },
        ],
      });
    });

    await afterRoleGrantsChanged(roleId);
  }

  /**
   * Bulk-set (replace) all permissions for a role.
   *
   * Writes only the difference — the assignments the role holds that are not in
   * `permissionIds` are removed, the ones it lacks are added — in ONE transaction,
   * under a lock on the role's row. An assignment that stays is never touched.
   *
   * Replacing the whole set as a delete and then an insert, outside a
   * transaction, left the role with no permissions whenever anything stopped
   * between the two: an insert that failed, or a serverless instance frozen after
   * its first response while boot seeding was still running. Every instance ran
   * that replacement on every cold start, so concurrent starts rewrote the same
   * rows against each other. Here, an unchanged set is answered by a read alone,
   * with no write and no lock, and a change either lands whole or not at all.
   *
   * @param roleId - Role ID to set permissions for
   * @param permissionIds - The complete desired set of permission IDs
   * @returns Updated array of permission objects with id, action, resource
   */
  async setRolePermissions(
    roleId: string,
    permissionIds: string[]
  ): Promise<Array<{ id: string; action: string; resource: string }>> {
    // A retired `manage-` permission is stored as the plain four it stands
    // for, so a role set with one, a preset's at each boot included, never
    // holds it again once converted.
    const desired = new Set(
      await storedAsPlain(
        this.adapter,
        permissionIds,
        this.adapter.getCapabilities().maxParamsPerQuery
      )
    );

    // Read first, outside any transaction: once a preset has settled, every
    // boot of every instance asks this with nothing to change, and the answer
    // costs one read rather than a lock and a rewrite. Compared by the rows'
    // own permission ids, so an assignment whose permission no longer exists
    // counts as held and is removed below. MySQL's table declares no foreign
    // key, so such a row can be there.
    const before = await this.readAssignments(roleId);
    if (sameMembers(new Set(before.map(row => row.permissionId)), desired)) {
      return named(before);
    }

    // Each statement binds no more parameters than the adapter says one query
    // may: one per id plus the role's for a removal, and up to one per column
    // for each inserted row, defaults included (`insertAssignments`).
    const maxParams = this.adapter.getCapabilities().maxParamsPerQuery;

    await this.adapter.transaction(async tx => {
      // Serialises writers to this role: a second writer waits, then reads what
      // the first committed and applies only what is still different. Columns
      // are named as the schema declares them, which is how the adapter reads a
      // where clause and returns a row.
      await tx.lockRow("roles", roleId);
      const held = await this.heldIn(tx, roleId);

      const extra = [...held].filter(id => !desired.has(id));
      for (const ids of batches(extra, maxParams - 1)) {
        await tx.delete("role_permissions", {
          and: [
            { column: "roleId", op: "=", value: roleId },
            { column: "permissionId", op: "IN", value: ids },
          ],
        });
      }

      const missing = [...desired].filter(id => !held.has(id));

      // Every id added has to name a permission. PostgreSQL and SQLite refuse
      // one that does not through the foreign key; MySQL's table declares
      // none, so it would keep an assignment that grants nothing, which the
      // list leaves out, and the replacement would report success. Thrown here,
      // inside the transaction, so the removal above is undone with it.
      const known = new Set<string>();
      for (const ids of batches(missing, maxParams)) {
        const rows = await tx.select<{ id: string }>("permissions", {
          columns: ["id"],
          where: { and: [{ column: "id", op: "IN", value: ids }] },
        });
        for (const row of rows) known.add(String(row.id));
      }
      const unknown = missing.filter(id => !known.has(id));
      if (unknown.length > 0) {
        throw NextlyError.notFound({
          logContext: { roleId, permissionIds: unknown },
        });
      }

      await this.insertAssignments(tx, roleId, missing);
    });

    await afterRoleGrantsChanged(roleId);

    return this.listRolePermissions(roleId);
  }

  /** The permission ids `roleId` holds, read on transaction `tx`. */
  private async heldIn(
    tx: TransactionContext,
    roleId: string
  ): Promise<Set<string>> {
    return new Set(
      (
        await tx.select<{ permissionId: string }>("role_permissions", {
          columns: ["permissionId"],
          where: this.whereEq("roleId", roleId),
        })
      ).map(row => String(row.permissionId))
    );
  }

  /**
   * Assigns `permissionIds` to `roleId` on transaction `tx`, each statement
   * binding no more parameters than the adapter says one query may. Through
   * Drizzle, on the transaction's connection, so the schema's own defaults
   * apply: SQLite's `created_at` is filled by the table definition, which an
   * insert by table name leaves as NULL.
   */
  private async insertAssignments(
    tx: TransactionContext,
    roleId: string,
    permissionIds: readonly string[]
  ): Promise<void> {
    const maxParams = this.adapter.getCapabilities().maxParamsPerQuery;
    const paramsPerRow = Object.keys(
      getColumns(this.tables.rolePermissions)
    ).length;
    const drizzle = tx.getDrizzle<RBACDatabaseInstance>();
    for (const ids of batches(permissionIds, maxParams / paramsPerRow)) {
      await drizzle.insert(this.tables.rolePermissions).values(
        ids.map(permissionId => ({
          id: randomUUID(),
          roleId,
          permissionId,
        }))
      );
    }
  }

  /**
   * Adds to the role the permissions `pick` chooses among `wanted`, in one
   * transaction under the lock on the role's row that every writer of its
   * permissions takes, so none lands between the choice and the add.
   *
   * Each wanted permission is named by its id and the action and resource it
   * is meant to grant. Its row is locked and read again here, and one whose
   * row is gone or now grants something else is left out: an id looked up
   * before the transaction may since have been edited into another
   * permission. `pick` is handed the ids still as wanted and the
   * transaction's executor, so what it records commits or rolls back with the
   * add; it returns the ids to add, and one the role holds already is left as
   * it is rather than added twice.
   *
   * @returns The permission ids added
   */
  async addRolePermissionsOnce(
    roleId: string,
    wanted: ReadonlyArray<{ id: string; action: string; resource: string }>,
    pick: (
      ids: readonly string[],
      executor: unknown
    ) => Promise<readonly string[]>
  ): Promise<string[]> {
    let added: string[] = [];
    await this.adapter.transaction(async tx => {
      await tx.lockRow("roles", roleId);
      const held = await this.heldIn(tx, roleId);
      const asWanted = await this.stillAsWanted(tx, wanted);
      const picked = new Set(await pick(asWanted, tx.getDrizzle()));
      added = asWanted.filter(id => picked.has(id) && !held.has(id));
      await this.insertAssignments(tx, roleId, added);
    });
    if (added.length > 0) await afterRoleGrantsChanged(roleId);
    return added;
  }

  /**
   * Stores what the role holds as the plain permissions a retired `manage-`
   * one stands for, under the lock on the role's row every writer of its
   * permissions takes: each retired one held is replaced by the plain four on
   * its resource. Whether anything changed; a role with none changes nothing,
   * so a second conversion finds nothing to do.
   */
  async convertRetiredManage(roleId: string): Promise<boolean> {
    const maxParams = this.adapter.getCapabilities().maxParamsPerQuery;
    let changed = false;
    await this.adapter.transaction(async tx => {
      await tx.lockRow("roles", roleId);
      const held = await this.heldIn(tx, roleId);
      const desired = new Set(await storedAsPlain(tx, [...held], maxParams));
      const removed = [...held].filter(id => !desired.has(id));
      const added = [...desired].filter(id => !held.has(id));
      if (removed.length === 0 && added.length === 0) return;
      for (const ids of batches(removed, maxParams - 1)) {
        await tx.delete("role_permissions", {
          and: [
            { column: "roleId", op: "=", value: roleId },
            { column: "permissionId", op: "IN", value: ids },
          ],
        });
      }
      await this.insertAssignments(tx, roleId, added);
      changed = true;
    });
    if (changed) await afterRoleGrantsChanged(roleId);
    return changed;
  }

  /**
   * Takes off the role the permissions `pick` chooses among `unwanted`, in one
   * transaction under the same lock on the role's row as
   * {@link addRolePermissionsOnce}, so no edit of its permissions lands
   * between the choice and the removal.
   *
   * Each permission is named by its id and the action and resource it is
   * taken back for, and its row is locked and read again here, as when adding:
   * one whose row now grants something else is left on the role, since the id
   * was looked up before the transaction. `pick` is handed the ids still as
   * named that the role holds, and the transaction's executor, so what it
   * records commits or rolls back with the removal; it returns the ids to
   * remove.
   *
   * @returns The permission ids removed
   */
  async withdrawRolePermissions(
    roleId: string,
    unwanted: ReadonlyArray<{ id: string; action: string; resource: string }>,
    pick: (
      held: readonly string[],
      executor: unknown
    ) => Promise<readonly string[]>
  ): Promise<string[]> {
    let removed: string[] = [];
    await this.adapter.transaction(async tx => {
      await tx.lockRow("roles", roleId);
      const held = await this.heldIn(tx, roleId);
      const holding = (await this.stillAsWanted(tx, unwanted)).filter(id =>
        held.has(id)
      );
      if (holding.length === 0) return;
      const picked = new Set(await pick(holding, tx.getDrizzle()));
      removed = holding.filter(id => picked.has(id));
      const maxParams = this.adapter.getCapabilities().maxParamsPerQuery;
      for (const batch of batches(removed, maxParams - 1)) {
        await tx.delete("role_permissions", {
          and: [
            { column: "roleId", op: "=", value: roleId },
            { column: "permissionId", op: "IN", value: batch },
          ],
        });
      }
    });
    if (removed.length > 0) await afterRoleGrantsChanged(roleId);
    return removed;
  }

  /**
   * The ids among `wanted` whose permission row, locked on transaction `tx`,
   * still grants the action and resource it is named for.
   */
  private async stillAsWanted(
    tx: TransactionContext,
    wanted: ReadonlyArray<{ id: string; action: string; resource: string }>
  ): Promise<string[]> {
    const ids = [...new Set(wanted.map(({ id }) => id))];
    for (const id of ids) await tx.lockRow("permissions", id);
    const maxParams = this.adapter.getCapabilities().maxParamsPerQuery;
    const rows = new Map<string, { action: string; resource: string }>();
    for (const batch of batches(ids, maxParams)) {
      for (const row of await tx.select<{
        id: string;
        action: string;
        resource: string;
      }>("permissions", {
        columns: ["id", "action", "resource"],
        where: { and: [{ column: "id", op: "IN", value: batch }] },
      })) {
        rows.set(String(row.id), row);
      }
    }
    return ids.filter(id => {
      const row = rows.get(id);
      return wanted.some(
        want =>
          want.id === id &&
          row?.action === want.action &&
          row?.resource === want.resource
      );
    });
  }

  /**
   * List all permissions assigned to a role.
   *
   * @param roleId - Role ID to list permissions for
   * @returns Array of permission objects with id, action, resource
   */
  async listRolePermissions(
    roleId: string
  ): Promise<Array<{ id: string; action: string; resource: string }>> {
    return named(await this.readAssignments(roleId));
  }

  /** The role's assignment rows, each with its permission where one exists. */
  private async readAssignments(roleId: string): Promise<Assignment[]> {
    return (this.db as RBACDatabaseInstance).query.rolePermissions.findMany({
      where: { roleId: roleId },
      with: {
        permission: {
          columns: {
            id: true,
            action: true,
            resource: true,
          },
        },
      },
    });
  }
}

/** An assignment row, and the permission it names when that still exists. */
type Assignment = {
  permissionId: string;
  permission?: { action: string; resource: string } | null;
};

/**
 * The permissions the assignments name. An assignment whose permission is gone
 * names nothing a caller could act on, so it is left out rather than read
 * through a missing row.
 */
function named(
  assignments: readonly Assignment[]
): Array<{ id: string; action: string; resource: string }> {
  return assignments.flatMap(({ permissionId, permission }) =>
    permission
      ? [
          {
            id: permissionId,
            action: permission.action,
            resource: permission.resource,
          },
        ]
      : []
  );
}

/** `items` in runs of at most `size`, and never less than one per run. */
/** Where `storedAsPlain` reads permission rows: an adapter or a transaction. */
type PermissionReader = Pick<TransactionContext, "select">;

/** A permission row as `storedAsPlain` reads it. */
type PermissionRow = { id: unknown; action: string; resource: string };

/**
 * The permission ids as a role stores them: each retired `manage-` one
 * replaced by the plain read, create, update and delete on its resource, and
 * every other id as it is. Where a resource lacks one of the plain four, its
 * `manage-` id is kept, so the role loses nothing; the bridge still counts it
 * until `nextly upgrade` converts it once they exist.
 */
export async function storedAsPlain(
  reader: PermissionReader,
  permissionIds: readonly string[],
  maxParams: number
): Promise<string[]> {
  const ids = [...new Set(permissionIds.map(String))];
  if (ids.length === 0) return ids;
  const rows: PermissionRow[] = [];
  for (const batch of batches(ids, maxParams)) {
    rows.push(
      ...(await reader.select<PermissionRow>("permissions", {
        columns: ["id", "action", "resource"],
        where: { and: [{ column: "id", op: "IN", value: batch }] },
      }))
    );
  }
  const retired = rows.filter(row => isRetiredManage(row.action, row.resource));
  if (retired.length === 0) return ids;
  const resources = [...new Set(retired.map(row => row.resource))];
  const plain = await reader.select<PermissionRow>("permissions", {
    columns: ["id", "action", "resource"],
    where: {
      and: [
        { column: "action", op: "IN", value: [...MANAGE_BRIDGED_ACTIONS] },
        { column: "resource", op: "IN", value: resources },
      ],
    },
  });
  const replaced = new Set<string>();
  const added: string[] = [];
  for (const resource of resources) {
    const four = plain.filter(row => row.resource === resource);
    if (
      !MANAGE_BRIDGED_ACTIONS.every(action =>
        four.some(row => row.action === action)
      )
    ) {
      continue;
    }
    for (const row of retired) {
      if (row.resource === resource) replaced.add(String(row.id));
    }
    added.push(...four.map(row => String(row.id)));
  }
  return [...new Set([...ids.filter(id => !replaced.has(id)), ...added])];
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const runs: T[][] = [];
  for (let start = 0; start < items.length; start += step) {
    runs.push(items.slice(start, start + step));
  }
  return runs;
}

/** Whether two sets hold the same members. */
function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const member of a) if (!b.has(member)) return false;
  return true;
}
