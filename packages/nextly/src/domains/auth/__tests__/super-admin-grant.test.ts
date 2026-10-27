/**
 * The super-admin grant rule refuses a change it can't judge, and judges each
 * kind of caller as its own.
 *
 * Each lookup the rule needs is made to fail in turn: the roles a change
 * names inherit, the roles themselves, and whether the caller is a
 * super-admin. Every failure must refuse the change rather than let it
 * through. The integration suite covers the same rule on real databases.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const lookups = vi.hoisted(() => ({
  descendants:
    vi.fn<(roleId: string) => Promise<{ ids: string[]; complete: boolean }>>(),
  superAdmin: vi.fn<(userId: string) => Promise<boolean>>(),
  lock: vi.fn<() => Promise<string | undefined>>(),
}));

vi.mock("../services/role-descendants", () => ({
  walkDescendantRoleIds: (_db: unknown, _dialect: unknown, roleId: string) =>
    lookups.descendants(roleId),
}));

vi.mock("../../users/services/last-super-admin", () => ({
  lockSuperAdminRole: () => lookups.lock(),
}));

vi.mock("../../../services/lib/permissions", () => ({
  isSuperAdminOrThrow: (userId: string) => lookups.superAdmin(userId),
}));

const tablesFor = vi.hoisted(() =>
  vi.fn((_dialect?: string) => ({ roles: { id: "id", slug: "slug" } }))
);

vi.mock("../../../database", () => ({ getDialectTables: tablesFor }));

import {
  roleChangeCallerFor,
  runAsRoleChangeCaller,
  type RoleChangeCaller,
} from "../services/role-change-caller";
import { refuseGrantingSuperAdmin } from "../services/super-admin-grant";

/** A transaction whose roles query answers `rows`, or fails with `error`. */
function txAnswering(rows: Array<{ id: string }> | Error) {
  const limit = () =>
    rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows);
  return {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
  } as unknown as Parameters<typeof refuseGrantingSuperAdmin>[0];
}

const CONFERS = txAnswering([{ id: "super-admin" }]);
const PLAIN = txAnswering([]);
const WALKED = { ids: ["super-admin"], complete: true };

function grant(
  caller: RoleChangeCaller | undefined,
  tx = CONFERS
): Promise<void> {
  const ask = () =>
    refuseGrantingSuperAdmin(tx, "postgresql", ["elevated"], {
      case: "test",
    });
  return caller === undefined ? ask() : runAsRoleChangeCaller(caller, ask);
}

afterEach(() => {
  lookups.descendants.mockReset();
  lookups.superAdmin.mockReset();
  lookups.lock.mockReset();
  lookups.lock.mockResolvedValue("super-admin");
});

lookups.lock.mockResolvedValue("super-admin");

describe("refuseGrantingSuperAdmin", () => {
  describe("refuses when it can't read what it needs", () => {
    it("the roles the change names inherit", async () => {
      lookups.descendants.mockRejectedValue(new Error("connection reset"));
      lookups.superAdmin.mockResolvedValue(true);

      await expect(grant({ kind: "person", userId: "admin" })).rejects.toThrow(
        "connection reset"
      );
    });

    it("the roles themselves", async () => {
      lookups.descendants.mockResolvedValue({ ids: [], complete: true });
      lookups.superAdmin.mockResolvedValue(true);

      await expect(
        grant(
          { kind: "person", userId: "admin" },
          txAnswering(new Error("connection reset"))
        )
      ).rejects.toThrow("connection reset");
    });

    it("whether the caller is a super-admin", async () => {
      lookups.descendants.mockResolvedValue({ ids: [], complete: true });
      lookups.superAdmin.mockRejectedValue(new Error("connection reset"));

      await expect(grant({ kind: "person", userId: "admin" })).rejects.toThrow(
        "connection reset"
      );
    });
  });

  describe("a change that confers super-admin", () => {
    it("is refused to a person who is no super-admin", async () => {
      lookups.descendants.mockResolvedValue(WALKED);
      lookups.superAdmin.mockResolvedValue(false);

      await expect(
        grant({ kind: "person", userId: "manager" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(lookups.superAdmin).toHaveBeenCalledWith("manager");
    });

    it("is refused to a key, without asking about anyone's roles", async () => {
      lookups.descendants.mockResolvedValue(WALKED);

      await expect(grant({ kind: "key" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(lookups.superAdmin).not.toHaveBeenCalled();
    });

    it("is refused to a request with no credentials", async () => {
      lookups.descendants.mockResolvedValue(WALKED);

      await expect(grant({ kind: "visitor" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("is allowed to a super-admin person", async () => {
      lookups.descendants.mockResolvedValue(WALKED);
      lookups.superAdmin.mockResolvedValue(true);

      await expect(
        grant({ kind: "person", userId: "admin" })
      ).resolves.toBeUndefined();
    });

    it("is allowed to trusted server code, with no request caller", async () => {
      lookups.descendants.mockResolvedValue(WALKED);

      await expect(grant(undefined)).resolves.toBeUndefined();
      expect(lookups.superAdmin).not.toHaveBeenCalled();
    });
  });

  it("reads the tables of the transaction's dialect, not the environment's", async () => {
    tablesFor.mockClear();
    lookups.descendants.mockResolvedValue({ ids: [], complete: true });

    await grant({ kind: "key" }, PLAIN);

    expect(tablesFor).toHaveBeenCalled();
    for (const call of tablesFor.mock.calls) expect(call[0]).toBe("postgresql");
  });

  it("refuses when the lock can't be taken", async () => {
    lookups.lock.mockRejectedValue(new Error("lock timeout"));
    lookups.superAdmin.mockResolvedValue(true);

    await expect(grant({ kind: "person", userId: "admin" })).rejects.toThrow(
      "lock timeout"
    );
  });

  it("takes the lock before it decides, whatever the roles", async () => {
    lookups.descendants.mockResolvedValue({ ids: [], complete: true });

    await grant({ kind: "key" }, PLAIN);

    expect(lookups.lock).toHaveBeenCalledTimes(1);
    expect(lookups.lock.mock.invocationCallOrder[0]).toBeLessThan(
      lookups.descendants.mock.invocationCallOrder[0]!
    );
  });

  it("treats a walk of the roles' inheritance cut short as conferring", async () => {
    // Super-admin may lie beyond where the walk stopped.
    lookups.descendants.mockResolvedValue({ ids: [], complete: false });
    lookups.superAdmin.mockResolvedValue(false);

    await expect(
      grant({ kind: "person", userId: "manager" }, PLAIN)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("asks nothing of the caller for a change that confers nothing", async () => {
    lookups.descendants.mockResolvedValue({ ids: [], complete: true });

    await expect(grant({ kind: "key" }, PLAIN)).resolves.toBeUndefined();
    expect(lookups.superAdmin).not.toHaveBeenCalled();
  });
});

describe("roleChangeCallerFor", () => {
  it("names a session's user as the person making the change", () => {
    expect(
      roleChangeCallerFor({ authMethod: "session", userId: "u1" })
    ).toEqual({ kind: "person", userId: "u1" });
  });

  it("names an API key as a key, never as the person who made it", () => {
    expect(
      roleChangeCallerFor({ authMethod: "api-key", userId: "u1" })
    ).toEqual({ kind: "key" });
  });

  it("names a request with no credentials a visitor", () => {
    expect(roleChangeCallerFor(undefined)).toEqual({ kind: "visitor" });
  });
});
