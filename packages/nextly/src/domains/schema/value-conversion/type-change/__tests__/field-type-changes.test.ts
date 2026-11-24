/**
 * The fields whose type a save changes, and the refusals their judgements give: a blocked change, a
 * lossy one the owner has not consented to, and any change while the definition awaits its
 * migration.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import { fieldTypeOnDialect } from "../field-type";
import {
  convertsByValue,
  fieldTypeChangesOf,
  type JudgedFieldTypeChange,
  pendingMigrationRefusal,
  rewritesValuesOn,
  translationsColumnChanges,
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

  it("finds a list's item type changing, as a number list's fractions becoming whole numbers", () => {
    const changes = fieldTypeChangesOf({
      previous: [
        f("scores", "number", {
          hasMany: true,
          options: { format: "float" },
        }),
      ],
      next: [f("scores", "number", { hasMany: true })],
      dialect: "postgresql",
      builtBy: "collection",
    });
    expect(changes.map(c => c.to.name)).toEqual(["scores"]);
  });

  it("finds a type change of a field kept on the row inside a group with no name", () => {
    const group = (type: string) =>
      f("", "group", { name: undefined, fields: [f("heading", type)] });
    const changes = fieldTypeChangesOf({
      previous: [group("text")],
      next: [group("number")],
      dialect: "postgresql",
      builtBy: "collection",
    });
    expect(changes.map(c => [c.from.type, c.to.name, c.to.type])).toEqual([
      ["text", "heading", "number"],
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
    emptied: 0,
    written: 0,
  },
});

// MySQL commits each schema statement on its own, and no hold keeps writes out on every road that
// converts, so no road rewrites a value there yet. The conversion's integration cases on MySQL are
// skipped by this answer, so a database leaving it here is a change of this case, never a silent skip.
describe("the databases a road rewrites a field's values on", () => {
  it("rewrites on PostgreSQL and SQLite, and not on MySQL", () => {
    expect(
      (["sqlite", "postgresql", "mysql"] as const).filter(rewritesValuesOn)
    ).toEqual(["sqlite", "postgresql"]);
  });

  it.each([
    ["sqlite", true],
    ["postgresql", true],
    ["mysql", false],
  ] as const)(
    "on %s converts a text becoming a number value by value: %s",
    (dialect, converts) => {
      expect(
        convertsByValue(f("v", "text"), f("v", "number"), dialect, {
          builtBy: "collection",
        })
      ).toBe(converts);
    }
  );
});

// A translated change is judged by the column its migration gives the translations table on every
// database, so a save on one database never writes a file that leaves another's in the old type.
describe("whether a translated field's translations column takes another type", () => {
  it("finds a checkbox becoming a number, whose column changes on PostgreSQL and MySQL though not on SQLite", () => {
    expect(
      translationsColumnChanges(
        f("v", "checkbox", { localized: true }),
        f("v", "number", { localized: true }),
        "collection"
      )
    ).toBe(true);
  });

  it("leaves a long text becoming code, which keeps its column on every database", () => {
    expect(
      translationsColumnChanges(
        f("v", "textarea", { localized: true }),
        f("v", "code", { localized: true }),
        "collection"
      )
    ).toBe(false);
  });
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

  it("refuses a lossy change unless the road converts it and its field is acknowledged, and never a safe one", () => {
    expect(
      typeChangeRefusals("Collection 'products'", [judged("lossy")]).map(
        r => r.code
      )
    ).toEqual(["TYPE_CHANGE_LOSES_VALUES"]);
    expect(
      typeChangeRefusals(
        "Collection 'products'",
        [{ ...judged("lossy"), converted: true }],
        new Set(["price"])
      )
    ).toEqual([]);
    // The database's cast clears nothing it cannot read, so consent does not let one through.
    expect(
      typeChangeRefusals(
        "Collection 'products'",
        [judged("lossy")],
        new Set(["price"])
      ).map(r => r.code)
    ).toEqual(["TYPE_CHANGE_LOSES_VALUES"]);
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
