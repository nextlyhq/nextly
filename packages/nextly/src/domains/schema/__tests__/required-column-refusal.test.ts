/**
 * The one refusal every road gives for a column made required over rows that
 * would break it: the entity, the field and the count, and for a field group
 * each collection and Single whose rows would break it.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import {
  requiredColumnBreakMessage,
  requiredColumnOverNullsError,
  requiredColumnUncountedError,
} from "../required-column-refusal";

describe("requiredColumnBreakMessage", () => {
  it("names the entity, the field and the count of rows holding no value", () => {
    expect(
      requiredColumnBreakMessage({
        entity: { kind: "collection", slug: "posts" },
        field: "title",
        count: 3,
        added: false,
      })
    ).toBe(
      "Collection 'posts': field 'title' cannot become required while 3 rows hold no value in it. Give those rows a value first, or keep the field optional."
    );
    expect(
      requiredColumnBreakMessage({
        entity: { kind: "single", slug: "home" },
        field: "title",
        count: 1,
        added: false,
      })
    ).toBe(
      "Single 'home': field 'title' cannot become required while 1 row holds no value in it. Give that row a value first, or keep the field optional."
    );
  });

  it("says why for a required field added without a default", () => {
    expect(
      requiredColumnBreakMessage({
        entity: { kind: "collection", slug: "posts" },
        field: "summary",
        count: 4,
        added: true,
      })
    ).toBe(
      "Collection 'posts': field 'summary' cannot be added as required without a default while 4 rows exist, which would hold no value in it. Give it a default, or add it as optional."
    );
  });

  it("names each collection and Single whose rows would break a field group's column", () => {
    expect(
      requiredColumnBreakMessage({
        entity: { kind: "fieldGroup", slug: "hero" },
        field: "cta",
        count: 3,
        added: false,
        users: [
          { kind: "collection", slug: "posts", count: 2 },
          { kind: "single", slug: "home", count: 1 },
        ],
      })
    ).toBe(
      "Field group 'hero': field 'cta' cannot become required while 3 rows hold no value in it: 2 in collection 'posts', 1 in Single 'home'. Give those rows a value first, or keep the field optional."
    );
  });
});

describe("requiredColumnBreakMessage for a field group's added column", () => {
  it("names each collection and Single whose rows would hold no value", () => {
    expect(
      requiredColumnBreakMessage({
        entity: { kind: "fieldGroup", slug: "hero" },
        field: "cta",
        count: 3,
        added: true,
        users: [
          { kind: "collection", slug: "posts", count: 2 },
          { kind: "single", slug: "home", count: 1 },
        ],
      })
    ).toBe(
      "Field group 'hero': field 'cta' cannot be added as required without a default while 3 rows exist, which would hold no value in it: 2 in collection 'posts', 1 in Single 'home'. Give it a default, or add it as optional."
    );
  });
});

describe("requiredColumnOverNullsError", () => {
  it("is one validation error with an entry per field, on the field's path", () => {
    const err = requiredColumnOverNullsError([
      {
        entity: { kind: "collection", slug: "posts" },
        field: "title",
        count: 3,
        added: false,
      },
      {
        entity: { kind: "collection", slug: "posts" },
        field: "summary",
        count: 4,
        added: true,
      },
    ]);
    expect(err).toBeInstanceOf(NextlyError);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.publicData).toEqual({
      errors: [
        {
          path: "fields.title",
          code: "REQUIRED_COLUMN_HAS_NULLS",
          message:
            "Collection 'posts': field 'title' cannot become required while 3 rows hold no value in it. Give those rows a value first, or keep the field optional.",
        },
        {
          path: "fields.summary",
          code: "REQUIRED_COLUMN_HAS_NULLS",
          message:
            "Collection 'posts': field 'summary' cannot be added as required without a default while 4 rows exist, which would hold no value in it. Give it a default, or add it as optional.",
        },
      ],
    });
  });
});

describe("a table that is not a collection, a Single or a field group", () => {
  // A plugin's or an extension's table has no entity or field to name, so its refusal names the
  // table and the column, on the table's path, under the same code.
  it("is named by its table and column", () => {
    const made = {
      entity: { kind: "table" as const, slug: "plugin_forms" },
      field: "label",
      count: 2,
      added: false,
    };
    const added = { ...made, field: "kind", count: 1, added: true };
    expect(requiredColumnBreakMessage(made)).toBe(
      "Table 'plugin_forms': column 'label' cannot become required while 2 rows hold no value in it. Give those rows a value first, or keep the column nullable."
    );
    expect(requiredColumnBreakMessage(added)).toBe(
      "Table 'plugin_forms': column 'kind' cannot be added as required without a default while 1 row exists, which would hold no value in it. Give it a default, or add it as nullable."
    );
    expect(requiredColumnOverNullsError([made]).publicData).toEqual({
      errors: [
        {
          path: "tables.plugin_forms.label",
          code: "REQUIRED_COLUMN_HAS_NULLS",
          message: requiredColumnBreakMessage(made),
        },
      ],
    });
  });
});

describe("requiredColumnUncountedError", () => {
  // A count that fails cannot say the change is safe, so the change is refused before anything
  // runs, naming the table and the field, rather than run and left to the database.
  it("refuses naming the table and the field, keeping the failure as the cause", () => {
    const cause = new Error("connection reset");
    const err = requiredColumnUncountedError({
      table: "dc_posts",
      field: "subtitle",
      cause,
    });
    expect(err).toBeInstanceOf(NextlyError);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.publicData).toEqual({
      errors: [
        {
          path: "fields.subtitle",
          code: "REQUIRED_COLUMN_UNCOUNTED",
          message:
            "Table 'dc_posts': the rows that would break making 'subtitle' required could not be counted, so that change was refused before it ran. Check that the database can be reached and the table read, then try again.",
        },
      ],
    });
    expect(err.cause).toBe(cause);
  });
});
