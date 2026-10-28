/**
 * Unit tests for check-bundle-budgets.mjs: the gate's verdicts. A build within
 * every budget passes; the shipped total, the shared shell and each route are
 * judged by their own budget; a route is held to its pinned size plus the
 * headroom; a route with no pin fails; and the boundary itself counts as
 * within ("at most").
 */

import { describe, expect, it } from "vitest";

import {
  BUDGETS,
  budgetBreaches,
  describeBreaches,
  pinRefusal,
  pinsFrom,
  routeKey,
} from "./check-bundle-budgets.mjs";

const KB = 1024;

/** A report: a small total, a 250 KB shell, and routes with their own code. */
function report(routes, { totalKB = 1000, shellKB = 250 } = {}) {
  return {
    totals: {
      browser: { count: 3, minifiedBytes: totalKB * KB },
      firstScreen: { gzippedBytes: shellKB * KB },
    },
    routes: routes.map(([root, kb]) => ({
      root,
      beyondShell: { gzippedBytes: kb * KB },
    })),
  };
}

/** Pins for the given stable names, in KB. */
function pins(entries) {
  return {
    routes: Object.fromEntries(entries.map(([key, kb]) => [key, kb * KB])),
  };
}

describe("routeKey", () => {
  it("drops the content hash, keeping pages that share a file name apart", () => {
    expect(routeKey("page.dashboard.users.create-CZ-2Ye0b.mjs")).toBe(
      "page.dashboard.users.create"
    );
    expect(routeKey("page.dashboard.roles.create-B26jfAsp.mjs")).toBe(
      "page.dashboard.roles.create"
    );
    expect(routeKey("RichTextInput-DhOEc_ZM.mjs")).toBe("RichTextInput");
  });
});

describe("pinsFrom", () => {
  it("pins every route's own code under its stable name", () => {
    const r = report([
      ["page.b-AAAAAAAA.mjs", 300],
      ["page.a-BBBBBBBB.mjs", 280],
    ]);
    expect(pinsFrom(r).routes).toEqual({
      "page.a": 280 * KB,
      "page.b": 300 * KB,
    });
  });

  it("pins a route named like a built-in object key as its own entry", () => {
    const routes = pinsFrom(report([["__proto__-AAAAAAAA.mjs", 3]])).routes;
    expect(Object.hasOwn(routes, "__proto__")).toBe(true);
    expect(JSON.parse(JSON.stringify(routes))).toEqual(
      JSON.parse('{"__proto__": 3072}')
    );
  });

  it("refuses two routes that share a stable name rather than keep one", () => {
    const r = report([
      ["index-AAAAAAAA.mjs", 300],
      ["index-BBBBBBBB.mjs", 280],
    ]);
    expect(() => pinsFrom(r)).toThrow(/index/);
  });
});

describe("pinRefusal", () => {
  const fresh = {
    commit: "unversioned",
    builtAt: "2026-10-27T00:00:00.000Z",
    buildInfo: { commit: "unversioned" },
  };

  it("pins a dist its build stamped", () => {
    expect(pinRefusal(fresh)).toBeNull();
  });

  it("refuses a dist with no build stamp: its bytes cannot be placed", () => {
    expect(pinRefusal({ ...fresh, buildInfo: undefined })).toMatch(/stamp/);
  });

  it("refuses a dist stamped by another commit", () => {
    expect(
      pinRefusal({ ...fresh, commit: "bbbbbbb", buildInfo: { commit: "aaaaaaa" } })
    ).toMatch(/predates|another commit/);
  });

  it("refuses while a build input has uncommitted changes: the bytes are not the commit's", () => {
    expect(pinRefusal(fresh, ["packages/admin/src/pages/dashboard/index.tsx"])).toMatch(
      /uncommitted.*pages\/dashboard\/index\.tsx/
    );
  });
});

