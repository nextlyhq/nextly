/**
 * A role's permissions are replaced by difference, in one transaction, so the
 * role is never left without them.
 *
 * Replacing the set as a delete followed by a separate insert emptied a
 * built-in role whenever something stopped between the two: an insert that
 * failed, or a serverless instance frozen after its first response while boot
 * seeding was still running. And every cold start rewrote every preset's rows,
 * so instances starting together rewrote the same rows against each other.
 *
 * On every dialect this process can reach:
 * - a replacement that fails part-way leaves the role exactly as it was;
 * - two seeders running at once on settled presets change nothing at all, the
 *   rows' own ids included;
 * - two seeders running at once on a preset that has drifted bring it back to
 *   exactly its set, with no duplicate assignment, touching no row that stays;
 * - two replacements with different sets, run at once, end as exactly one of
 *   them, never a mix of the two.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { seedRolePresets } from "../../../../database/seeders/role-presets";
import { seedPermissionsAndRolePresets } from "../../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { ServiceContainer } from "../../../../services/index";

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

/** A boot whose permissions and preset roles are seeded, as a boot leaves them. */
async function bootSeeded(dialect: string): Promise<TestNextly> {
  const handle = await createTestNextly(
    dialect === "sqlite" ? {} : { dialect: dialect as "postgresql" | "mysql" }
  );
  await seedPermissionsAndRolePresets();
  return handle;
}

function services(handle: TestNextly): ServiceContainer {
  return new ServiceContainer(handle.adapter as unknown as DrizzleAdapter);
}

async function adminRoleId(handle: TestNextly): Promise<string> {
  const role = await services(handle).roles.findRoleIdBySlug("admin");
  if (!role) throw new Error("the admin preset was not seeded");
  return String(role.id);
}

/** The role's assignment rows, ids included, in a stable order. */
async function assignmentRows(
  handle: TestNextly,
  roleId: string
): Promise<Array<{ id: string; permissionId: string }>> {
  const rows = await (handle.adapter as unknown as DrizzleAdapter).select<{
    id: string;
    permissionId: string;
  }>("role_permissions", {
    where: { and: [{ column: "roleId", op: "=", value: roleId }] },
  });
  return rows
    .map(row => ({
      id: String(row.id),
      permissionId: String(row.permissionId),
    }))
    .sort((a, b) => a.permissionId.localeCompare(b.permissionId));
}

describe.each(getConfiguredTestDialects())(
  "a role's permissions, replaced by difference (%s)",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      await handle?.destroy();
      handle = undefined;
    });

    it("leaves the role as it was when the replacement fails part-way", async () => {
      handle = await bootSeeded(dialect);
      const roleId = await adminRoleId(handle);
      const before = await assignmentRows(handle, roleId);
      expect(before.length).toBeGreaterThan(1);

      // One assignment dropped and one added that the database refuses, so the
      // removal succeeds and the addition fails: the point at which a
      // delete-then-insert has already emptied the role. The id names no
      // permission, which PostgreSQL and SQLite refuse on the foreign key, and
      // is longer than MySQL's 191-character column, which MySQL refuses
      // because its table declares no foreign key to fail on.
      const desired = [
        ...before.slice(1).map(row => row.permissionId),
        `no-such-permission-${"x".repeat(200)}`,
      ];
      await expect(
        services(handle).rolePermissions.setRolePermissions(roleId, desired)
      ).rejects.toThrow();

      expect(await assignmentRows(handle, roleId)).toEqual(before);
    });

    it("ends as exactly one of two replacements with different sets that run at once", async () => {
      handle = await bootSeeded(dialect);
      const roleId = await adminRoleId(handle);
      const service = services(handle).rolePermissions;
      const all = (await assignmentRows(handle, roleId)).map(
        row => row.permissionId
      );
      // Each target drops a different assignment. Without the lock on the
      // role, both would read the same set and delete from it, and the role
      // would end with both dropped: a set neither replacement asked for.
      const first = all.filter((_, index) => index !== 0);
      const second = all.filter((_, index) => index !== 1);

      // Several rounds, because two writers meet in the gap only when their
      // reads land before either commits.
      for (let round = 0; round < 5; round++) {
        await service.setRolePermissions(roleId, all);
        await Promise.all([
          service.setRolePermissions(roleId, first),
          service.setRolePermissions(roleId, second),
        ]);
        const after = (await assignmentRows(handle, roleId)).map(
          row => row.permissionId
        );
        expect([first, second]).toContainEqual(after);
      }
    });

    it("changes nothing when two seeders run at once on settled presets", async () => {
      handle = await bootSeeded(dialect);
      const roleId = await adminRoleId(handle);
      const before = await assignmentRows(handle, roleId);
      const adapter = handle.adapter as unknown as DrizzleAdapter;

      await Promise.all([
        seedRolePresets(adapter, quiet),
        seedRolePresets(adapter, quiet),
      ]);

      // The same rows, ids and all: nothing was deleted and written back.
      expect(await assignmentRows(handle, roleId)).toEqual(before);
    });

    it("brings a drifted preset back to exactly its set when two seeders run at once, touching no assignment that stays", async () => {
      handle = await bootSeeded(dialect);
      const roleId = await adminRoleId(handle);
      const settled = await assignmentRows(handle, roleId);
      const removed = settled[0]!.permissionId;
      const adapter = handle.adapter as unknown as DrizzleAdapter;
      await adapter.delete("role_permissions", {
        and: [
          { column: "roleId", op: "=", value: roleId },
          { column: "permissionId", op: "=", value: removed },
        ],
      });

      const warnings: string[] = [];
      const recording = { ...quiet, warn: (m: string) => warnings.push(m) };
      await Promise.all([
        seedRolePresets(adapter, recording),
        seedRolePresets(adapter, recording),
      ]);

      const after = await assignmentRows(handle, roleId);
      expect(after.map(row => row.permissionId)).toEqual(
        settled.map(row => row.permissionId)
      );
      // Every assignment that never left keeps its own row, id and all: only
      // the missing one was written. Rewriting the whole set whenever it
      // differs would bring the set back too, and fail here.
      expect(after.filter(row => row.permissionId !== removed)).toEqual(
        settled.filter(row => row.permissionId !== removed)
      );
      expect(warnings).toEqual([]);
    });
  }
);
