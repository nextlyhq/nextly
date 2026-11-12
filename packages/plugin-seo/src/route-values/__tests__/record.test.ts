/**
 * Which page a head's answer keeps its route's values for: a page of a type
 * SEO is added to, in the language it was answered in, the site's default
 * where none; never a later page of a list, another type's page, or an
 * entry with no id.
 */
import type { PageMetadataInput, PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { routeValuesPageOf } from "../record";
import { routeValuesKey } from "../store";

const ctx = {
  publicAddresses: { defaultLanguage: () => Promise.resolve("en") },
} as unknown as PluginContext;

const TYPES = { collections: ["posts"], singles: ["home"] };

const entry = (
  extra: Partial<PageMetadataInput> = {},
  document: Record<string, unknown> = { id: "p1", title: "Pricing" }
): PageMetadataInput => ({
  source: { kind: "entry", collection: "posts", entry: document },
  code: {},
  derived: {},
  ...extra,
});

describe("the page a route's values are kept for", () => {
  it("names an entry by its id, in the default language where none is read", async () => {
    expect(await routeValuesPageOf(ctx, entry(), TYPES)).toEqual({
      type: "posts",
      id: "p1",
      language: "en",
    });
    expect(
      await routeValuesPageOf(ctx, entry({ locale: "de" }), TYPES)
    ).toEqual({ type: "posts", id: "p1", language: "de" });
  });

  it("names a Single by its key alone, its one page", async () => {
    const input: PageMetadataInput = {
      source: { kind: "single", slug: "home", document: { id: "s1" } },
      code: {},
      derived: {},
    };
    expect(await routeValuesPageOf(ctx, input, TYPES)).toEqual({
      type: "single:home",
      id: "",
      language: "en",
    });
  });

  it("keeps nothing for a later page of a list, another type, or no id", async () => {
    expect(
      await routeValuesPageOf(ctx, entry({ path: "/blog/page/2" }), TYPES)
    ).toBeUndefined();
    expect(
      await routeValuesPageOf(ctx, entry({ path: "/blog/page/1" }), TYPES)
    ).toEqual({ type: "posts", id: "p1", language: "en" });
    expect(
      await routeValuesPageOf(
        ctx,
        {
          source: { kind: "entry", collection: "notes", entry: { id: "n1" } },
          code: {},
          derived: {},
        },
        TYPES
      )
    ).toBeUndefined();
    expect(
      await routeValuesPageOf(ctx, entry({}, { title: "Draft" }), TYPES)
    ).toBeUndefined();
  });
});

describe("the key a page's values are kept under", () => {
  it("tells pages, types and languages apart, and a Single's ids alike", () => {
    const key = routeValuesKey({ type: "posts", id: "p1", language: "en" });
    expect(
      routeValuesKey({ type: "posts", id: "p2", language: "en" })
    ).not.toBe(key);
    expect(
      routeValuesKey({ type: "posts", id: "p1", language: "de" })
    ).not.toBe(key);
    expect(
      routeValuesKey({ type: "pages", id: "p1", language: "en" })
    ).not.toBe(key);
    expect(
      routeValuesKey({ type: "single:home", id: "s1", language: "en" })
    ).toBe(routeValuesKey({ type: "single:home", id: "", language: "en" }));
  });
});
