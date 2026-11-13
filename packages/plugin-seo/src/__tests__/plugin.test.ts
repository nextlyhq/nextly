import { createRequire } from "node:module";

import type { PluginRoutePermissionScope } from "@nextlyhq/plugin-sdk";
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

/** The Page Builder's Settings place, which the SEO plugin adds a tab to. */
const PAGE_BUILDER_PLACE = "nextlyhq-plugin-page-builder.settings";

/** The tab, as the plugin declares it there. */
const PAGE_BUILDER_TAB_DECLARED = {
  id: "nextlyhq-plugin-seo.page-builder-tab",
  kind: "tab",
  place: PAGE_BUILDER_PLACE,
  label: "SEO",
  component: "@nextlyhq/plugin-seo/admin#PageBuilderSeoTab",
};

/** The contributions a plugin adds to the entry and Single edit pages. */
function editPageContributions(plugin: ReturnType<typeof seoPlugin>) {
  return (plugin.contributes?.admin?.contributions ?? []).filter(
    each => each.place !== PAGE_BUILDER_PLACE
  );
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
      // The Connections tab's reads, and Search Console's sign-in.
      ["GET", "/connections", undefined, undefined],
      ["POST", "/connections/search-console/connect", undefined, undefined],
      ["GET", "/connections/search-console/callback", undefined, undefined],
      ["POST", "/connections/search-console/disconnect", undefined, undefined],
      ["GET", "/connections/search-console/report", undefined, undefined],
      ["GET", "/sitemap.xml", "root", true],
      ["GET", "/robots.txt", "root", true],
      // Registered always; it answers once switched on in the settings.
      ["GET", "/llms.txt", "root", true],
      ["GET", "/sitemap.xml", undefined, true],
      ["POST", "/share-image", undefined, undefined],
      // The settings screen's reads, for a signed-in reader of the settings.
      ["GET", "/settings/content-types", undefined, undefined],
      // Which sitemap pages own robots.txt rules being typed would block.
      ["POST", "/settings/robots-rules-check", undefined, undefined],
      ["GET", "/settings/document", undefined, undefined],
      // The redirects screen's routes, for those the redirects' permissions allow.
      ["GET", "/redirects", undefined, undefined],
      ["POST", "/redirects", undefined, undefined],
      ["PATCH", "/redirects/:id", undefined, undefined],
      ["DELETE", "/redirects/:id", undefined, undefined],
      ["POST", "/redirects/import", undefined, undefined],
      ["GET", "/not-found", undefined, undefined],
      ["PATCH", "/not-found/:id", undefined, undefined],
      // Whether the site's Proxy runs, which serves the redirects.
      ["GET", "/proxy-status", undefined, undefined],
      // What search engines received: the pages it offers, and the check,
      // for anyone signed in.
      ["POST", "/received", undefined, undefined],
      // Whether the live home page carries the saved verification codes.
      ["POST", "/settings/verification-check", undefined, undefined],
      ["POST", "/resolve", undefined, undefined],
      // A Page Builder template's SEO panel's read.
      ["POST", "/template", undefined, undefined],
      // The problem list, read and checked again by a signed-in reader.
      ["GET", "/problems", undefined, undefined],
      ["POST", "/problems/check", undefined, undefined],
      // The Pages screen's list, and its save.
      ["GET", "/pages", undefined, undefined],
      ["POST", "/pages/seo", undefined, undefined],
      // The bulk edit table, for a signed-in reader of each type.
      ["GET", "/bulk/types", undefined, undefined],
      ["GET", "/bulk/rows", undefined, undefined],
      ["POST", "/bulk/save", undefined, undefined],
      // The import, for whoever holds site-wide SEO.
      ["GET", "/import/groups", undefined, undefined],
      ["POST", "/import/dry-run", undefined, undefined],
      ["POST", "/import/apply", undefined, undefined],
      // The Overview's setup checklist, read and hidden or shown.
      ["GET", "/overview/checklist", undefined, undefined],
      ["POST", "/overview/checklist", undefined, undefined],
    ]);
  });

  it("lists the site's addresses and saves a page's SEO only for those who manage the site's SEO", () => {
    const routes = seoPlugin({ collections: ["pages"] }).contributes?.routes;
    const permissionOf = (method: string, path: string) => {
      const found = routes?.find(
        route => route.method === method && route.path === path
      )?.requiredPermission;
      // The names a host that renamed nothing gives the plugin's own.
      const scope: PluginRoutePermissionScope = {
        plugin: "@nextlyhq/plugin-seo",
        collection: (slug, action) => `${action}-${slug}`,
        single: (slug, action) => `${action}-${slug}`,
      };
      return typeof found === "function" ? found(scope) : found;
    };
    expect(permissionOf("GET", "/pages")).toBe("manage-seo");
    expect(permissionOf("POST", "/pages/seo")).toBe("manage-seo");
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

  it("asks site-wide SEO for the redirects' and not-found log's routes, whatever an installation names those stores", () => {
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });

    const asked = (plugin.contributes?.routes ?? [])
      .filter(
        ({ path }) =>
          path.startsWith("/redirects") ||
          path.startsWith("/not-found") ||
          path === "/proxy-status"
      )
      .map(({ method, path, requiredPermission }) => [
        method,
        path,
        requiredPermission,
      ]);

    expect(asked).toEqual([
      ["GET", "/redirects", "manage-seo"],
      ["POST", "/redirects", "manage-seo"],
      ["PATCH", "/redirects/:id", "manage-seo"],
      ["DELETE", "/redirects/:id", "manage-seo"],
      ["POST", "/redirects/import", "manage-seo"],
      ["GET", "/not-found", "manage-seo"],
      ["PATCH", "/not-found/:id", "manage-seo"],
      ["GET", "/proxy-status", "manage-seo"],
    ]);
  });

  it("omits the sitemap routes when sitemap is disabled, and keeps robots.txt", () => {
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });
    expect(plugin.contributes?.routes?.map(route => route.path)).toEqual([
      "/connections",
      "/connections/search-console/connect",
      "/connections/search-console/callback",
      "/connections/search-console/disconnect",
      "/connections/search-console/report",
      "/robots.txt",
      "/llms.txt",
      "/share-image",
      "/settings/content-types",
      "/settings/robots-rules-check",
      "/settings/document",
      "/redirects",
      "/redirects",
      "/redirects/:id",
      "/redirects/:id",
      "/redirects/import",
      "/not-found",
      "/not-found/:id",
      "/proxy-status",
      "/received",
      "/settings/verification-check",
      "/resolve",
      "/template",
      "/problems",
      "/problems/check",
      "/pages",
      "/pages/seo",
      "/bulk/types",
      "/bulk/rows",
      "/bulk/save",
      "/import/groups",
      "/import/dry-run",
      "/import/apply",
      "/overview/checklist",
      "/overview/checklist",
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
      "/connections",
      "/connections/search-console/connect",
      "/connections/search-console/callback",
      "/connections/search-console/disconnect",
      "/connections/search-console/report",
      // Switched on and off in the settings, not by these options.
      "/llms.txt",
      "/share-image",
      "/settings/content-types",
      "/settings/robots-rules-check",
      "/settings/document",
      "/redirects",
      "/redirects",
      "/redirects/:id",
      "/redirects/:id",
      "/redirects/import",
      "/not-found",
      "/not-found/:id",
      "/proxy-status",
      "/received",
      "/settings/verification-check",
      "/resolve",
      "/template",
      "/problems",
      "/problems/check",
      "/pages",
      "/pages/seo",
      "/bulk/types",
      "/bulk/rows",
      "/bulk/save",
      "/import/groups",
      "/import/dry-run",
      "/import/apply",
      "/overview/checklist",
      "/overview/checklist",
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

describe("how long a title or description may be", () => {
  /** The `maxLength` each of a group's fields is saved with. */
  function limits(group: unknown) {
    const fields: readonly unknown[] =
      typeof group === "object" &&
      group !== null &&
      "fields" in group &&
      Array.isArray(group.fields)
        ? group.fields
        : [];
    return Object.fromEntries(
      fields
        .filter(
          (field): field is FieldConfig =>
            typeof field === "object" && field !== null
        )
        .filter(field => "name" in field)
        .map(field => [field.name, (field as { maxLength?: number }).maxLength])
    );
  }

  it("saves a title or description of any length by default", () => {
    // Google cuts a long title by width rather than refusing it, so the
    // length is a warning in the SEO tab and the problem list.
    const group = seoGroup(seoPlugin({ collections: ["pages"] }));
    for (const read of [
      limits(group),
      limits({ fields: defaultSeoFields() }),
    ]) {
      expect(read).toHaveProperty("metaTitle", undefined);
      expect(read).toHaveProperty("metaDescription", undefined);
    }
  });

  it("refuses a longer one where the site asks for hard limits", () => {
    const group = seoGroup(
      seoPlugin({ collections: ["pages"], hardLengthLimits: true })
    );
    expect(limits(group)).toMatchObject({
      metaTitle: 60,
      metaDescription: 160,
    });
    expect(
      limits({ fields: defaultSeoFields({ hardLengthLimits: true }) })
    ).toMatchObject({
      metaTitle: 60,
      metaDescription: 160,
    });
  });
});

describe("the dashboard card the plugin contributes", () => {
  it("declares seo/issues and its Needs attention line through contributes.dashboard", () => {
    const plugin = seoPlugin({
      collections: ["pages", "posts"],
      sitemap: false,
    });
    const dashboard = plugin.contributes?.dashboard;

    expect(dashboard?.widgets?.map(widget => widget.id)).toEqual([
      "seo/issues",
    ]);
    // One line counting the problem list, shown to a reader of any
    // collection SEO is added to.
    expect(dashboard?.attention?.map(item => item.id)).toEqual([
      "seo/problems",
    ]);
    expect(dashboard?.attention?.map(item => item.collections)).toEqual([
      ["pages", "posts"],
    ]);
  });

  it("contributes nothing through the removed widget doors", () => {
    // The card is a declaration and nothing else: no stats card under
    // `admin.widgets`, and no data source under `widgetSources`.
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });

    expect(plugin.contributes?.admin).not.toHaveProperty("widgets");
    // Its admin contributions are the SEO tab, its side panel line, and the
    // tab in the Page Builder's Settings.
    expect(plugin.contributes?.admin?.contributions).toEqual([
      expect.objectContaining({ kind: "tab" }),
      expect.objectContaining({ kind: "sidebarSection" }),
      expect.objectContaining({ kind: "tab", place: PAGE_BUILDER_PLACE }),
    ]);
    // Read as a property of the value: `widgetSources` is no field of the
    // contributions type, so a typed read of it does not compile.
    expect(plugin.contributes).toBeDefined();
    expect(plugin.contributes).not.toHaveProperty("widgetSources");
  });

  it("is withheld when no collection carries the fields", () => {
    // 🔴 A plugin registered with no collections checks no page of one, so
    // every count answers zero. A card there would report a clean site for a
    // plugin that is doing nothing at all -- which is worse than no card,
    // because it is an answer rather than an absence.
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
        id: "nextlyhq-plugin-seo.status",
        kind: "sidebarSection",
        place: "collection.edit",
        label: "Search",
        component: "@nextlyhq/plugin-seo/admin#SeoStatusSection",
        after: "details",
        collections: ["pages", "posts"],
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
      {
        id: "nextlyhq-plugin-seo.single-status",
        kind: "sidebarSection",
        place: "single.edit",
        label: "Search",
        component: "@nextlyhq/plugin-seo/admin#SeoStatusSection",
        after: "details",
        singles: ["homepage"],
      },
      PAGE_BUILDER_TAB_DECLARED,
    ]);
  });

  it("adds no Single's tab while it extends no Single", () => {
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });
    expect(
      plugin.contributes?.admin?.contributions?.map(each => each.place)
    ).toEqual(["collection.edit", "collection.edit", PAGE_BUILDER_PLACE]);
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
    expect(editPageContributions(plugin)).toEqual([]);
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
      expect(editPageContributions(plugin), JSON.stringify(admin)).toEqual([]);
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
      expect(editPageContributions(plugin)).toEqual([]);
    }
  });

  it("draws the tab for a group of fields it edits, fewer than the defaults", () => {
    const plugin = seoPlugin({
      collections: ["pages"],
      sitemap: false,
      fields: [text({ name: "metaTitle" }), text({ name: "metaDescription" })],
    });
    expect(editPageContributions(plugin)).toHaveLength(2);
  });
});

