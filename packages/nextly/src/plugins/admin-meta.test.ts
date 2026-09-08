import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "./plugin-context";
import { definePlugin } from "./plugin-context";

import { NEXTLY_ERROR_STATUS } from "../errors/error-codes";
import { NextlyError } from "../errors/nextly-error";

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
      storage: "number",
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
      // Storage is not presentation: it decides how the type's values behave,
      // so it always travels even when every optional key is omitted.
      storage: "number",
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
      { type: "rating", component: "@acme/p/admin#Rating", storage: "number" },
    ]);

    // Disabled plugins keep their collections + custom field types so the admin
    // can still render fields of retained collections.
    const disabled = buildPluginAdminMeta(
      asPlugins([{ ...base, enabled: false, contributes: { fieldTypes } }]),
      undefined
    );
    expect(disabled[0].fieldTypes).toEqual([
      { type: "rating", component: "@acme/p/admin#Rating", storage: "number" },
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

  /**
   * The admin-meta endpoint answers WITHOUT authentication, so anything on this
   * payload is readable by anyone who can reach the app. A permission
   * vocabulary is a map of what the installation can do and how each capability
   * is spelled, which is reconnaissance rather than content, so it is not
   * served here at all.
   *
   * Asserted against a plugin that DECLARES one, so the absence is the
   * serializer declining to carry it rather than a fixture with nothing to
   * carry. The admin reads the seeded rows from the authenticated permissions
   * endpoint instead, which is also the set that actually exists.
   */
  it("never serializes declared permissions onto the public payload", () => {
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
    expect(enabled[0]).not.toHaveProperty("permissions");
    // The plugin itself was serialized: without this the assertion above would
    // pass just as well for a fixture the builder dropped entirely.
    expect(enabled[0].name).toBe(base.name);

    const disabled = buildPluginAdminMeta(
      asPlugins([{ ...base, enabled: false, contributes }]),
      undefined
    );
    expect(disabled[0]).not.toHaveProperty("permissions");
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
    // `fullPath` travels too: it is the namespace the dispatcher mounts the
    // route at, derived from the raw package name, and the admin renders it
    // rather than rebuilding it from the slug.
    expect(enabled[0].routes).toEqual([
      {
        method: "GET",
        path: "/submissions/export",
        fullPath: "/plugins/@acme/p/submissions/export",
      },
    ]);

    const disabled = buildPluginAdminMeta(
      asPlugins([{ ...base, enabled: false, contributes }]),
      undefined
    );
    expect(disabled[0].routes).toBeUndefined();
  });

  it("lists contributed singles and field group slugs alongside collections", () => {
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          contributes: {
            collections: [{ slug: "forms" }],
            singles: [{ slug: "form-settings" }],
            fieldGroups: [{ slug: "form-block" }],
          },
        },
      ]),
      undefined
    );
    expect(meta[0].collections).toEqual(["forms"]);
    expect(meta[0].singles).toEqual(["form-settings"]);
    expect(meta[0].fieldGroups).toEqual(["form-block"]);
  });
});

