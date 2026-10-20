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
  descendants: vi.fn<(roleId: string) => Promise<string[]>>(),
  superAdmin: vi.fn<(userId: string) => Promise<boolean>>(),
}));

vi.mock("../services/role-descendants", () => ({
  listDescendantRoleIds: (_db: unknown, roleId: string) =>
    lookups.descendants(roleId),
}));

vi.mock("../../../services/lib/permissions", () => ({
  isSuperAdminOrThrow: (userId: string) => lookups.superAdmin(userId),
}));

import {
  refuseGrantingSuperAdmin,
  runAsRoleChangeCaller,
  type RoleChangeCaller,
} from "../services/super-admin-grant";

/** A database whose roles query answers `rows`, or fails with `error`. */
function dbAnswering(rows: Array<{ id: string }> | Error) {
  const findMany = () =>
    rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows);
  return { query: { roles: { findMany } } } as unknown as Parameters<
    typeof refuseGrantingSuperAdmin
  >[0];
}

const CONFERS = dbAnswering([{ id: "super-admin" }]);
const PLAIN = dbAnswering([]);

function grant(
  caller: RoleChangeCaller | undefined,
  db = CONFERS
): Promise<void> {
  const ask = () =>
    refuseGrantingSuperAdmin(db, ["elevated"], { case: "test" });
  return caller === undefined ? ask() : runAsRoleChangeCaller(caller, ask);
}

afterEach(() => {
  lookups.descendants.mockReset();
  lookups.superAdmin.mockReset();
});

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
      lookups.descendants.mockResolvedValue([]);
      lookups.superAdmin.mockResolvedValue(true);

      await expect(
        grant(
          { kind: "person", userId: "admin" },
          dbAnswering(new Error("connection reset"))
        )
      ).rejects.toThrow("connection reset");
    });

    it("whether the caller is a super-admin", async () => {
      lookups.descendants.mockResolvedValue([]);
      lookups.superAdmin.mockRejectedValue(new Error("connection reset"));

      await expect(grant({ kind: "person", userId: "admin" })).rejects.toThrow(
        "connection reset"
      );
    });
  });

  describe("a change that confers super-admin", () => {
    it("is refused to a person who is no super-admin", async () => {
      lookups.descendants.mockResolvedValue(["super-admin"]);
      lookups.superAdmin.mockResolvedValue(false);

      await expect(
        grant({ kind: "person", userId: "manager" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(lookups.superAdmin).toHaveBeenCalledWith("manager");
    });

    it("is refused to a key, without asking about anyone's roles", async () => {
      lookups.descendants.mockResolvedValue(["super-admin"]);

      await expect(grant({ kind: "key" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(lookups.superAdmin).not.toHaveBeenCalled();
    });

    it("is refused to a request with no credentials", async () => {
      lookups.descendants.mockResolvedValue(["super-admin"]);

      await expect(grant({ kind: "visitor" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("is allowed to a super-admin person", async () => {
      lookups.descendants.mockResolvedValue(["super-admin"]);
      lookups.superAdmin.mockResolvedValue(true);

      await expect(
        grant({ kind: "person", userId: "admin" })
      ).resolves.toBeUndefined();
    });

    it("is allowed to trusted server code, with no request caller", async () => {
      lookups.descendants.mockResolvedValue(["super-admin"]);

      await expect(grant(undefined)).resolves.toBeUndefined();
      expect(lookups.superAdmin).not.toHaveBeenCalled();
    });
  });

  it("asks nothing of the caller for a change that confers nothing", async () => {
    lookups.descendants.mockResolvedValue([]);

    await expect(grant({ kind: "key" }, PLAIN)).resolves.toBeUndefined();
    expect(lookups.superAdmin).not.toHaveBeenCalled();
  });
});
