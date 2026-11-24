/**
 * Whether a CHECK or a generated column reads a column, as the database states it. What separates
 * this from a search of the text: a name is read however it is quoted, and neither a string, a
 * comment nor another name's own characters hide a reader or make one up.
 */
import { describe, expect, it } from "vitest";

import { namesColumn, sqliteReadersIn } from "../column-readers";

const CHECK = "a CHECK that reads v";
const GENERATED = "a generated column that reads v";
const table = (columns: string) => `CREATE TABLE t (id text, ${columns})`;

describe("what in a SQLite table's statement reads a column", () => {
  it.each([
    ["a column's own CHECK", "v text CHECK (length(v) < 9)"],
    ["the table's named CHECK", "v text, CONSTRAINT c CHECK (v > 1)"],
    ["a double-quoted name", `v text CHECK ("v" > 1)`],
    ["a bracketed name", "v text CHECK ([v] > 1)"],
    ["a backquoted name", "v text CHECK (`v` > 1)"],
    ["a name in another case", "v text check (V > 1)"],
    ["a name qualified by its table", "v text CHECK (t.v > 1)"],
    [
      "after a string with a doubled quote",
      "v text CHECK (id <> 'it''s )' OR v > 1)",
    ],
    [
      "after a name with an apostrophe",
      `v text CHECK ("it's" <> 'a' OR v <> 'b')`,
    ],
    ["after a name with a parenthesis", `v text CHECK ("a)" IS NULL OR v > 1)`],
    [
      "after a bracketed name with a parenthesis",
      "v text CHECK ([a)] IS NULL OR v > 1)",
    ],
    [
      "past a comment before its parenthesis",
      "v text CHECK /* it's ) */ (v > 1)",
    ],
    [
      "past a line comment before its parenthesis",
      "v text CHECK -- it's )\n (v > 1)",
    ],
    ["after a comment inside it", "v text CHECK (id > 1 /* ) */ AND v > 1)"],
    ["inside nested parentheses", "v text CHECK ((id > 1) AND ((v) > 1))"],
    ["the second of two", "v text CHECK (id > 1) CHECK (v > 1)"],
    ["an expression that never closes", "v text CHECK ((id > 1"],
    ["a quoted name that never closes", `v text CHECK ("id > 1)`],
  ])("reads a CHECK: %s", (_, columns) => {
    expect(sqliteReadersIn(table(columns), "v")).toContain(CHECK);
  });

  it.each([
    ["no CHECK", "v text"],
    ["a CHECK of another column", "v text CHECK (id > 1)"],
    [
      "a CHECK of a column whose name holds it",
      "v text, va text CHECK (va > 1)",
    ],
    ["its name in a string", "v text CHECK (id <> 'v')"],
    ["its name in a comment", "v text CHECK (id > 1 /* v */)"],
    ["a CHECK in a comment", "v text /* CHECK (v > 1) */"],
    ["a CHECK in a string", "v text DEFAULT 'CHECK (v > 1)'"],
    ["a column named check", `v text, "check" text`],
    ["a cast", "v text CHECK (CAST(id AS text) > 1)"],
  ])("reads none: %s", (_, columns) => {
    expect(sqliteReadersIn(table(columns), "v")).toEqual([]);
  });

  it.each([
    ["spelled whole", "v text, g text GENERATED ALWAYS AS (v || 'x') STORED"],
    ["spelled short", "v text, g text AS (\"v\" || 'x')"],
  ])("reads a generated column: %s", (_, columns) => {
    expect(sqliteReadersIn(table(columns), "v")).toEqual([GENERATED]);
  });
});

describe("whether a CHECK's expression names a column", () => {
  it.each([
    ["postgresql", "CHECK (((v)::text <> 'a'::text))", true],
    [
      "postgresql",
      `CHECK ((("it's")::text <> 'a'::text) OR ((v)::text <> 'b'::text))`,
      true,
    ],
    ["postgresql", "CHECK (((va)::text <> 'v'::text))", false],
    ["mysql", "(`v` <> _utf8mb4\\'a\\')", true],
    ["sqlite", `"it's" <> 'a' OR v <> 'b'`, true],
  ] as const)("%s: %s", (dialect, expression, names) => {
    expect(namesColumn(expression, "v", dialect)).toBe(names);
  });
});
