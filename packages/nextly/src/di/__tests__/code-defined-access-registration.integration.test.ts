/**
 * Code-defined `access` blocks reach the RBAC registry whatever else the config
 * contains.
 *
 * `checkAccess` resolves them from an in-memory registry, and a slug missing
 * from it falls through to the caller's stored permissions. That is the
 * dangerous direction: an unregistered rule does not fail closed, it stops
 * applying — so a `read: () => false` written to restrict a Single silently
 * stops restricting.
 *
 * The case that matters is a config with NO code-first collections, because the
 * collection sync returns early for it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

function registeredAccess(t: TestNextly, slug: string): unknown {
  const rbac = t.getService(
    "rbacAccessControlService"
  ) as RBACAccessControlService;
  return rbac.getRegisteredAccess(slug);
}

describe("code-defined access registration (integration)", () => {
  it("registers a Single's access when the config has no collections", async () => {
    // The regression: this registration used to live inside the code-first
    // COLLECTION sync, which returns early when there are none — so a
    // Singles-only app never registered any of its rules.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          access: { read: () => true, update: () => false },
          fields: [text({ name: "siteName" })],
        }),
      ],
    });

    const access = registeredAccess(current, "preferences") as
      | { read?: unknown; update?: unknown }
      | undefined;
    expect(access).toBeDefined();
    expect(typeof access?.read).toBe("function");
    expect(typeof access?.update).toBe("function");
  });

  it("applies that Single's rule rather than falling through to stored permissions", async () => {
    // Registration is the mechanism; this is the consequence, and it is the half
    // worth pinning. A user with no stored grants is REFUSED by the rule, and a
    // rule that never registered would let `hasPermission` answer instead.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "preferences",
          access: { read: () => false },
          fields: [text({ name: "siteName" })],
        }),
        defineSingle({
          slug: "public-notes",
          access: { read: () => true },
          fields: [text({ name: "body" })],
        }),
      ],
    });
    const rbac = current.getService(
      "rbacAccessControlService"
    ) as RBACAccessControlService;

    // The positive control: the permissive rule is reached and answers true for
    // the same user, so a blanket denial cannot explain the refusal below.
    await expect(
      rbac.checkAccess({
        userId: "user-1",
        operation: "read",
        resource: "public-notes",
      })
    ).resolves.toBe(true);

    await expect(
      rbac.checkAccess({
        userId: "user-1",
        operation: "read",
        resource: "preferences",
      })
    ).resolves.toBe(false);
  });

  it("still registers collection access when collections are present", async () => {
    // The path that always worked, kept so the extraction cannot quietly drop it.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          access: { read: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
      singles: [
        defineSingle({
          slug: "preferences",
          access: { read: () => true },
          fields: [text({ name: "siteName" })],
        }),
      ],
    });

    expect(registeredAccess(current, "posts")).toBeDefined();
    expect(registeredAccess(current, "preferences")).toBeDefined();
  });
});
