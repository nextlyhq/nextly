/**
 * The DSL's runtime contract: what a definition IS, and what it refuses.
 *
 * The type test beside this one covers what a definition means to the checker.
 * This covers the data, because every consumer downstream — the diff engine,
 * the migration snapshot, the runtime registry — reads the data and never the
 * types.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { col, defineTable } from "../dsl";

/** The error a caller can act on: a validation failure carrying a path. */
function validationPaths(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { path: string }[] }
        | undefined;
      return (data?.errors ?? []).map(issue => issue.path);
    }
    throw error;
  }
  throw new Error("expected the call to throw, and it returned");
}

describe("defineTable", () => {
  const identities = defineTable(
    "identities",
    {
      id: col.id(),
      providerAccountId: col.shortText(),
      emailAtLink: col.text({ nullable: true }),
      ...col.timestamps(),
    },
    { indexes: [{ columns: ["providerAccountId"], unique: true }] }
  );

  it("survives a JSON round trip unchanged", () => {
    // Every consumer downstream reads this as data — a migration snapshot
    // writes it to disk. Anything not JSON-representable would be lost there
    // rather than here, where it is visible.
    expect(JSON.parse(JSON.stringify(identities))).toEqual(identities);
  });

  it("freezes the definition and its column list", () => {
    expect(Object.isFrozen(identities)).toBe(true);
    expect(Object.isFrozen(identities.columns)).toBe(true);
  });

  it("snake-cases the authored key into the SQL column name", () => {
    const column = identities.columns.find(c => c.key === "providerAccountId");
    expect(column?.name).toBe("provider_account_id");
  });

  it("resolves index columns to their SQL names", () => {
    expect(identities.indexes).toEqual([
      { columns: ["provider_account_id"], unique: true },
    ]);
  });

  it("gives col.id() a bounded, generated primary key", () => {
    // Bounded rather than text: MySQL cannot index an unbounded text column,
    // so a `text` id could not carry the primary key at all.
    expect(identities.columns.find(c => c.key === "id")).toMatchObject({
      kind: "varchar",
      length: 36,
      primaryKey: true,
      generated: "uuidv7",
      nullable: false,
    });
  });

  it("gives col.timestamps() two non-null columns, one refreshed on update", () => {
    expect(identities.columns.find(c => c.key === "createdAt")).toMatchObject({
      name: "created_at",
      kind: "timestamp",
      nullable: false,
      // Tagged, not the bare string: a text column may legitimately default to
      // the word "now", and the compiler has to tell the two apart.
      default: { token: "now" },
    });
    const updated = identities.columns.find(c => c.key === "updatedAt");
    expect(updated).toMatchObject({
      name: "updated_at",
      kind: "timestamp",
      nullable: false,
      default: { token: "now" },
      onUpdate: "now",
    });
  });

  it("refuses a varchar with no usable width", () => {
    expect(validationPaths(() => col.varchar(0))).toEqual(["varchar.length"]);
  });

  it("refuses a varchar wider than MySQL can declare, at the widest it can", () => {
    // utf8mb4 spends up to 4 bytes a character, so 65,535 characters is a
    // 262,140-byte column; MySQL's ceiling is 16,383.
    expect(validationPaths(() => col.varchar(16_384))).toEqual([
      "varchar.length",
    ]);
    expect(validationPaths(() => col.varchar(65_535))).toEqual([
      "varchar.length",
    ]);
    expect(col.varchar(16_383).length).toBe(16_383);
  });

  it("refuses a decimal whose scale exceeds its precision", () => {
    // DECIMAL(3,5) asks for five fractional digits out of three total, which
    // describes no representable number.
    expect(validationPaths(() => col.decimal(3, 5))).toEqual(["decimal.scale"]);
  });

  it("refuses a decimal scale MySQL cannot declare, at the widest one it can", () => {
    // MySQL caps DECIMAL scale at 30 while PostgreSQL accepts more, so 31
    // would create on one dialect and fail on the other.
    expect(validationPaths(() => col.decimal(31, 31))).toEqual([
      "decimal.scale",
    ]);
    expect(() => col.decimal(31, 30)).not.toThrow();
  });

  it("refuses two keys that collide once snake-cased", () => {
    // `fooBar` and `foo_bar` are one SQL column, so the table would declare it
    // twice and fail at CREATE rather than here.
    expect(
      validationPaths(() =>
        defineTable("t", {
          id: col.id(),
          fooBar: col.text(),
          foo_bar: col.text(),
        })
      )
    ).toEqual(["t.foo_bar"]);
  });

  it("refuses an index naming a column the table does not declare", () => {
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id() }, { indexes: [{ columns: ["nope"] }] })
      )
    ).toEqual(["t.indexes[0]"]);
  });

  it("refuses an index over no columns", () => {
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id() }, { indexes: [{ columns: [] }] })
      )
    ).toEqual(["t.indexes[0]"]);
  });

  it("refuses a foreign key over no columns, and accepts one over a column", () => {
    // Two empty lists agree in length, so only a count of at least one keeps
    // `FOREIGN KEY () REFERENCES users ()` from reaching the database.
    const declare = (columns: string[], referenced: string[]) =>
      defineTable(
        "t",
        { id: col.id(), ownerId: col.shortText() },
        {
          foreignKeys: [
            { columns, references: { table: "users", columns: referenced } },
          ],
        }
      );
    expect(validationPaths(() => declare([], []))).toEqual([
      "t.foreignKeys[0]",
    ]);
    expect(() => declare(["ownerId"], ["id"])).not.toThrow();
  });

  it("refuses an explicit foreign key name past 63 characters, and accepts 63", () => {
    const declare = (name: string) =>
      defineTable(
        "t",
        { id: col.id(), ownerId: col.shortText() },
        {
          foreignKeys: [
            {
              columns: ["ownerId"],
              references: { table: "users", columns: ["id"] },
              name,
            },
          ],
        }
      );
    expect(() => declare(`fk_${"n".repeat(60)}`)).not.toThrow();
    expect(validationPaths(() => declare(`fk_${"n".repeat(61)}`))).toEqual([
      "t.foreignKeys[0]",
    ]);
  });

  it("refuses a referenced table or column the DDL cannot render, and accepts a plain one", () => {
    // `REFERENCES "" ("id")` would compile and fail only when it ran; a quote
    // in a name would fail when the DDL was rendered, mid-`migrate:create`.
    const declare = (table: string, column: string) =>
      defineTable(
        "t",
        { id: col.id(), ownerId: col.shortText() },
        {
          foreignKeys: [
            { columns: ["ownerId"], references: { table, columns: [column] } },
          ],
        }
      );
    expect(() => declare("users", "id")).not.toThrow();
    for (const [table, column] of [
      ["", "id"],
      ["users", ""],
      ['us"ers', "id"],
      ["users", "i`d"],
      ["users\u0000x", "id"],
    ]) {
      expect(validationPaths(() => declare(table, column))).toEqual([
        "t.foreignKeys[0]",
      ]);
    }
  });

  it("refuses an explicit name or a column name holding a quote character", () => {
    expect(
      validationPaths(() =>
        defineTable(
          "t",
          { id: col.id(), ownerId: col.shortText() },
          {
            foreignKeys: [
              {
                columns: ["ownerId"],
                references: { table: "users", columns: ["id"] },
                name: 'fk_a"b',
              },
            ],
          }
        )
      )
    ).toEqual(["t.foreignKeys[0]"]);
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id(), "la`bel": col.shortText() })
      )
    ).toEqual(["t.la`bel"]);
    expect(
      validationPaths(() =>
        defineTable(
          "t",
          { id: col.id(), price: col.integer() },
          { checks: [{ name: 'po"s', sql: "price >= 0" }] }
        )
      )
    ).toEqual(["t.checks[0]"]);
  });

  it("refuses a decimal default finer than the column's scale, naming the column", () => {
    // MySQL 8.0.46 stores `DECIMAL(10,2) DEFAULT 1.555` as 1.56, so the live
    // default would never match the declaration.
    expect(
      validationPaths(() =>
        defineTable("t", {
          id: col.id(),
          price: col.decimal(10, 2, { default: 1.555 }),
        })
      )
    ).toEqual(["t.price"]);
    // Exponent form, which is how JavaScript writes a small number.
    expect(
      validationPaths(() =>
        defineTable("t", {
          id: col.id(),
          rate: col.decimal(10, 6, { default: 1e-7 }),
        })
      )
    ).toEqual(["t.rate"]);
    // The boundary is the scale itself, not a smaller cap.
    expect(() =>
      defineTable("t", {
        id: col.id(),
        price: col.decimal(10, 2, { default: 1.55 }),
      })
    ).not.toThrow();
    expect(() =>
      defineTable("t", {
        id: col.id(),
        rate: col.decimal(10, 7, { default: 1e-7 }),
      })
    ).not.toThrow();
  });

  it("refuses a table with no columns", () => {
    expect(validationPaths(() => defineTable("t", {}))).toEqual(["t"]);
  });

  describe("relation names", () => {
    const edge = (name: string, targetTable: string) => ({
      name,
      kind: "one" as const,
      targetTable,
      fromColumn: "ownerId",
    });

    it("refuses two declared relations of one name, and accepts two names", () => {
      // The registry keys edges by name, so the second would replace the
      // first and a query would follow only the last declaration.
      const declare = (second: string) =>
        defineTable(
          "t",
          { id: col.id(), ownerId: col.shortText() },
          { relations: [edge("owner", "users"), edge(second, "admins")] }
        );
      expect(validationPaths(() => declare("owner"))).toEqual([
        "t.relations[1]",
      ]);
      expect(declare("admin").relations.map(rel => rel.name)).toEqual([
        "owner",
        "admin",
      ]);
    });

    it("refuses two ref() columns implying one name, until one is declared", () => {
      // `fooRefId` shortens to `fooRef`; `foo` has no Id suffix and takes
      // `fooRef` as well.
      const columns = {
        id: col.id(),
        fooRefId: col.ref("users"),
        foo: col.ref("admins"),
      };
      expect(validationPaths(() => defineTable("t", columns))).toEqual([
        "t.relations",
      ]);
      // A declared relation of that name replaces both implied edges.
      const declared = defineTable("t", columns, {
        relations: [
          {
            name: "fooRef",
            kind: "one",
            targetTable: "users",
            fromColumn: "fooRefId",
          },
        ],
      });
      expect(declared.relations.map(rel => rel.name)).toEqual(["fooRef"]);
    });
  });
});
