import { createRequire } from "node:module";

import { select, text } from "nextly";
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
      "socialTitle",
      "socialDescription",
      "ogImage",
      "canonical",
      "canonicalElsewhere",
      "noindex",
      "structuredDataType",
    ]);
  });

  it("nests custom fields under the seo group too", () => {
    const custom = [text({ name: "focusKeyword" })];
    const plugin = seoPlugin({ collections: ["pages"], fields: custom });
    // Custom overrides stay under `seo`, not at the collection's top level.
    expect(seoGroup(plugin).fields).toBe(custom);
  });

  it("serves the sitemap and robots.txt at the site root by default, and the sitemap at its old address too", () => {
    const routes = seoPlugin({ collections: ["pages"] }).contributes?.routes;
    expect(
      routes?.map(route => [
        route.method,
        route.path,
        route.mount,
        route.public,
      ])
    ).toEqual([
      ["GET", "/sitemap.xml", "root", true],
      ["GET", "/robots.txt", "root", true],
      ["GET", "/sitemap.xml", undefined, true],
      ["POST", "/share-image", undefined, undefined],
      ["POST", "/resolve", undefined, undefined],
    ]);
  });

  it("offers making a share image to a person who may add to the media library", () => {
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });
    const route = plugin.contributes?.routes?.find(
      ({ path }) => path === "/share-image"
    );
    expect(route).toMatchObject({
      method: "POST",
      requiredPermission: "create-media",
    });
    expect(route?.public).toBeUndefined();
  });

  it("omits the sitemap routes when sitemap is disabled, and keeps robots.txt", () => {
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });
    expect(plugin.contributes?.routes?.map(route => route.path)).toEqual([
      "/robots.txt",
      "/share-image",
      "/resolve",
    ]);
    // The SEO fields are still contributed.
    expect(plugin.contributes?.extend?.[0]?.target).toEqual(["pages"]);
  });

  it("serves neither file with both turned off", () => {
    const plugin = seoPlugin({
      collections: ["pages"],
      sitemap: false,
      robots: false,
    });
    expect(plugin.contributes?.routes?.map(route => route.path)).toEqual([
      "/share-image",
      "/resolve",
    ]);
  });

  it("rejects a sitemap file size smaller than an empty file", () => {
    expect(() =>
      seoPlugin({ collections: ["pages"], sitemap: { maxBytesPerFile: 100 } })
    ).toThrow(/maxBytesPerFile must be at least/);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects a sitemap file size of %s",
    value => {
      expect(() =>
        seoPlugin({
          collections: ["pages"],
          sitemap: { maxUrlsPerFile: value },
        })
      ).toThrow(/maxUrlsPerFile must be a positive whole number/);
      expect(() =>
        seoPlugin({
          collections: ["pages"],
          sitemap: { maxBytesPerFile: value },
        })
      ).toThrow(/maxBytesPerFile must be a positive whole number/);
    }
  );

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
      "socialTitle",
      "socialDescription",
      "ogImage",
      "canonical",
      "canonicalElsewhere",
      "noindex",
      "structuredDataType",
    ]);
  });
});

describe("the dashboard card the plugin contributes", () => {
  it("declares seo/issues and its Needs attention lines through contributes.dashboard", () => {
    const plugin = seoPlugin({
      collections: ["pages", "posts"],
      sitemap: false,
    });
    const dashboard = plugin.contributes?.dashboard;

    expect(dashboard?.widgets?.map(widget => widget.id)).toEqual([
      "seo/issues",
    ]);
    // A line per collection it extends, which carry the `seo` group.
    expect(dashboard?.attention?.map(item => item.id)).toEqual([
      "seo/issues-pages",
      "seo/issues-posts",
    ]);
    expect(dashboard?.attention?.map(item => item.collections)).toEqual([
      ["pages"],
      ["posts"],
    ]);
  });

  it("contributes nothing through the removed widget doors", () => {
    // The card is a declaration and nothing else: no stats card under
    // `admin.widgets`, and no data source under `widgetSources`.
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });

    // Its admin contributions are the SEO tab alone.
    expect(plugin.contributes?.admin).toEqual({
      contributions: [expect.objectContaining({ kind: "tab" })],
    });
    // Read as a property of the value: `widgetSources` is no field of the
    // contributions type, so a typed read of it does not compile.
    expect(plugin.contributes).toBeDefined();
    expect(plugin.contributes).not.toHaveProperty("widgetSources");
  });

  it("is withheld when no collection carries the fields", () => {
    // 🔴 A plugin registered with no collections extends nothing, so the scan
    // has nothing to read and every count answers zero. A card there would
    // report a clean site for a plugin that is doing nothing at all -- which is
    // worse than no card, because it is an answer rather than an absence.
    const plugin = seoPlugin({ collections: [], sitemap: false });

    expect(plugin.contributes?.dashboard).toBeUndefined();
  });

  it("declares a core floor that cannot fall behind what it needs", () => {
    // 🔴 A hand-written floor goes stale silently in the direction that ACCEPTS:
    // an older core satisfying the wider range does not read the dashboard
    // contribution in the shape it is declared, and the card never appears.
    // Every package here releases at one version, so the version this plugin
    // ships at names the core built beside it.
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });

    expect(plugin.nextly).toBe(`>=${plugin.version}`);
  });
});

