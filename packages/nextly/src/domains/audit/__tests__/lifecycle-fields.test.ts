/**
 * Whether a write carries content of its own, as a publish states it: a field
 * other than those the status lifecycle writes.
 */
import { describe, expect, it } from "vitest";

import { carriesContent, LIFECYCLE_FIELDS } from "../lifecycle-fields";

describe("whether a write carries content", () => {
  it("does when it names a field a person edits", () => {
    expect(carriesContent({ status: "published", title: "New" })).toBe(true);
  });

  it("does not when it names only what the lifecycle writes", () => {
    // The population: the lifecycle's own fields, without which an empty set
    // would let every write read as content.
    expect(LIFECYCLE_FIELDS.has("status")).toBe(true);
    expect(LIFECYCLE_FIELDS.has("updatedAt")).toBe(true);
    expect(carriesContent({ status: "published", updatedAt: new Date() })).toBe(
      false
    );
    expect(carriesContent({})).toBe(false);
  });
});
