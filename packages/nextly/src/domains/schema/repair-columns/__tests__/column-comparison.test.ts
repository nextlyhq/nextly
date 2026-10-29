import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../services/field-column-descriptor";
import { compareColumn, type ColumnShape } from "../column-comparison";

/** A live column as introspection records it. */
const live = (
  type: string,
  nullable = true,
  extra: Partial<ColumnShape> = {}
): ColumnShape => ({ type, nullable, ...extra });

/** The column a descriptor names: its dialect type, size inside the type. */
const expected = (type: string, nullable = true): ColumnShape => ({
  type,
  nullable,
});

describe("compareColumn: each known shape", () => {
  // One row per shape the spec lists, on each dialect that can hold it: the
  // live column an older generator created, against the descriptor's column.
  const shapes: Array<{
    shape: string;
    dialect: SupportedDialect;
    live: ColumnShape;
    expected: ColumnShape;
    type: boolean;
    nullability: boolean;
  }> = [
    {
      shape: "repeater or group in text",
      dialect: "postgresql",
      live: live("text"),
      expected: expected("jsonb"),
      type: true,
      nullability: false,
    },
    {
      shape: "repeater or group in text",
      dialect: "mysql",
      live: live("text"),
      expected: expected("json"),
      type: true,
      nullability: false,
    },
    {
      shape: "float number in decimal(10,2)",
      dialect: "postgresql",
      live: live("numeric", true, { typeModifier: "10,2" }),
      expected: expected("float8"),
      type: true,
      nullability: false,
    },
    {
      shape: "float number in decimal(10,2)",
      dialect: "mysql",
      live: live("decimal(10,2)"),
      expected: expected("double"),
      type: true,
      nullability: false,
    },
    {
      shape: "select or radio in text",
      dialect: "mysql",
      live: live("text"),
      expected: expected("varchar(255)"),
      type: true,
      nullability: false,
    },
    {
      shape: "upload in text",
      dialect: "mysql",
      live: live("text"),
      expected: expected("varchar(36)"),
      type: true,
      nullability: false,
    },
    {
      shape: "required relationship in a NOT NULL column",
      dialect: "postgresql",
      live: live("text", false),
      expected: expected("text", true),
      type: false,
      nullability: true,
    },
    {
      shape: "required relationship in a NOT NULL column",
      dialect: "mysql",
      live: live("varchar(36)", false),
      expected: expected("varchar(36)", true),
      type: false,
      nullability: true,
    },
    {
      shape: "required relationship in a NOT NULL column",
      dialect: "sqlite",
      live: live("text", false),
      expected: expected("text", true),
      type: false,
      nullability: true,
    },
    {
      shape: "component many-to-many in a uuid column",
      dialect: "postgresql",
      live: live("uuid"),
      expected: expected("jsonb"),
      type: true,
      nullability: false,
    },
    {
      shape: "component many-to-many in a text column",
      dialect: "postgresql",
      live: live("text"),
      expected: expected("jsonb"),
      type: true,
      nullability: false,
    },
    {
      shape: "component many-to-many in a varchar(36) column",
      dialect: "mysql",
      live: live("varchar(36)"),
      expected: expected("json"),
      type: true,
      nullability: false,
    },
    {
      shape: "a type and a nullability difference at once",
      dialect: "postgresql",
      live: live("text", false),
      expected: expected("jsonb", true),
      type: true,
      nullability: true,
    },
  ];

  it.each(shapes)(
    "$shape on $dialect differs in type=$type, nullability=$nullability",
    ({ live: liveColumn, expected: expectedColumn, type, nullability }) => {
      expect(compareColumn(liveColumn, expectedColumn)).toEqual({
        type,
        nullability,
      });
    }
  );

  it("finds no type difference for a repeater or group on SQLite, where JSON is text", () => {
    expect(compareColumn(live("text"), expected("text"))).toBeNull();
  });
});

describe("compareColumn: sizes, where the database reports them", () => {
  it("counts a varchar length that differs", () => {
    expect(
      compareColumn(live("varchar(36)"), expected("varchar(255)"))
    ).toEqual({ type: true, nullability: false });
  });

  it("counts a varchar length PostgreSQL reports beside the type", () => {
    expect(
      compareColumn(
        live("varchar", true, { typeModifier: "120" }),
        expected("varchar(255)")
      )
    ).toEqual({ type: true, nullability: false });
  });

  it("counts a decimal's precision and scale that differ", () => {
    expect(
      compareColumn(
        live("numeric", true, { typeModifier: "12,4" }),
        expected("numeric(10, 2)")
      )
    ).toEqual({ type: true, nullability: false });
  });

  it("reads the same precision and scale written with and without a space as the same", () => {
    expect(
      compareColumn(
        live("numeric", true, { typeModifier: "10,2" }),
        expected("numeric(10, 2)")
      )
    ).toBeNull();
  });

  it("does not count a size only one side states", () => {
    // SQLite's descriptor names a bare `numeric`; a declared `numeric(10,2)`
    // reports a size the descriptor never stated, which is no difference.
    expect(
      compareColumn(live("numeric(10,2)"), expected("numeric"))
    ).toBeNull();
  });
});

describe("compareColumn: spelling alone is no difference", () => {
  const pairs: Array<[string, string]> = [
    ["int4", "integer"],
    ["int", "int4"],
    ["int8", "bigint"],
    ["int2", "smallint"],
    ["bool", "boolean"],
    ["tinyint(1)", "bool"],
    ["float8", "double precision"],
    ["float4", "real"],
    ["varchar", "character varying"],
    ["bpchar", "character"],
    ["timestamptz", "timestamp with time zone"],
    ["timestamp", "timestamp without time zone"],
    ["numeric", "decimal"],
    ["_text", "text[]"],
    ["TEXT", "text"],
  ];

  it.each(pairs)("%s and %s", (liveType, expectedType) => {
    expect(compareColumn(live(liveType), expected(expectedType))).toBeNull();
  });

  it("still counts a real type change hidden behind a size strip", () => {
    // `tinyint(4)` is a one-byte integer, not the boolean `tinyint(1)` spells.
    expect(compareColumn(live("tinyint(4)"), expected("tinyint(1)"))).toEqual({
      type: true,
      nullability: false,
    });
  });
});

describe("compareColumn: what is not compared", () => {
  it("does not report a column that differs only in its default", () => {
    expect(
      compareColumn(
        live("text", true, { default: "'draft'::text" }),
        expected("text")
      )
    ).toBeNull();
  });

  it("does not report a column that differs only in being a key", () => {
    expect(
      compareColumn(live("text", true, { primaryKey: true }), expected("text"))
    ).toBeNull();
  });
});
