/**
 * A two-column comparison shows each version's own text, so the engine's single
 * run of insert/delete/common segments has to be distributed: a deletion is
 * part of the older version's text and a nonsense addition to the newer one,
 * and vice versa. Common runs belong to both.
 */
import { describe, it, expect } from "vitest";

import type { TextSegment } from "@admin/services/versionApi";

import { splitTextSegments } from "../text-segment-sides";

describe("splitTextSegments", () => {
  it("sends a deletion left, an insertion right, and common text to both", () => {
    const segments: TextSegment[] = [
      { op: 0, text: "Hello " },
      { op: -1, text: "world" },
      { op: 1, text: "there" },
    ];

    expect(splitTextSegments(segments)).toEqual({
      before: [
        { op: 0, text: "Hello " },
        { op: -1, text: "world" },
      ],
      after: [
        { op: 0, text: "Hello " },
        { op: 1, text: "there" },
      ],
    });
  });

  it("keeps each run's op, so a side can still mark what changed in it", () => {
    const { before, after } = splitTextSegments([
      { op: -1, text: "gone" },
      { op: 1, text: "new" },
    ]);

    // Flattening to plain text would lose the mark, and a column of unmarked
    // text cannot show WHICH part of it moved.
    expect(before.map(segment => segment.op)).toEqual([-1]);
    expect(after.map(segment => segment.op)).toEqual([1]);
  });

  it("keeps the runs in their original order on each side", () => {
    const { before } = splitTextSegments([
      { op: 0, text: "a" },
      { op: 1, text: "skipped" },
      { op: -1, text: "b" },
      { op: 0, text: "c" },
    ]);

    // Dropping the other side's runs must not reorder what remains: the older
    // version's text is these runs concatenated, in this sequence.
    expect(before.map(segment => segment.text).join("")).toBe("abc");
  });

  it("gives both sides everything when nothing changed", () => {
    const segments: TextSegment[] = [{ op: 0, text: "identical" }];
    const { before, after } = splitTextSegments(segments);

    expect(before).toEqual(segments);
    expect(after).toEqual(segments);
  });

  it("leaves a side empty when the whole text is one-sided", () => {
    const { before, after } = splitTextSegments([{ op: 1, text: "all new" }]);

    expect(before).toEqual([]);
    expect(after).toEqual([{ op: 1, text: "all new" }]);
  });
});