describe("the SEO tab in the Page Builder's Settings", () => {
  it("is added to the Page Builder's place, which the plugin names as an optional dependency", () => {
    const plugin = seoPlugin({ collections: ["pages"], sitemap: false });
    expect(plugin.contributes?.admin?.contributions).toContainEqual(
      PAGE_BUILDER_TAB_DECLARED
    );
    expect(plugin.optionalDependsOn).toEqual({
      "@nextlyhq/plugin-page-builder": `>=${plugin.version}`,
    });
  });

  it("is told which collections' pages it edits: those the SEO tab edits", () => {
    const editing = seoPlugin({ collections: ["pages"], sitemap: false });
    expect(editing.contributes?.admin?.clientConfig).toMatchObject({
      tabCollections: ["pages"],
    });
    // A group the tab cannot edit stays among the page's fields: no page's
    // SEO is the Page Builder tab's either, though a template's rule still is.
    const gated = seoPlugin({
      collections: ["pages"],
      sitemap: false,
      fields: [text({ name: "metaTitle" }), text({ name: "focusKeyword" })],
    });
    expect(gated.contributes?.admin?.clientConfig).toMatchObject({
      tabCollections: [],
    });
    expect(gated.contributes?.admin?.contributions).toEqual([
      PAGE_BUILDER_TAB_DECLARED,
    ]);
  });
});

