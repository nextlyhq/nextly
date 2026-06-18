import { beforeEach, describe, expect, it } from "vitest";

import {
  getPluginRouteRegistry,
  resetPluginRouteRegistry,
} from "./route-registry";
import type { PluginRoute } from "./route-types";

const handler: PluginRoute["handler"] = () => new Response("ok");
const baseCtx = {} as never;

beforeEach(() => resetPluginRouteRegistry());

describe("PluginRouteRegistry", () => {
  it("matches a static namespaced route", () => {
    const reg = getPluginRouteRegistry();
    reg.register("@acme/x", { method: "GET", path: "/ping", handler }, baseCtx);
    const m = reg.match("GET", "/plugins/@acme/x/ping");
    expect(m?.pluginName).toBe("@acme/x");
    expect(m?.params).toEqual({});
    expect(m?.route.path).toBe("/ping");
  });

  it("captures :params and ignores the wrong method", () => {
    const reg = getPluginRouteRegistry();
    reg.register(
      "@acme/x",
      { method: "GET", path: "/items/:id", handler },
      baseCtx
    );
    expect(reg.match("GET", "/plugins/@acme/x/items/42")?.params).toEqual({
      id: "42",
    });
    expect(reg.match("POST", "/plugins/@acme/x/items/42")).toBeNull();
  });

  it("returns null for an unknown plugin/path and clears", () => {
    const reg = getPluginRouteRegistry();
    reg.register("@acme/x", { method: "GET", path: "/ping", handler }, baseCtx);
    expect(reg.match("GET", "/plugins/@acme/y/ping")).toBeNull();
    expect(reg.match("GET", "/plugins/@acme/x/ping/extra")).toBeNull();
    resetPluginRouteRegistry();
    expect(getPluginRouteRegistry().list()).toHaveLength(0);
  });

  it("exposes registered routes via list()", () => {
    const reg = getPluginRouteRegistry();
    reg.register("@acme/x", { method: "GET", path: "/ping", handler }, baseCtx);
    reg.register(
      "@acme/x",
      { method: "POST", path: "/ping", handler },
      baseCtx
    );
    expect(reg.list().map(r => `${r.method} ${r.fullPath}`)).toEqual([
      "GET /plugins/@acme/x/ping",
      "POST /plugins/@acme/x/ping",
    ]);
  });
});
