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

  it("returns an empty list when no plugin contributes routes", () => {
    expect(
      collectPluginRoutes([
        { name: "@a/z", version: "1", nextly: ">=0" } as PluginDefinition,
      ])
    ).toEqual([]);
  });
});
