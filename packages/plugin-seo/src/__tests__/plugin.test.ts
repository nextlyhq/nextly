import { createRequire } from "node:module";

import { text } from "nextly";
import type { FieldConfig } from "nextly";
import { describe, expect, it } from "vitest";

import { defaultSeoFields } from "../fields";
import { seoPlugin } from "../plugin";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/** The `seo` group the plugin contributes to its first target. */
function seoGroup(plugin: ReturnType<typeof seoPlugin>) {
  const group = plugin.contributes?.extend?.[0]?.fields?.[0];
  if (!group || group.type !== "group") {
    throw new Error("expected the extend payload to be a single seo group");
  }
  return group;
}

function fieldNames(fields: FieldConfig[]): (string | undefined)[] {
  return fields.map(f => ("name" in f ? f.name : undefined));
}

describe("seoPlugin", () => {
  it("returns a plugin definition directly (no unwrapping)", () => {
    const plugin = seoPlugin({ collections: ["pages"] });
    expect(plugin.name).toBe("@nextlyhq/plugin-seo");
    expect(plugin.category).toBe("seo");
    // Version cannot drift from what ships — it is read from package.json.
    expect(plugin.version).toBe(pkg.version);
    // The core-compat field is literally `nextly`.
    expect(typeof plugin.nextly).toBe("string");
  });

  it("extends exactly the named collections with a single seo group", () => {
    const plugin = seoPlugin({ collections: ["pages", "posts"] });
    const extend = plugin.contributes?.extend?.[0];
    expect(extend?.target).toEqual(["pages", "posts"]);
    expect(extend?.fields).toHaveLength(1);
    expect(seoGroup(plugin).name).toBe("seo");
  });

  it("dedupes repeated collection slugs (a dup would double-add seo and throw)", () => {
    const plugin = seoPlugin({ collections: ["pages", "pages", "posts"] });
    expect(plugin.contributes?.extend?.[0]?.target).toEqual(["pages", "posts"]);
  });

  it("ships canonical + noindex in the default fields (edge over other plugins)", () => {
    expect(
      fieldNames(seoGroup(seoPlugin({ collections: ["pages"] })).fields)
    ).toEqual([
      "metaTitle",
      "metaDescription",
      "ogImage",
      "canonical",
      "noindex",
    ]);
  });

  it("nests custom fields under the seo group too", () => {
    const custom = [text({ name: "focusKeyword" })];
    const plugin = seoPlugin({ collections: ["pages"], fields: custom });
    // Custom overrides stay under `seo`, not at the collection's top level.
    expect(seoGroup(plugin).fields).toBe(custom);
  });

  it("serves the sitemap route by default", () => {
    const plugin = seoPlugin({ collections: ["pages"] });
    expect(plugin.contributes?.routes?.[0]).toMatchObject({
      method: "GET",
      path: "/sitemap.xml",
      public: true,
    });
  });

  it("omits the sitemap route when sitemap is disabled", () => {
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });
    // No public enumeration route when the sitemap is turned off.
    expect(plugin.contributes?.routes).toBeUndefined();
    // The SEO fields are still contributed.
    expect(plugin.contributes?.extend?.[0]?.target).toEqual(["pages"]);
  });

  it("rejects a sitemap collection outside the configured collections", () => {
    // A typo'd / non-extended slug would 500 the public route at request time;
    // fail fast at construction instead.
    expect(() =>
      seoPlugin({ collections: ["pages"], sitemap: { collections: ["posts"] } })
    ).toThrow(/subset/i);
  });

  it("rejects a baseUrl that is not an absolute http(s) URL", () => {
    expect(() =>
      seoPlugin({ collections: ["pages"], baseUrl: "example.com" })
    ).toThrow(/absolute http/i);
  });

  it("does not validate baseUrl when the sitemap is disabled", () => {
    // A disabled route never consumes baseUrl, so an env-specific/invalid value
    // must not block boot.
    expect(() =>
      seoPlugin({
        collections: ["pages"],
        sitemap: false,
        baseUrl: "not-a-url",
      })
    ).not.toThrow();
  });

  it("defaultSeoFields returns the inner seo fields", () => {
    expect(fieldNames(defaultSeoFields())).toEqual([
      "metaTitle",
      "metaDescription",
      "ogImage",
      "canonical",
      "noindex",
    ]);
  });
});
