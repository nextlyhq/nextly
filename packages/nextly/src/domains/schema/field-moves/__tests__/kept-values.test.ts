/**
 * What each column kind keeps of a value moved out of a group, on each dialect: the rule the save
 * judges every entry by before a move is written.
 */
import { describe, expect, it } from "vitest";

import {
  fitsDecimal,
  keptValuesOf,
  type HeldValue,
  type KeptColumn,
} from "../kept-values";

type Dialect = "postgresql" | "mysql" | "sqlite";
const ALL: readonly Dialect[] = ["postgresql", "mysql", "sqlite"];
const SERVERS: readonly Dialect[] = ["postgresql", "mysql"];

/** The value as each dialect's check reads it: the JSON type's name, and the text. */
const held = (type: string, text: string): HeldValue => ({ type, text });

function keeps(
  column: KeptColumn,
  dialect: Dialect,
  value: HeldValue
): boolean | undefined {
  return keptValuesOf(column, dialect)?.keeps(value);
}

describe("keptValuesOf", () => {
  it("keeps a text within a varchar's width in characters, on PostgreSQL and MySQL", () => {
    const column: KeptColumn = { kind: "shortText", columnType: "varchar(40)" };
    for (const dialect of SERVERS) {
      expect(keeps(column, dialect, held("string", "a".repeat(40)))).toBe(true);
      expect(keeps(column, dialect, held("string", "a".repeat(41)))).toBe(
        false
      );
      // Characters, not UTF-16 units: forty emoji fit forty characters.
      expect(keeps(column, dialect, held("string", "😀".repeat(40)))).toBe(
        true
      );
      expect(keptValuesOf(column, dialect)?.ask("it")).toBe(
        "Write it in at most 40 characters"
      );
    }
    // SQLite's text has no width.
    expect(keptValuesOf(column, "sqlite")).toBeUndefined();
  });

  it("keeps a text in MySQL's text within its bytes, and any text on PostgreSQL and SQLite", () => {
    const column: KeptColumn = { kind: "longText", columnType: "text" };
    expect(keeps(column, "mysql", held("string", "a".repeat(65535)))).toBe(
      true
    );
    expect(keeps(column, "mysql", held("string", "a".repeat(65536)))).toBe(
      false
    );
    // Bytes, not characters: 16 384 four-byte characters are 65 536 bytes.
    expect(keeps(column, "mysql", held("string", "😀".repeat(16384)))).toBe(
      false
    );
    expect(keptValuesOf(column, "postgresql")).toBeUndefined();
    expect(keptValuesOf(column, "sqlite")).toBeUndefined();
  });

  it("bounds a select's and a relationship id's MySQL varchar as any string column", () => {
    // A select or radio is the `text` kind, varchar(255) on MySQL; a single relationship's id is
    // varchar(36) there.
    expect(
      keeps(
        { kind: "text", columnType: "varchar(255)" },
        "mysql",
        held("string", "x".repeat(256))
      )
    ).toBe(false);
    expect(
      keeps(
        { kind: "fkSingle", columnType: "varchar(36)" },
        "mysql",
        held("string", "x".repeat(37))
      )
    ).toBe(false);
    expect(
      keptValuesOf({ kind: "text", columnType: "text" }, "postgresql")
    ).toBeUndefined();
  });

  it("keeps a decimal that fits its precision and scale exactly, on PostgreSQL and MySQL", () => {
    const column: KeptColumn = {
      kind: "decimal",
      columnType: "numeric",
      precision: 10,
      scale: 2,
    };
    for (const dialect of SERVERS) {
      for (const text of ["1.23", "1.230", "12345678.9", "-0.05", "0", "100"]) {
        expect(keeps(column, dialect, held("number", text)), text).toBe(true);
      }
      // A digit past the scale, which the cast would round away, or too many before the point.
      for (const text of ["1.239", "123456789", "1e-7", "1e21", "abc"]) {
        expect(keeps(column, dialect, held("number", text)), text).toBe(false);
      }
      expect(keptValuesOf(column, dialect)?.ask("each")).toBe(
        "Write each as a number with at most 8 digits before the point and 2 after it"
      );
    }
    // SQLite's numeric keeps the value as it is.
    expect(keptValuesOf(column, "sqlite")).toBeUndefined();
  });

  it("keeps a whole number within an integer's range, on PostgreSQL and MySQL", () => {
    const column: KeptColumn = { kind: "integer", columnType: "int4" };
    for (const dialect of SERVERS) {
      for (const text of ["0", "-2147483648", "2147483647"]) {
        expect(keeps(column, dialect, held("number", text)), text).toBe(true);
      }
      for (const text of ["2147483648", "-2147483649", "3.5", "1e3", "true"]) {
        expect(keeps(column, dialect, held("number", text)), text).toBe(false);
      }
    }
    expect(keptValuesOf(column, "sqlite")).toBeUndefined();
  });

  it("keeps any JSON number in a double, and refuses text its cast cannot read", () => {
    const column: KeptColumn = { kind: "double", columnType: "float8" };
    for (const dialect of SERVERS) {
      for (const text of ["0.1", "-3", "1e-7", "1.5E+30"]) {
        expect(keeps(column, dialect, held("number", text)), text).toBe(true);
      }
      for (const text of ["abc", "", "NaN", "true"]) {
        expect(keeps(column, dialect, held("string", text)), text).toBe(false);
      }
    }
    expect(keptValuesOf(column, "sqlite")).toBeUndefined();
  });

  it("keeps only a checkbox value every dialect reads as the same boolean, on every dialect", () => {
    const column: KeptColumn = { kind: "boolean", columnType: "boolean" };
    for (const dialect of ALL) {
      for (const value of [
        held("boolean", "true"),
        held("BOOLEAN", "false"),
        // SQLite names a JSON boolean's type `true` or `false` and reads it as 1 or 0.
        held("true", "1"),
        held("false", "0"),
        held("integer", "1"),
        held("number", "0"),
        held("string", "true"),
        held("text", "false"),
      ]) {
        expect(keeps(column, dialect, value), JSON.stringify(value)).toBe(true);
      }
      // Read as false on MySQL and SQLite, as true ("yes") or refused (2) on PostgreSQL.
      for (const value of [
        held("string", "yes"),
        held("string", "True"),
        held("string", "1"),
        held("integer", "2"),
        held("object", "{}"),
      ]) {
        expect(keeps(column, dialect, value), JSON.stringify(value)).toBe(
          false
        );
      }
      expect(keptValuesOf(column, dialect)?.ask("it")).toBe(
        "Write it as true or false"
      );
    }
  });

  it("judges a date on every dialect, as `movesAsTheSameDate` reads it", () => {
    const column: KeptColumn = { kind: "timestamp", columnType: "timestamp" };
    expect(keeps(column, "sqlite", held("text", "2026-07-17"))).toBe(true);
    expect(keeps(column, "sqlite", held("text", "July 17, 2026"))).toBe(false);
    // A date is a string: a number is not read as one.
    expect(keeps(column, "postgresql", held("number", "1784246400"))).toBe(
      false
    );
  });

  it("keeps every value of a JSON column, and of a kind whose column takes any", () => {
    for (const dialect of ALL) {
      expect(
        keptValuesOf({ kind: "json", columnType: "jsonb" }, dialect)
      ).toBeUndefined();
    }
  });
});

describe("fitsDecimal", () => {
  it("reads the digits from the text, with an exponent moving the point", () => {
    expect(fitsDecimal("0.000001", 10, 6)).toBe(true);
    expect(fitsDecimal("1e-6", 10, 6)).toBe(true);
    expect(fitsDecimal("1.5e2", 10, 0)).toBe(true);
    expect(fitsDecimal("1.55e1", 10, 0)).toBe(false);
    expect(fitsDecimal("0001.10", 3, 1)).toBe(true);
    expect(fitsDecimal("99.99", 4, 2)).toBe(true);
    expect(fitsDecimal("100.00", 4, 2)).toBe(false);
  });
});
