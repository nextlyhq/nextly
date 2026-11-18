/**
 * The page builder's custom CSS source for a pages route: its one checker,
 * and the site's own CSS, read through the page builder the route names.
 *
 * Read through that page builder where it started in this module copy, else
 * through the started site's `site-css` service (a production build bundles
 * the plugin into each route, and the route's copy never starts); nothing for
 * a route naming no page builder, or one that has not started anywhere.
 */
import { pluginCacheTag, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const instance = vi.hoisted(() => ({
  plugins: {} as Record<string, Record<string, unknown>>,
}));
vi.mock("@nextlyhq/plugin-sdk", async importActual => ({
  ...(await importActual<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => ({ plugins: instance.plugins }),
}));

const { pageBuilderCustomCss, SITE_CSS_SERVICE, siteCssReader, sitesCss } =
  await import("./custom-css");
const { PAGE_BUILDER_PLUGIN_NAME } = await import("./library-contract");
const { CUSTOM_CSS_CHECKER_ID } = await import("./site-code/css-check");
const { SITE_CSS_CACHE_PART } = await import("./site-code/site-css-store");

/** A stand-in for a page builder's definition, as the map keys it. */
function definition(): PluginDefinition {
  return { name: PAGE_BUILDER_PLUGIN_NAME } as PluginDefinition;
}

/** A started copy's database holding `css` as the site's CSS. */
function databaseHolding(css: string) {
  const rows = [
    {
      name: "site-css",
      value: JSON.stringify({
        sha256: "unchecked",
        chars: css.length,
        parts: 1,
        by: null,
      }),
    },
    { name: "site-css:000", value: css },
  ];
  return {
    table: () => ({ name: "name" }),
    select: () => ({ where: () => ({ all: async () => rows }) }),
  };
}

beforeEach(() => {
  instance.plugins = {};
});

describe("pageBuilderCustomCss", () => {
  it("is the one checker", () => {
    const source = pageBuilderCustomCss();
    expect(source.id).toBe(CUSTOM_CSS_CHECKER_ID);
    expect(source.accepts("selector { color: red; }", "block")).toBe(true);
    expect(source.accepts("@import url(/a.css);", "page")).toBe(false);
    expect(source.accepts("h2 { color: red; }", "block")).toBe(false);
  });

  it("reads no site CSS for a route naming no page builder", async () => {
    const source = pageBuilderCustomCss();
    expect(await source.readSite()).toBeUndefined();
  });

  it("tags the read with the plugin's own site CSS tag, which a save expires", () => {
    const source = pageBuilderCustomCss({ plugin: definition() });
    expect(source.tags).toEqual([
      pluginCacheTag(PAGE_BUILDER_PLUGIN_NAME, SITE_CSS_CACHE_PART),
    ]);
  });

  it("reads through the started site where this copy of the page builder never started", async () => {
    const plugin = definition();
    sitesCss.set(plugin, siteCssReader());
    instance.plugins[PAGE_BUILDER_PLUGIN_NAME] = {
      [SITE_CSS_SERVICE]: { read: async () => "body { margin: 0; }" },
    };
    const source = pageBuilderCustomCss({ plugin });
    expect(await source.readSite()).toBe("body { margin: 0; }");
  });

  it("reads through its own started copy, not the instance", async () => {
    const plugin = definition();
    const reader = siteCssReader();
    sitesCss.set(plugin, reader);
    instance.plugins[PAGE_BUILDER_PLUGIN_NAME] = {
      [SITE_CSS_SERVICE]: { read: async () => "from { the: instance; }" },
    };
    // The page builder started here, its database holding the site's CSS.
    reader.start(databaseHolding("p { color: red; }") as never);
    // The parts' hash is not the header's, so the store draws none of it:
    // proof the read went to this copy's database.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await pageBuilderCustomCss({ plugin }).readSite()).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reads none before the site has started anywhere", async () => {
    const plugin = definition();
    sitesCss.set(plugin, siteCssReader());
    expect(await pageBuilderCustomCss({ plugin }).readSite()).toBeUndefined();
  });

  it("reads none for a plugin that is not a page builder", async () => {
    const source = pageBuilderCustomCss({ plugin: definition() });
    expect(await source.readSite()).toBeUndefined();
  });
});
