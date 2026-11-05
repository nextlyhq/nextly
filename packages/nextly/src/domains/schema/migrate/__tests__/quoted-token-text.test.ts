// A string token carries the text the server reads only when this scan reads
// it exactly; every other string has none, so a reader comparing it fails
// closed. Each cell is one condition that makes the text inexact.
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { statementTokens, type QuotedToken } from "../split-sql";

/** The quoted tokens of `sql`, in order. */
function quoted(sql: string, dialect: SupportedDialect): QuotedToken[] {
  return statementTokens(sql, dialect).filter(
    (token): token is QuotedToken => typeof token !== "string"
  );
}

describe("a quoted token names its kind", () => {
  it("reads a string, a quoted name and a dollar body as three kinds", () => {
    expect(quoted(`SELECT 'a', "b", $$c$$`, "postgresql")).toEqual([
      { kind: "string", name: undefined, text: "a" },
      { kind: "name", name: "B" },
      { kind: "body", name: undefined },
    ]);
  });

  it.each<SupportedDialect>(["postgresql", "mysql", "sqlite"])(
    "%s: reads no name from an unterminated quoted name",
    dialect => {
      const q = dialect === "mysql" ? "`" : '"';
      expect(quoted(`ALTER TABLE ${q}dc_posts`, dialect)).toEqual([
        { kind: "name", name: undefined },
      ]);
    }
  );

  it("reads MySQL's backtick as a name", () => {
    expect(quoted("SELECT `b`", "mysql")).toEqual([
      { kind: "name", name: "B" },
    ]);
  });
});

describe("a string's text is exact or absent", () => {
  it.each<SupportedDialect>(["postgresql", "mysql", "sqlite"])(
    "%s: undoes a doubled quote",
    dialect => {
      expect(quoted(`SELECT 'it''s'`, dialect)[0]?.text).toBe("it's");
    }
  );

  it("sqlite: keeps a backslash, which never escapes there", () => {
    expect(quoted(`SELECT 'a\\nb'`, "sqlite")[0]?.text).toBe("a\\nb");
  });

  it("mysql: has no text for a string with a backslash", () => {
    expect(quoted(`SELECT 'a\\nb'`, "mysql")[0]?.text).toBeUndefined();
  });

  it("postgresql: has no text for an E'...' string with a backslash", () => {
    expect(quoted(`SELECT E'a\\nb'`, "postgresql")[0]?.text).toBeUndefined();
  });

  it("postgresql: has no text for an ordinary string with a backslash", () => {
    // standard_conforming_strings decides what it means.
    expect(quoted(`SELECT 'a\\'`, "postgresql")[0]?.text).toBeUndefined();
  });

  it("postgresql: reads an E'...' string with no backslash exactly", () => {
    expect(quoted(`SELECT E'ab'`, "postgresql")[0]?.text).toBe("ab");
  });

  it("mysql: has no text for a double-quoted string", () => {
    // ANSI_QUOTES reads it as a name.
    expect(quoted(`SELECT "ab"`, "mysql")[0]).toEqual({
      kind: "string",
      name: undefined,
      text: undefined,
    });
  });

  it.each<SupportedDialect>(["postgresql", "mysql", "sqlite"])(
    "%s: has no text for an unterminated string",
    dialect => {
      expect(quoted(`SELECT 'ab`, dialect)[0]?.text).toBeUndefined();
    }
  );
});
