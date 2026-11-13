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
import { consoleLogger } from "../../../shared/types";
import { FieldGroupMetadataService } from "../../field-groups/services/field-group-metadata-service";
import type { FieldGroupRegistryService } from "../../field-groups/services/field-group-registry-service";
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

/** The Singles the registry holds, with the tables each stores in. */
let singles: Array<{ slug: string; tableName: string }> = [];
const singleRegistry = { getAllSingles: vi.fn(async () => singles) };

const deps: AddressCheckDeps = { adapter, fieldGroups, singleRegistry };

const check = (
  kind: UsedAddress["kind"],
  address: string,
  pendingCreates: UsedAddress[] = []
) => checkNewAddress(deps, { kind, address, pendingCreates });

beforeEach(() => {
  registered = {};
  singles = [];
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

describe("a Single's address whose tables another Single holds", () => {
  // A Single stores in its table and the `_locales` companion beside it, so a
  // Single `foo-locales` (table `single_foo_locales`) already holds the
  // companion a new Single `foo` would need.
  it("is used, as the Single create refuses it", async () => {
    singles = [{ slug: "foo-locales", tableName: "single_foo_locales" }];
    expect(await check("single", "foo")).toEqual({
      code: "DUPLICATE",
      message: "Resource already exists.",
    });
  });

  it("is free when no Single's tables meet the new one's", async () => {
    singles = [{ slug: "about", tableName: "single_about" }];
    expect(await check("single", "foo")).toBeNull();
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

describe("the field-group create's address check", () => {
  /** The field groups the registry holds, with the table each was recorded with. */
  function serviceOver(held: Array<{ slug: string; tableName: string }>) {
    const registry = { getAllComponents: vi.fn(async () => held) };
    const service = new FieldGroupMetadataService(
      registry as unknown as FieldGroupRegistryService,
      consoleLogger
    );
    return { service, registry };
  }

  const refusalOf = async (run: Promise<void>) => {
    try {
      await run;
      return null;
    } catch (error) {
      const e = error as {
        code?: string;
        publicData?: { errors?: { code: string }[] };
      };
      return e.publicData?.errors?.[0]?.code ?? e.code;
    }
  };

  // Asked as an address is typed, so the field groups are read once per check.
  it("reads the field groups once", async () => {
    const { service, registry } = serviceOver([
      { slug: "seo", tableName: "comp_seo" },
    ]);
    await service.assertNewAddressAvailable("hero", "comp_hero");
    expect(registry.getAllComponents).toHaveBeenCalledTimes(1);
  });

  // The create's refusals, in the create's order: the rule before anything is
  // read, then a twin, then an address held, then a table owned.
  it("judges by the rule before reading anything", async () => {
    const { service, registry } = serviceOver([]);
    expect(
      await refusalOf(service.assertNewAddressAvailable("Hero", "comp_hero"))
    ).toBe("SLUG_INVALID_FORMAT");
    expect(registry.getAllComponents).not.toHaveBeenCalled();
  });

  it("refuses a twin before the table it shares", async () => {
    const { service } = serviceOver([
      { slug: "hero_banner", tableName: "comp_hero_banner" },
    ]);
    expect(
      await refusalOf(
        service.assertNewAddressAvailable("hero-banner", "comp_hero_banner")
      )
    ).toBe("SLUG_SAME_SNAKE_CASE");
  });

  it("refuses an address held under a custom table name", async () => {
    const { service } = serviceOver([
      { slug: "seo", tableName: "my_seo_block" },
    ]);
    expect(
      await refusalOf(service.assertNewAddressAvailable("seo", "comp_seo"))
    ).toBe("DUPLICATE");
  });

  it("refuses a table another field group owns", async () => {
    const { service } = serviceOver([
      { slug: "other", tableName: "comp_hero" },
    ]);
    expect(
      await refusalOf(service.assertNewAddressAvailable("hero", "comp_hero"))
    ).toBe("DUPLICATE");
  });

  it("accepts an address and table no field group holds", async () => {
    const { service } = serviceOver([{ slug: "seo", tableName: "comp_seo" }]);
    expect(
      await refusalOf(service.assertNewAddressAvailable("hero", "comp_hero"))
    ).toBeNull();
  });
});