describe("buildPluginAdminMeta — clientConfig", () => {
  const withConfig = (clientConfig: Record<string, unknown>) =>
    asPlugins([{ ...base, contributes: { admin: { clientConfig } } }]);

  it("delivers a plugin's own config to the client", () => {
    // A plugin's factory runs on the server when the host builds its config;
    // its admin components run in the browser. This is the only thing that
    // crosses between them.
    const meta = buildPluginAdminMeta(
      withConfig({
        remotePatterns: [{ protocol: "https", hostname: "a.example" }],
      }),
      undefined
    );
    expect(meta[0]?.clientConfig).toEqual({
      remotePatterns: [{ protocol: "https", hostname: "a.example" }],
    });
  });

  it("keeps it for a disabled plugin, whose field editors still mount", () => {
    // Unlike menus and pages, which a disabled plugin does not render at all.
    // Its collections and their fields are retained, so its field editors DO
    // render, and one configured by this would read `undefined`. For the page
    // builder that is a configured allowlist becoming an empty one, which
    // makes remote media vanish from entries that are otherwise fine.
    const meta = buildPluginAdminMeta(
      asPlugins([
        {
          ...base,
          enabled: false,
          contributes: {
            admin: { clientConfig: { a: 1 }, menu: [{ label: "X", to: "/x" }] },
          },
        },
      ]),
      undefined
    );
    expect(meta[0]?.enabled).toBe(false);
    expect(meta[0]?.clientConfig).toEqual({ a: 1 });
    // The behavioral surface is still withheld, so this is a deliberate
    // distinction rather than the enabled gate having been dropped.
    expect(meta[0]?.menu).toBeUndefined();
  });

  it("refuses config that will not survive the trip, naming the plugin", () => {
    // Rejected rather than repaired. A config whose Dates arrive as strings and
    // whose functions arrive as nothing still looks plausible to the component
    // reading it, which is harder to diagnose than a config that never arrives.
    for (const bad of [
      { when: new Date() },
      { fn: () => 1 },
      { m: new Map() },
      { s: new Set([1]) },
      { big: 1n },
      { nested: { deep: [{ when: new Date() }] } },
    ]) {
      // The public message stays generic; the plugin and the offending keys
      // live in the log context, which is where a boot failure is read.
      let thrown: unknown;
      try {
        buildPluginAdminMeta(withConfig(bad), undefined);
      } catch (error) {
        thrown = error;
      }
      const label = JSON.stringify(Object.keys(bad));
      expect(NextlyError.is(thrown), label).toBe(true);
      const err = thrown as NextlyError;
      expect(String(err.code), label).toBe(
        "NEXTLY_PLUGIN_CLIENT_CONFIG_INVALID"
      );
      expect(err.logContext?.plugin, label).toBe("@acme/p");
      // Named so an author does not have to bisect the object to find it.
      expect(err.logContext?.keys, label).toEqual(Object.keys(bad));
    }
  });

  it("refuses a key whose value simply disappears", () => {
    // `undefined` and a function are both dropped by JSON, so the object the
    // client receives is missing a key the plugin wrote. That is a silent
    // shape change, not a harmless omission.
    expect(() =>
      buildPluginAdminMeta(withConfig({ a: 1, gone: undefined }), undefined)
    ).toThrow(NextlyError);
  });

  it("accepts the JSON shapes a real config uses", () => {
    const config = {
      s: "x",
      n: 1,
      b: true,
      nul: null,
      arr: [1, "two", { three: 3 }],
      nested: { deep: { deeper: [true] } },
    };
    const meta = buildPluginAdminMeta(withConfig(config), undefined);
    expect(meta[0]?.clientConfig).toEqual(config);
  });

  it("survives a cycle by refusing rather than by hanging", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => buildPluginAdminMeta(withConfig(cyclic), undefined)).toThrow(
      NextlyError
    );
  });
});

describe("buildPluginAdminMeta — clientConfig runtime shapes", () => {
  const withConfig = (clientConfig: unknown) =>
    asPlugins([
      { ...base, contributes: { admin: { clientConfig } } },
    ]) as PluginDefinition[];

  it("refuses a top level that is not a plain object", () => {
    // The declared type promises a record; a JavaScript host need not deliver
    // one. Each of these round-trips perfectly, so only a shape check catches
    // it — and every reader downstream assumes an object it can destructure.
    for (const bad of [null, [1, 2], "a string", 42, true]) {
      expect(
        () => buildPluginAdminMeta(withConfig(bad), undefined),
        JSON.stringify(bad)
      ).toThrow(NextlyError);
    }
  });

  it("refuses negative zero, which JSON turns into zero", () => {
    // Observable in the browser as `1 / value`, so it is a mangled copy like
    // any other rather than a rounding detail.
    expect(() =>
      buildPluginAdminMeta(withConfig({ n: -0 }), undefined)
    ).toThrow(NextlyError);
  });

  it("reports a throwing getter instead of letting it escape", () => {
    // The diagnostic path reads each value to name the offending key, so a
    // getter that throws would replace the reportable error with a raw one
    // from the very function whose job is to describe the problem.
    const config = {
      ok: 1,
      get boom(): never {
        throw new Error("getter");
      },
    };
    let thrown: unknown;
    try {
      buildPluginAdminMeta(withConfig(config), undefined);
    } catch (error) {
      thrown = error;
    }
    expect(NextlyError.is(thrown)).toBe(true);
    expect(String((thrown as NextlyError).code)).toBe(
      "NEXTLY_PLUGIN_CLIENT_CONFIG_INVALID"
    );
  });

  it("resolves its status from the canonical table, not an inline literal", () => {
    let thrown: unknown;
    try {
      buildPluginAdminMeta(withConfig({ when: new Date() }), undefined);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as NextlyError).statusCode).toBe(
      NEXTLY_ERROR_STATUS.NEXTLY_PLUGIN_CLIENT_CONFIG_INVALID
    );
  });
});

