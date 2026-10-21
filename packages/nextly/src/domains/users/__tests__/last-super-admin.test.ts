/**
 * The last-super-admin guard refuses a change it could not judge.
 *
 * Each read the guard makes is made to fail in turn: the lock on the
 * `super-admin` role, the inheritance between roles, and the assignments of
 * the roles that confer it. Every failure must refuse the change rather than
 * let it through. The integration suite covers what the guard decides on
 * real databases.
 */
import { describe, expect, it, vi } from "vitest";

// Conditions as plain values, so the fake transaction below need not parse SQL.
vi.mock("drizzle-orm", () => ({
  and: (...parts: unknown[]) => ({ and: parts }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  ne: (a: unknown, b: unknown) => ({ ne: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  isNull: (a: unknown) => ({ isNull: a }),
}));

vi.mock("../../../services/lib/role-assignments", () => ({
  roleAssignmentInForce: () => ({ inForce: true }),
}));

import {
  refuseRemovingLastSuperAdmin,
  type FirstAdministratorTables,
  type LastSuperAdminTx,
} from "../services/last-super-admin";

const tables = {
  users: { id: "users.id", isActive: "users.isActive" },
  roles: { id: "roles.id", slug: "roles.slug" },
  userRoles: {
    userId: "userRoles.userId",
    roleId: "userRoles.roleId",
    expiresAt: "userRoles.expiresAt",
  },
  roleInherits: {
    parentRoleId: "roleInherits.parentRoleId",
    childRoleId: "roleInherits.childRoleId",
  },
} as unknown as FirstAdministratorTables;

type Rows = Array<Record<string, unknown>>;

/** A read that answers `answer`, awaited, limited or locked. */
function read(answer: Rows | Error) {
  const settle = () =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  const reader = {
    then: (ok: (rows: Rows) => unknown, fail: (e: unknown) => unknown) =>
      settle().then(ok, fail),
    limit: () => reader,
    for: () => settle(),
  };
  return reader;
}

/**
 * A transaction answering each table's read: the role row (the lock), the
 * inheritance between roles, and the assignments joined to their accounts.
 */
function txAnswering(answers: {
  lock?: Rows | Error;
  edges?: Rows | Error;
  assignments?: Rows | Error;
}): LastSuperAdminTx {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          read(
            table === tables.roles
              ? (answers.lock ?? [{ id: "super-admin" }])
              : (answers.edges ?? [])
          ),
        innerJoin: () => ({
          where: () =>
            read(
              answers.assignments ?? [
                { userId: "first", roleId: "super-admin" },
              ]
            ),
        }),
      }),
    }),
  } as unknown as LastSuperAdminTx;
}

const DELETE_FIRST = { kind: "delete", userId: "first" } as const;

describe("refuseRemovingLastSuperAdmin", () => {
  describe("refuses when it can't read what it needs", () => {
    it("the super-admin role, which it locks", async () => {
      await expect(
        refuseRemovingLastSuperAdmin(
          txAnswering({ lock: new Error("lock timeout") }),
          tables,
          "postgresql",
          DELETE_FIRST
        )
      ).rejects.toThrow("lock timeout");
    });

    it("the inheritance between roles", async () => {
      await expect(
        refuseRemovingLastSuperAdmin(
          txAnswering({ edges: new Error("connection reset") }),
          tables,
          "postgresql",
          DELETE_FIRST
        )
      ).rejects.toThrow("connection reset");
    });

    it("the assignments of the roles that confer super-admin", async () => {
      await expect(
        refuseRemovingLastSuperAdmin(
          txAnswering({ assignments: new Error("connection reset") }),
          tables,
          "postgresql",
          DELETE_FIRST
        )
      ).rejects.toThrow("connection reset");
    });
  });

  it("refuses removing the last permanent super-admin", async () => {
    await expect(
      refuseRemovingLastSuperAdmin(
        txAnswering({}),
        tables,
        "postgresql",
        DELETE_FIRST
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses removing the inheritance the last one is a super-admin through", async () => {
    await expect(
      refuseRemovingLastSuperAdmin(
        txAnswering({
          edges: [{ parentRoleId: "owner", childRoleId: "super-admin" }],
          assignments: [{ userId: "heir", roleId: "owner" }],
        }),
        tables,
        "postgresql",
        {
          kind: "removeInheritance",
          parentRoleId: "owner",
          childRoleId: "super-admin",
        }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows it while another permanent super-admin remains", async () => {
    await expect(
      refuseRemovingLastSuperAdmin(
        txAnswering({
          assignments: [
            { userId: "first", roleId: "super-admin" },
            { userId: "second", roleId: "super-admin" },
          ],
        }),
        tables,
        "postgresql",
        DELETE_FIRST
      )
    ).resolves.toBeUndefined();
  });
});
