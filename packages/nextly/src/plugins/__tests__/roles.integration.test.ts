/**
 * C3 / D67 — plugin-contributed role bundles, end-to-end.
 *
 * A plugin declares a custom permission + a role bundling it; after
 * `seedPermissionsAndRolePresets()` (which the boot runs: permissions, then roles), the role exists in
 * the DB with the resolved permission, and re-seeding is idempotent.
 *
 * The harness doesn't run the boot's seeding, so the test invokes it explicitly.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { ServiceContainer } from "../../services/index";
import { seedPermissionsAndRolePresets } from "../../init/seed-permissions";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const rolePlugin = () =>
  definePlugin({
    name: "@test/roles",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      permissions: [{ action: "approve", resource: "posts" }],
      roles: [
        {
          slug: "post-reviewer",
          name: "Post Reviewer",
          permissionSlugs: ["approve-posts"],
        },
      ],
    },
  });

describe("plugin role bundles", () => {
  it("seeds a contributed role with its resolved permission", async () => {
    current = await createTestNextly({ plugins: [rolePlugin()] });
    await seedPermissionsAndRolePresets();

    const c = new ServiceContainer(
      current.adapter as unknown as DrizzleAdapter
    );
    const role = await c.roles.findRoleIdBySlug("post-reviewer");
    expect(role).not.toBeNull();

    const perms = await c.rolePermissions.listRolePermissions(role!.id);
    expect(perms).toContainEqual(
      expect.objectContaining({ action: "approve", resource: "posts" })
    );
  });

  it("is idempotent across re-seed (no duplicate, no throw)", async () => {
    current = await createTestNextly({ plugins: [rolePlugin()] });
    await seedPermissionsAndRolePresets();
    await seedPermissionsAndRolePresets();

    const c = new ServiceContainer(
      current.adapter as unknown as DrizzleAdapter
    );
    const role = await c.roles.findRoleIdBySlug("post-reviewer");
    expect(role).not.toBeNull();
  });
});
