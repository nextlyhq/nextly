/**
 * B3 / T1 — secure-by-default proven end-to-end on the WRITE path through
 * `ctx.services.collections` (the plugin-facing, ServiceOpts-wrapped facade).
 *
 * `service-d56.integration.test.ts` already proves RBAC denial on the READ/count
 * path (a permission-less `{as:'user'}` is FORBIDDEN, `{as:'system'}` elevates).
 * This file closes the remaining gap: the CREATE path — a permission-less user is
 * denied, `{as:'system'}` succeeds, AND a plugin-registered `beforeCreate` hook
 * still fires under elevation (validation/hooks are not skipped by `as:'system'`).
 *
 * A plugin contributes the collection's permission and the hook, so this also
 * exercises the declare→seed→enforce chain end-to-end.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const posts = () =>
  defineCollection({
    slug: "posts",
    fields: [text({ name: "title" })],
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Services = any;

describe("secure-by-default write path (B3/T1, D35)", () => {
  it("denies a permission-less user, elevates with {as:'system'}, still runs beforeCreate", async () => {
    let services: Services;
    const beforeCreate = { fired: 0 };

    const probe = definePlugin({
      name: "@test/rbac-write",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        // Declared custom permission — exercises the declare→seed path.
        permissions: [{ action: "publish", resource: "posts" }],
      },
      init: ctx => {
        services = ctx.services;
        ctx.hooks.on(
          "beforeCreate",
          "posts",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (context: any) => {
            beforeCreate.fired += 1;
            return context.data;
          }
        );
      },
    });

    current = await createTestNextly({
      collections: [posts()],
      plugins: [probe],
    });

    // 1) As a permission-less user → secure-by-default DENIAL on the write.
    await expect(
      services.collections.createEntry(
        "posts",
        { title: "x" },
        { as: "user", user: { id: "u1", email: "u@x.com" } }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // RBAC denies BEFORE any execution — the hook never ran on the denied write.
    expect(beforeCreate.fired).toBe(0);

    // 2) As system → succeeds, AND the beforeCreate hook still fired (elevation
    //    bypasses RBAC, NOT validation/hooks).
    const created = await services.collections.createEntry(
      "posts",
      { title: "y" },
      { as: "system" }
    );
    expect(created).toBeTruthy();
    expect((created as { title?: string }).title).toBe("y");
    expect(beforeCreate.fired).toBeGreaterThanOrEqual(1);
  });
});
