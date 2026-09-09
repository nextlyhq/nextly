/**
 * A plugin can own a top-level path, and cannot take one core serves.
 *
 * Both halves matter. Without the first, a plugin that takes over an endpoint
 * core stops shipping forces every caller to a new URL for a change none of
 * them asked for. Without the second, declaring `/collections` would put a
 * plugin in front of the collections API, and the guard would be a list of
 * reserved prefixes that has to be updated every time core adds a route.
 *
 * The guard here is the ORDER instead: root routes are consulted only after the
 * built-in router has declined, so core's answer always wins and there is no
 * list to fall behind.
 *
 * @module plugins/routes/route-root-mount
 */
import { describe, expect, it } from "vitest";

import { collectPluginRoutes } from "./collect-routes";
import { pluginRouteFullPath } from "./route-path";
import { PluginRouteRegistry } from "./route-registry";
import type { PluginRoute } from "./route-types";

const ctx = {} as never;

function route(over: Partial<PluginRoute>): PluginRoute {
  return {
    method: "GET",
    path: "/forms",
    handler: () => Response.json({ ok: true }),
    public: true,
    ...over,
  } as PluginRoute;
}

describe("where a plugin route answers", () => {
  it("serves a root route at the path it declared", () => {
    expect(pluginRouteFullPath("@acme/forms", "/forms/:slug", "root")).toBe(
      "/forms/:slug"
    );
  });

  it("still namespaces by default, so nothing changes for a route that says nothing", () => {
    // The control on the default. A mount that silently became "root" would
    // put every existing plugin route at a top-level path.
    expect(pluginRouteFullPath("@acme/forms", "/export")).toBe(
      "/plugins/@acme/forms/export"
    );
  });

  it("keeps the two mounts in separate matching passes", () => {
    const reg = new PluginRouteRegistry();
    reg.register("@acme/forms", route({ mount: "root", path: "/forms" }), ctx);

    // The property the ordering rests on: asking for one mount never answers
    // with the other. `handleServiceRequest` asks for "plugin" before the
    // built-in router and "root" only after it declines, so a root route that
    // answered the first question would be ahead of core.
    expect(reg.match("GET", "/forms", "plugin")).toBeNull();
    expect(reg.match("GET", "/forms", "root")).not.toBeNull();
  });

  it("collision-checks a root path against another plugin's", () => {
    // Two plugins claiming one address is the failure the namespace used to
    // make impossible, so rooting a route has to bring the check with it.
    expect(() =>
      collectPluginRoutes([
        {
          name: "@acme/one",
          contributes: { routes: [route({ mount: "root", path: "/forms" })] },
        },
        {
          name: "@acme/two",
          contributes: { routes: [route({ mount: "root", path: "/forms" })] },
        },
      ] as never)
    ).toThrow();
  });

  it("lets two plugins keep the same path when neither is rooted", () => {
    // The control for the case above: the namespace is what separates them, so
    // this must NOT throw or the collision check is just refusing all reuse.
    expect(() =>
      collectPluginRoutes([
        { name: "@acme/one", contributes: { routes: [route({})] } },
        { name: "@acme/two", contributes: { routes: [route({})] } },
      ] as never)
    ).not.toThrow();
  });
});
