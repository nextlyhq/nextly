import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../plugin-context";

import { collectPluginRoutes } from "./collect-routes";

const h = () => new Response("");

/** Capture the NextlyError a thunk throws and return its `code`. */
function thrownCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as NextlyError).code as string;
  }
  throw new Error("expected the function to throw");
}

function plugin(
  name: string,
  routes: Array<{
    method: "GET" | "POST";
    path: string;
    mount?: "plugin" | "root";
  }>,
  enabled?: boolean
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: ">=0.0.1",
    ...(enabled === undefined ? {} : { enabled }),
    contributes: { routes: routes.map(r => ({ ...r, handler: h })) },
  } as PluginDefinition;
}

describe("collectPluginRoutes", () => {
  it("collects enabled plugins' routes, namespaced; skips disabled", () => {
    const collected = collectPluginRoutes([
      plugin("@a/x", [{ method: "GET", path: "/p" }]),
      plugin("@a/y", [{ method: "GET", path: "/q" }], false),
    ]);
    expect(collected.map(r => r.fullPath)).toEqual(["/plugins/@a/x/p"]);
    expect(collected[0].pluginName).toBe("@a/x");
  });

  it("throws on a (method, path) collision across plugins", () => {
    expect(
      thrownCode(() =>
        collectPluginRoutes([
          plugin("@a/x", [{ method: "GET", path: "/p" }]),
          plugin("@a/x", [{ method: "GET", path: "/p" }]),
        ])
      )
    ).toBe("NEXTLY_ROUTE_COLLISION");
  });

  it("allows the same path with different methods", () => {
    const collected = collectPluginRoutes([
      plugin("@a/x", [
        { method: "GET", path: "/p" },
        { method: "POST", path: "/p" },
      ]),
    ]);
    expect(collected).toHaveLength(2);
  });

  it("rejects a path without a leading slash", () => {
    expect(
      thrownCode(() =>
        collectPluginRoutes([plugin("@a/x", [{ method: "GET", path: "bad" }])])
      )
    ).toBe("NEXTLY_ROUTE_INVALID_PATH");
  });

  /**
   * The collision rule asks whether ONE request could reach two routes, and the
   * registry matches each mount in its own pass -- so two patterns under
   * different mounts never compete however alike they look. These two overlap
   * on `/plugins/foo/bar/baz` and carry three literals each, which is a
   * collision within a mount and nothing at all across them: the root route
   * still answers `/custom/foo/bar/baz`, where the namespaced one cannot go.
   */
  it("allows overlapping patterns filed under different mounts", () => {
    const collected = collectPluginRoutes([
      plugin("foo", [{ method: "GET", path: "/bar/:id" }]),
      plugin("@a/root", [
        { method: "GET", path: "/:scope/foo/bar/baz", mount: "root" },
      ]),
    ]);

    expect(collected.map(r => r.fullPath)).toEqual([
      "/plugins/foo/bar/:id",
      "/:scope/foo/bar/baz",
    ]);
  });

  it("still refuses overlapping patterns under the SAME mount", () => {
    // The control for the pair above: identical shapes, one mount, so a request
    // to `/x/foo/bar/baz` could reach either and registration order would pick.
    expect(
      thrownCode(() =>
        collectPluginRoutes([
          plugin("@a/one", [
            { method: "GET", path: "/:scope/foo/bar/baz", mount: "root" },
          ]),
          plugin("@a/two", [
            { method: "GET", path: "/x/foo/bar/:id", mount: "root" },
          ]),
        ])
      )
    ).toBe("NEXTLY_ROUTE_COLLISION");
  });

  /**
   * The type says `"plugin" | "root"`, and a plugin authored in JavaScript
   * reaches the fold without ever meeting it. Downstream nothing agrees about
   * an unknown value: `pluginRouteFullPath` reads anything but `"root"` as
   * namespaced, the registry files the typo verbatim, and the matcher asks only
   * for the two it knows. The route registers, appears in `/api/admin-meta`,
   * and can never match, which is the same silent shape a root route on an
   * unreachable prefix has.
   */
  it("rejects a mount outside the union", () => {
    expect(
      thrownCode(() =>
        collectPluginRoutes([
          plugin("@a/x", [
            {
              method: "GET",
              path: "/p",
              mount: "roots" as "root",
            },
          ]),
        ])
      )
    ).toBe("NEXTLY_ROUTE_INVALID_MOUNT");
  });

  it("accepts both declared mounts, and an absent one", () => {
    // The control. A check that refused everything would pass the assertion
    // above while making the whole contract unusable.
    const collected = collectPluginRoutes([
      plugin("@a/x", [
        { method: "GET", path: "/a" },
        { method: "GET", path: "/b", mount: "plugin" },
        { method: "GET", path: "/c", mount: "root" },
      ]),
    ]);

    expect(collected.map(r => r.fullPath)).toEqual([
      "/plugins/@a/x/a",
      "/plugins/@a/x/b",
      "/c",
    ]);
  });

  it("returns an empty list when no plugin contributes routes", () => {
    expect(
      collectPluginRoutes([
        { name: "@a/z", version: "1", nextly: ">=0" } as PluginDefinition,
      ])
    ).toEqual([]);
  });
});

