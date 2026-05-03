// Why: lock the canonical list of reserved field names so future drift is caught
// in tests rather than at runtime in two different filtering paths.
import { describe, expect, it } from "vitest";

import { RESERVED_NAMES, isReservedFieldName } from "../constants";

describe("RESERVED_NAMES", () => {
  it("contains the documented system field names", () => {
    expect(RESERVED_NAMES).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "slug",
        "createdAt",
        "updatedAt",
        "status",
      ])
    );
  });

  it("isReservedFieldName matches case-sensitively", () => {
    expect(isReservedFieldName("title")).toBe(true);
    expect(isReservedFieldName("Title")).toBe(false);
    expect(isReservedFieldName("excerpt")).toBe(false);
  });
});