describe("the SEO tab the plugin contributes", () => {
  it("adds one tab to each extended collection's and Single's page, editing the seo group", () => {
    const plugin = seoPlugin({
      collections: ["pages", "posts"],
      singles: ["homepage"],
      sitemap: false,
    });
    expect(plugin.contributes?.extend?.[0]?.target).toEqual([
      "pages",
      "posts",
      "homepage",
    ]);
    expect(plugin.contributes?.admin?.contributions).toEqual([
      {
        id: "nextlyhq-plugin-seo.tab",
        kind: "tab",
        place: "collection.edit",
        label: "SEO",
        component: "@nextlyhq/plugin-seo/admin#SeoTab",
        collections: ["pages", "posts"],
        fields: ["seo"],
      },
      {
        id: "nextlyhq-plugin-seo.single-tab",
        kind: "tab",
        place: "single.edit",
        label: "SEO",
        component: "@nextlyhq/plugin-seo/admin#SeoTab",
        singles: ["homepage"],
        fields: ["seo"],
      },
    ]);
  });

  it("adds no Single's tab while it extends no Single", () => {
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });
    expect(
      plugin.contributes?.admin?.contributions?.map(each => each.place)
    ).toEqual(["collection.edit"]);
  });
});

describe("the SEO tab and fields of a project's own", () => {
  it("leaves a group the tab cannot edit whole among the page's own fields", () => {
    const plugin = seoPlugin({
      collections: ["pages"],
      sitemap: false,
      fields: [
        text({ name: "metaTitle" }),
        text({ name: "metaDescription" }),
        text({ name: "focusKeyword" }),
      ],
    });
    expect(plugin.contributes?.admin).toBeUndefined();
  });

  it("leaves a group whose fields say they may not be edited among the page's fields", () => {
    for (const admin of [
      { readOnly: true },
      { disabled: true },
      { hidden: true },
      { condition: { field: "metaTitle", equals: "x" } },
    ]) {
      const plugin = seoPlugin({
        collections: ["pages"],
        sitemap: false,
        fields: [
          text({ name: "metaTitle", admin }),
          text({ name: "metaDescription" }),
        ],
      });
      expect(plugin.contributes?.admin, JSON.stringify(admin)).toBeUndefined();
    }
  });

  it("leaves a group whose fields are of another type than the tab writes", () => {
    for (const metaTitle of [
      select({
        name: "metaTitle",
        options: [{ label: "A", value: "a" }],
      }),
      text({ name: "metaTitle", hasMany: true }),
    ]) {
      const plugin = seoPlugin({
        collections: ["pages"],
        sitemap: false,
        fields: [metaTitle, text({ name: "metaDescription" })],
      });
      expect(plugin.contributes?.admin).toBeUndefined();
    }
  });

  it("draws the tab for a group of fields it edits, fewer than the defaults", () => {
    const plugin = seoPlugin({
      collections: ["pages"],
      sitemap: false,
      fields: [text({ name: "metaTitle" }), text({ name: "metaDescription" })],
    });
    expect(plugin.contributes?.admin?.contributions).toHaveLength(1);
  });
});
