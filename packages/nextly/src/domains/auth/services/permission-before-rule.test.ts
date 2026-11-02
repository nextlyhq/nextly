/**
 * A signed-in user needs the permission first; a code rule can only narrow it.
 *
 * `nextly.access.check` asks the one access decision, as the entity readers,
 * relationship population and release checks do. Where a target declares a
 * rule for the action, that rule used to decide alone, whatever the user's
 * permissions: a rule of `true` let in a user the role screen kept out. Now
 * the permission is asked first and a rule that answers `true` only lets
 * through a user who holds it.
 *
 * The notice naming such a newly refused user once is the gates' to give, and
 * `auth/access/gate-adapters.test.ts` pins it there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ holds: true }));

vi.mock("../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../services/lib/permissions")
  >()),
  isSuperAdmin: vi.fn(async () => false),
  isSuperAdminOrRefuse: vi.fn(async () => false),
  isSuperAdminOrThrow: vi.fn(async () => false),
  listRoleSlugsForUser: vi.fn(async () => ["editor"]),
  // The user holds `read-posts` exactly when a case says so, by every lookup
  // the check can make.
  listEffectiveGrants: vi.fn(async () =>
    access.holds
      ? [{ slug: "read-posts", action: "read", resource: "posts" }]
      : []
  ),
  hasPermission: vi.fn(
    async (_userId: string, action: string, resource: string) =>
      access.holds && action === "read" && resource === "posts"
  ),
  listEffectivePermissions: vi.fn(async () => []),
}));

import type { NextlyContext } from "../../../direct-api/namespaces/context";
import { createAccessNamespace } from "../../../direct-api/namespaces/rbac";

import { RBACAccessControlService } from "./rbac-access-control-service";

/** `nextly.access.check`'s read of `posts`, where `posts` declares `read`. */
function read(rule: boolean | (() => boolean)) {
  const rbac = new RBACAccessControlService();
  rbac.registerCollectionAccess("posts", { read: rule });
  return createAccessNamespace({
    rbacAccessControlService: rbac,
  } as unknown as NextlyContext).check({
    userId: "u1",
    operation: "read",
    resource: "posts",
  });
}

beforeEach(() => {
  access.holds = true;
});

describe("a signed-in user's check where the target declares a rule", () => {
  it("refuses a user without the permission, even where the rule says true", async () => {
    access.holds = false;
    const rule = vi.fn(() => true);
    await expect(read(rule)).resolves.toBe(false);
    // Refused before the rule is asked, as the decision refuses.
    expect(rule).not.toHaveBeenCalled();
    await expect(read(true)).resolves.toBe(false);
  });

  it("lets the rule narrow a user who holds the permission", async () => {
    // The controls: with the permission, the rule decides.
    await expect(read(() => true)).resolves.toBe(true);
    await expect(read(() => false)).resolves.toBe(false);
    await expect(read(true)).resolves.toBe(true);
  });
});
