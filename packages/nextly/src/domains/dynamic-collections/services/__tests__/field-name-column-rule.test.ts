/**
 * A field's column is `toSnakeCase(name)` on every road, so a collection saved
 * through the service keeps each field's name as given and checks every name
 * by the column it becomes.
 *
 * - `namesKeptFromStored`: on an update, an incoming field that differs from a
 *   stored field only in case keeps the STORED name, so its column and values
 *   stay where they are. Fields saved before names kept their case were stored
 *   lowercased (`metatitle`); sending them back as `metaTitle` must not drop
 *   that column for a new one.
 * - `validateFieldNames`: camelCase is accepted, and two names that become one
 *   column, a name whose column is a system column, and a column longer than
 *   an identifier may be are refused.
 */
import { describe, expect, it } from "vitest";

import { assertValidFieldsPayload } from "../../../../api/fields-payload";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";
import { DynamicCollectionValidationService } from "../dynamic-collection-validation-service";
import { namesKeptFromStored } from "../field-names";

const field = (name: string): FieldDefinition =>
  ({ name, type: "text" }) as FieldDefinition;

const namesOf = (fields: FieldDefinition[]) => fields.map(f => f.name);

describe("namesKeptFromStored", () => {
  // Every cell of {stored: none, lowercased, camelCase} × {sent: lowercased,
  // camelCase, as stored}: the stored name wins whenever the two differ only in
  // case, and a field with no stored match keeps the name it was sent with.
  const cells: Array<{
    stored: string | null;
    sent: string;
    saved: string;
  }> = [
    { stored: null, sent: "metatitle", saved: "metatitle" },
    { stored: null, sent: "metaTitle", saved: "metaTitle" },
    { stored: "metatitle", sent: "metatitle", saved: "metatitle" },
    { stored: "metatitle", sent: "metaTitle", saved: "metatitle" },
    { stored: "metatitle", sent: "METATITLE", saved: "metatitle" },
    { stored: "metaTitle", sent: "metatitle", saved: "metaTitle" },
    { stored: "metaTitle", sent: "metaTitle", saved: "metaTitle" },
  ];

  for (const { stored, sent, saved } of cells) {
    it(`saves "${sent}" as "${saved}" when ${stored ? `"${stored}" is stored` : "nothing is stored"}`, () => {
      const result = namesKeptFromStored(
        [field(sent)],
        stored ? [field(stored)] : []
      );
      expect(namesOf(result)).toEqual([saved]);
    });
  }

  it("keeps every other property of the incoming field", () => {
    const incoming = {
      name: "metaTitle",
      type: "text",
      required: true,
    } as FieldDefinition;
    const [result] = namesKeptFromStored([incoming], [field("metatitle")]);
    expect(result).toEqual({ ...incoming, name: "metatitle" });
  });

  it("keeps two stored fields that differ only in case each its own name", () => {
    const result = namesKeptFromStored(
      [field("metaTitle"), field("metatitle")],
      [field("metatitle"), field("metaTitle")]
    );
    expect(namesOf(result)).toEqual(["metaTitle", "metatitle"]);
  });

  it("saves a field sent for a stored field of the same column under the stored name", () => {
    // `metaTitle` and a stored `meta_title` are one column: saving it as sent
    // would ask to add a column that already exists.
    const result = namesKeptFromStored(
      [field("metaTitle"), field("summary")],
      [field("meta_title")]
    );
    expect(namesOf(result)).toEqual(["meta_title", "summary"]);
  });

  it("matches each incoming field to its own stored field among several", () => {
    const result = namesKeptFromStored(
      [field("metaTitle"), field("Summary"), field("newOne")],
      [field("summary"), field("metatitle"), field("removed")]
    );
    expect(namesOf(result)).toEqual(["metatitle", "summary", "newOne"]);
  });
});

describe("validateFieldNames, by the column each name becomes", () => {
  const validation = new DynamicCollectionValidationService();

  it("accepts a camelCase name", () => {
    expect(() =>
      validation.validateFieldNames([field("metaTitle"), field("title2")])
    ).not.toThrow();
  });

  it("refuses two names that become one column", () => {
    expect(() =>
      validation.validateFieldNames([field("metaTitle"), field("meta_title")])
    ).toThrow(/meta_title/);
  });

  // The reserved list carries both spellings of every system column
  // (`created_at`, `createdAt`), so today this is refused by its own spelling
  // as much as by its column; the column check also covers a column declared
  // under one spelling only, which no current column is.
  it("refuses a name whose column is a system column", () => {
    expect(() => validation.validateFieldNames([field("createdAt")])).toThrow(
      /reserved/i
    );
  });

  it("refuses a name whose column would be longer than an identifier may be", () => {
    // 50 characters, every other one a capital: its column grows past 63.
    const long = "aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwX";
    expect(long).toHaveLength(50);
    expect(() => validation.validateFieldNames([field(long)])).toThrow(
      /column/i
    );
  });

  it("still refuses a name starting with a capital", () => {
    expect(() => validation.validateFieldNames([field("MetaTitle")])).toThrow();
  });
});

// The Schema Builder's own gate, which every Builder preview and save passes
// through, is a separate rule from the service's: the service accepting a
// camelCase name from the API does not open it to the Builder.
describe("the Builder's field payload", () => {
  for (const kind of ["collection", "single", "component"] as const) {
    it(`still refuses a camelCase name for a ${kind}`, () => {
      expect(() =>
        assertValidFieldsPayload([{ name: "metaTitle", type: "text" }], {
          kind,
        })
      ).toThrow();
      expect(() =>
        assertValidFieldsPayload([{ name: "meta_title", type: "text" }], {
          kind,
        })
      ).not.toThrow();
    });
  }
});

// A field's CHECK constraints name its column like everything else in the
// table: a camelCase field's constraint on its name would refer to a column
// that does not exist, and the CREATE TABLE would fail.
describe("a camelCase field's constraints", () => {
  for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
    it(`name its column on ${dialect}`, () => {
      const sql = new DynamicCollectionSchemaService(
        undefined,
        dialect
      ).generateMigrationSQL("dc_books", [
        {
          name: "pageCount",
          type: "number",
          validation: { min: 1, max: 900 },
        } as FieldDefinition,
        {
          name: "metaTitle",
          type: "text",
          validation: { minLength: 3 },
        } as FieldDefinition,
      ]);
      const quoted = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      expect(sql).toContain(`${quoted("page_count")} >= 1`);
      expect(sql).toContain(`${quoted("page_count")} <= 900`);
      expect(sql).toContain(`LENGTH(${quoted("meta_title")}) >= 3`);
      expect(sql).not.toContain(quoted("pageCount"));
      expect(sql).not.toContain(quoted("metaTitle"));
    });
  }
});
