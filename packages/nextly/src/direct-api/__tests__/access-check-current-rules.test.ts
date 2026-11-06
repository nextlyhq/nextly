/**
 * `nextly.access.check` asks the rules registered now, on the service it is
 * handed, not rules an earlier configuration registered in the same process.
 *
 * A reload replaces the access-control service. A rule the new configuration
 * no longer declares must stop applying, so a check after it answers as the
 * route gates do, by the permission alone.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../services/lib/permissions")>()),
  listRoleSlugsForUser: vi.fn(async () => ["editor"]),
  listEffectiveGrants: vi.fn(async () => [
    { slug: "read-posts", action: "read", resource: "posts" },
  ]),
  hasPermission: vi.fn(
    async (_userId: string, action: string, resource: string) =>
      action === "read" && resource === "posts"
  ),
  isSuperAdmin: vi.fn(async () => false),
  isSuperAdminOrRefuse: vi.fn(async () => false),
  isSuperAdminOrThrow: vi.fn(async () => false),
}));

import { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import type { NextlyContext } from "../namespaces/context";
import { createAccessNamespace } from "../namespaces/rbac";

const readsPosts = (rbac: RBACAccessControlService) =>
  createAccessNamespace({
    rbacAccessControlService: rbac,
  } as unknown as NextlyContext).check({
    userId: "user-1",
    operation: "read",
    resource: "posts",
  });

describe("nextly.access.check across a reload", () => {
  it("stops applying a rule the current configuration no longer declares", async () => {
    // The earlier configuration's service, whose rule refuses every read.
    const before = new RBACAccessControlService();
    before.registerCollectionAccess("posts", { read: () => false });
    // The control: while it is current, the rule applies.
    await expect(readsPosts(before)).resolves.toBe(false);

    // The current configuration declares no rule for posts, so the
    // permission alone answers, and this user holds it.
    const now = new RBACAccessControlService();
    await expect(readsPosts(now)).resolves.toBe(true);
  });
});
