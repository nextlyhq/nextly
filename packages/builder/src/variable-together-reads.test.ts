/**
 * How a screen's groups of variables are asked about together: in reads no
 * larger than the host answers, a group too large for one left added up.
 *
 * @module variable-together-reads.test
 */
import { describe, expect, it } from "vitest";

import { togetherBatches } from "./variable-together-reads";

/** A group of `size` variables, named from `from`. */
const group = (from: number, size: number): string[] =>
  Array.from({ length: size }, (_, at) => `v-${String(from + at)}`);

describe("reading groups together", () => {
  it("asks at most fifty groups to a read", () => {
    const groups = Array.from({ length: 51 }, (_, at) => group(at * 0, 2));
    expect(togetherBatches(groups).map(batch => batch.length)).toEqual([50, 1]);
  });

  it("asks about at most fifty variables in all to a read", () => {
    // 30 and 30 are 60 variables: two reads. Shared ones count once.
    expect(
      togetherBatches([group(0, 30), group(30, 30)]).map(batch => batch.length)
    ).toEqual([1, 1]);
    expect(togetherBatches([group(0, 30), group(10, 30)])).toHaveLength(1);
  });

  it("leaves out a group larger than one read", () => {
    expect(togetherBatches([group(0, 51), group(0, 2)])).toEqual([
      [group(0, 2)],
    ]);
  });
});
