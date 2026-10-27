/**
 * The field a collection's entries most naturally divide by: status where the
 * collection has a lifecycle, else its first groupable choice field, else
 * none.
 */
import { describe, expect, it } from "vitest";

import { naturalGroupBy } from "../settings";

const choices = [{ value: "a", label: "A" }];

describe("the field a collection divides by", () => {
  it("is status on a collection with a lifecycle, whatever else it has", () => {
    // 🔴 The must-differ case: read as "the first choice field", this
    // collection would divide by `kind`, which comes before `status`.
    expect(
      naturalGroupBy({
        lifecycle: true,
        fields: [
          { name: "kind", choices },
          { name: "status", choices },
        ],
      })
    ).toBe("status");
  });

  it("is the first choice field that can be grouped by, without a lifecycle", () => {
    expect(
      naturalGroupBy({
        lifecycle: false,
        fields: [
          { name: "title" },
          { name: "size", choices, groupable: false },
          { name: "kind", choices },
          { name: "colour", choices },
        ],
      })
    ).toBe("kind");
  });

  it("is none where no field has choices to divide by", () => {
    // A free-text field is no breakdown, even where it can be grouped.
    expect(
      naturalGroupBy({
        lifecycle: false,
        fields: [{ name: "title", groupable: true }],
      })
    ).toBeUndefined();
  });
});
