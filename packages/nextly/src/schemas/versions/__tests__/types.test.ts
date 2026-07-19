import { describe, it, expect } from "vitest";

import { VERSION_STATUSES, isVersionStatus } from "../types";

describe("versions types", () => {
  it("lists the active status set", () => {
    expect([...VERSION_STATUSES]).toEqual([
      "draft",
      "published",
      "unpublished",
      "scheduled",
    ]);
  });

  it("guards known statuses and rejects others", () => {
    expect(isVersionStatus("draft")).toBe(true);
    expect(isVersionStatus("published")).toBe(true);
    expect(isVersionStatus("reverted")).toBe(false);
    expect(isVersionStatus(42)).toBe(false);
  });
});
