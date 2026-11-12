import { describe, expect, it, vi } from "vitest";

import type { PluginDefinition } from "./plugin-context";
import {
  pluginLandingWarnings,
  reportPluginLandingWarnings,
  resolvePluginLanding,
} from "./plugin-landing";

/**
 * A standalone plugin `@acme/reports` (admin slug `acme-reports`) owning the
 * `reports` and `exports` collections and an `overview` page, with whatever
 * else a test adds.
 */
function reportsPlugin(
  extra: Partial<{
    landing: string;
    placement: string;
    collections: string[];
    menu: Array<{ label: string; to: string; section?: string }>;
    enabled: boolean;
  }> = {}
): PluginDefinition {
  const collections = extra.collections ?? ["reports", "exports"];
  // A plain object rather than `definePlugin`, whose module brings the
  // runtime with it; `renameMap` is what `rename` sets.
  return {
    name: "@acme/reports",
    version: "1.0.0",
    nextly: "*",
    ...(extra.enabled === undefined ? {} : { enabled: extra.enabled }),
    admin: {
      placement: extra.placement ?? "standalone",
      ...(extra.landing === undefined ? {} : { landing: extra.landing }),
    },
    contributes: {
      collections: collections.map(slug => ({ slug }) as never),
      admin: {
        pages: [{ path: "overview", component: "@acme/reports/admin#Page" }],
        ...(extra.menu ? { menu: extra.menu } : {}),
      },
    },
  } as unknown as PluginDefinition;
}

describe("resolvePluginLanding", () => {
  it("resolves one of the plugin's own pages, with its query", () => {
    expect(
      resolvePluginLanding(
        reportsPlugin({ landing: "/admin/plugins/acme-reports/overview?x=1" }),
        undefined
      )
    ).toEqual({
      kind: "resolved",
      href: "/admin/plugins/acme-reports/overview?x=1",
    });
  });

  it("resolves one of its own collections through the host's rename", () => {
    const declared = reportsPlugin({ landing: "/admin/collections/exports" });
    // The control: unrenamed, the declared slug is the address.
    expect(resolvePluginLanding(declared, undefined)).toEqual({
      kind: "resolved",
      href: "/admin/collections/exports",
    });
    const renamed = { ...declared, renameMap: { exports: "data-exports" } };
    expect(resolvePluginLanding(renamed, undefined)).toEqual({
      kind: "resolved",
      href: "/admin/collections/data-exports",
    });
    // A site writing an override knows the slug it registered.
    expect(
      resolvePluginLanding(renamed, {
        landing: "/admin/collections/data-exports",
      })
    ).toEqual({ kind: "resolved", href: "/admin/collections/data-exports" });
  });

  it("follows the declared slug when renames chain onto another's name", () => {
    // `reports` is registered as `exports`, and the declared `exports` as
    // `data-exports`: the plugin's `exports` is the latter, whichever of its
    // collections it declares first.
    const renameMap = { reports: "exports", exports: "data-exports" };
    for (const collections of [
      ["reports", "exports"],
      ["exports", "reports"],
    ]) {
      const chained = {
        ...reportsPlugin({
          landing: "/admin/collections/exports",
          collections,
        }),
        renameMap,
      };
      expect(resolvePluginLanding(chained, undefined)).toEqual({
        kind: "resolved",
        href: "/admin/collections/data-exports",
      });
    }
  });

  it("refuses a page the plugin does not register, or another plugin's", () => {
    for (const landing of [
      "/admin/plugins/acme-reports/missing",
      "/admin/plugins/acme-other/overview",
      "/admin/collections/posts",
      "/admin/media",
      "overview",
    ]) {
      expect(
        resolvePluginLanding(reportsPlugin({ landing }), undefined)
      ).toEqual({ kind: "unknown", declared: landing, source: "plugin" });
    }
  });

  it("lets the site's override win over the plugin's own", () => {
    expect(
      resolvePluginLanding(
        reportsPlugin({ landing: "/admin/collections/reports" }),
        { landing: "/admin/plugins/acme-reports/overview" }
      )
    ).toEqual({
      kind: "resolved",
      href: "/admin/plugins/acme-reports/overview",
    });
  });

  it("is unset when neither names one", () => {
    expect(resolvePluginLanding(reportsPlugin(), undefined)).toEqual({
      kind: "unset",
    });
  });
});

