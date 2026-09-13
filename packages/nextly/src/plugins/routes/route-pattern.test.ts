import { describe, expect, it } from "vitest";

import { matchPattern, routePathIsLiteral, splitPath } from "./route-pattern";

/**
 * The classification a caller outside the matcher is allowed to ask for.
 *
 * Published so a plugin taking a path from an operator can refuse a pattern
 * while the config is being written, and the only property that makes it worth
 * publishing is that it AGREES with the matcher. A separate predicate that
 * happens to agree is still separate, so these cases hold the two together:
 * each asks this function and then asks the matcher itself, and a divergence
 * fails rather than waiting to be noticed as a wrongly refused path.
 */

/** Whether the matcher would route MORE than the path itself to this pattern. */
function matchesSomethingElse(path: string): boolean {
  const segments = splitPath(path);
  const other = segments.map((seg, i) => (i === 0 ? `${seg}-other` : seg));
  return matchPattern(segments, other) !== null;
}

describe("whether a route path names one address", () => {
  it("says yes to a path of literals", () => {
    expect(routePathIsLiteral("/mcp")).toBe(true);
    expect(routePathIsLiteral("/agents/mcp")).toBe(true);
  });

  it("says yes to a colon INSIDE a segment, which is a literal", () => {
    // The case a rule written as "contains a colon" gets wrong. `mcp:v1` does
    // not begin with `:`, so the matcher routes exactly one path to it.
    expect(routePathIsLiteral("/mcp:v1")).toBe(true);
    expect(matchesSomethingElse("/mcp:v1")).toBe(false);
  });

  it("says no to a segment that IS a capture", () => {
    expect(routePathIsLiteral("/mcp/:id")).toBe(false);
    expect(routePathIsLiteral("/:mcp")).toBe(false);
  });

  it("agrees with the matcher about which paths match only themselves", () => {
    // The property, rather than a list of answers. Whatever this says is
    // literal must match nothing but itself, and whatever it says is a pattern
    // must match something else, or the two have diverged.
    for (const path of ["/mcp", "/agents/mcp", "/mcp:v1", "/a/b/c"]) {
      expect(routePathIsLiteral(path), path).toBe(true);
      expect(matchesSomethingElse(path), path).toBe(false);
    }
    for (const path of ["/:id", "/mcp/:id", "/:a/:b"]) {
      expect(routePathIsLiteral(path), path).toBe(false);
    }
    // A capture in the FIRST segment is the one the probe above can vary, so
    // it is the one that demonstrates the other direction rather than assuming
    // it.
    expect(matchesSomethingElse("/:id")).toBe(true);
  });

  it("ignores empty segments the way the matcher does", () => {
    // `splitPath` drops them, so a trailing or doubled slash cannot change the
    // classification. Shape rules about slashes belong to whoever is refusing
    // the path, not to the grammar.
    expect(routePathIsLiteral("/mcp/")).toBe(true);
    expect(routePathIsLiteral("//mcp")).toBe(true);
    expect(routePathIsLiteral("/mcp//:id")).toBe(false);
  });
});