/**
 * Routes and permissions are asymmetric, and the tests exist to hold that
 * apart. `collectPluginRoutes` covers enabled plugins only, so a disabled
 * plugin serves nothing — that is what enabling would add. `collectCustomPermissions`
 * folds over every plugin including disabled ones, so its permissions are
 * already seeded and are not pending on anything.
 */
describe("dormant routes", () => {
  const declaring = {
    name: "@acme/p",
    version: "1.0.0",
    contributes: {
      permissions: [
        { action: "export", resource: "submissions", danger: true },
      ],
      routes: [{ method: "GET", path: "/export", handler: () => undefined }],
    },
  } as unknown as PluginDefinition;

  it("reports a disabled plugin's routes as dormant, not active", () => {
    const [meta] = buildPluginAdminMeta(
      [{ ...declaring, enabled: false } as PluginDefinition],
      undefined
    );

    expect(meta.whenEnabled?.routes).toEqual([
      { method: "GET", path: "/export", fullPath: "/plugins/@acme/p/export" },
    ]);
    expect(meta.routes).toBeUndefined();
  });

  /**
   * The separating case for the routes/permissions split. A disabled plugin's
   * permissions are seeded whatever this page shows, so presenting them as
   * something enabling would ADD would be false — the dormant branch must
   * carry routes and nothing else.
   */
  it("never presents permissions as pending on being enabled", () => {
    const [meta] = buildPluginAdminMeta(
      [{ ...declaring, enabled: false } as PluginDefinition],
      undefined
    );

    expect(Object.keys(meta.whenEnabled ?? {})).toEqual(["routes"]);
  });

  it("reports an enabled plugin's routes as active, not dormant", () => {
    const [meta] = buildPluginAdminMeta(
      [{ ...declaring, enabled: true } as PluginDefinition],
      undefined
    );

    expect(meta.routes).toEqual([
      { method: "GET", path: "/export", fullPath: "/plugins/@acme/p/export" },
    ]);
    expect(meta.whenEnabled).toBeUndefined();
  });

  it.each([true, false])(
    "never carries the active and dormant routes together (enabled=%s)",
    enabled => {
      const [meta] = buildPluginAdminMeta(
        [{ ...declaring, enabled } as PluginDefinition],
        undefined
      );

      const active = Boolean(meta.routes);
      const dormant = Boolean(meta.whenEnabled);
      expect(active && dormant).toBe(false);
      // Exactly one, so this cannot pass on a plugin that serialized neither.
      expect(active || dormant).toBe(true);
    }
  );

  /**
   * `collectPluginRoutes` throws on a path without a leading slash, so a
   * declaration like this cannot mount. Presenting it as something enabling
   * would add is a promise that boot then refuses.
   */
  it("omits a declared route that could not mount", () => {
    const [meta] = buildPluginAdminMeta(
      [
        {
          name: "@acme/bad",
          version: "1.0.0",
          enabled: false,
          contributes: { routes: [{ method: "GET", path: "export" }] },
        } as unknown as PluginDefinition,
      ],
      undefined
    );

    expect(meta.whenEnabled).toBeUndefined();
  });

  /**
   * The second of `collectPluginRoutes`'s two rules, and the one a
   * leading-slash filter alone would miss. Two declarations sharing a
   * `(method, full path)` make boot throw NEXTLY_ROUTE_COLLISION, so
   * advertising both as things enabling would serve is a promise boot refuses.
   */
  it("omits declarations that collide with each other", () => {
    const [meta] = buildPluginAdminMeta(
      [
        {
          name: "@acme/dup",
          version: "1.0.0",
          enabled: false,
          contributes: {
            routes: [
              { method: "GET", path: "/export" },
              { method: "GET", path: "/export" },
            ],
          },
        } as unknown as PluginDefinition,
      ],
      undefined
    );

    expect(meta.whenEnabled).toBeUndefined();
  });

  it("omits the dormant branch for a plugin that declares no routes", () => {
    const [meta] = buildPluginAdminMeta(
      [
        {
          name: "@acme/bare",
          version: "1.0.0",
          enabled: false,
        } as PluginDefinition,
      ],
      undefined
    );

    expect(meta.whenEnabled).toBeUndefined();
  });
});

/**
 * Namespaces are built from package names, so a collision need not be
 * self-inflicted: an enabled plugin can already own the path a disabled one
 * would claim. Advertising it as something enabling would serve is a promise
 * boot refuses.
 */
