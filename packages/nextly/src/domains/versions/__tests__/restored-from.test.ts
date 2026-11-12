/**
 * A save's `_restoredFrom`: read at the write's boundary, and kept only for
 * the fields whose saved value is still the one their version holds.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { restoredFromOf, sourcesStillRestored } from "../restored-from";

describe("restoredFromOf", () => {
  it("is undefined for a save that names no restored fields", () => {
    expect(restoredFromOf({ title: "x" })).toBeUndefined();
  });

  it("reads each field's version", () => {
    expect(
      restoredFromOf({ title: "x", _restoredFrom: { title: 3, body: 1 } })
    ).toEqual({ title: 3, body: 1 });
  });

  it.each([
    ["a list", ["title"]],
    ["a version that is not a whole number", { title: 1.5 }],
    ["a version below 1", { title: 0 }],
    ["a version given as text", { title: "3" }],
    ["an empty field name", { "": 3 }],
  ])("refuses %s", (_case, value) => {
    expect(() => restoredFromOf({ _restoredFrom: value })).toThrow(NextlyError);
  });
});

describe("sourcesStillRestored", () => {
  const versions = new Map<number, Record<string, unknown>>([
    [1, { title: "t1", body: "b1", tags: ["a", "b"] }],
    [2, { title: "t2", body: "b2" }],
  ]);

  it("keeps each field whose saved value is its version's", () => {
    expect(
      sourcesStillRestored(
        { title: 1, body: 2 },
        { title: "t1", body: "b2" },
        versions
      )
    ).toEqual({ title: 1, body: 2 });
  });

  it("drops a field edited again before the save", () => {
    expect(
      sourcesStillRestored(
        { title: 1, body: 2 },
        { title: "t9", body: "b2" },
        versions
      )
    ).toEqual({ body: 2 });
  });

  it("drops a field the save does not write", () => {
    expect(
      sourcesStillRestored({ title: 1, body: 2 }, { body: "b2" }, versions)
    ).toEqual({ body: 2 });
  });

  it("drops a field whose version is not in the history", () => {
    expect(
      sourcesStillRestored({ title: 7 }, { title: "t1" }, versions)
    ).toBeUndefined();
  });

  it("compares structured values by content", () => {
    expect(
      sourcesStillRestored({ tags: 1 }, { tags: ["a", "b"] }, versions)
    ).toEqual({ tags: 1 });
    expect(
      sourcesStillRestored({ tags: 1 }, { tags: ["b", "a"] }, versions)
    ).toBeUndefined();
  });

  it("compares a date as stored, so a restored date the save holds as a Date keeps its source", () => {
    // A version's snapshot is read back from JSON, where a date is its ISO
    // string; the save being recorded holds the same date as a Date.
    const stored = new Map([[1, { when: "2026-01-02T03:04:05.000Z" }]]);
    expect(
      sourcesStillRestored(
        { when: 1 },
        { when: new Date("2026-01-02T03:04:05.000Z") },
        stored
      )
    ).toEqual({ when: 1 });
    expect(
      sourcesStillRestored(
        { when: 1 },
        { when: new Date("2026-01-03T03:04:05.000Z") },
        stored
      )
    ).toBeUndefined();
  });

  it("is undefined when nothing is left", () => {
    expect(
      sourcesStillRestored({ title: 1 }, { title: "t9" }, versions)
    ).toBeUndefined();
  });
});
