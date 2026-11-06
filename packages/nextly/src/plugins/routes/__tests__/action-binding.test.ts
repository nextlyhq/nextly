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