describe("dormant routes against the enabled set", () => {
  const enabledOwner = {
    name: "foo",
    version: "1.0.0",
    contributes: { routes: [{ method: "GET", path: "/bar/x" }] },
  } as unknown as PluginDefinition;

  const disabledClaimant = {
    name: "foo/bar",
    version: "1.0.0",
    enabled: false,
    contributes: { routes: [{ method: "GET", path: "/x" }] },
  } as unknown as PluginDefinition;

  it("omits a dormant route an enabled plugin already serves", () => {
    // Both resolve to /plugins/foo/bar/x.
    const metas = buildPluginAdminMeta(
      [enabledOwner, disabledClaimant],
      undefined
    );
    const claimant = metas.find(m => m.name === "foo/bar");

    expect(claimant?.whenEnabled).toBeUndefined();
  });

  /**
   * The control. Without the enabled owner present the same declaration is
   * perfectly mountable, so the omission above is about the collision rather
   * than about a route that was never valid.
   */
  it("keeps it when no enabled plugin holds that path", () => {
    const metas = buildPluginAdminMeta([disabledClaimant], undefined);
    const claimant = metas.find(m => m.name === "foo/bar");

    expect(claimant?.whenEnabled?.routes).toEqual([
      { method: "GET", path: "/x", fullPath: "/plugins/foo/bar/x" },
    ]);
  });

  it("leaves the enabled owner's own route reported", () => {
    const metas = buildPluginAdminMeta(
      [enabledOwner, disabledClaimant],
      undefined
    );

    expect(metas.find(m => m.name === "foo")?.routes).toEqual([
      { method: "GET", path: "/bar/x", fullPath: "/plugins/foo/bar/x" },
    ]);
  });
});

/**
 * A menu item that spells a slug survives boot and breaks at navigation.
 *
 * `.rename()` moves a contributed collection and the permission its slug
 * seeds, and nothing type-checks a path or a permission string, so the
 * broken versions of these items all serialize. Each assertion below is
 * written against one of them: a `to` still naming the declared slug, a
 * `requiredPermission` still naming it, a literal path rewritten by a rule
 * that should not have touched it, and the declared slug leaking through to
 * the client beside the resolved one.
 */
