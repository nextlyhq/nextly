// Why: lock the "next available numeric-suffix name" contract so future
// drift is caught. Pattern: body -> body_2; body_2 -> body_3. Skips any
// name already in use.
import { describe, expect, it } from "vitest";

import { nextDuplicateName } from "../duplicate-field-name";

describe("nextDuplicateName", () => {
  it("appends _2 when there's no existing suffix", () => {
    expect(nextDuplicateName("body", ["body"])).toBe("body_2");
  });

  it("bumps an existing _N suffix by one", () => {
    expect(nextDuplicateName("body_2", ["body", "body_2"])).toBe("body_3");
  });

  it("skips taken numeric suffixes to find a free one", () => {
    expect(nextDuplicateName("body", ["body", "body_2", "body_3"])).toBe(
      "body_4"
    );
  });

  it("returns the source name itself when not in the taken set", () => {
    expect(nextDuplicateName("body", [])).toBe("body");
  });

  it("ignores names without the _N suffix when bumping", () => {
    expect(nextDuplicateName("body", ["body", "body_legacy", "body_v1"])).toBe(
      "body_2"
    );
  });
});
