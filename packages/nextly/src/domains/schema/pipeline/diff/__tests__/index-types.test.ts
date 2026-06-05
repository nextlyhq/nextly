import { describe, expect, it } from "vitest";

import { isManagedIndexName } from "../index-util";

describe("isManagedIndexName", () => {
  it("treats idx_/uq_ prefixes as managed, excludes pkey/external", () => {
    expect(isManagedIndexName("idx_dc_posts_slug")).toBe(true);
    expect(isManagedIndexName("uq_dc_posts_email")).toBe(true);
    expect(isManagedIndexName("dc_posts_pkey")).toBe(false);
    expect(isManagedIndexName("some_external_index")).toBe(false);
    expect(isManagedIndexName("idx_dc_posts_created_at_pkey")).toBe(false);
  });
});
