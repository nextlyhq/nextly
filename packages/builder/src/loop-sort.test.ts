/**
 * A loop's stored sort, as its controls read and write it: the first key
 * edited, every further key kept as stored.
 */
import { describe, expect, it } from "vitest";

import { readSort, restKeys, writeSort } from "./loop-sort";

describe("reading a stored sort", () => {
  it("reads the first key's field and direction, and keeps the rest as stored", () => {
    expect(readSort("-publishedAt, title,-id")).toEqual({
      first: { field: "publishedAt", descending: true },
      rest: ["title", "-id"],
    });
  });

  it("reads nothing, an empty string and a non-string as no sort", () => {
    for (const value of [undefined, "", "  ", 3, null]) {
      expect(readSort(value)).toEqual({ first: undefined, rest: [] });
    }
  });

  it("skips empty keys and a bare dash, as the reader does", () => {
    expect(readSort(",-, title")).toEqual({
      first: { field: "title", descending: false },
      rest: [],
    });
  });
});

describe("writing a sort", () => {
  const any = () => true;

  it("puts the new first key before the kept ones", () => {
    const stored = readSort("-publishedAt,title");
    expect(
      writeSort(stored, { field: "createdAt", descending: false }, any)
    ).toBe("createdAt,title");
  });

  it("drops a further key the collection cannot sort by, and keeps the rest as stored", () => {
    // One key the reader refuses refuses the whole sort, which would undo
    // the order just chosen.
    const stored = readSort("-publishedAt,-rating,title");
    expect(
      writeSort(
        stored,
        { field: "createdAt", descending: true },
        field => field !== "rating"
      )
    ).toBe("-createdAt,title");
  });

  it("removes the whole sort for no first key", () => {
    expect(writeSort(readSort("-a,b"), undefined, any)).toBeUndefined();
  });

  it("names the further keys by field and direction", () => {
    expect(restKeys(readSort("a,-b,c"))).toEqual([
      { field: "b", descending: true },
      { field: "c", descending: false },
    ]);
  });
});