describe("the optional connections the plugin declares", () => {
  it("reaches only IndexNow's endpoint and Google's Search Console addresses", () => {
    const plugin = seoPlugin({ collections: ["pages"] });
    expect(plugin.capabilities?.net?.outbound).toEqual([
      "api.indexnow.org",
      "oauth2.googleapis.com",
      "www.googleapis.com",
      "searchconsole.googleapis.com",
    ]);
  });

  it("keeps every credential at a secret path, which core encrypts and never returns", () => {
    const plugin = seoPlugin({ collections: ["pages"] });
    expect(plugin.capabilities?.secrets).toEqual([
      "indexNowKey",
      "searchConsole.refreshToken",
      "searchConsolePending.state",
      "searchConsolePending.verifier",
    ]);
    // Each secret path is one the declared settings hold.
    const shape = plugin.contributes?.settings?.shape ?? {};
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining([
        "indexNowKey",
        "searchConsole",
        "searchConsolePending",
      ])
    );
  });

  it("declares the event a committed save's addresses are announced on", () => {
    const plugin = seoPlugin({ collections: ["pages"] });
    expect(plugin.contributes?.events).toContainEqual({
      name: "nextlyhq-plugin-seo.addresses-moved",
    });
  });

  it("declares the event a committed change to who holds an address is announced on", () => {
    // Undeclared, every save that gains or releases an address would log a
    // warning that the plugin emits an event it never declared.
    const plugin = seoPlugin({ collections: ["pages"] });
    expect(plugin.contributes?.events).toContainEqual({
      name: "nextlyhq-plugin-seo.address-record-changed",
    });
  });

  it("reads a client secret wrapped by another copy of the plugin SDK", () => {
    // A site may install its own copy of the SDK beside the plugin's, whose
    // `secret()` makes an object of a class the plugin's copy did not make.
    class OtherCopySecret {
      readonly #value: string;
      constructor(value: string) {
        this.#value = value;
      }
      reveal(): string {
        return this.#value;
      }
      toString(): string {
        return "[redacted]";
      }
    }
    expect(() =>
      seoPlugin({
        collections: ["pages"],
        searchConsole: {
          clientId: "id",
          clientSecret: new OtherCopySecret("s") as unknown as string,
        },
      })
    ).not.toThrow();
  });

  it("refuses a Search Console sign-in with a blank client id or secret", () => {
    expect(() =>
      seoPlugin({
        collections: ["pages"],
        searchConsole: { clientId: " ", clientSecret: "s" },
      })
    ).toThrow(/clientId and a clientSecret/);
    expect(() =>
      seoPlugin({
        collections: ["pages"],
        searchConsole: { clientId: "id", clientSecret: "" },
      })
    ).toThrow(/clientId and a clientSecret/);
  });
});

