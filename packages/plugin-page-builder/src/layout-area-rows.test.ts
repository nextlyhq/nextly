/**
 * Putting one component in one area of a set: that area's row names it, and
 * every other row stays as it was stored, in its place.
 */
import { describe, expect, it } from "vitest";

import { areaRowsOf, withArea } from "./layout-area-rows";

describe("a set's areas with one area given a component", () => {
  it("names the component in that area's own row, keeping its place and its row id", () => {
    const rows = [
      { id: "r1", area: "header", component: "starter-h" },
      { id: "r2", area: "footer", component: "starter-f" },
    ];
    expect(withArea(rows, "header", "ridgeline")).toEqual([
      { id: "r1", area: "header", component: "ridgeline" },
      { id: "r2", area: "footer", component: "starter-f" },
    ]);
  });

  it("adds a row at the end for an area the set does not fill yet", () => {
    expect(
      withArea([{ area: "header", component: "h" }], "footer", "f")
    ).toEqual([
      { area: "header", component: "h" },
      { area: "footer", component: "f" },
    ]);
  });

  it("keeps one row for the area when the stored rows repeat it", () => {
    expect(
      withArea(
        [
          { area: "header", component: "a" },
          { area: "header", component: "b" },
        ],
        "header",
        "c"
      )
    ).toEqual([{ area: "header", component: "c" }]);
  });
});

describe("a set's stored areas as rows", () => {
  it("reads rows as stored, or as JSON text where an adapter stores them so", () => {
    const rows = [{ area: "header", component: "h" }];
    expect(areaRowsOf(rows)).toEqual(rows);
    expect(areaRowsOf(JSON.stringify(rows))).toEqual(rows);
  });

  it("reads nothing it cannot read as rows as none", () => {
    expect(areaRowsOf(undefined)).toEqual([]);
    expect(areaRowsOf("not json")).toEqual([]);
    expect(areaRowsOf({ area: "header" })).toEqual([]);
    expect(areaRowsOf([null, "x", { area: "footer" }])).toEqual([
      { area: "footer" },
    ]);
  });
});
