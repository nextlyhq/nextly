/**
 * `nextly.access.check` refuses, rather than throws, when it cannot read the
 * user: a role or grant lookup that fails refuses the check, so a caller
 * branching on the answer is told `false`, never a failure, and a rule is
 * never asked with a role set that could not be read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({
  roles: ["editor"] as string[],
  grants: [
    { slug: "update-settings", action: "update", resource: "settings" },
    { slug: "read-posts", action: "read", resource: "posts" },
  ],
  rolesFail: false,
  grantsFail: false,
}));

/** Every role and grant lookup the check can make, failing on demand. */
vi.mock("../../services/lib/permissions", async importOriginal => {
  const roles = async () => {
    if (user.rolesFail) throw new Error("roles unreadable");
    return user.roles;
  };
  const grants = async () => {
    if (user.grantsFail) throw new Error("grants unreadable");
    return user.grants;
  };
  const holds = async (_userId: string, action: string, resource: string) =>
    (await grants()).some(g => g.action === action && g.resource === resource);
  const superAdmin = async () => (await roles()).includes("super-admin");
  return {
    ...(await importOriginal<
      typeof import("../../services/lib/permissions")
    >()),
    listRoleSlugsForUser: vi.fn(roles),
    listEffectiveGrants: vi.fn(grants),
    hasPermission: vi.fn(holds),
    hasAnyPermission: vi.fn(
      async (
        userId: string,
        checks: { action: string; resource: string }[]
      ) => {
        for (const check of checks) {
          if (await holds(userId, check.action, check.resource)) return true;
        }
        return false;
      }
    ),
    isSuperAdmin: vi.fn(superAdmin),
    isSuperAdminOrRefuse: vi.fn(superAdmin),
    isSuperAdminOrThrow: vi.fn(superAdmin),
  };
});

import { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import type { NextlyContext } from "../namespaces/context";
import { createAccessNamespace } from "../namespaces/rbac";

/** `nextly.access.check` over a registry where `posts` refuses suspended users. */
function access() {
  const rbac = new RBACAccessControlService();
  rbac.registerCollectionAccess("posts", {
    read: ({ req }) => !(req.user?.roles ?? []).includes("suspended"),
  });
  return createAccessNamespace({
    rbacAccessControlService: rbac,
  } as unknown as NextlyContext);
}

const updatesSettings = () =>
  access().check({
    userId: "user-1",
    operation: "update",
    resource: "settings",
  });
const readsPosts = () =>
  access().check({ userId: "user-1", operation: "read", resource: "posts" });

beforeEach(() => {
  user.roles = ["editor"];
  user.rolesFail = false;
  user.grantsFail = false;
});

describe("nextly.access.check when it cannot read the user", () => {
  it("answers for a user it can read", async () => {
    // The controls: the grant allows, and the rule reads the roles.
    await expect(updatesSettings()).resolves.toBe(true);
    await expect(readsPosts()).resolves.toBe(true);
    user.roles = ["editor", "suspended"];
    await expect(readsPosts()).resolves.toBe(false);
  });

  it("refuses when the grant lookup fails", async () => {
    user.grantsFail = true;
    await expect(updatesSettings()).resolves.toBe(false);
    await expect(readsPosts()).resolves.toBe(false);
  });

  it("refuses when the role lookup fails, never asking a rule without the roles", async () => {
    // A suspended user whose roles cannot be read is not judged as having
    // none: the rule that would refuse them is never asked with an empty set.
    user.roles = ["editor", "suspended"];
    user.rolesFail = true;
    await expect(readsPosts()).resolves.toBe(false);
    await expect(updatesSettings()).resolves.toBe(false);
  });
});