describe("the SEO section", () => {
  const SECTION = "/admin/plugins/nextlyhq-plugin-seo";

  it("lists its five screens in the order they are used, Overview first", () => {
    const admin = seoPlugin({ collections: ["posts"] }).contributes?.admin;
    expect((admin?.menu ?? []).map(item => [item.label, item.to])).toEqual([
      ["Overview", `${SECTION}/overview`],
      ["Pages", `${SECTION}/pages`],
      ["Problems", `${SECTION}/problems`],
      ["Redirects", `${SECTION}/redirects`],
      ["Settings", `${SECTION}/settings`],
    ]);
  });

  it("badges Problems with the count of its Needs attention line", () => {
    const plugin = seoPlugin({ collections: ["posts"] });
    const problems = plugin.contributes?.admin?.menu?.find(
      item => item.label === "Problems"
    );
    expect(problems?.badge).toEqual({ attention: "seo/problems" });
    expect(
      plugin.contributes?.dashboard?.attention?.map(item => item.id)
    ).toEqual(["seo/problems"]);
  });

  it("names no badge where no collection carries SEO, and so no line exists", () => {
    const problems = seoPlugin({
      collections: [],
      singles: ["home"],
    }).contributes?.admin?.menu?.find(item => item.label === "Problems");
    expect(problems?.badge).toBeUndefined();
  });

  it("opens on its Overview", () => {
    expect(seoPlugin({ collections: ["posts"] }).admin?.landing).toBe(
      `${SECTION}/overview`
    );
  });

  it("serves each screen, and the old addresses that send bookmarks on", () => {
    const pages = seoPlugin({ collections: ["posts"] }).contributes?.admin
      ?.pages;
    expect(
      (pages ?? []).map(page => [
        page.path,
        page.component.split("#")[1],
        page.requiredPermission,
      ])
    ).toEqual([
      ["overview", "SeoOverviewPage", "manage-seo"],
      ["pages", "SeoPagesPage", "manage-seo"],
      ["pages/import", "SeoImportPage", "manage-seo"],
      ["pages/inspect", "SeoInspectPage", "check-seo"],
      ["problems", "SeoProblemsPage", undefined],
      ["redirects", "SeoRedirectsPage", "manage-seo"],
      ["settings", "SeoSettingsPage", "manage-seo"],
      ["bulk", "SeoBulkMoved", undefined],
      ["received", "SeoReceivedMoved", undefined],
    ]);
  });
});

