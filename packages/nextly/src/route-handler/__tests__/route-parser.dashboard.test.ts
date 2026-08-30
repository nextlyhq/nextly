/**
 * `/api/dashboard` routes.
 *
 * Four routes, none deeper than the top-level id segment (`stats`,
 * `recent-entries`, `activity`, `query`). The risk this file pins: a longer
 * path must 404 rather than match one of those four and silently drop the
 * tail, which would let `/api/dashboard/query/extra` reach the widget-query
 * executor as if it were the bare route.
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

  it("rejects a verb neither GET nor POST declares", () => {
    expect(parseRestRoute(["dashboard", "stats"], "DELETE")).toEqual({});
    expect(parseRestRoute(["dashboard", "query"], "PATCH")).toEqual({});
  });
});
