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

  it("folds headerSlot + widgets for enabled plugins", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: {
            admin: {
              headerSlot: "@acme/p/admin#HeaderBadge",
              widgets: [
                {
                  id: "stats",
                  component: "@acme/p/admin#Stats",
                  size: "half",
                  requiredPermission: "read-stats",
                },
              ],
            },
          },
        },
      ]),
      undefined
    );
    expect(meta[0].headerSlot).toBe("@acme/p/admin#HeaderBadge");
    expect(meta[0].widgets?.[0]).toMatchObject({
      id: "stats",
      component: "@acme/p/admin#Stats",
      size: "half",
      requiredPermission: "read-stats",
    });
  });

  it("folds contributes.admin.header (slot + hideDefaults + hide) for enabled plugins", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: {
            admin: {
              header: {
                slot: "@acme/p/admin#Publish",
                hideDefaults: true,
                hide: ["github", "notifications"],
              },
            },
          },
        },
      ]),
      undefined
    );
    expect(meta[0].header).toEqual({
      slot: "@acme/p/admin#Publish",
      hideDefaults: true,
      hide: ["github", "notifications"],
    });
    // Back-compat: legacy headerSlot mirrors header.slot.
    expect(meta[0].headerSlot).toBe("@acme/p/admin#Publish");
  });

  it("maps a deprecated top-level headerSlot into header.slot", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: { admin: { headerSlot: "@acme/p/admin#Badge" } },
        },
      ]),
      undefined
    );
    expect(meta[0].header?.slot).toBe("@acme/p/admin#Badge");
    expect(meta[0].headerSlot).toBe("@acme/p/admin#Badge");
  });

  it("omits header for enabled:false plugins", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          enabled: false,
          contributes: {
            admin: {
              header: { slot: "@acme/p/admin#Publish", hideDefaults: true },
            },
          },
        },
      ]),
      undefined
    );
    expect(meta[0].header).toBeUndefined();
    expect(meta[0].headerSlot).toBeUndefined();
  });

  it("omits headerSlot + widgets for enabled:false plugins", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          enabled: false,
          contributes: {
            admin: {
              headerSlot: "@acme/p/admin#HeaderBadge",
              widgets: [{ id: "stats", component: "@acme/p/admin#Stats" }],
            },
          },
        },
      ]),
      undefined
    );
    expect(meta[0].headerSlot).toBeUndefined();
    expect(meta[0].widgets).toBeUndefined();
  });

  it("serializes contributes.fieldTypes type→component, even when disabled", () => {
    const fieldTypes = [
      { type: "rating", storage: "number", component: "@acme/p/admin#Rating" },
    ];
    const enabled = buildPluginAdminMeta(
      asPlugins([{ ...base, contributes: { fieldTypes } }]),
      undefined
    );
    expect(enabled[0].fieldTypes).toEqual([
      { type: "rating", component: "@acme/p/admin#Rating" },
    ]);

    // Disabled plugins keep their collections + custom field types so the admin
    // can still render fields of retained collections.
    const disabled = buildPluginAdminMeta(
      asPlugins([{ ...base, enabled: false, contributes: { fieldTypes } }]),
      undefined
    );
    expect(disabled[0].fieldTypes).toEqual([
      { type: "rating", component: "@acme/p/admin#Rating" },
    ]);
  });

  it("omits admin contributions for enabled:false plugins", () => {
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
