/**
 * Whether two values of a relationship name the same documents: a populated
 * row is read as its id even when the document it names has fields called
 * `relationTo` and `value`, which shape it like a reference to one of several
 * collections. Only a value without an id is such a reference.
 */
import { describe, expect, it } from "vitest";

import { sameFieldValue } from "../same-form-value";

describe("sameFieldValue, for a relationship", () => {
  it("reads a populated row with its own relationTo and value fields as its id", () => {
    const populated = { id: "u1", relationTo: "teams", value: "lead" };

    expect(sameFieldValue("relationship", populated, "u1")).toBe(true);
  });

  it("tells apart two populated rows whose relationTo and value fields agree", () => {
    const one = { id: "u1", relationTo: "teams", value: "lead" };
    const other = { id: "u2", relationTo: "teams", value: "lead" };

    expect(sameFieldValue("relationship", one, other)).toBe(false);
  });

  it("still reads a reference to one of several collections by its value", () => {
    expect(
      sameFieldValue(
        "relationship",
        { relationTo: "posts", value: { id: "p1", title: "One" } },
        { relationTo: "posts", value: "p1" }
      )
    ).toBe(true);
  });
});