describe("SEO on every content type, where the site names none", () => {
  const EVERY = { every: ["collection", "single"] };

  it("adds the seo group to every collection and Single the site defines", () => {
    const plugin = seoPlugin({ sitemap: false });
    expect(plugin.contributes?.extend).toHaveLength(1);
    expect(plugin.contributes?.extend?.[0]?.target).toEqual(EVERY);
    expect(seoGroup(plugin).name).toBe("seo");
  });

  it("leaves out each type the site excludes", () => {
    const plugin = seoPlugin({ exclude: ["logs", "logs", "audit"] });
    expect(plugin.contributes?.extend?.[0]?.target).toEqual({
      ...EVERY,
      except: ["logs", "audit"],
    });
  });

  it("adds a plugin's collection the site includes by name, and keeps it out of the scope", () => {
    const plugin = seoPlugin({ include: ["forms"], exclude: ["logs"] });
    const [named, scope] = plugin.contributes?.extend ?? [];
    expect(named?.target).toEqual(["forms"]);
    expect(named?.fields?.[0]).toBe(scope?.fields?.[0]);
    // Named once: the scope never reaches it a second time.
    expect(scope?.target).toEqual({ ...EVERY, except: ["logs", "forms"] });
  });

  it("keeps a site's named list exactly as before", () => {
    const plugin = seoPlugin({ collections: ["posts"], singles: ["home"] });
    expect(plugin.contributes?.extend?.map(clause => clause.target)).toEqual([
      ["posts", "home"],
    ]);
  });

  it.each([
    ["exclude", { collections: ["posts"], exclude: ["logs"] }],
    ["include", { singles: ["home"], include: ["forms"] }],
  ] as const)(
    "refuses %s beside a named list, which already says which types",
    (_, options) => {
      expect(() => seoPlugin(options)).toThrow(/collections|singles/);
    }
  );

  it("draws the SEO tab and its line wherever its own group was added", () => {
    const plugin = seoPlugin({ sitemap: false });
    const edit = editPageContributions(plugin);
    expect(edit.map(each => [each.id, each.place])).toEqual([
      ["nextlyhq-plugin-seo.tab", "collection.edit"],
      ["nextlyhq-plugin-seo.status", "collection.edit"],
      ["nextlyhq-plugin-seo.single-tab", "single.edit"],
      ["nextlyhq-plugin-seo.single-status", "single.edit"],
    ]);
    for (const each of edit) {
      // Offered by core on the types the start added the group to, the
      // Schema Builder's included and a type with its own `seo` left out.
      expect(each).toMatchObject({ extendedWith: ["seo"] });
      expect(each).not.toHaveProperty("collections");
      expect(each).not.toHaveProperty("singles");
    }
  });

  it("refuses page permissions, which are declared for named types before the site starts", () => {
    expect(() => seoPlugin({ pagePermissions: true })).toThrow(
      /pagePermissions/
    );
  });

  it("shows the dashboard card and its line to whoever manages site-wide SEO", () => {
    const plugin = seoPlugin({ sitemap: false });
    const dashboard = plugin.contributes?.dashboard;
    expect(dashboard?.widgets?.map(widget => widget.access)).toEqual([
      "manage-seo",
    ]);
    expect(dashboard?.attention).toEqual([
      expect.objectContaining({ id: "seo/problems", permission: "manage-seo" }),
    ]);
  });

  it("takes a sitemap list it cannot check until the site starts", () => {
    expect(() =>
      seoPlugin({ sitemap: { collections: ["posts"] } })
    ).not.toThrow();
  });
});
