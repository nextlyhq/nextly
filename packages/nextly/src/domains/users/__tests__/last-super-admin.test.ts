/**
 * The last-super-admin guard refuses a change it could not judge.
 *
 * Each read the guard makes is made to fail in turn: the lock on the
 * `super-admin` role, the inheritance between roles, and the assignments of
 * the roles that confer it, and, for a role change that takes super-admin
 * from someone, who holds it now and whether the caller is a super-admin.
 * Every failure must refuse the change rather than let it through. The
 * integration suite covers what the guard decides on real databases.
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

/** Whether the caller is a super-admin, as the permission layer answers it. */
const isSuperAdmin = vi.hoisted(() => vi.fn());
vi.mock("../../../services/lib/permissions", () => ({
  isSuperAdminOrThrow: isSuperAdmin,
}));

import { runAsRoleChangeCaller } from "../../auth/services/role-change-caller";
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
 * inheritance between roles, and the assignments joined to their accounts,
 * the permanent ones the guard keeps (`assignments`) and those in force now
 * (`inForce`, the same unless given).
 */
function txAnswering(answers: {
  lock?: Rows | Error;
  edges?: Rows | Error;
  assignments?: Rows | Error;
  inForce?: Rows | Error;
}): LastSuperAdminTx {
  const permanent = answers.assignments ?? [
    { userId: "first", roleId: "super-admin" },
  ];
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
          where: (condition: unknown) =>
            read(
              JSON.stringify(condition).includes("inForce")
                ? (answers.inForce ?? permanent)
                : permanent
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

describe("taking super-admin from someone by a role change", () => {
  /** The first and a second super-admin, so the last one is never at stake. */
  const TWO = [
    { userId: "first", roleId: "super-admin" },
    { userId: "second", roleId: "super-admin" },
  ];
  const UNASSIGN_SECOND = {
    kind: "unassignRole",
    userId: "second",
    roleId: "super-admin",
  } as const;

  function unassign(tx: LastSuperAdminTx): Promise<void> {
    return refuseRemovingLastSuperAdmin(
      tx,
      tables,
      "postgresql",
      UNASSIGN_SECOND
    );
  }

  it("refuses an API key", async () => {
    await expect(
      runAsRoleChangeCaller({ kind: "key" }, () =>
        unassign(txAnswering({ assignments: TWO }))
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a person who is no super-admin", async () => {
    isSuperAdmin.mockResolvedValueOnce(false);
    await expect(
      runAsRoleChangeCaller({ kind: "person", userId: "admin" }, () =>
        unassign(txAnswering({ assignments: TWO }))
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a super-admin person, and trusted code with no caller", async () => {
    isSuperAdmin.mockResolvedValueOnce(true);
    await expect(
      runAsRoleChangeCaller({ kind: "person", userId: "first" }, () =>
        unassign(txAnswering({ assignments: TWO }))
      )
    ).resolves.toBeUndefined();
    await expect(
      unassign(txAnswering({ assignments: TWO }))
    ).resolves.toBeUndefined();
  });

  it("counts a holder whose assignment expires, whom the last-one rule doesn't", async () => {
    await expect(
      runAsRoleChangeCaller({ kind: "key" }, () =>
        unassign(
          txAnswering({
            assignments: [{ userId: "first", roleId: "super-admin" }],
            inForce: TWO,
          })
        )
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("asks nothing of the caller when nobody would lose it", async () => {
    isSuperAdmin.mockClear();
    await expect(
      runAsRoleChangeCaller({ kind: "key" }, () =>
        refuseRemovingLastSuperAdmin(
          txAnswering({ assignments: TWO }),
          tables,
          "postgresql",
          { kind: "unassignRole", userId: "second", roleId: "editor" }
        )
      )
    ).resolves.toBeUndefined();
    expect(isSuperAdmin).not.toHaveBeenCalled();
  });

  describe("refuses when it can't read what it needs", () => {
    it("who holds super-admin now", async () => {
      await expect(
        unassign(
          txAnswering({
            assignments: TWO,
            inForce: new Error("connection reset"),
          })
        )
      ).rejects.toThrow("connection reset");
    });

    it("whether the caller is a super-admin", async () => {
      isSuperAdmin.mockRejectedValueOnce(new Error("connection reset"));
      await expect(
        runAsRoleChangeCaller({ kind: "person", userId: "admin" }, () =>
          unassign(txAnswering({ assignments: TWO }))
        )
      ).rejects.toThrow("connection reset");
    });
  });
});