describe("pluginLandingWarnings", () => {
  const menu = [
    { label: "Overview", to: "/admin/plugins/acme-reports/overview" },
  ];

  it("warns in development for a standalone plugin with no landing and no collections", () => {
    const plugin = reportsPlugin({ collections: [], menu });
    expect(pluginLandingWarnings([plugin], undefined, "development")).toEqual([
      expect.objectContaining({
        kind: "plugin-landing-missing",
        plugin: "@acme/reports",
      }),
    ]);
  });

  it("says nothing of a missing landing where something else answers it", () => {
    const quiet = [
      // It has collections to open.
      reportsPlugin({ menu }),
      // It names a landing.
      reportsPlugin({
        collections: [],
        menu,
        landing: "/admin/plugins/acme-reports/overview",
      }),
      // It is not standalone.
      reportsPlugin({ collections: [], menu, placement: "plugins" }),
      // Its only item is listed in another section's panel.
      reportsPlugin({
        collections: [],
        menu: [{ ...menu[0], section: "settings" }],
      }),
      // It is off.
      reportsPlugin({ collections: [], menu, enabled: false }),
    ];
    for (const plugin of quiet) {
      expect(pluginLandingWarnings([plugin], undefined, "development")).toEqual(
        []
      );
    }
  });

  it("reads the site's placement override", () => {
    const plugin = reportsPlugin({
      collections: [],
      menu,
      placement: "plugins",
    });
    expect(
      pluginLandingWarnings(
        [plugin],
        { "acme-reports": { placement: "standalone" } },
        "development"
      ).map(w => w.kind)
    ).toEqual(["plugin-landing-missing"]);
  });

  it("warns for a landing naming an unregistered page or an unowned collection", () => {
    for (const landing of [
      "/admin/plugins/acme-reports/missing",
      "/admin/collections/posts",
    ]) {
      const warnings = pluginLandingWarnings(
        [reportsPlugin({ landing })],
        undefined,
        "development"
      );
      expect(warnings).toEqual([
        expect.objectContaining({ kind: "plugin-landing-unknown" }),
      ]);
      expect(warnings[0].message).toContain(landing);
    }
  });

  it("names the site's override when that is what is wrong", () => {
    const [warning] = pluginLandingWarnings(
      [reportsPlugin()],
      { "acme-reports": { landing: "/admin/collections/posts" } },
      "development"
    );
    expect(warning.message).toContain("pluginOverrides");
  });

  it("reports a dropped landing as missing too, when nothing else answers it", () => {
    const plugin = reportsPlugin({
      collections: [],
      menu,
      landing: "/admin/plugins/acme-reports/missing",
    });
    expect(
      pluginLandingWarnings([plugin], undefined, "development").map(w => w.kind)
    ).toEqual(["plugin-landing-unknown", "plugin-landing-missing"]);
  });

  it("is silent when the landing is valid", () => {
    const valid = [
      reportsPlugin({
        collections: [],
        menu,
        landing: "/admin/plugins/acme-reports/overview",
      }),
      reportsPlugin({ menu, landing: "/admin/collections/reports" }),
    ];
    expect(pluginLandingWarnings(valid, undefined, "development")).toEqual([]);
  });

  it("is silent outside development", () => {
    const plugins = [
      reportsPlugin({ collections: [], menu }),
      reportsPlugin({ landing: "/admin/collections/posts" }),
    ];
    // The control: the same plugins are reported in development.
    expect(
      pluginLandingWarnings(plugins, undefined, "development")
    ).toHaveLength(2);
    for (const env of ["production", "test", undefined]) {
      expect(pluginLandingWarnings(plugins, undefined, env)).toEqual([]);
    }
  });
});

describe("reportPluginLandingWarnings", () => {
  const menu = [
    { label: "Overview", to: "/admin/plugins/acme-reports/overview" },
  ];
  const logger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  it("hands each development warning to the logger it is given", () => {
    const host = logger();
    reportPluginLandingWarnings(
      [reportsPlugin({ collections: [], menu })],
      undefined,
      "development",
      host
    );
    expect(host.warn).toHaveBeenCalledTimes(1);
    expect(host.warn.mock.calls[0][1]).toEqual({
      kind: "plugin-landing-missing",
      plugin: "@acme/reports",
    });
  });

  it("says nothing outside development", () => {
    const host = logger();
    reportPluginLandingWarnings(
      [reportsPlugin({ collections: [], menu })],
      undefined,
      "production",
      host
    );
    expect(host.warn).not.toHaveBeenCalled();
  });
});
