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

  it("collides two rooted patterns that differ only in a parameter's name", () => {
    // `/hooks/:id` and `/hooks/:slug` are different strings and the same URL.
    // Keyed on the text, both registered and the winner was whichever plugin
    // came first, which is registration order dressed up as routing.
    expect(() =>
      collectPluginRoutes([
        {
          name: "@acme/one",
          contributes: {
            routes: [route({ mount: "root", path: "/hooks/:id" })],
          },
        },
        {
          name: "@acme/two",
          contributes: {
            routes: [route({ mount: "root", path: "/hooks/:slug" })],
          },
        },
      ] as never)
    ).toThrow();
  });

  it("does NOT collide a literal with a capture", () => {
    // The control on the rule above, and the reason it is keyed on shape rather
    // than on "contains a capture": `/items/count` beside `/items/:id` is an
    // ordinary pair that every router supports. Refusing it would have made the
    // collision check reject the common case to catch the rare one.
    expect(() =>
      collectPluginRoutes([
        {
          name: "@acme/one",
          contributes: {
            routes: [route({ mount: "root", path: "/items/count" })],
          },
        },
        {
          name: "@acme/two",
          contributes: {
            routes: [route({ mount: "root", path: "/items/:id" })],
          },
        },
      ] as never)
    ).not.toThrow();
  });

  it("answers the literal pattern when both could match", () => {
    // Which makes the pair above unambiguous rather than merely permitted.
    const reg = new PluginRouteRegistry();
    reg.register(
      "@acme/two",
      route({ mount: "root", path: "/items/:id" }),
      ctx
    );
    reg.register(
      "@acme/one",
      route({ mount: "root", path: "/items/count" }),
      ctx
    );
    // Registered SECOND on purpose: first-match-wins would answer with the
    // capture, and the assertion would pass for the wrong reason if the
    // specific one had been registered first.
    expect(reg.match("GET", "/items/count", "root")?.pluginName).toBe(
      "@acme/one"
    );
    expect(reg.match("GET", "/items/42", "root")?.pluginName).toBe("@acme/two");
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
