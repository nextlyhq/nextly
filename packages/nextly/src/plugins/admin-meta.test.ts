import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "./plugin-context";

import { buildPluginAdminMeta } from "./admin-meta";

const base = {
  name: "@acme/p",
  version: "1.0.0",
  nextly: "*",
} as const;

function asPlugins(defs: unknown[]): PluginDefinition[] {
  return defs as PluginDefinition[];
}

describe("buildPluginAdminMeta", () => {
  it("folds contributes.admin menu/pages/settings for enabled plugins", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: {
            admin: {
              menu: [
                {
                  label: "Forms",
                  to: "/admin/collections/forms",
                  icon: "file-text",
                  order: 10,
                },
              ],
              pages: [
                {
                  path: "reports",
                  component: "@acme/p/admin#Reports",
                  requiredPermission: "read-reports",
                },
              ],
              settings: { component: "@acme/p/admin#Settings" },
            },
          },
        },
      ]),
      undefined
    );

    expect(meta[0].menu).toEqual([
      {
        label: "Forms",
        to: "/admin/collections/forms",
        icon: "file-text",
        order: 10,
      },
    ]);
    expect(meta[0].pages?.[0]).toMatchObject({
      path: "reports",
      component: "@acme/p/admin#Reports",
      requiredPermission: "read-reports",
    });
    expect(meta[0].settings?.component).toBe("@acme/p/admin#Settings");
  });

  it("omits admin contributions for enabled:false plugins (D49)", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          enabled: false,
          contributes: {
            admin: { menu: [{ label: "x", to: "/x" }] },
          },
        },
      ]),
      undefined
    );
    // The plugin entry still exists (its schema still applies), but its
    // behavioral admin UI (menu/pages/settings) is skipped per D49.
    expect(meta).toHaveLength(1);
    expect(meta[0].menu).toBeUndefined();
    expect(meta[0].pages).toBeUndefined();
    expect(meta[0].settings).toBeUndefined();
  });

  it("preserves placement/appearance/collections and applies host overrides", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          admin: {
            placement: "users",
            order: 60,
            appearance: { icon: "BarChart", label: "Analytics" },
          },
          contributes: { collections: [{ slug: "forms" }] },
        },
      ]),
      { "acme-p": { order: 5, appearance: { badge: "Beta" } } }
    );

    expect(meta[0].placement).toBe("users");
    expect(meta[0].order).toBe(5); // host override wins
    expect(meta[0].appearance).toEqual({
      icon: "BarChart",
      label: "Analytics",
      badge: "Beta", // shallow-merged
    });
    expect(meta[0].collections).toEqual(["forms"]);
  });

  it("defaults placement to 'plugins' and has no admin keys when none declared", () => {
    const meta = buildPluginAdminMeta(asPlugins([{ ...base }]), undefined);
    expect(meta[0].placement).toBe("plugins");
    expect(meta[0].menu).toBeUndefined();
    expect(meta[0].pages).toBeUndefined();
    expect(meta[0].settings).toBeUndefined();
  });
});
