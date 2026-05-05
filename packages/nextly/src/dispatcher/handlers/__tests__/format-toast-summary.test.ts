// formatToastSummary unit tests.
//
// The helper is exported from collection-dispatcher.ts via a test-only
// re-export at the bottom of that file. Keeping the implementation
// co-located with the handler (where it's the only consumer) means we
// don't fragment the dispatcher into a tiny helper module just for one
// pure function.

import { describe, expect, it } from "vitest";

import { formatToastSummaryForTest } from "../collection-dispatcher";

describe("formatToastSummary", () => {
  it("returns 'no changes' for an all-zero summary", () => {
    expect(
      formatToastSummaryForTest({ added: 0, removed: 0, renamed: 0, changed: 0 })
    ).toBe("no changes");
  });

  it("singular added field uses 'field' (no plural)", () => {
    expect(
      formatToastSummaryForTest({ added: 1, removed: 0, renamed: 0, changed: 0 })
    ).toBe("1 field added");
  });

  it("plural added fields use 'fields'", () => {
    expect(
      formatToastSummaryForTest({ added: 3, removed: 0, renamed: 0, changed: 0 })
    ).toBe("3 fields added");
  });

  it("orders parts as added, renamed, changed, removed", () => {
    expect(
      formatToastSummaryForTest({ added: 1, removed: 1, renamed: 1, changed: 1 })
    ).toBe("1 field added, 1 renamed, 1 changed, 1 removed");
  });

  it("only renders non-zero counts", () => {
    expect(
      formatToastSummaryForTest({ added: 0, removed: 0, renamed: 2, changed: 0 })
    ).toBe("2 renamed");
  });
});
