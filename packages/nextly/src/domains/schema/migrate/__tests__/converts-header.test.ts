/**
 * The line a migration file states its converted columns and their fills on, and how it is read back.
 * A fill is any JSON a field can hold: what separates it from a writing of its own is that a comma, a
 * quote or a line break in it ends neither the entry nor the line.
 */
import { describe, expect, it } from "vitest";

import {
  convertsHeaderLine,
  filledBy,
  readConvertsMark,
} from "../converts-header";

const FILE = "20260101_000000_000_posts_update.sql";
const file = (line: string) =>
  `-- Migration: posts\n${line}\n-- UP\nSELECT 1;\n`;
const read = (line: string) => readConvertsMark(file(line), FILE);

describe("a migration file's converted columns", () => {
  it.each([
    0,
    -1.5,
    false,
    "low",
    'a, b\'s "c" (d) * e!',
    "two\nlines\r\nand \u2028 a separator",
    "-- UP",
    "%20 fill, x.y",
    "עברית 😀",
    ["a", "b"],
    { root: { type: "root", children: [] } },
  ])("states a fill and reads it back: %j", value => {
    const columns = [
      { table: "dc_posts", column: "v", fill: { value } },
      { table: "dc_posts_locales", column: "title" },
    ];
    const line = convertsHeaderLine(columns);

    // One line, whatever the value holds.
    expect(line.trimEnd().split(/[\r\n\u2028\u2029]/)).toHaveLength(1);
    expect(read(line.trimEnd())?.columns).toEqual(columns);
  });

  it("states a column with no fill as it did", () => {
    expect(
      convertsHeaderLine([
        { table: "dc_posts", column: "v" },
        { table: "dc_posts_locales", column: "title" },
      ])
    ).toBe("-- Converts values: rules 1; dc_posts.v, dc_posts_locales.title\n");
    expect(convertsHeaderLine([])).toBe("");
  });

  it.each([
    ["no value", "dc_posts.v fill"],
    ["a value that is no JSON", "dc_posts.v fill abc"],
    ["a value cut off", "dc_posts.v fill %7B%22a"],
    ["an escape that is none", "dc_posts.v fill %E0%A4%A"],
    ["two values", "dc_posts.v fill 0 1"],
    ["another word", "dc_posts.v with 0"],
  ])("refuses a line whose fill cannot be read: %s", (_, entry) => {
    expect(() => read(`-- Converts values: rules 1; ${entry}`)).toThrow();
  });

  it("says which columns are filled, in either case", () => {
    const filled = filledBy([
      { table: "dc_posts", column: "v", fill: { value: 0 } },
      { table: "dc_posts", column: "w" },
    ]);
    expect(filled("DC_POSTS", "V")).toBe(true);
    expect(filled("dc_posts", "w")).toBe(false);
    expect(filled("dc_other", "v")).toBe(false);
  });
});