describe("buildPluginAdminMeta menu slugs", () => {
  /** A plugin owning `patterns`, offering it a menu item, optionally renamed. */
  function withPatternsMenu(map?: Record<string, string>): PluginDefinition {
    const plugin = definePlugin({
      ...base,
      contributes: {
        collections: [{ slug: "patterns" } as never],
        admin: {
          menu: [
            {
              label: "Patterns",
              collection: "patterns",
              to: "/admin/collections/patterns",
              icon: "LayoutTemplate",
            },
          ],
        },
      },
    } as unknown as PluginDefinition);
    return map ? (plugin.rename?.(map) ?? plugin) : plugin;
  }

  const menuOf = (plugin: PluginDefinition) =>
    buildPluginAdminMeta([plugin], undefined)[0].menu;

  it("points the item at the slug the host registered", () => {
    // The control: the same declaration with nothing renamed has to resolve to
    // the declared slug. Without it, a resolver that returned a constant, or
    // one that dropped the item, would satisfy the renamed assertion below.
    expect(menuOf(withPatternsMenu())?.[0]).toMatchObject({
      to: "/admin/collections/patterns",
      requiredPermission: "read-patterns",
    });

    expect(
      menuOf(withPatternsMenu({ patterns: "saved-patterns" }))?.[0]
    ).toMatchObject({
      to: "/admin/collections/saved-patterns",
      // The gate moves with the link. A rename seeds `read-saved-patterns`,
      // so an item still asking for `read-patterns` is withheld from every
      // non-super-admin who can open the list.
      requiredPermission: "read-saved-patterns",
    });
  });

  it("does not ship the declared slug beside the resolved one", () => {
    const item = menuOf(withPatternsMenu({ patterns: "saved-patterns" }))?.[0];

    // Two answers to one question, of which the stale one reads as
    // authoritative because it is the name the plugin's own code uses.
    expect(item).not.toHaveProperty("collection");
  });

  it("leaves an item that names no collection exactly as written", () => {
    const plugin = definePlugin({
      ...base,
      contributes: {
        collections: [{ slug: "patterns" } as never],
        admin: {
          menu: [
            {
              label: "Pages",
              to: "/admin/collections/patterns",
              icon: "Layout",
            },
          ],
        },
      },
    } as unknown as PluginDefinition);
    // The rename map COVERS the slug spelled in the path, so a resolver that
    // rewrote paths by matching text rather than by reading `collection`
    // would move this one. It must not: the item named no collection, and an
    // author's literal path is not the framework's to reinterpret.
    const renamed = plugin.rename?.({ patterns: "saved-patterns" }) ?? plugin;

    expect(menuOf(renamed)?.[0]).toEqual({
      label: "Pages",
      to: "/admin/collections/patterns",
      icon: "Layout",
    });
  });

  it("refuses an item naming a collection the plugin does not contribute", () => {
    const plugin = definePlugin({
      ...base,
      contributes: {
        collections: [{ slug: "patterns" } as never],
        admin: {
          menu: [
            {
              label: "Patterns",
              collection: "pattrens",
              to: "/admin/collections/patterns",
            },
          ],
        },
      },
    } as unknown as PluginDefinition);

    // A typo resolves to a well-formed path and a well-formed permission, and
    // both are wrong in the quietest way available: the permission is never
    // seeded, so a non-super-admin cannot tell the item from one they are not
    // allowed to see. Registration is the last moment it is visible as a
    // mistake, so it is refused there rather than serialized.
    let caught: unknown;
    try {
      menuOf(plugin);
    } catch (error) {
      caught = error;
    }

    // Asserted on the reason and the log message rather than on `message`,
    // which every plugin resolution error answers with the same sentence — a
    // match on it would pass for a duplicate admin slug just as readily.
    expect(
      (caught as { logContext?: { reason?: string } })?.logContext?.reason
    ).toBe("menu-item-unowned-collection");
    // Names the offending slug AND what it could have been. Neither is
    // recoverable from the other, and a reader looking at a typo is exactly
    // the reader who cannot see it.
    const logMessage = (caught as { logMessage?: string })?.logMessage ?? "";
    expect(logMessage).toContain("pattrens");
    expect(logMessage).toContain("patterns");
  });

  it("keeps a destination that carries list state when nothing is renamed", () => {
    const plugin = definePlugin({
      ...base,
      contributes: {
        collections: [{ slug: "patterns" } as never],
        admin: {
          menu: [
            {
              label: "Drafts",
              collection: "patterns",
              to: "/admin/collections/patterns?status=draft",
            },
          ],
        },
      },
    } as unknown as PluginDefinition);

    // Naming a collection is how an item opts into rename-safety and RBAC, not
    // a request to be sent somewhere canonical. Overwriting `to` made adding
    // `collection` to a working link silently change where that link went —
    // and the contract on the field says the opposite.
    expect(menuOf(plugin)?.[0]).toMatchObject({
      to: "/admin/collections/patterns?status=draft",
      requiredPermission: "read-patterns",
    });

    // And when the slug DOES move, only the collection segment is rewritten.
    const renamed = plugin.rename?.({ patterns: "saved" }) ?? plugin;
    expect(menuOf(renamed)?.[0]).toMatchObject({
      to: "/admin/collections/saved?status=draft",
      requiredPermission: "read-saved",
    });
  });

  it("does not resolve a slug through an inherited object property", () => {
    const plugin = definePlugin({
      ...base,
      contributes: {
        // A legal slug that is also a key every object inherits.
        collections: [{ slug: "constructor" } as never],
        admin: {
          menu: [
            {
              label: "Constructor",
              collection: "constructor",
              to: "/admin/collections/constructor",
            },
          ],
        },
      },
    } as unknown as PluginDefinition);

    // With no rename the map is `{}`, and `{}["constructor"]` is the Object
    // constructor — a function, so `??` never fires and the destination
    // becomes the source text of a native function.
    expect(menuOf(plugin)?.[0]).toMatchObject({
      to: "/admin/collections/constructor",
      requiredPermission: "read-constructor",
    });
  });

  it("resolves a nested item too", () => {
    const plugin = definePlugin({
      ...base,
      contributes: {
        collections: [{ slug: "patterns" } as never],
        admin: {
          menu: [
            {
              label: "Design",
              to: "/admin/collections/patterns",
              children: [
                {
                  label: "Patterns",
                  collection: "patterns",
                  to: "/admin/collections/patterns",
                },
              ],
            },
          ],
        },
      },
    } as unknown as PluginDefinition);
    const renamed = plugin.rename?.({ patterns: "saved-patterns" }) ?? plugin;

    // A child is exactly as stranded as a parent, and is the one a resolver
    // that only walked the top level would leave behind.
    expect(menuOf(renamed)?.[0].children?.[0]).toMatchObject({
      to: "/admin/collections/saved-patterns",
      requiredPermission: "read-saved-patterns",
    });
  });
});
