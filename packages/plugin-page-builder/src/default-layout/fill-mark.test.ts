/**
 * How an area's fill mark is stored: the component, and who is still to be
 * told. A value this code did not write reads as nothing it can trust.
 */
import { describe, expect, it } from "vitest";

import { decodeFillMark, encodeFillMark } from "./fill-mark";

describe("an area's fill mark", () => {
  it("reads back what it stored, with and without someone to tell", () => {
    for (const mark of [
      { component: "c1", tell: "u1" },
      { component: "c1", tell: null },
    ]) {
      expect(decodeFillMark(encodeFillMark(mark))).toEqual(mark);
    }
  });

  it("reads a value it did not write as no mark", () => {
    for (const value of ["", "a  b", "a b c", " a"]) {
      expect(decodeFillMark(value)).toBeNull();
    }
  });
});