describe("a route asking for a plugin's kind of signed-in person", () => {
  /** A plugin registering `accounts:account`, with one route to judge. */
  function accounts(
    route: Record<string, unknown>,
    enabled?: boolean
  ): PluginDefinition {
    return {
      name: "accounts",
      version: "1.0.0",
      nextly: ">=0.0.1",
      ...(enabled === undefined ? {} : { enabled }),
      contributes: {
        principals: [
          { name: "account", attributes: {}, resolve: async () => null },
        ],
        routes: [{ method: "POST", path: "/cart", handler: h, ...route }],
      },
    } as unknown as PluginDefinition;
  }

  /** Why collection refused, or that it did not. */
  function refusal(plugins: PluginDefinition[]): string {
    try {
      collectPluginRoutes(plugins);
    } catch (e) {
      return (e as NextlyError).logMessage ?? "";
    }
    return "collected";
  }

  it("is collected when a plugin registers the kind", () => {
    // The control for every refusal below.
    expect(
      refusal([accounts({ principal: { kind: "accounts:account" } })])
    ).toBe("collected");
  });

  it("is collected when it asks for another plugin's kind", () => {
    const shop = {
      name: "shop",
      version: "1.0.0",
      nextly: ">=0.0.1",
      contributes: {
        routes: [
          {
            method: "GET",
            path: "/orders",
            handler: h,
            principal: { kind: "accounts:account" },
          },
        ],
      },
    } as unknown as PluginDefinition;
    expect(refusal([accounts({}), shop])).toBe("collected");
  });

  it("is refused when it is also public", () => {
    expect(
      refusal([
        accounts({ principal: { kind: "accounts:account" }, public: true }),
      ])
    ).toMatch(/principal cannot be combined with public: true/);
  });

  it.each([
    ["a fixed slug", "update-carts"],
    ["a resolver", () => "update-carts"],
  ])("is refused when it also names a permission, as %s", (_l, permission) => {
    expect(
      refusal([
        accounts({
          principal: { kind: "accounts:account" },
          requiredPermission: permission,
        }),
      ])
    ).toMatch(/principal cannot be combined with requiredPermission/);
  });

  it("is refused when no plugin registers the kind", () => {
    expect(
      refusal([accounts({ principal: { kind: "accounts:acount" } })])
    ).toMatch(/"accounts:acount", which no enabled plugin registers/);
  });

  it("is refused when only a disabled plugin registers the kind", () => {
    const disabledAccounts = {
      ...accounts({}, false),
      name: "accounts",
    } as PluginDefinition;
    const shop = {
      name: "shop",
      version: "1.0.0",
      nextly: ">=0.0.1",
      contributes: {
        routes: [
          {
            method: "GET",
            path: "/orders",
            handler: h,
            principal: { kind: "accounts:account" },
          },
        ],
      },
    } as unknown as PluginDefinition;
    expect(refusal([disabledAccounts, shop])).toMatch(
      /which no enabled plugin registers/
    );
  });

  it.each([
    ["a bare string", "accounts:account"],
    ["an unknown key", { kind: "accounts:account", optional: true }],
    [
      "a required that is not a boolean",
      { kind: "accounts:account", required: "no" },
    ],
  ])("is refused when principal is %s", (_l, principal) => {
    expect(refusal([accounts({ principal })])).toMatch(/principal/);
    expect(refusal([accounts({ principal })])).not.toBe("collected");
  });
});
