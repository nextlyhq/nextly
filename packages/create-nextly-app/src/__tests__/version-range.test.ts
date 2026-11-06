/**
 * The highest major a dependency spec admits: what a fresh install could
 * resolve to, which decides whether an app is headed past a supported major.
 */
import { describe, expect, it } from "vitest";

import { highestMajorIn } from "../utils/version-range";

describe("highestMajorIn", () => {
  it.each([
    ["^16.4.1", 16],
    ["~16.4.2", 16],
    ["16.4.2", 16],
    ["=16.4.2", 16],
    ["16.x", 16],
    [">=16.4.1 <17", 16],
    [">=16.4.1 <17.0.0", 16],
    [">=16.4.1 <17.2", 17],
    [">=16.4.1 <=17", 17],
    ["^16.4.1 || ^17.0.0", 17],
    ["^15.5.28 || ^16.4.1", 16],
  ])("reads %s as reaching major %d", (spec, major) => {
    expect(highestMajorIn(spec)).toBe(major);
  });

  it.each([">=16.4.1", ">16", "*", "x", ""])(
    "reads %j as having no upper bound",
    spec => {
      expect(highestMajorIn(spec)).toBe(Infinity);
    }
  );

  it.each(["latest", "canary", "workspace:*", "file:../next"])(
    "names no major for %s",
    spec => {
      expect(highestMajorIn(spec)).toBeUndefined();
    }
  );
});
