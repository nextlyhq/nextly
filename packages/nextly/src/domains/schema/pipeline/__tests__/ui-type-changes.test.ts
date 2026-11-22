/**
 * The fields a Schema Builder save's confirmed renames name: paired by their columns among the
 * fields kept on the row, so a field a group with no name holds is found by its own name.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { renamedFieldsOf } from "../ui-type-changes";

const field = (name: string, type: string) =>
  ({ name, type }) as unknown as FieldDefinition;
const nameless = (...fields: FieldDefinition[]) =>
  ({ type: "group", fields }) as unknown as FieldDefinition;
const columnOf = (f: FieldDefinition) => f.name.toLowerCase();

describe("the fields a save's confirmed renames name", () => {
  it("finds a field renamed inside a group with no name", () => {
    const previous = [field("title", "text"), nameless(field("score", "text"))];
    const next = [field("title", "text"), nameless(field("points", "number"))];
    expect(
      renamedFieldsOf(
        previous,
        next,
        [{ tableName: "dc_items", fromColumn: "score", toColumn: "points" }],
        new Set(["dc_items"]),
        columnOf
      )
    ).toEqual(new Map([["score", "points"]]));
  });

  it("names nothing for a rename on another table, or of a column no field has", () => {
    const previous = [field("score", "text")];
    const next = [field("points", "number")];
    expect(
      renamedFieldsOf(
        previous,
        next,
        [
          { tableName: "dc_other", fromColumn: "score", toColumn: "points" },
          { tableName: "dc_items", fromColumn: "gone", toColumn: "points" },
        ],
        new Set(["dc_items"]),
        columnOf
      ).size
    ).toBe(0);
  });
});
