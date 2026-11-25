/**
 * Which of the main table's indexes a move of translatable columns drops first, and which refuse
 * it (`indexDropsBeforeColumns`). The plausible broken versions: an index on the column with
 * another one dropped (its other column then loses its index, or what it keeps unique changes),
 * an expression or partial index over the column missed (SQLite refuses the drop part-way, the
 * others drop it in silence), and one merely named after the column taken to read it.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors";
import { indexDropsBeforeColumns } from "../generate-up";

const SPEC = {
  dialect: "postgresql" as const,
  mainTable: "dc_notes",
  collection: "notes",
};

/** An index as the catalog reader reports it, whole and droppable unless said otherwise. */
function index(
  name: string,
  columns: string[],
  over: {
    wholeColumns?: boolean;
    droppableByName?: boolean;
    definition?: string;
  } = {}
) {
  return {
    name,
    columns,
    wholeColumns: over.wholeColumns ?? true,
    droppableByName: over.droppableByName ?? true,
    ...(over.definition === undefined ? {} : { definition: over.definition }),
  };
}

/** The refusal `run` throws, or undefined where it throws none. */
function refusalOf(run: () => unknown): NextlyError | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
}

describe("indexDropsBeforeColumns", () => {
  it("drops an index on a moving column alone, first, in each dialect's form", () => {
    const indexes = [index("by_title", ["title"]), index("by_id", ["id"])];
    expect(indexDropsBeforeColumns(SPEC, ["Title"], indexes)).toEqual([
      'DROP INDEX "by_title"',
    ]);
    expect(
      indexDropsBeforeColumns({ ...SPEC, dialect: "mysql" }, ["title"], indexes)
    ).toEqual(["DROP INDEX `by_title` ON `dc_notes`"]);
  });

  it("refuses an index on the column with another, or one only a rebuild removes, naming it", () => {
    for (const held of [
      index("pair", ["title", "id"]),
      index("inline_unique", ["title"], { droppableByName: false }),
    ]) {
      const refusal = refusalOf(() =>
        indexDropsBeforeColumns(SPEC, ["title"], [held])
      );
      expect(refusal?.code).toBe("NEXTLY_UPGRADE_COLUMN_HELD");
      expect(refusal?.publicMessage).toContain(`"${held.name}"`);
    }
  });

  it("refuses an expression or partial index whose definition reads the column, and one with none", () => {
    for (const held of [
      index("lower_title", [], {
        wholeColumns: false,
        definition: 'CREATE INDEX "lower_title" ON "dc_notes" (lower("title"))',
      }),
      index("titled", ["id"], {
        wholeColumns: false,
        definition:
          'CREATE INDEX "titled" ON "dc_notes" ("id") WHERE "title" IS NOT NULL',
      }),
      // A definition that could not be read vouches for nothing.
      index("unread", [], { wholeColumns: false }),
    ]) {
      expect(
        refusalOf(() => indexDropsBeforeColumns(SPEC, ["title"], [held]))?.code
      ).toBe("NEXTLY_UPGRADE_COLUMN_HELD");
    }
  });

  it("leaves an index that reads no moving column, one named after it included", () => {
    const indexes = [
      index("by_id", ["id"]),
      index("title", [], {
        wholeColumns: false,
        definition: 'CREATE INDEX "title" ON "dc_notes" (lower("id"))',
      }),
    ];
    expect(indexDropsBeforeColumns(SPEC, ["title"], indexes)).toEqual([]);
  });

  it("drops nothing where no column moves or no index was read", () => {
    expect(
      indexDropsBeforeColumns(SPEC, [], [index("by_title", ["title"])])
    ).toEqual([]);
    expect(indexDropsBeforeColumns(SPEC, ["title"], undefined)).toEqual([]);
  });
});
