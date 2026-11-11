/**
 * The actions a route is bound to, read from the plugin definition it was
 * registered with: each action of the plugin that runs it, by method, path
 * and mount, its collections under the slugs they are served as, through
 * every configured plugin, a disabled one included.
 */
import { describe, expect, it } from "vitest";

import type { AdminContribution } from "../../admin-contributions";
import type { PluginDefinition } from "../../plugin-context";
import { boundActionsOf } from "../action-binding";
import type { PluginRoute } from "../route-types";

const ESCALATE: PluginRoute = {
  method: "POST",
  path: "/escalate",
  handler: () => new Response(),
};

const SUPPORT: PluginDefinition = {
  name: "@acme/support",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    routes: [ESCALATE, { ...ESCALATE, mount: "root" }],
    admin: {
      contributions: [
        {
          id: "acme-support.escalate",
          kind: "rowAction",
          place: "collection.list",
          label: "Escalate",
          collections: ["forms", "tickets"],
          action: { run: { method: "POST", path: "/escalate" } },
          visibleWhen: { field: "status", notEquals: "closed" },
        },
        {
          id: "acme-support.rooted",
          kind: "rowAction",
          place: "collection.list",
          label: "Rooted",
          action: { run: { method: "POST", path: "/escalate", mount: "root" } },
        },
        {
          id: "acme-support.preview",
          kind: "rowAction",
          place: "collection.list",
          label: "Preview",
          action: { open: "x#Preview" },
        },
      ] as AdminContribution[],
    },
  },
};

/** A disabled plugin whose collection is still served, under its renamed slug. */
const FORMS: PluginDefinition = {
  name: "@acme/forms",
  version: "1.0.0",
  nextly: "*",
  enabled: false,
  collections: [{ slug: "forms", fields: [] }],
  renameMap: { forms: "contact-forms" },
};

describe("boundActionsOf", () => {
  it("binds the plugin's actions that run the route, by method, path and mount", () => {
    expect(
      boundActionsOf(SUPPORT, ESCALATE, [SUPPORT, FORMS]).map(a => a.id)
    ).toEqual(["acme-support.escalate"]);
    expect(
      boundActionsOf(SUPPORT, { ...ESCALATE, mount: "root" }, [
        SUPPORT,
        FORMS,
      ]).map(a => a.id)
    ).toEqual(["acme-support.rooted"]);
  });

  it("names each collection as it is served, through a disabled contributor too", () => {
    const [escalate] = boundActionsOf(SUPPORT, ESCALATE, [SUPPORT, FORMS]);
    expect(escalate).toMatchObject({
      kind: "rowAction",
      collections: ["contact-forms", "tickets"],
      visibleWhen: { field: "status", notEquals: "closed" },
    });
  });

  it("binds nothing for a disabled plugin", () => {
    expect(
      boundActionsOf({ ...SUPPORT, enabled: false }, ESCALATE, [SUPPORT])
    ).toEqual([]);
  });
});

describe("the person's menu item's action", () => {
  const REBUILD: PluginRoute = {
    method: "POST",
    path: "/rebuild",
    handler: () => new Response(),
  };
  const withMenu = (
    run: { method: "POST"; path: string },
    routes: PluginRoute[] = [ESCALATE, REBUILD]
  ): PluginDefinition => ({
    ...SUPPORT,
    contributes: {
      ...SUPPORT.contributes,
      routes,
      admin: {
        ...SUPPORT.contributes?.admin,
        header: {
          place: "menu",
          item: { label: "Escalate all", icon: "BookOpen", action: { run } },
        },
      },
    },
  });

  it("binds the item under its id beside the list actions on a shared route", () => {
    const plugin = withMenu({ method: "POST", path: "/escalate" });
    expect(
      boundActionsOf(plugin, ESCALATE, [plugin]).map(a => [a.id, a.kind])
    ).toEqual([
      ["acme-support.escalate", "rowAction"],
      ["acme-support.user-menu", "userMenuItem"],
    ]);
  });

  it("binds the item only to the route it runs", () => {
    const plugin = withMenu({ method: "POST", path: "/rebuild" });
    expect(boundActionsOf(plugin, REBUILD, [plugin]).map(a => a.id)).toEqual([
      "acme-support.user-menu",
    ]);
    expect(boundActionsOf(plugin, ESCALATE, [plugin]).map(a => a.id)).toEqual([
      "acme-support.escalate",
    ]);
  });

  it("binds no public route, and nothing for a disabled plugin", () => {
    const open = { ...REBUILD, public: true } as PluginRoute;
    const plugin = withMenu({ method: "POST", path: "/rebuild" }, [open]);
    expect(boundActionsOf(plugin, open, [plugin])).toEqual([]);
    const off = {
      ...withMenu({ method: "POST", path: "/rebuild" }),
      enabled: false,
    };
    expect(boundActionsOf(off, REBUILD, [off])).toEqual([]);
  });
});
