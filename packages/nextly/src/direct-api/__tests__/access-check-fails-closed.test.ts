/**
 * `nextly.access.check` refuses, rather than throws, when it cannot read the
 * user: a role or grant lookup that fails counts as holding nothing of its
 * kind, so a caller branching on the answer is told `false`, never a failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const lookups = vi.hoisted(() => ({
  roles: vi.fn<() => Promise<string[]>>(),
  grants:
    vi.fn<
      () => Promise<{ slug: string; action: string; resource: string }[]>
    >(),
}));

vi.mock("../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../services/lib/permissions")>()),
  listRoleSlugsForUser: lookups.roles,
  listEffectiveGrants: lookups.grants,
}));

import type { NextlyContext } from "../namespaces/context";
import { createAccessNamespace } from "../namespaces/rbac";

/** The namespace, over a registry that declares no rule. */
const access = createAccessNamespace({
  rbacAccessControlService: { getRegisteredTarget: () => undefined },
} as unknown as NextlyContext);

const UPDATE_SETTINGS = {
  slug: "update-settings",
  action: "update",
  resource: "settings",
};

const asked = () =>
  access.check({ userId: "user-1", operation: "update", resource: "settings" });

beforeEach(() => {
  lookups.roles.mockReset().mockResolvedValue([]);
  lookups.grants.mockReset().mockResolvedValue([UPDATE_SETTINGS]);
});

describe("nextly.access.check when it cannot read the user", () => {
  it("allows a holder of the permission when both lookups answer", async () => {
    // The control: the same grant, read, allows.
    await expect(asked()).resolves.toBe(true);
  });

  it("refuses when the grant lookup fails", async () => {
    lookups.grants.mockRejectedValue(new Error("grants unreadable"));
    await expect(asked()).resolves.toBe(false);
  });

  it("keeps the grants it read when the role lookup fails, and refuses when both fail", async () => {
    lookups.roles.mockRejectedValue(new Error("roles unreadable"));
    // The grants were read, so the holder is still allowed: a failed role
    // lookup costs only what a role would give, a super-admin's authority.
    await expect(asked()).resolves.toBe(true);
    lookups.grants.mockRejectedValue(new Error("grants unreadable"));
    await expect(asked()).resolves.toBe(false);
  });
});
