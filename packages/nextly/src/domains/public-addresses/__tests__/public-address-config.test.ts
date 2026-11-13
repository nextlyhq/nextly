/**
 * A public address declared in code is judged where the type is defined, and
 * the configuration as a whole holds no two Singles at one address.
 *
 * A collection's entries each have their own address, so two collections may
 * share a pattern (`/{slug}` for pages and posts alike) and only entries can
 * clash. A Single is one page at one fixed address, so two Singles at the same
 * address are a clash the configuration itself states, and it stops the
 * configuration, naming both.
 */
import { describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { defineConfig } from "../../../collections/config/define-config";
import { number, text } from "../../../collections/fields/helpers";
import { defineSingle } from "../../../singles/config/define-single";
import { publicAddressClashes } from "../distinct-public-addresses";

const posts = (publicAddress?: string) =>
  defineCollection({
    slug: "posts",
    fields: [text({ name: "title" }), text({ name: "slug" })],
    ...(publicAddress === undefined ? {} : { publicAddress }),
  });

const page = (slug: string, publicAddress?: string) =>
  defineSingle({
    slug,
    fields: [text({ name: "headline" })],
    ...(publicAddress === undefined ? {} : { publicAddress }),
  });

describe("a public address declared in code", () => {
  it("is accepted on a collection and on a Single", () => {
    expect(posts("/blog/{slug}").publicAddress).toBe("/blog/{slug}");
    expect(page("home", "/").publicAddress).toBe("/");
  });

  it("is optional: a type without one is not public yet", () => {
    expect(posts().publicAddress).toBeUndefined();
    expect(page("home").publicAddress).toBeUndefined();
  });

  it("refuses a collection address that names no field, at definition", () => {
    expect(() => posts("/blog/{handle}")).toThrow(/publicAddress/);
    expect(() => posts("/blog/{handle}")).toThrow(/"handle" is not a field/);
  });

  it("refuses a collection address every entry would share", () => {
    expect(() => posts("/blog")).toThrow(/at least one placeholder/);
  });

  it("refuses a Single address with a placeholder, at definition", () => {
    expect(() => page("home", "/{headline}")).toThrow(/no placeholder/);
  });

  it("refuses an address the runtime keeps for itself", () => {
    expect(() => posts("/admin/{slug}")).toThrow(
      /kept for the admin, the API or the runtime/
    );
    expect(() => page("map", "/sitemap.xml")).toThrow(
      /kept for the admin, the API or the runtime/
    );
  });
});

describe("two Singles at one address", () => {
  it("stops the configuration, naming both", () => {
    expect(() =>
      defineConfig({ singles: [page("home", "/"), page("landing", "/")] })
    ).toThrow(/Singles "home" and "landing" are both at "\/"/);
  });

  it("is told apart from two addresses that differ", () => {
    expect(() =>
      defineConfig({
        singles: [page("about", "/about"), page("team", "/about/team")],
      })
    ).not.toThrow();
    // Paths are case-sensitive: `/About` is another address.
    expect(() =>
      defineConfig({
        singles: [page("about", "/about"), page("legacy", "/About")],
      })
    ).not.toThrow();
  });

  it("lets two collections share a pattern, since only entries can clash", () => {
    const pages = defineCollection({
      slug: "pages",
      fields: [text({ name: "slug" })],
      publicAddress: "/{slug}",
    });
    expect(() =>
      defineConfig({ collections: [pages, posts("/{slug}")] })
    ).not.toThrow();
  });

  it("is found among Singles a plugin contributes as well as the site's own", () => {
    // The boot judges the configuration once plugins have joined it, through
    // the same function `defineConfig` uses.
    expect(
      publicAddressClashes({
        singles: [page("home", "/"), page("shop-home", "/")],
      })
    ).toEqual([{ address: "/", singles: ["home", "shop-home"] }]);
    expect(
      publicAddressClashes({
        singles: [page("home", "/"), page("shop-home", "/shop")],
      })
    ).toEqual([]);
  });
});

const features = (more: Record<string, unknown> = {}) =>
  defineCollection({
    slug: "features",
    fields: [
      text({ name: "title" }),
      text({ name: "slug" }),
      text({ name: "address" }),
      number({ name: "rank" }),
    ],
    publicAddress: "/features/{slug}",
    publicAddressField: "address",
    ...more,
  });

/** What the address field's own rule answers for `value`. */
async function ruleOn(value: unknown): Promise<unknown> {
  const field = features().fields.find(
    each => "name" in each && each.name === "address"
  ) as { validate?: (value: unknown, ctx: unknown) => unknown } | undefined;
  return field?.validate?.(value, { data: {}, req: {} });
}

describe("an entry's own address, named by a field", () => {
  it("is accepted where it names a text field and the collection has a template", () => {
    expect(features().publicAddressField).toBe("address");
  });

  it("refuses a field the collection doesn't have, one that holds no text, and one with no template", () => {
    expect(() => features({ publicAddressField: "where" })).toThrow(
      /publicAddressField/
    );
    expect(() => features({ publicAddressField: "rank" })).toThrow(
      /publicAddressField/
    );
    expect(() => features({ publicAddress: undefined })).toThrow(
      /publicAddressField/
    );
  });

  it("accepts an address on this site, and an empty value, which leaves the template", async () => {
    for (const value of [
      "/brand-voice",
      "/tools/word-counter",
      "",
      undefined,
    ]) {
      expect(await ruleOn(value), String(value)).toBe(true);
    }
  });

  it.each([
    ["another site's address", "https://other.example/brand-voice"],
    ["an address on another host", "//other.example/brand-voice"],
    ["a relative path", "brand-voice"],
    ["a path with a dot segment", "/features/../admin"],
    ["a path with an empty segment", "/brand//voice"],
    ["a path with a query", "/brand-voice?x=1"],
    ["a path the runtime keeps", "/admin/brand-voice"],
  ])("refuses %s, as a template's result would be", async (_why, value) => {
    expect(await ruleOn(value)).toMatch(/address/);
  });
});
