/**
 * Guards the word-level text diff. The key invariant is reconstruction: the
 * left projection of the segments must rebuild the original and the right
 * projection the updated text, whatever the segmentation.
 */
import { describe, expect, it } from "vitest";

import { diffText } from "../text-diff";
import type { TextSegment } from "../types";

/** Rebuild the "before" text: everything except inserted (op 1) segments. */
function leftText(segments: TextSegment[]): string {
  return segments
    .filter(s => s.op <= 0)
    .map(s => s.text)
    .join("");
}

/** Rebuild the "after" text: everything except deleted (op -1) segments. */
function rightText(segments: TextSegment[]): string {
  return segments
    .filter(s => s.op >= 0)
    .map(s => s.text)
    .join("");
}

describe("diffText", () => {
  it("reconstructs both sides and marks a substituted word", () => {
    const before = "the cat sat on the mat";
    const after = "the dog sat on the mat";
    const segments = diffText(before, after);

    expect(leftText(segments)).toBe(before);
    expect(rightText(segments)).toBe(after);
    expect(segments.some(s => s.op === -1)).toBe(true);
    expect(segments.some(s => s.op === 1)).toBe(true);
  });

  it("returns a single unchanged segment for identical text", () => {
    const segments = diffText("unchanged", "unchanged");
    expect(segments).toEqual([{ op: 0, text: "unchanged" }]);
  });

  it("marks a pure insertion", () => {
    const segments = diffText("", "brand new");
    expect(leftText(segments)).toBe("");
    expect(rightText(segments)).toBe("brand new");
    expect(segments.every(s => s.op === 1)).toBe(true);
  });

  it("marks a pure deletion", () => {
    const segments = diffText("gone", "");
    expect(leftText(segments)).toBe("gone");
    expect(rightText(segments)).toBe("");
    expect(segments.every(s => s.op === -1)).toBe(true);
  });
});
