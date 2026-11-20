/**
 * A save request's moves are read at the boundary: absent means none, and a malformed value is
 * refused rather than ignored, since a move dropped in silence would let the save drop the
 * field's column with its values.
 */
import { describe, expect, it } from "vitest";

import { readRequestedMoves } from "../request-moves";

describe("readRequestedMoves", () => {
  it("reads no moves from a request that sends none", () => {
    expect(readRequestedMoves({ fields: [] })).toEqual([]);
    expect(readRequestedMoves({ hints: null })).toEqual([]);
    expect(readRequestedMoves({ hints: { renames: { a: "b" } } })).toEqual([]);
  });

  it("reads each move's path before and after", () => {
    expect(
      readRequestedMoves({
        hints: { moves: [{ from: ["title"], to: ["meta", "title"] }] },
      })
    ).toEqual([{ from: ["title"], to: ["meta", "title"] }]);
  });

  it.each([
    ["a path that is not a list", { from: "title", to: ["meta", "title"] }],
    ["an empty path", { from: [], to: ["title"] }],
    ["an empty name", { from: ["title"], to: ["meta", ""] }],
    ["a key it does not know", { from: ["a"], to: ["b"], keep: true }],
  ])("refuses %s", (_label, move) => {
    expect(() => readRequestedMoves({ hints: { moves: [move] } })).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" })
    );
  });

  it("refuses moves that are not a list", () => {
    expect(() =>
      readRequestedMoves({ hints: { moves: { from: ["a"], to: ["b"] } } })
    ).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});
