/**
 * Which columns judged conversions fill, for the check of required columns that leaves those out. What
 * separates it from a plausible wrong answer: a converted column with no fill, and one whose fill does
 * not reach the rows holding none already, still have rows a NOT NULL would meet.
 */
import { describe, expect, it } from "vitest";

import {
  type ConvertedColumn,
  filledByConversions,
  type TypeConversion,
} from "../type-conversion";

const column = (
  name: string,
  fill?: ConvertedColumn["fill"]
): ConvertedColumn => ({
  table: "dc_posts",
  column: name,
  field: name,
  type: "integer",
  counts: { kept: 0, changed: 0, lost: 0 },
  takesPlaceOnSqlite: false,
  keepsType: false,
  changesKind: true,
  castReaches: false,
  ...(fill === undefined ? {} : { fill }),
});

const conversion = (...columns: ConvertedColumn[]): TypeConversion => ({
  tables: ["dc_posts"],
  columns,
  run: () => Promise.resolve(),
  runIn: () => undefined,
});

describe("the columns judged conversions fill", () => {
  it("is each whose fill reaches every row, in either case, of any conversion", () => {
    const filled = filledByConversions([
      conversion(column("other", { value: 0, rows: 0, everyRow: true })),
      conversion(column("v", { value: 0, rows: 2, everyRow: true })),
    ]);

    expect(filled("dc_posts", "v")).toBe(true);
    expect(filled("DC_POSTS", "V")).toBe(true);
    expect(filled("dc_posts", "other")).toBe(true);
    expect(filled("dc_other", "v")).toBe(false);
  });

  it("is none converted with no fill, nor one whose fill leaves the rows holding none", () => {
    const filled = filledByConversions([
      conversion(
        column("plain"),
        column("emptied", { value: 0, rows: 1, everyRow: false })
      ),
    ]);

    expect(filled("dc_posts", "plain")).toBe(false);
    expect(filled("dc_posts", "emptied")).toBe(false);
    expect(filledByConversions([])("dc_posts", "plain")).toBe(false);
  });
});
