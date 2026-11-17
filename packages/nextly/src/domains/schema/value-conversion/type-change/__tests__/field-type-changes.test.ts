/**
 * The fields whose type a save changes, and the refusals their judgements give: a blocked change, a
 * lossy one the owner has not consented to, and any change while the definition awaits its
 * migration.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import { fieldTypeOnDialect } from "../field-type";
import {
  fieldTypeChangesOf,
  type JudgedFieldTypeChange,
  pendingMigrationRefusal,
  typeChangeRefusals,
} from "../field-type-changes";

const f = (name: string, type: string, extra: object = {}) =>
  ({ name, type, ...extra }) as unknown as FieldDefinition;

describe("the fields whose type a save changes", () => {
  it("pairs fields by name or by their rename, and leaves a width or a one-to-one alone", () => {
    const changes = fieldTypeChangesOf({
      previous: [
        f("price", "text"),
        f("title", "text"),
        f("old", "checkbox"),
        f("owner", "relationship", {
          relationTo: "people",
          options: { relationType: "oneToOne" },
        }),
      ],
      next: [
        f("price", "number"),
        f("title", "text", { options: { variant: "short" } }),
        f("renamed", "text"),
        f("owner", "relationship", {
          relationTo: "people",
          options: { relationType: "manyToOne" },
        }),
      ],
      renamed: new Map([["old", "renamed"]]),
      dialect: "postgresql",
      builtBy: "collection",
    });
    expect(changes.map(c => [c.from.name, c.to.name])).toEqual([
      ["price", "price"],
      ["old", "renamed"],
    ]);
  });

  it("leaves a field that loses or gains its column to the save's drop or add", () => {
    // A relationship turned many-to-many keeps its links in a junction table: its column is
    // dropped, not converted. The reverse adds one. A text turned into a number keeps its column.
    const owner = (relationType: string) =>
      f("owner", "relationship", {
        relationTo: "people",
        options: { relationType },
      });
    const changes = fieldTypeChangesOf({
      previous: [
        owner("manyToOne"),
        f("tags", "relationship", {
          relationTo: "people",
          options: { relationType: "manyToMany" },
        }),
        f("price", "text"),
      ],
      next: [owner("manyToMany"), f("tags", "text"), f("price", "number")],
      dialect: "postgresql",
      builtBy: "collection",
    });
    expect(changes.map(c => c.to.name)).toEqual(["price"]);
  });
});

const judged = (
  cls: "safe" | "lossy" | "blocked",
  name = "price"
): JudgedFieldTypeChange => ({
  from: f(name, "text"),
  to: f(name, "number"),
  fromType: fieldTypeOnDialect(f(name, "text"), "postgresql", "collection"),
  toType: fieldTypeOnDialect(f(name, "number"), "postgresql", "collection"),
  table: "dc_products",
  column: name,
  result: {
    judgement: {
      class: cls,
      reasons:
        cls === "safe"
          ? []
          : [
              {
                kind: cls === "blocked" ? "rounded" : "not-a-number",
                class: cls,
                rows: { first: [{ id: "p1" }], count: 3 },
              },
            ],
    },
    cleared: [],
    counts: { kept: 0, changed: 0, lost: 0, blocked: 0 },
    readings: [],
  },
});

describe("the refusals a save's type changes give", () => {
  it("refuses a blocked change, naming its reason by row keys and the way to keep the old values", () => {
    expect(
      typeChangeRefusals("Collection 'products'", [judged("blocked")])
    ).toEqual([
      {
        path: "price",
        code: "TYPE_CHANGE_BLOCKED",
        message:
          "Collection 'products': field 'price' cannot change from text to number (blocked: values the new type holds only rounded (3 rows, first 1: id p1)). A new field of the new type keeps the old values beside the new ones.",
      },
    ]);
  });

  it("refuses a lossy change unless its field is acknowledged, and never a safe one", () => {
    expect(
      typeChangeRefusals("Collection 'products'", [judged("lossy")]).map(
        r => r.code
      )
    ).toEqual(["TYPE_CHANGE_LOSES_VALUES"]);
    expect(
      typeChangeRefusals(
        "Collection 'products'",
        [judged("lossy")],
        new Set(["price"])
      )
    ).toEqual([]);
    expect(
      typeChangeRefusals("Collection 'products'", [judged("safe")])
    ).toEqual([]);
  });

  it("refuses any type change while the recorded definition awaits its migration", () => {
    const change = [judged("safe")];
    expect(
      pendingMigrationRefusal("Collection 'products'", "pending", change)
    ).toEqual({
      path: "price",
      code: "TYPE_CHANGE_BLOCKED",
      message:
        "Finish the pending migration of Collection 'products' first, then change the field's type.",
    });
    expect(
      pendingMigrationRefusal("Collection 'products'", "applied", change)
    ).toBeNull();
    expect(
      pendingMigrationRefusal("Collection 'products'", "pending", [])
    ).toBeNull();
  });
});
