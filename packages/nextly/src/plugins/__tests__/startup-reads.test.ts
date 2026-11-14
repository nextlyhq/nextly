/**
 * A plugin page's startup reads, as the prebuilt admin page carries them and
 * as boot checks them.
 *
 * Each page that declares reads is named by the address the admin registers
 * it at, with the admin API paths its reads ask for, spelled by the function
 * the page's own read asks by. What the startup request cannot carry is left
 * out of the page, and refused at boot.
 */
import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "../plugin-context";
import { assertPluginManifests } from "../resolve";
import { pluginRouteFullPath } from "../routes/route-path";
import {
  adminStartupScreens,
  adminStartupScreensJson,
  MAX_PAGE_STARTUP_READS,
} from "../startup-reads";
import { validatePluginStartupReads } from "../validate-startup-reads";

/** A plugin with the given admin pages, and nothing else. */
const pluginWith = (
  name: string,
  pages: NonNullable<
    NonNullable<PluginDefinition["contributes"]>["admin"]
  >["pages"]
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: "*",
  contributes: { admin: { pages } },
});

const OVERVIEW = {
  path: "overview",
  component: "@acme/seo/admin#Overview",
  startupReads: [
    { path: "/overview/checklist" },
    { path: "/acme-status", mount: "root" as const },
  ],
};

describe("the plugin pages' startup reads in the prebuilt page", () => {
  it("names each page by its admin address, with the paths its reads ask for", () => {
    const screens = adminStartupScreens([
      pluginWith("@acme/seo", [
        OVERVIEW,
        // A page with no reads is not named at all.
        { path: "settings", component: "@acme/seo/admin#Settings" },
      ]),
    ]);

    expect(screens).toEqual({
      "/admin/plugins/acme-seo/overview": [
        pluginRouteFullPath("@acme/seo", "/overview/checklist"),
        "/acme-status",
      ],
    });
    expect(screens["/admin/plugins/acme-seo/overview"]?.[0]).toBe(
      "/plugins/@acme/seo/overview/checklist"
    );
  });

  it("names a page declared with a leading slash at the same address", () => {
    const screens = adminStartupScreens([
      pluginWith("@acme/seo", [{ ...OVERVIEW, path: "/overview" }]),
    ]);
    expect(Object.keys(screens)).toEqual(["/admin/plugins/acme-seo/overview"]);
  });

  it("leaves out what the startup request cannot carry", () => {
    const screens = adminStartupScreens([
      pluginWith("@acme/seo", [
        {
          ...OVERVIEW,
          startupReads: [
            { path: "/../secrets" },
            ...Array.from({ length: MAX_PAGE_STARTUP_READS + 1 }, (_, i) => ({
              path: `/read-${i}`,
            })),
          ],
        },
      ]),
    ]);

    expect(screens["/admin/plugins/acme-seo/overview"]).toEqual(
      Array.from(
        { length: MAX_PAGE_STARTUP_READS },
        (_, i) => `/plugins/@acme/seo/read-${i}`
      )
    );
  });

  it("is nothing at all when no page declares a read", () => {
    expect(adminStartupScreensJson(undefined)).toBeNull();
    expect(
      adminStartupScreensJson([
        pluginWith("@acme/seo", [
          { path: "settings", component: "@acme/seo/admin#Settings" },
        ]),
      ])
    ).toBeNull();
  });

  it("is JSON that cannot end the element it is written into", () => {
    const json = adminStartupScreensJson([
      pluginWith("@acme/seo", [
        { ...OVERVIEW, startupReads: [{ path: "/overview?q=</script>" }] },
      ]),
    ]);

    expect(json).not.toContain("</script>");
    expect(JSON.parse(json ?? "null")).toEqual({
      reads: {
        "/admin/plugins/acme-seo/overview": [
          "/plugins/@acme/seo/overview?q=</script>",
        ],
      },
      foldedPanels: [],
    });
  });

  it("names the collections whose screens start with the panel folded, on their served slugs", () => {
    const forms: PluginDefinition = {
      name: "@acme/forms",
      version: "1.0.0",
      nextly: "*",
      renameMap: { forms: "site-forms" },
      contributes: {
        admin: {
          views: {
            forms: { foldedPanel: true },
            submissions: { foldedPanel: false },
          },
        },
      },
    };
    const off: PluginDefinition = {
      ...forms,
      name: "@acme/off",
      enabled: false,
      renameMap: {},
      contributes: { admin: { views: { drafts: { foldedPanel: true } } } },
    };

    expect(JSON.parse(adminStartupScreensJson([forms, off]) ?? "null")).toEqual(
      { reads: {}, foldedPanels: ["site-forms"] }
    );
  });
});

describe("the boot check of a page's startup reads", () => {
  it("runs where a plugin list is checked, so a bad read stops the boot", () => {
    expect(() =>
      assertPluginManifests([
        pluginWith("@acme/seo", [
          { ...OVERVIEW, startupReads: [{ path: "/../secrets" }] },
        ]),
      ])
    ).toThrow(
      expect.objectContaining({
        logContext: expect.objectContaining({
          reason: "page-startup-read-invalid",
        }),
      })
    );
    expect(() =>
      assertPluginManifests([pluginWith("@acme/seo", [OVERVIEW])])
    ).not.toThrow();
  });

  it("accepts reads the startup request can carry", () => {
    expect(() =>
      validatePluginStartupReads([pluginWith("@acme/seo", [OVERVIEW])])
    ).not.toThrow();
  });

  it("refuses more reads than a page may declare", () => {
    expect(() =>
      validatePluginStartupReads([
        pluginWith("@acme/seo", [
          {
            ...OVERVIEW,
            startupReads: Array.from(
              { length: MAX_PAGE_STARTUP_READS + 1 },
              (_, i) => ({ path: `/read-${i}` })
            ),
          },
        ]),
      ])
    ).toThrow(
      expect.objectContaining({
        logContext: expect.objectContaining({
          reason: "page-startup-reads-too-many",
        }),
      })
    );
  });

  it.each([
    ["a step up", "/../secrets"],
    ["no leading slash", "overview"],
    ["a space", "/over view"],
  ])("refuses a read with %s", (_case, path) => {
    expect(() =>
      validatePluginStartupReads([
        pluginWith("@acme/seo", [{ ...OVERVIEW, startupReads: [{ path }] }]),
      ])
    ).toThrow(
      expect.objectContaining({
        logContext: expect.objectContaining({
          reason: "page-startup-read-invalid",
        }),
      })
    );
  });
});
