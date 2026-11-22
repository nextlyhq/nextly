// The system fields' names, which the loader and the save both filter by, are derived from the
// system fields themselves. Which names a field may not take is the save's own rule, tested in
// field-name-check and beside the rule in nextly.
import { describe, expect, it } from "vitest";

import { DEFAULT_SYSTEM_FIELDS, SYSTEM_FIELD_NAMES } from "../constants";

describe("SYSTEM_FIELD_NAMES", () => {
  // The loader and the save both filter by this list. Restating it instead of
  // deriving it is what lets them disagree, so the guard is that every system
  // field is named here rather than that the names are the two we have today.
  it("names every field DEFAULT_SYSTEM_FIELDS provides", () => {
    expect(SYSTEM_FIELD_NAMES).toEqual(DEFAULT_SYSTEM_FIELDS.map(f => f.name));
  });
});
