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
  it("serializes a field type's layout hint", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: {
            fieldTypes: [
              {
                type: "page-builder",
                storage: "json",
                component: "@acme/p/admin#Canvas",
                layout: "takeover",
              },
            ],
          },
        },
      ]),
      undefined
    );
    expect(meta[0].fieldTypes?.[0]).toMatchObject({
      type: "page-builder",
      component: "@acme/p/admin#Canvas",
      layout: "takeover",
    });
  });

  it("serializes a field type's picker presentation and surfaces", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: {
            fieldTypes: [
              {
                type: "rating",
                storage: "number",
                component: "@acme/p/admin#Rating",
                label: "Star Rating",
                description: "A 1-5 star rating",
                icon: "Star",
                category: "Advanced",
                surfaces: ["entries", "users"],
              },
            ],
          },
        },
      ]),
      undefined
    );
    expect(meta[0].fieldTypes?.[0]).toEqual({
      type: "rating",
      component: "@acme/p/admin#Rating",
      label: "Star Rating",
      description: "A 1-5 star rating",
      icon: "Star",
      category: "Advanced",
      surfaces: ["entries", "users"],
    });
  });

  it("omits presentation and surfaces keys a field type does not declare", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: {
            fieldTypes: [
              { type: "rating", storage: "number", component: "@p#R" },
            ],
          },
        },
      ]),
      undefined
    );
    expect(meta[0].fieldTypes?.[0]).toEqual({
      type: "rating",
      component: "@p#R",
    });
  });

  it("serializes schemaBuilderSlot for an enabled plugin only", () => {
    const enabled = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: { admin: { schemaBuilderSlot: "@acme/p/admin#Toggle" } },
        },
      ]),
      undefined
    );
    expect(enabled[0].schemaBuilderSlot).toBe("@acme/p/admin#Toggle");

    const disabled = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          enabled: false,
          contributes: { admin: { schemaBuilderSlot: "@acme/p/admin#Toggle" } },
        },
      ]),
      undefined
    );
    expect(disabled[0].schemaBuilderSlot).toBeUndefined();
  });

  it("serializes entryFormToolbarSlot for an enabled plugin only", () => {
    const enabled = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: { admin: { entryFormToolbarSlot: "@acme/p/admin#Bar" } },
        },
      ]),
      undefined
    );
    expect(enabled[0].entryFormToolbarSlot).toBe("@acme/p/admin#Bar");

    const disabled = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          enabled: false,
          contributes: { admin: { entryFormToolbarSlot: "@acme/p/admin#Bar" } },
        },
      ]),
      undefined
    );
    expect(disabled[0].entryFormToolbarSlot).toBeUndefined();
  });

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

  it("passes identity metadata through (author/links/license/category/tags)", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          author: "Acme Inc.",
          homepage: "https://acme.dev",
          repository: "https://github.com/acme/p",
          docsUrl: "https://acme.dev/docs",
          license: "MIT",
          category: "forms",
          tags: ["forms", "email"],
        },
      ]),
      undefined
    );
    expect(meta[0]).toMatchObject({
      author: "Acme Inc.",
      homepage: "https://acme.dev",
      repository: "https://github.com/acme/p",
      docsUrl: "https://acme.dev/docs",
      license: "MIT",
      category: "forms",
      tags: ["forms", "email"],
    });
  });

  it("keeps identity metadata for disabled plugins", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        { ...base, enabled: false, author: "Acme Inc.", license: "MIT" },
      ]),
      undefined
    );
    expect(meta[0].author).toBe("Acme Inc.");
    expect(meta[0].license).toBe("MIT");
  });

  it("serializes the enabled state explicitly", () => {
    const on = buildPluginAdminMeta(asPlugins([{ ...base }]), undefined);
    expect(on[0].enabled).toBe(true);

    const off = buildPluginAdminMeta(
      asPlugins([{ ...base, enabled: false }]),
      undefined
    );
    expect(off[0].enabled).toBe(false);
  });

  it("serializes dependsOn ranges for the detail page", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([{ ...base, dependsOn: { "@acme/core": "^1.2.0" } }]),
      undefined
    );
    expect(meta[0].dependsOn).toEqual({ "@acme/core": "^1.2.0" });
  });

  it("summarizes declared permissions for enabled plugins only", () => {
    const contributes = {
      permissions: [
        {
          action: "export",
          resource: "submissions",
          label: "Export submissions",
          danger: true,
        },
      ],
    };
    const enabled = buildPluginAdminMeta(
      asPlugins([{ ...base, contributes }]),
      undefined
    );
    expect(enabled[0].permissions).toEqual([
      {
        action: "export",
        resource: "submissions",
        label: "Export submissions",
        danger: true,
      },
    ]);

    const disabled = buildPluginAdminMeta(
      asPlugins([{ ...base, enabled: false, contributes }]),
      undefined
    );
    expect(disabled[0].permissions).toBeUndefined();
  });

  it("summarizes declared routes (method + path only) for enabled plugins only", () => {
    const contributes = {
      routes: [
        {
          method: "GET",
          path: "/submissions/export",
          handler: () => new Response(),
          requiredPermission: "export-submissions",
        },
      ],
    };
    const enabled = buildPluginAdminMeta(
      asPlugins([{ ...base, contributes }]),
      undefined
    );
    expect(enabled[0].routes).toEqual([
      { method: "GET", path: "/submissions/export" },
    ]);

    const disabled = buildPluginAdminMeta(
      asPlugins([{ ...base, enabled: false, contributes }]),
      undefined
    );
    expect(disabled[0].routes).toBeUndefined();
  });

  it("lists contributed singles and components slugs alongside collections", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: {
            collections: [{ slug: "forms" }],
            singles: [{ slug: "form-settings" }],
            components: [{ slug: "form-block" }],
          },
        },
      ]),
      undefined
    );
    expect(meta[0].collections).toEqual(["forms"]);
    expect(meta[0].singles).toEqual(["form-settings"]);
    expect(meta[0].components).toEqual(["form-block"]);
  });
});
