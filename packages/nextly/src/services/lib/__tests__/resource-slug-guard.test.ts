/**
 * The global slug guard rejects names that would collide with a system
 * resource's permissions, at the boundary every collection and single
 * create/rename passes through.
 *
 * The collision is real: permission identity is `action-resource`, so a content
 * type named `webhooks` seeds `read-webhooks` / `update-webhooks` — the exact
 * rows the webhook endpoint routes check. A role granted the content type's
 * permission would reach the system surface.
 *
 * `settings` and `media` are deliberately NOT reserved and are asserted here so
 * a future edit cannot quietly re-break the common `settings` single: the
 * settings surface is gated on `manage`, which content seeding never produces.
 */
import { describe, it, expect, vi } from "vitest";

import { NextlyError } from "../../../errors";
import {
  RESERVED_RESOURCE_SLUGS,
  isReservedResourceSlug,
} from "../../../schemas/_zod/rbac";
import { assertGlobalResourceSlugAvailable } from "../resource-slug-guard";

describe("RESERVED_RESOURCE_SLUGS", () => {
  it("reserves every system resource whose routes enforce CRUD actions", () => {
    for (const slug of [
      "webhooks",
      "api-keys",
      "email-providers",
      "email-templates",
      "users",
      "roles",
      "permissions",
    ]) {
      expect(isReservedResourceSlug(slug)).toBe(true);
    }
  });

  it("does not reserve settings or media, which stay usable as content", () => {
    expect(isReservedResourceSlug("settings")).toBe(false);
    expect(isReservedResourceSlug("media")).toBe(false);
    expect(RESERVED_RESOURCE_SLUGS).not.toContain("settings");
    expect(RESERVED_RESOURCE_SLUGS).not.toContain("media");
  });

  it("does not reserve an ordinary content slug", () => {
    expect(isReservedResourceSlug("posts")).toBe(false);
  });
});

/** Adapter whose slug lookups return whatever the test seeds. */
function adapterReturning(owner: { id: string } | null) {
  return {
    // findSlugOwner queries dynamic_collections first, then dynamic_singles.
    // Returning the owner for collections and null for singles is enough.
    selectOne: vi
      .fn()
      .mockImplementationOnce(async () => owner)
      .mockImplementationOnce(async () => null),
  } as never;
}

describe("assertGlobalResourceSlugAvailable", () => {
  it("rejects a reserved name even when no resource holds it", async () => {
    // A system resource is not a dynamic collection or single, so uniqueness
    // alone would treat the name as free.
    const adapter = adapterReturning(null);
    await expect(
      assertGlobalResourceSlugAvailable(adapter, "webhooks")
    ).rejects.toThrow(NextlyError);
  });

  it("allows settings and media", async () => {
    for (const slug of ["settings", "media"]) {
      await expect(
        assertGlobalResourceSlugAvailable(adapterReturning(null), slug)
      ).resolves.toBeUndefined();
    }
  });

  it("allows an ordinary free slug", async () => {
    await expect(
      assertGlobalResourceSlugAvailable(adapterReturning(null), "posts")
    ).resolves.toBeUndefined();
  });

  it("still rejects a name another resource already holds", async () => {
    const adapter = adapterReturning({ id: "c1" });
    await expect(
      assertGlobalResourceSlugAvailable(adapter, "posts")
    ).rejects.toThrow(NextlyError);
  });

  it("lets a resource keep a reserved slug it somehow already holds", async () => {
    // Grandfathering: a collection created before the name became reserved must
    // still be editable. Rejecting a no-op save would strand it.
    const adapter = adapterReturning({ id: "c1" });
    await expect(
      assertGlobalResourceSlugAvailable(adapter, "webhooks", {
        currentResourceType: "collection",
        currentResourceId: "c1",
      })
    ).resolves.toBeUndefined();
  });
});
