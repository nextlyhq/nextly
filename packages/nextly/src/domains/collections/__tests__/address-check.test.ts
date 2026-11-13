/**
 * The address check answers what the create of that kind would answer, before the create.
 *
 * The registries are a stub here, holding the addresses each case names; the agreement with the
 * real creates on every dialect is `address-rule-agreement.integration.test.ts`. What this file
 * pins is what only the check does: the entities created in the editor but not saved yet count
 * as used, and a refusal comes back as the create's own code and public message.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { judgeAddress, type UsedAddress } from "../../../shared/address-rule";
import { checkNewAddress, type AddressCheckDeps } from "../address-check";

/** The addresses each registry table holds. */
let registered: Record<string, string[]> = {};

const slugIn = (where: unknown): string | undefined =>
  (where as { and?: { value?: unknown }[] }).and?.[0]?.value as
    | string
    | undefined;

const adapter = {
  // The exact lookup the creates make: the row whose slug is the address.
  selectOne: vi.fn(async (table: string, query: { where: unknown }) =>
    (registered[table] ?? []).includes(slugIn(query.where) ?? "")
      ? { id: `${table}:${slugIn(query.where)}` }
      : null
  ),
  // The neighbours the snake_case comparison reads; the rule decides among them.
  select: vi.fn(async (table: string) =>
    (registered[table] ?? []).map(slug => ({ id: `${table}:${slug}`, slug }))
  ),
} as unknown as DrizzleAdapter;

const fieldGroups = { assertNewAddressAvailable: vi.fn(async () => {}) };

const deps: AddressCheckDeps = { adapter, fieldGroups };

const check = (
  kind: UsedAddress["kind"],
  address: string,
  pendingCreates: UsedAddress[] = []
) => checkNewAddress(deps, { kind, address, pendingCreates });

beforeEach(() => {
  registered = {};
  vi.clearAllMocks();
  fieldGroups.assertNewAddressAvailable.mockImplementation(async () => {});
});

describe("an address the rule refuses", () => {
  it.each([
    ["collection", "Posts"],
    ["collection", "1posts"],
    ["single", "select"],
    ["collection", "a".repeat(51)],
    ["single", ""],
  ] as const)(
    "a %s's '%s' gets the rule's code and message",
    async (kind, address) => {
      const rule = judgeAddress(kind, address);
      expect(rule).not.toBeNull();
      expect(await check(kind, address)).toEqual({
        code: rule?.code,
        message: rule?.message,
      });
    }
  );
});

describe("an address a saved entity holds", () => {
  it("is used, with the create's generic answer that names no entity", async () => {
    registered = { dynamic_singles: ["home"] };
    expect(await check("collection", "home")).toEqual({
      code: "DUPLICATE",
      message: "Resource already exists.",
    });
  });

  it("is refused for a twin, as the create refuses it", async () => {
    registered = { dynamic_collections: ["blog_posts"] };
    const refusal = await check("single", "blog-posts");
    expect(refusal?.code).toBe("SLUG_SAME_SNAKE_CASE");
    expect(refusal?.message).toMatch(/'blog-posts'.*collection 'blog_posts'/);
  });

  it("accepts one no entity holds", async () => {
    registered = { dynamic_collections: ["posts"] };
    expect(await check("collection", "articles")).toBeNull();
  });
});

describe("an address an unsaved entity holds", () => {
  it("is used when an unsaved collection or Single holds it exactly", async () => {
    expect(
      await check("single", "about", [{ kind: "collection", address: "about" }])
    ).toEqual({ code: "DUPLICATE", message: "Resource already exists." });
  });

  it("is free for a field group when only an unsaved collection holds it", async () => {
    expect(
      await check("fieldGroup", "seo", [{ kind: "collection", address: "seo" }])
    ).toBeNull();
  });

  it("is used when an unsaved field group holds it, for another field group", async () => {
    expect(
      await check("fieldGroup", "seo", [{ kind: "fieldGroup", address: "seo" }])
    ).toEqual({ code: "DUPLICATE", message: "Resource already exists." });
  });

  it("refuses a hyphenated address whose snake_case form an unsaved entity holds", async () => {
    const refusal = await check("collection", "blog-posts", [
      { kind: "collection", address: "blog_posts" },
    ]);
    expect(refusal?.code).toBe("SLUG_SAME_SNAKE_CASE");
    expect(refusal?.message).toMatch(/'blog-posts'.*'blog_posts'/);
  });

  it("puts the rule's refusal first, as the create does", async () => {
    expect(
      await check("collection", "select", [
        { kind: "collection", address: "select" },
      ])
    ).toEqual({
      code: judgeAddress("collection", "select")?.code,
      message: judgeAddress("collection", "select")?.message,
    });
  });
});

describe("a field group's address", () => {
  it("is judged by the field-group service's own check, with the table the create derives", async () => {
    await check("fieldGroup", "hero-banner");
    expect(fieldGroups.assertNewAddressAvailable).toHaveBeenCalledWith(
      "hero-banner",
      "comp_hero_banner"
    );
  });

  it("answers the service's refusal as the create would", async () => {
    fieldGroups.assertNewAddressAvailable.mockRejectedValue(
      NextlyError.duplicate()
    );
    expect(await check("fieldGroup", "hero")).toEqual({
      code: "DUPLICATE",
      message: "Resource already exists.",
    });
  });
});

describe("a failure that is not a refusal", () => {
  it("is thrown, not answered as a verdict on the address", async () => {
    const down = new Error("connection lost");
    vi.mocked(adapter.selectOne).mockRejectedValueOnce(down);
    await expect(check("collection", "posts")).rejects.toBe(down);
  });
});
