/**
 * `/api/dashboard` routes.
 *
 * Six routes, none deeper than the top-level id segment (`stats`,
 * `recent-entries`, `activity`, `query`, and `layout` under two verbs). The
 * risk this file pins: a longer path must 404 rather than match one of them
 * and silently drop the tail, which would let `/api/dashboard/query/extra`
 * reach the widget-query executor as if it were the bare route.
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("dashboard routes", () => {
  it("resolves the widget-query route", () => {
    expect(parseRestRoute(["dashboard", "query"], "POST")).toMatchObject({
      service: "dashboard",
      method: "postWidgetQuery",
    });
  });

  it("does not claim a path with extra segments after query", () => {
    const result = parseRestRoute(["dashboard", "query", "extra"], "POST");
    expect(result.method).not.toBe("postWidgetQuery");
  });

  it("resolves the three GET dashboard routes", () => {
    expect(parseRestRoute(["dashboard", "stats"], "GET")).toMatchObject({
      method: "getDashboardStats",
    });
    expect(
      parseRestRoute(["dashboard", "recent-entries"], "GET")
    ).toMatchObject({
      method: "getDashboardRecentEntries",
    });
    expect(parseRestRoute(["dashboard", "activity"], "GET")).toMatchObject({
      method: "getDashboardActivity",
    });
  });

  it("does not claim a path with extra segments after a GET route", () => {
    expect(
      parseRestRoute(["dashboard", "stats", "extra"], "GET").method
    ).not.toBe("getDashboardStats");
    expect(
      parseRestRoute(["dashboard", "recent-entries", "extra"], "GET").method
    ).not.toBe("getDashboardRecentEntries");
    expect(
      parseRestRoute(["dashboard", "activity", "extra"], "GET").method
    ).not.toBe("getDashboardActivity");
  });

  it("rejects a POST to an id other than query", () => {
    expect(parseRestRoute(["dashboard", "stats"], "POST")).toEqual({});
  });

  it("rejects a GET to an id none of the three routes declare", () => {
    expect(parseRestRoute(["dashboard", "unknown"], "GET")).toEqual({});
  });

  it("resolves the layout route under both of its verbs", () => {
    expect(parseRestRoute(["dashboard", "layout"], "GET")).toMatchObject({
      method: "getWidgetLayout",
    });
    expect(parseRestRoute(["dashboard", "layout"], "PUT")).toMatchObject({
      method: "putWidgetLayout",
    });
  });

  it("does not claim a path with extra segments after layout", () => {
    expect(
      parseRestRoute(["dashboard", "layout", "extra"], "PUT").method
    ).not.toBe("putWidgetLayout");
    expect(
      parseRestRoute(["dashboard", "layout", "extra"], "GET").method
    ).not.toBe("getWidgetLayout");
  });

  it("rejects a PUT to an id other than layout", () => {
    // The PUT branch is checked BEFORE the blanket GET guard, so a PUT that
    // names no layout must fall out of the parser rather than through it.
    expect(parseRestRoute(["dashboard", "stats"], "PUT")).toEqual({});
    expect(parseRestRoute(["dashboard", "query"], "PUT")).toEqual({});
  });

  it.each([
    ["constructor", "constructor"],
    ["toString", "toString"],
    ["__proto__", "__proto__"],
    ["hasOwnProperty", "hasOwnProperty"],
  ])("does not resolve %s as a route id", (_label, id) => {
    // The parser dispatches off a TABLE, and both of its keys come off the
    // URL. `TABLE[key]` reaches `Object.prototype`, so these four names are
    // present on every object literal ever written: `constructor` is a
    // function and `__proto__` an object, either of which would get past a
    // bare truthiness check and be dispatched on.
    expect(parseRestRoute(["dashboard", id], "GET")).toEqual({});
    expect(parseRestRoute(["dashboard", id], "PUT")).toEqual({});
  });

  it.each([
    // The VERB guard needs an id that exists on whatever the verb lookup
    // returns, or the id guard catches the request first and the verb guard is
    // never the reason. `DASHBOARD_ROUTES.constructor` is `Object`, and
    // `Object.call` / `Object.bind` are real functions -- so this pair walks
    // straight through a bare truthiness check and dispatches with `method`
    // and `operation` both undefined. `stats` under a bogus verb cannot show
    // that, because `Object.stats` is undefined either way.
    ["constructor", "call"],
    ["constructor", "bind"],
    ["__proto__", "toString"],
  ])("does not resolve %s as an HTTP verb", (verb, id) => {
    expect(parseRestRoute(["dashboard", id], verb)).toEqual({});
  });

  it("rejects a verb none of the routes declare", () => {
    expect(parseRestRoute(["dashboard", "stats"], "DELETE")).toEqual({});
    expect(parseRestRoute(["dashboard", "query"], "PATCH")).toEqual({});
    expect(parseRestRoute(["dashboard", "layout"], "DELETE")).toEqual({});
    expect(parseRestRoute(["dashboard", "layout"], "POST")).toEqual({});
  });
});
