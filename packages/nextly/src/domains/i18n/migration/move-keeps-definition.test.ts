/**
 * The judge of a move into a new column: what the source column has that the receiving column,
 * created naming none of it, would not.
 */
import { describe, expect, it } from "vitest";

import type { ColumnExtras } from "../../schema/pipeline/live-table-facts";

import {
  lostOnMove,
  refusalsForMovesLosingDefinition,
} from "./move-keeps-definition";

const moved = [{ field: "summary", column: "summary" }];
const extras = (facts: Partial<ColumnExtras>) =>
  new Map<string, ColumnExtras>([
    ["summary", { comment: null, charset: null, collation: null, ...facts }],
  ]);
const NONE = { charset: null, collation: null };
const UTF8MB4 = { charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci" };

describe("lostOnMove", () => {
  it("loses nothing from a column with no comment and the receiving defaults", () => {
    expect(lostOnMove(moved, extras({}), NONE)).toEqual([]);
    expect(
      lostOnMove(
        moved,
        extras({ charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci" }),
        UTF8MB4
      )
    ).toEqual([]);
  });

  it("loses a comment wherever the column has one", () => {
    expect(lostOnMove(moved, extras({ comment: "kept" }), NONE)).toEqual([
      { field: "summary", column: "summary", lost: ["comment"] },
    ]);
  });

  it("loses a character set or collation other than the receiving table's", () => {
    expect(
      lostOnMove(
        moved,
        extras({ charset: "latin1", collation: "latin1_swedish_ci" }),
        UTF8MB4
      )
    ).toEqual([
      {
        field: "summary",
        column: "summary",
        lost: ["character set", "collation"],
      },
    ]);
    // The same character set under another collation.
    expect(
      lostOnMove(
        moved,
        extras({ charset: "utf8mb4", collation: "utf8mb4_bin" }),
        UTF8MB4
      )
    ).toEqual([{ field: "summary", column: "summary", lost: ["collation"] }]);
  });

  it("loses a non-default collation where the receiving column takes its type's", () => {
    expect(lostOnMove(moved, extras({ collation: "public.C" }), NONE)).toEqual([
      { field: "summary", column: "summary", lost: ["collation"] },
    ]);
  });

  it("judges nothing for a column the source table does not have", () => {
    expect(lostOnMove(moved, new Map(), NONE)).toEqual([]);
  });
});

describe("refusalsForMovesLosingDefinition", () => {
  it("names the field, its column, what it would lose and the way on", () => {
    const [refused] = refusalsForMovesLosingDefinition({
      losses: [{ field: "summary", column: "summary", lost: ["comment"] }],
      table: "dc_posts",
      translation: "on",
      surface: "builder",
    });
    expect(refused).toMatchObject({
      path: "fields.summary",
      code: "TRANSLATION_MOVE_LOSES_COLUMN_DEFINITION",
    });
    expect(refused?.message).toMatch(
      /dc_posts\.summary.*own comment.*translation on.*Remove the comment.*leave translation off.*save again/
    );
  });
});
