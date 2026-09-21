/**
 * Foreign keys, checks and the two index shapes the base model cannot carry.
 *
 * Every rule here refuses rather than degrades, and the partial index is why:
 * created without its predicate it covers more rows than intended, and if it
 * is unique it enforces a constraint nobody asked for — on data that was legal
 * until the deploy.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  assertIndexShapeSupported,
  foreignKeyName,
  resolveCheck,
  resolveForeignKey,
} from "../constraints";

const COLUMNS = new Set(["id", "user_id", "org_id"]);

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      return data?.errors?.[0]?.message ?? "";
    }
    throw error;
  }
  throw new Error("expected a refusal, and the call returned");
}

describe("foreign keys", () => {
  it("resolves a simple key with conservative defaults", () => {
    const fk = resolveForeignKey(
      "links",
      { columns: ["user_id"], references: { table: "users", columns: ["id"] } },
      COLUMNS
    );
    // `no action` rather than `cascade`: a default that deletes rows is not a
    // default, and a cascade nobody asked for removes data on an unrelated
    // write.
    expect(fk).toMatchObject({
      columns: ["user_id"],
      referencesTable: "users",
      onDelete: "no action",
      onUpdate: "no action",
    });
  });

  it("honours explicit referential actions", () => {
    const fk = resolveForeignKey(
      "links",
      {
        columns: ["user_id"],
        references: { table: "users", columns: ["id"] },
        onDelete: "cascade",
      },
      COLUMNS
    );
    expect(fk.onDelete).toBe("cascade");
  });

  it("refuses a column count mismatch", () => {
    // Produces SQL the server rejects at CREATE — a failed deploy rather than
    // a message naming the mistake.
    expect(
      refusal(() =>
        resolveForeignKey(
          "links",
          {
            columns: ["user_id", "org_id"],
            references: { table: "users", columns: ["id"] },
          },
          COLUMNS
        )
      )
    ).toMatch(/as many columns/);
  });

  it("refuses a column the table does not declare", () => {
    expect(
      refusal(() =>
        resolveForeignKey(
          "links",
          {
            columns: ["ghost"],
            references: { table: "users", columns: ["id"] },
          },
          COLUMNS
        )
      )
    ).toMatch(/does not declare/);
  });

  it("refuses an unknown referential action", () => {
    expect(
      refusal(() =>
        resolveForeignKey(
          "links",
          {
            columns: ["user_id"],
            references: { table: "users", columns: ["id"] },
            onDelete: "explode" as never,
          },
          COLUMNS
        )
      )
    ).toMatch(/Unknown onDelete/);
  });

  it("derives a bounded name, so MySQL does not refuse it", () => {
    // Composing `fk_<table>_<cols>` directly exceeds 63 near the limit, which
    // MySQL refuses and PostgreSQL truncates — leaving a constraint whose name
    // disagrees with the declared one.
    const name = foreignKeyName("a_very_long_table_name_for_this_purpose", [
      "a_long_column_name",
      "another_long_column_name",
    ]);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name.startsWith("fk_")).toBe(true);
  });
});

describe("check constraints", () => {
  it("resolves an expression with a derived name", () => {
    expect(resolveCheck("t", { sql: "price > 0" }, 0)).toEqual({
      name: "ck_t_0",
      sql: "price > 0",
    });
  });

  it("refuses an empty expression", () => {
    expect(refusal(() => resolveCheck("t", { sql: "   " }, 0))).toMatch(
      /must carry an expression/
    );
  });
});

describe("index shapes per dialect", () => {
  const partial = {
    name: "idx_t_done",
    columns: ["done"],
    where: "done = true",
  };

  it("allows a partial index on PostgreSQL and SQLite", () => {
    expect(() =>
      assertIndexShapeSupported(partial, "postgresql", "t")
    ).not.toThrow();
    expect(() =>
      assertIndexShapeSupported(partial, "sqlite", "t")
    ).not.toThrow();
  });

  it("refuses a partial index on MySQL rather than dropping the predicate", () => {
    // Dropped, a unique partial index enforces uniqueness over rows that were
    // legal until the deploy, and the failure arrives as a write rejection on
    // data nobody changed.
    expect(
      refusal(() => assertIndexShapeSupported(partial, "mysql", "t"))
    ).toMatch(/no partial indexes/);
  });

  it("refuses an index declaring both columns and an expression", () => {
    // The converter reports an expression index with an EMPTY column list, so
    // the two states are indistinguishable downstream.
    expect(
      refusal(() =>
        assertIndexShapeSupported(
          { name: "idx_t_x", columns: ["a"], expression: "lower(a)" },
          "postgresql",
          "t"
        )
      )
    ).toMatch(/both columns and an expression/);
  });

  it("refuses an index covering nothing", () => {
    expect(
      refusal(() =>
        assertIndexShapeSupported(
          { name: "idx_t_x", columns: [] },
          "postgresql",
          "t"
        )
      )
    ).toMatch(/covers no columns/);
  });

  it("allows an expression index with no columns", () => {
    // The control: the rule above must not refuse the legitimate shape it
    // exists to distinguish.
    expect(() =>
      assertIndexShapeSupported(
        { name: "idx_t_lower", columns: [], expression: "lower(a)" },
        "postgresql",
        "t"
      )
    ).not.toThrow();
  });
});
