/**
 * Generated DDL is assembled as text, so a default value's own punctuation has
 * to survive the trip through the SQL parser unchanged. JSON defaults are the
 * demanding case: they carry both apostrophes and backslash escapes, and the
 * dialects disagree about what a backslash means.
 */
import { describe, expect, it } from "vitest";

import { quoteJsonSqlDefault, quoteSqlLiteral } from "../sql-literal";

const dialects = ["postgresql", "mysql", "sqlite"] as const;

describe("quoteSqlLiteral", () => {
  describe.each(dialects)("%s", dialect => {
    it("wraps a plain value in single quotes", () => {
      expect(quoteSqlLiteral("hello", dialect)).toBe("'hello'");
    });

    it("doubles an embedded apostrophe", () => {
      expect(quoteSqlLiteral("O'Reilly", dialect)).toBe("'O''Reilly'");
    });

    it("doubles every apostrophe, not just the first", () => {
      expect(quoteSqlLiteral("it's o'clock", dialect)).toBe("'it''s o''clock'");
    });

    it("quotes a JSON document containing an apostrophe", () => {
      const json = JSON.stringify({ text: "it's fine" });
      expect(quoteSqlLiteral(json, dialect)).toBe(`'{"text":"it''s fine"}'`);
    });
  });

  describe("backslashes", () => {
    it("leaves them alone for postgresql and sqlite", () => {
      // Both store a backslash verbatim, so escaping it would store two.
      expect(quoteSqlLiteral("a\\nb", "postgresql")).toBe("'a\\nb'");
      expect(quoteSqlLiteral("a\\nb", "sqlite")).toBe("'a\\nb'");
    });

    it("doubles them for mysql", () => {
      // MySQL reads a backslash as an escape introducer, so an undoubled one
      // would consume the character after it.
      expect(quoteSqlLiteral("a\\nb", "mysql")).toBe("'a\\\\nb'");
    });

    it("keeps a JSON newline escape intact for mysql", () => {
      // JSON writes a newline as the two characters `\` and `n`. Left
      // undoubled, MySQL would store a real newline, and a literal newline
      // inside a JSON string does not parse.
      const json = JSON.stringify({ text: "line\nline" });
      const literal = quoteSqlLiteral(json, "mysql");
      expect(literal).toBe(`'{"text":"line\\\\nline"}'`);
      // What MySQL stores after collapsing each doubled backslash is exactly
      // the JSON that went in.
      expect(literal.slice(1, -1).replace(/\\\\/g, "\\")).toBe(json);
    });

    it("keeps an escaped backslash intact for mysql", () => {
      const json = JSON.stringify({ path: "C:\\dir" });
      const literal = quoteSqlLiteral(json, "mysql");
      expect(literal.slice(1, -1).replace(/\\\\/g, "\\")).toBe(json);
    });

    it("escapes backslashes and apostrophes together for mysql", () => {
      expect(quoteSqlLiteral("it's a\\b", "mysql")).toBe("'it''s a\\\\b'");
    });
  });
});

/**
 * MySQL refuses a literal default on a JSON column outright, so the DEFAULT
 * clause for a JSON-backed column is not the same text on every dialect.
 */
describe("quoteJsonSqlDefault", () => {
  it("encodes the value as hex for mysql", () => {
    // A quoted literal would have to guess how the server treats backslashes,
    // which depends on a SQL mode this code cannot see.
    expect(quoteJsonSqlDefault("{}", "mysql")).toBe(
      "(CONVERT(X'7b7d' USING utf8mb4))"
    );
  });

  it("leaves the literal bare for postgresql and sqlite", () => {
    expect(quoteJsonSqlDefault("{}", "postgresql")).toBe("'{}'");
    expect(quoteJsonSqlDefault("{}", "sqlite")).toBe("'{}'");
  });

  it("round-trips a value carrying quotes, newlines, and backslashes", () => {
    const json = JSON.stringify({ p: "C:\\dir", n: "a\nb", q: "it's" });
    const emitted = quoteJsonSqlDefault(json, "mysql");
    const hex = emitted.match(/X'([0-9a-f]*)'/)?.[1] ?? "";
    expect(Buffer.from(hex, "hex").toString("utf8")).toBe(json);
    // No delimiter or escape character survives into the statement text.
    expect(hex).toMatch(/^[0-9a-f]*$/);
  });
});
