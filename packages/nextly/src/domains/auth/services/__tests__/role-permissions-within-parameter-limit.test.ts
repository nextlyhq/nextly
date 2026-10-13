/**
 * A large change to a role's permissions stays within the parameters one query
 * may bind.
 *
 * The difference is written as a removal of the ids not wanted and an insert
 * of the ids missing, and each binds a parameter per id. Clearing a role with
 * thousands of assignments, or filling one, would otherwise be a single
 * statement past what the adapter says a query may carry. The adapter here is
 * a stand-in that records each statement against an advertised limit of nine.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import { RolePermissionService } from "../role-permission-service";

vi.mock("../../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../services/lib/permissions")
  >()),
  invalidatePermissionCache: vi.fn(async () => undefined),
}));

const MAX_PARAMS = 9;

/** The role's assignments, held in memory, and every statement that touched them. */
function standIn(held: Set<string>) {
  const removals: string[][] = [];
  const inserts: number[] = [];
  const read = async () =>
    [...held].map(permissionId => ({
      permissionId,
      permission: { action: "read", resource: permissionId },
    }));
  const tx = {
    lockRow: async () => undefined,
    select: async () => [...held].map(permissionId => ({ permissionId })),
    delete: async (
      _table: string,
      where: { and: Array<{ column: string; value: unknown }> }
    ) => {
      const ids = where.and.find(c => c.column === "permissionId")
        ?.value as string[];
      removals.push(ids);
      for (const id of ids) held.delete(id);
    },
    getDrizzle: () => ({
      insert: () => ({
        values: async (rows: Array<{ permissionId: string }>) => {
          inserts.push(rows.length);
          for (const row of rows) held.add(row.permissionId);
        },
      }),
    }),
  };
  const adapter = {
    getCapabilities: () => ({
      dialect: "sqlite",
      maxParamsPerQuery: MAX_PARAMS,
    }),
    getDrizzle: () => ({ query: { rolePermissions: { findMany: read } } }),
    transaction: async (work: (t: typeof tx) => Promise<unknown>) => work(tx),
  };
  const service = new RolePermissionService(
    adapter as unknown as DrizzleAdapter,
    { debug() {}, info() {}, warn() {}, error() {} }
  );
  return { service, removals, inserts };
}

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `permission-${index}`);

describe("replacing a role's permissions in bulk", () => {
  it("removes a large set in statements within the adapter's limit", async () => {
    const held = new Set(ids(50));
    const { service, removals } = standIn(held);

    await expect(service.setRolePermissions("role-1", [])).resolves.toEqual([]);

    expect(held.size).toBe(0);
    expect(removals.flat()).toHaveLength(50);
    // One parameter per id, and one for the role.
    for (const run of removals) {
      expect(run.length + 1).toBeLessThanOrEqual(MAX_PARAMS);
    }
  });

  it("adds a large set in statements within the adapter's limit", async () => {
    const held = new Set<string>();
    const { service, inserts } = standIn(held);

    await service.setRolePermissions("role-1", ids(50));

    expect(held.size).toBe(50);
    expect(inserts.reduce((sum, rows) => sum + rows, 0)).toBe(50);
    // Up to one parameter per column of each row: id, role, permission and
    // creation time.
    for (const rows of inserts) {
      expect(rows * 4).toBeLessThanOrEqual(MAX_PARAMS);
    }
  });
});