describe("budgetBreaches", () => {
  it("fails two routes that share a stable name: one pin cannot hold both", () => {
    const r = report([
      ["index-AAAAAAAA.mjs", 300],
      ["index-BBBBBBBB.mjs", 280],
    ]);
    expect(budgetBreaches(r, pins([["index", 300]]))).toEqual([
      expect.objectContaining({ kind: "duplicate", name: "route index" }),
    ]);
  });

  it("passes a build within every budget", () => {
    const r = report([["page.a-AAAAAAAA.mjs", 300]]);
    expect(budgetBreaches(r, pins([["page.a", 300]]))).toEqual([]);
  });

  it("counts each boundary itself as within: the budgets say at most", () => {
    const r = report([["page.a-AAAAAAAA.mjs", 330]], {
      totalKB: BUDGETS.totalMinifiedKB,
      shellKB: BUDGETS.shellGzipKB,
    });
    // 300 KB pinned plus 10% is 330 KB.
    expect(budgetBreaches(r, pins([["page.a", 300]]))).toEqual([]);
  });

  it("fails a route grown past its pin plus the headroom, naming both", () => {
    const r = report([["page.a-AAAAAAAA.mjs", 331]]);
    const [breach, ...rest] = budgetBreaches(r, pins([["page.a", 300]]));
    expect(rest).toEqual([]);
    expect(breach.kind).toBe("route");
    expect(breach.name).toContain("page.a");
    expect(breach.measured).toContain("331.00 KB gzipped of its own");
    expect(breach.budget).toContain("330.00 KB");
    expect(breach.budget).toContain("pinned 300.00 KB");
  });

  it("gives a route that adds almost nothing a 2 KB floor, not 10%", () => {
    const p = pins([["page.tiny", 1]]);
    expect(budgetBreaches(report([["page.tiny-AAAAAAAA.mjs", 3]]), p)).toEqual(
      []
    );
    const [breach] = budgetBreaches(report([["page.tiny-AAAAAAAA.mjs", 3.5]]), p);
    expect(breach.kind).toBe("route");
  });

  it("fails a route that has no pin, saying how to pin it", () => {
    const r = report([["page.new-AAAAAAAA.mjs", 270]]);
    const [breach] = budgetBreaches(r, pins([]));
    expect(breach.kind).toBe("unpinned");
    expect(breach.name).toContain("page.new");
    expect(breach.budget).toContain("--pin");
  });

  it("fails a new route named like a built-in object key, which no pin holds", () => {
    const r = report([
      ["toString-AAAAAAAA.mjs", 3],
      ["constructor-BBBBBBBB.mjs", 3],
    ]);
    expect(budgetBreaches(r, pins([])).map(b => b.kind)).toEqual([
      "unpinned",
      "unpinned",
    ]);
  });

  it("fails a shell over its cap", () => {
    const r = report([], { shellKB: BUDGETS.shellGzipKB + 1 });
    const [breach] = budgetBreaches(r, pins([]));
    expect(breach.kind).toBe("shell");
    expect(breach.budget).toContain(`${BUDGETS.shellGzipKB} KB`);
  });

  it("fails a shipped total over its budget", () => {
    const r = report([], { totalKB: 3600 });
    const [breach] = budgetBreaches(r, pins([]));
    expect(breach.kind).toBe("total");
    expect(breach.measured).toContain("3600.00 KB");
    expect(breach.budget).toContain("3500");
  });

  it("reports every breaching route, not only the first", () => {
    const r = report([
      ["page.one-AAAAAAAA.mjs", 400],
      ["page.fine-BBBBBBBB.mjs", 300],
      ["page.two-CCCCCCCC.mjs", 500],
    ]);
    const p = pins([
      ["page.one", 300],
      ["page.fine", 300],
      ["page.two", 300],
    ]);
    expect(budgetBreaches(r, p).map(b => b.name)).toEqual([
      expect.stringContaining("page.one"),
      expect.stringContaining("page.two"),
    ]);
  });
});

describe("describeBreaches", () => {
  it("renders measured size and budget together on one line", () => {
    const r = report([], { totalKB: 3600 });
    expect(describeBreaches(budgetBreaches(r, pins([])))).toEqual([
      expect.stringMatching(/total.*3600\.00 KB minified.*3500 KB minified/),
    ]);
  });
});
