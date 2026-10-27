/**
 * Unit tests for check-bundle-budgets.mjs: the gate's verdicts — a build
 * within all budgets passes whatever the previous build measured, a breach
 * fails naming the measured size and the budget it exceeded, and the
 * boundary itself counts as within ("at most").
 */

import { describe, expect, it } from "vitest";

import { budgetBreaches, describeBreaches, BUDGETS } from "./check-bundle-budgets.mjs";

/** A report inside every budget: small total, small routes. */
function withinReport() {
  return {
    totals: { browser: { count: 3, minifiedBytes: 1000 * 1024 } },
    routes: [
      { root: "a.mjs", directVisit: { gzippedBytes: 50 * 1024 } },
      { root: "b.mjs", directVisit: { gzippedBytes: 199 * 1024 } },
    ],
  };
}

describe("budgetBreaches", () => {
  it("passes a build within all budgets, routes included", () => {
    expect(budgetBreaches(withinReport())).toEqual([]);
  });

  it("counts the boundary itself as within — the budgets say at most", () => {
    const report = {
      totals: { browser: { count: 3, minifiedBytes: BUDGETS.totalMinifiedKB * 1024 } },
      routes: [
        { root: "a.mjs", directVisit: { gzippedBytes: BUDGETS.routeDirectVisitGzipKB * 1024 } },
      ],
    };
    expect(budgetBreaches(report)).toEqual([]);
  });

  it("fails a total breach naming the measured size and the budget", () => {
    const report = {
      totals: { browser: { count: 3, minifiedBytes: 3600 * 1024 } },
      routes: [],
    };
    const breaches = budgetBreaches(report);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].kind).toBe("total");
    expect(breaches[0].measured).toContain("3600.00 KB");
    expect(breaches[0].budget).toContain("3500");
  });

  it("fails a route breach naming that route's direct visit", () => {
    const report = {
      totals: { browser: { count: 3, minifiedBytes: 1000 * 1024 } },
      routes: [{ root: "heavy.mjs", directVisit: { gzippedBytes: 250 * 1024 } }],
    };
    const breaches = budgetBreaches(report);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].kind).toBe("route");
    expect(breaches[0].name).toContain("heavy.mjs");
    expect(breaches[0].measured).toContain("250.00 KB");
    expect(breaches[0].budget).toContain("200");
  });

  it("reports every breaching route, not only the first", () => {
    const report = {
      totals: { browser: { count: 3, minifiedBytes: 1000 * 1024 } },
      routes: [
        { root: "one.mjs", directVisit: { gzippedBytes: 300 * 1024 } },
        { root: "fine.mjs", directVisit: { gzippedBytes: 100 * 1024 } },
        { root: "two.mjs", directVisit: { gzippedBytes: 400 * 1024 } },
      ],
    };
    const breaches = budgetBreaches(report);
    expect(breaches.map(b => b.name)).toEqual([
      expect.stringContaining("one.mjs"),
      expect.stringContaining("two.mjs"),
    ]);
  });

  it("fails both kinds together when a build breaches total and routes", () => {
    const report = {
      totals: { browser: { count: 3, minifiedBytes: 3600 * 1024 } },
      routes: [{ root: "heavy.mjs", directVisit: { gzippedBytes: 300 * 1024 } }],
    };
    const breaches = budgetBreaches(report);
    expect(breaches.map(b => b.kind)).toEqual(["total", "route"]);
  });
});

describe("describeBreaches", () => {
  it("renders measured size and budget together on one line", () => {
    const report = {
      totals: { browser: { count: 3, minifiedBytes: 3600 * 1024 } },
      routes: [],
    };
    const lines = describeBreaches(budgetBreaches(report));
    expect(lines).toEqual([
      expect.stringMatching(/total.*3600\.00 KB minified.*3500 KB minified/),
    ]);
  });
});
