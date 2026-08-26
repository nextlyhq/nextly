/**
 * Guards unit alignment. The headline is that inserting one unit must not mark
 * every following unit changed, and that an edited unit pairs as `changed`
 * rather than as a removal sitting beside an unrelated addition.
 *
 * The refusal case is the other half: a caller that cannot align must be told
 * so, because "no pairs" and "these are identical" are different answers and
 * folding them together lets an unreadable document read as an unchanged one.
 */
import { describe, expect, it } from "vitest";

import { alignUnits } from "../align-units";

describe("alignUnits", () => {
  it("reports identical sequences as unchanged", () => {
    const { aligned, pairs } = alignUnits(["a", "b"], ["a", "b"]);
    expect(aligned).toBe(true);
    expect(pairs.map(p => p.status)).toEqual(["unchanged", "unchanged"]);
  });

  it("marks only the inserted unit added, not everything after it", () => {
    // The differentiator against index-based comparison, which would report
    // "b" as changed simply because it moved down one place.
    const { pairs } = alignUnits(["a", "b"], ["a", "x", "b"]);
    expect(pairs.map(p => p.status)).toEqual([
      "unchanged",
      "added",
      "unchanged",
    ]);
    expect(pairs[1]).toMatchObject({ status: "added", after: "x", toIndex: 1 });
  });

  it("marks a removed unit removed and leaves its neighbours alone", () => {
    const { pairs } = alignUnits(["a", "b", "c"], ["a", "c"]);
    expect(pairs.map(p => p.status)).toEqual([
      "unchanged",
      "removed",
      "unchanged",
    ]);
    expect(pairs[1]).toMatchObject({
      status: "removed",
      before: "b",
      fromIndex: 1,
    });
  });

  it("pairs an edited unit as changed rather than removed beside added", () => {
    // Without the pairing pass the caller gets two rows to join by eye, and
    // cannot run a word-level diff over the pair.
    const { pairs } = alignUnits(["a", "hello world"], ["a", "hello there"]);
    expect(pairs.map(p => p.status)).toEqual(["unchanged", "changed"]);
    expect(pairs[1]).toMatchObject({
      status: "changed",
      before: "hello world",
      after: "hello there",
      fromIndex: 1,
      toIndex: 1,
    });
  });

  it("pairs a MULTI-unit replacement positionally, not just at its boundary", () => {
    // The differ emits a replacement as every removal followed by every
    // insertion, so a rule that looks only at the boundary between those runs
    // pairs one removal with one insertion and reports the rest as a stray
    // removal and a stray addition. The single-unit case above cannot tell the
    // two implementations apart — this one can.
    const { pairs } = alignUnits(
      ["old one", "old two"],
      ["new one", "new two"]
    );
    expect(pairs.map(p => p.status)).toEqual(["changed", "changed"]);
    expect(pairs[0]).toMatchObject({
      before: "old one",
      after: "new one",
      fromIndex: 0,
      toIndex: 0,
    });
    expect(pairs[1]).toMatchObject({
      before: "old two",
      after: "new two",
      fromIndex: 1,
      toIndex: 1,
    });
  });

  it("leaves the unmatched tail of a longer removal run as removals", () => {
    const { pairs } = alignUnits(["a1", "a2", "a3"], ["b1"]);
    expect(pairs.map(p => p.status)).toEqual(["changed", "removed", "removed"]);
    expect(pairs[1]).toMatchObject({ before: "a2", fromIndex: 1 });
    expect(pairs[2]).toMatchObject({ before: "a3", fromIndex: 2 });
  });

  it("leaves the unmatched tail of a longer insertion run as additions", () => {
    const { pairs } = alignUnits(["a1"], ["b1", "b2", "b3"]);
    expect(pairs.map(p => p.status)).toEqual(["changed", "added", "added"]);
    expect(pairs[1]).toMatchObject({ after: "b2", toIndex: 1 });
    expect(pairs[2]).toMatchObject({ after: "b3", toIndex: 2 });
  });

  it("carries indices that address the correct side of each pair", () => {
    // An insertion desynchronises the two sides, so a pair after it must name
    // a different index on each side. One shared index would silently address
    // the wrong unit from here on.
    const { pairs } = alignUnits(["a", "b"], ["x", "a", "b"]);
    const last = pairs[pairs.length - 1];
    expect(last).toMatchObject({
      status: "unchanged",
      before: "b",
      after: "b",
      fromIndex: 1,
      toIndex: 2,
    });
  });

  it("handles a unit repeated many times without confusing indices", () => {
    const { pairs } = alignUnits(["x", "x", "x"], ["x", "x"]);
    expect(pairs.filter(p => p.status === "removed")).toHaveLength(1);
    expect(pairs.filter(p => p.status === "unchanged")).toHaveLength(2);
  });

  it("handles an empty side in each direction", () => {
    expect(alignUnits([], ["a"]).pairs).toEqual([
      { status: "added", after: "a", toIndex: 0 },
    ]);
    expect(alignUnits(["a"], []).pairs).toEqual([
      { status: "removed", before: "a", fromIndex: 0 },
    ]);
    expect(alignUnits([], []).pairs).toEqual([]);
  });

  it("aligns units that contain private-use characters of its own alphabet", () => {
    // Content is mapped THROUGH the alphabet rather than compared against it,
    // so a unit that happens to contain one of these characters is ordinary
    // text. A mapping that leaked content into the synthetic string would
    // mis-align here.
    const marker = "\u{E000}";
    const { aligned, pairs } = alignUnits(
      [`before ${marker}`, "b"],
      [`before ${marker}`, "c"]
    );
    expect(aligned).toBe(true);
    expect(pairs.map(p => p.status)).toEqual(["unchanged", "changed"]);
  });

  it("refuses rather than degrading when its alphabet is exhausted", () => {
    // A silently truncated alignment reads as a confident answer, so the
    // caller is told it could not be done and reports "not comparable".
    const many = Array.from({ length: 200_000 }, (_, i) => `u${i}`);
    const result = alignUnits(many, many.slice(0, 10));
    expect(result.aligned).toBe(false);
    expect(result.pairs).toEqual([]);
  });
});
