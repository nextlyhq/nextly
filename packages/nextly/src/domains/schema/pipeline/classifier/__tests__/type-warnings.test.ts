// What each database does with the type change offered, one case per pair on each dialect.
//
// The warning is what an owner reads before agreeing to a conversion, so it must say what that
// database actually does: MySQL refuses a value that is not JSON rather than coercing it, a
// PostgreSQL cast stops at the first value it cannot read, SQLite enforces no length.

import { describe, it, expect } from "vitest";

import { buildPerDialectWarning } from "../type-warnings";

describe("buildPerDialectWarning", () => {
  describe("text to JSON", () => {
    const w = buildPerDialectWarning("text", "jsonb");

    it("PostgreSQL stops at the first value that is not JSON", () => {
      expect(w.pg).toBe(
        "PostgreSQL: text -> jsonb stops with an error at the first value that is not JSON (an empty string included), and nothing is changed."
      );
    });

    it("MySQL refuses a value that is not JSON, never coercing it", () => {
      expect(w.mysql).toBe(
        "MySQL: text -> jsonb refuses a value that is not valid JSON (an empty string included), whatever the SQL mode: it is not coerced. The conversion stops and nothing is changed."
      );
      expect(w.mysql).not.toMatch(/silently|coerces/i);
    });

    it("SQLite keeps the values as text", () => {
      expect(w.sqlite).toBe(
        "SQLite: text -> jsonb keeps every value as it is: SQLite holds JSON as text, so no value is checked."
      );
    });
  });

  describe("a string to a shorter varchar", () => {
    const w = buildPerDialectWarning("text", "varchar(255)");

    it("PostgreSQL stops at the first value too long", () => {
      expect(w.pg).toBe(
        "PostgreSQL: text -> varchar(255) stops with an error at the first value longer than 255 characters, and nothing is changed."
      );
    });

    it("MySQL refuses it in strict mode and cuts it without", () => {
      expect(w.mysql).toBe(
        "MySQL: text -> varchar(255) refuses a value longer than 255 characters in strict mode (the default), and the conversion stops; without strict mode it cuts the value to 255 characters with only a warning."
      );
    });

    it("SQLite enforces no length", () => {
      expect(w.sqlite).toBe(
        "SQLite: text -> varchar(255) keeps every value as it is: SQLite enforces no length."
      );
    });
  });

  describe("a number to a double", () => {
    const w = buildPerDialectWarning("numeric(10,2)", "double precision");

    it("PostgreSQL rounds past a double's digits, with no error", () => {
      expect(w.pg).toBe(
        "PostgreSQL: numeric(10,2) -> double precision stores each value as a double: a value of more than 15 significant digits is rounded, with no error."
      );
    });

    it("MySQL rounds past a double's digits, with no error", () => {
      expect(w.mysql).toBe(
        "MySQL: numeric(10,2) -> double precision stores each value as a double: a value of more than 15 significant digits is rounded, with no error."
      );
    });

    it("SQLite stores each number as a REAL", () => {
      expect(w.sqlite).toBe(
        "SQLite: numeric(10,2) -> double precision stores each number as a REAL, a double: a value of more than 15 significant digits is rounded, with no error, and a value that is not a number is kept as text."
      );
    });
  });

  describe("any other pair", () => {
    const w = buildPerDialectWarning("text", "integer");

    it("PostgreSQL stops at the first value it cannot cast", () => {
      expect(w.pg).toBe(
        "PostgreSQL: text -> integer stops with an error at the first value that cannot be cast to integer, and nothing is changed."
      );
    });

    it("MySQL refuses in strict mode and coerces without", () => {
      expect(w.mysql).toBe(
        "MySQL: text -> integer refuses a value it cannot convert in strict mode (the default), and the conversion stops; without strict mode it stores a coerced value (0, a cut string, a zero date) with only a warning."
      );
    });

    it("SQLite keeps what its new affinity cannot convert", () => {
      expect(w.sqlite).toBe(
        'SQLite: text -> integer copies each value into a column of the new type\'s affinity: a value it cannot convert is kept as it was stored ("abc" stays text in an integer column), with no error.'
      );
    });
  });
});
