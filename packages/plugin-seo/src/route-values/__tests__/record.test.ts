/**
 * Which page a head's answer keeps its route's values for: a page of a type
 * SEO is added to, in the language it was answered in, the site's default
 * where none; never a later page of the document's own list, another
 * type's page, or an entry with no id.
 */
import type { PageMetadataInput, PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

// Each document's own address, as the site would declare it: a post at
// `/blog/<slug>`, its slug taken whole, so one may end in `/page/2`.
vi.mock("@nextlyhq/plugin-sdk", async original => ({
  ...(await original<typeof import("@nextlyhq/plugin-sdk")>()),
  publicAddressOf: (
    _type: unknown,
    document: Readonly<Record<string, unknown>>
  ) =>
    Promise.resolve({
      status: "resolved",
      path: `/blog/${String(document.slug)}`,
    }),
  languageAddressOf: (path: string, locale: string) =>
    Promise.resolve({ status: "resolved", path: `/${locale}${path}` }),
}));

import { routeValuesPageOf, withRouteValues } from "../record";
import { recordRouteValues, routeValuesKey } from "../store";

// What is recorded, watched rather than written.
vi.mock("../store", async original => ({
  ...(await original<typeof import("../store")>()),
  recordRouteValues: vi.fn(() => Promise.resolve()),
}));

const ctx = {
  publicAddresses: { defaultLanguage: () => Promise.resolve("en") },
} as unknown as PluginContext;

const TYPES = { collections: ["posts"], singles: ["home"] };

const entry = (
  extra: Partial<PageMetadataInput> = {},
  document: Record<string, unknown> = { id: "p1", slug: "news" }
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

  it("keeps nothing for a later page of the document's own list, another type, or no id", async () => {
    expect(
      await routeValuesPageOf(ctx, entry({ path: "/blog/news/page/2" }), TYPES)
    ).toBeUndefined();
    expect(
      await routeValuesPageOf(
        ctx,
        entry({ path: "/de/blog/news/page/3", locale: "de" }),
        TYPES
      )
    ).toBeUndefined();
    expect(
      await routeValuesPageOf(ctx, entry({ path: "/blog/news/page/1" }), TYPES)
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
      await routeValuesPageOf(ctx, entry({}, { slug: "draft" }), TYPES)
    ).toBeUndefined();
  });

  it("keeps a document whose own address ends in a page number as itself", async () => {
    const own = entry(
      { path: "/blog/archive/page/2" },
      {
        id: "p2",
        slug: "archive/page/2",
      }
    );
    expect(await routeValuesPageOf(ctx, own, TYPES)).toEqual({
      type: "posts",
      id: "p2",
      language: "en",
    });
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

describe("recording as the head is answered", () => {
  it("records what the route supplied once the head is answered, and nothing when it is not", async () => {
    const recorded = vi.mocked(recordRouteValues);
    recorded.mockClear();
    const code = { title: "Plans and pricing" };
    const answering = withRouteValues(
      ctx,
      { resolve: () => Promise.resolve({ title: "Plans and pricing" }) },
      TYPES
    );
    expect(await answering.resolve(entry({ code }))).toEqual({
      title: "Plans and pricing",
    });
    expect(recorded).toHaveBeenCalledWith(
      ctx,
      { type: "posts", id: "p1", language: "en" },
      code
    );

    recorded.mockClear();
    const failing = withRouteValues(
      ctx,
      { resolve: () => Promise.reject(new Error("no answer")) },
      TYPES
    );
    await expect(failing.resolve(entry({ code }))).rejects.toThrow("no answer");
    expect(recorded).not.toHaveBeenCalled();
  });
});
