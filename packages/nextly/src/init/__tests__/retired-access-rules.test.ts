/**
 * Finding, counting and naming the stored access rules a database still holds.
 *
 * The column that held them is retired, and rows carrying a rule look exactly
 * as they did while the rule was enforced. These pin which tables are
 * examined, that only rows actually holding a rule are counted, and that the
 * warning names the table, the count and the command that removes the column.
 */
import { describe, expect, it, vi } from "vitest";

import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import {
  countRetiredAccessRules,
  findRetiredAccessRulesColumns,
  formatRetiredAccessRulesWarning,
} from "../retired-access-rules";

function snapshot(tables: Record<string, string[]>): NextlySchemaSnapshot {
  return {
    tables: Object.entries(tables).map(([name, columns]) => ({
      name,
      columns: columns.map(c => ({ name: c, type: "text", nullable: true })),
    })),
  };
}

describe("findRetiredAccessRulesColumns", () => {
  it("names each registry table that still carries the column", () => {
    expect(
      findRetiredAccessRulesColumns(
        snapshot({
          dynamic_collections: ["id", "slug", "access_rules"],
          dynamic_singles: ["id", "slug", "access_rules"],
        })
      )
    ).toEqual(["dynamic_collections", "dynamic_singles"]);
  });

  it("reports nothing for a database that never had it or already dropped it", () => {
    // A NEW database, and an old one after the drop, look the same here.
    expect(
      findRetiredAccessRulesColumns(
        snapshot({
          dynamic_collections: ["id", "slug"],
          dynamic_singles: ["id", "slug"],
        })
      )
    ).toEqual([]);
  });

  it("reports only the table that still has it when the other was dropped", () => {
    expect(
      findRetiredAccessRulesColumns(
        snapshot({
          dynamic_collections: ["id", "slug"],
          dynamic_singles: ["id", "access_rules"],
        })
      )
    ).toEqual(["dynamic_singles"]);
  });

  it("ignores a same-named column on a table that is not a registry", () => {
    // A user collection is free to declare a field with this name; it was
    // never a stored rule and the warning must not claim it.
    expect(
      findRetiredAccessRulesColumns(snapshot({ posts: ["id", "access_rules"] }))
    ).toEqual([]);
  });
});

describe("countRetiredAccessRules", () => {
  it("counts only rows holding a rule, and drops tables with none", async () => {
    const countRows = vi.fn(async (_db: unknown, _d: unknown, table: string) =>
      table === "dynamic_collections" ? 5 : 2
    );
    const countNulls = vi.fn(
      async (_db: unknown, _d: unknown, table: string, column: string) => {
        expect(column).toBe("access_rules");
        return table === "dynamic_collections" ? 3 : 2;
      }
    );

    const found = await countRetiredAccessRules(
      {},
      "sqlite",
      ["dynamic_collections", "dynamic_singles"],
      { countRows, countNulls }
    );

    // 5 rows, 3 with no rule → 2 carry one. Singles: 2 rows, both NULL → none.
    expect(found).toEqual([{ table: "dynamic_collections", rows: 2 }]);
  });

  it("asks nothing when handed no tables", async () => {
    const countRows = vi.fn(async () => 1);
    const countNulls = vi.fn(async () => 0);

    expect(
      await countRetiredAccessRules({}, "sqlite", [], { countRows, countNulls })
    ).toEqual([]);
    expect(countRows).not.toHaveBeenCalled();
    expect(countNulls).not.toHaveBeenCalled();
  });
});

describe("formatRetiredAccessRulesWarning", () => {
  it("names each table, its count, and the command that removes the column", () => {
    const message = formatRetiredAccessRulesWarning([
      { table: "dynamic_collections", rows: 2 },
      { table: "dynamic_singles", rows: 1 },
    ]);

    expect(message).toContain("no longer enforces them");
    // The whole decision order, not only the code-defined half: an operator
    // reading that only code rules decide would take their role grants for
    // ignored, or add a code rule that overrides them.
    expect(message).toContain("falls through to the roles and permissions");
    expect(message).toContain("Existing role grants still apply");
    expect(message).toContain("dynamic_collections: 2 rows carry");
    expect(message).toContain("dynamic_singles: 1 row carries");
    expect(message).toContain("nextly migrate");
    expect(message).toContain("NEXTLY_ALLOW_CORE_DESTRUCTIVE=1");
  });
});
