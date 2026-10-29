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
 * `settings` and `media` are reserved too, and asserted here: their admin
 * routes check `{action, "settings"}` and `{action, "media"}` for the CRUD
 * actions content seeding produces, not only `manage`, so a same-named content
 * type reaches them.
 */
import { describe, it, expect, vi } from "vitest";

import { NextlyError } from "../../../errors";
import {
  SYSTEM_RESOURCES,
  isReservedResourceSlug,
} from "../../../schemas/_zod/rbac";
import { assertGlobalResourceSlugAvailable } from "../resource-slug-guard";

describe("isReservedResourceSlug", () => {
  it("reserves every system resource name", () => {
    // Every system resource has a route enforcing a create/read/update/delete
    // action that content seeding produces, so a same-named content type would
    // mint a colliding permission row. `settings` and `media` are included:
    // the user-fields/component routes accept `{action, "settings"}` and the
    // media routes `{action, "media"}`, not only `manage`.
    for (const slug of SYSTEM_RESOURCES) {
      expect(isReservedResourceSlug(slug)).toBe(true);
    }
  });

  it("does not reserve an ordinary content slug", () => {
    expect(isReservedResourceSlug("posts")).toBe(false);
    expect(isReservedResourceSlug("products")).toBe(false);
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
    // The addresses already used, listed to refuse one with the same
    // snake_case form. None, unless a test seeds them.
    select: vi.fn(async () => []),
  } as never;
}

/** Adapter where no resource owns the slug, and `used` lists each registry's rows. */
function adapterUsing(used: {
  dynamic_collections?: Array<{ id: string; slug: string }>;
  dynamic_singles?: Array<{ id: string; slug: string }>;
}) {
  return {
    selectOne: vi.fn(async () => null),
    select: vi.fn(async (table: keyof typeof used) => used[table] ?? []),
  } as never;
}

describe("assertGlobalResourceSlugAvailable and the snake_case form", () => {
  it("refuses a new slug whose snake_case form a Single's slug has, naming both", async () => {
    await expect(
      assertGlobalResourceSlugAvailable(
        adapterUsing({ dynamic_singles: [{ id: "s1", slug: "team-updates" }] }),
        "team_updates",
        { addressKind: "collection" }
      )
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          {
            code: "SLUG_SAME_SNAKE_CASE",
            message: expect.stringMatching(
              /^Collection address 'team_updates'.*single 'team-updates'/
            ),
          },
        ],
      },
    });
  });

  it("names the address alone when the caller does not say its kind", async () => {
    await expect(
      assertGlobalResourceSlugAvailable(
        adapterUsing({ dynamic_singles: [{ id: "s1", slug: "team-updates" }] }),
        "team_updates"
      )
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          {
            message: expect.stringMatching(
              /^The address 'team_updates'.*single 'team-updates'/
            ),
          },
        ],
      },
    });
  });

  it("lets a resource be renamed to a slug of its own snake_case form", async () => {
    await expect(
      assertGlobalResourceSlugAvailable(
        adapterUsing({
          dynamic_collections: [{ id: "c1", slug: "team_updates" }],
        }),
        "team-updates",
        { currentResourceType: "collection", currentResourceId: "c1" }
      )
    ).resolves.toBeUndefined();
  });

  it("leaves an address a resource already holds alone, whatever its neighbours", async () => {
    // The slug's own row answers the owner lookup, so the address is not new and is not judged.
    const adapter = {
      selectOne: vi.fn(async () => ({ id: "c1" })),
      select: vi.fn(async () => [{ id: "s1", slug: "team-updates" }]),
    } as never;
    await expect(
      assertGlobalResourceSlugAvailable(adapter, "team_updates", {
        currentResourceType: "collection",
        currentResourceId: "c1",
      })
    ).resolves.toBeUndefined();
  });
});

describe("assertGlobalResourceSlugAvailable", () => {
  it("rejects a reserved name even when no resource holds it", async () => {
    // A system resource is not a dynamic collection or single, so uniqueness
    // alone would treat the name as free.
    const adapter = adapterReturning(null);
    await expect(
      assertGlobalResourceSlugAvailable(adapter, "webhooks")
    ).rejects.toThrow(NextlyError);
  });

  it("rejects settings and media, which collide via their CRUD routes", async () => {
    for (const slug of ["settings", "media"]) {
      await expect(
        assertGlobalResourceSlugAvailable(adapterReturning(null), slug)
      ).rejects.toThrow(NextlyError);
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

  it("judges a rename to a new address by the whole rule", async () => {
    // The new slug is free (no row holds it), so the address is new and changed.
    for (const [kind, slug, code] of [
      ["collection", "admin", "SLUG_RESERVED"],
      ["collection", "select", "SLUG_SQL_KEYWORD"],
      ["single", "a".repeat(49), "SLUG_TOO_LONG"],
    ] as const) {
      await expect(
        assertGlobalResourceSlugAvailable(adapterUsing({}), slug, {
          currentResourceType: kind,
          currentResourceId: "r1",
        }),
        slug
      ).rejects.toMatchObject({ publicData: { errors: [{ code }] } });
    }
  });

  it("leaves a create to the road that judged it", async () => {
    // A registration with no resource being renamed is a create its road has already judged,
    // a start among them, which may keep an existing entity's address.
    await expect(
      assertGlobalResourceSlugAvailable(adapterUsing({}), "cascade")
    ).resolves.toBeUndefined();
  });
});
