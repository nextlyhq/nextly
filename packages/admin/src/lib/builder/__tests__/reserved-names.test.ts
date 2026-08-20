// Why: lock the canonical list of reserved field names so future drift is caught
// in tests rather than at runtime in two different filtering paths.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SYSTEM_FIELDS,
  RESERVED_NAMES,
  SYSTEM_FIELD_NAMES,
  isReservedFieldName,
} from "../constants";

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

describe("SYSTEM_FIELD_NAMES", () => {
  // The loader and the save both filter by this list. Restating it instead of
  // deriving it is what lets them disagree, so the guard is that every system
  // field is named here rather than that the names are the two we have today.
  it("names every field DEFAULT_SYSTEM_FIELDS provides", () => {
    expect(SYSTEM_FIELD_NAMES).toEqual(DEFAULT_SYSTEM_FIELDS.map(f => f.name));
  });

  it("stays narrower than RESERVED_NAMES", () => {
    // Reserved covers columns the builder never renders (id, timestamps,
    // status); filtering loads or saves by it would drop user fields.
    expect(SYSTEM_FIELD_NAMES.length).toBeLessThan(RESERVED_NAMES.length);
    for (const name of SYSTEM_FIELD_NAMES) {
      expect(RESERVED_NAMES).toContain(name);
    }
  });
});
