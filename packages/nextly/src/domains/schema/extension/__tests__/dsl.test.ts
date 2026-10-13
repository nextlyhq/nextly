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
import { col, defineTable, type ColumnBuilder } from "../dsl";

/** The issues of the validation failure `run` throws. */
function validationIssues(
  run: () => unknown
): { path: string; message: string }[] {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { path: string; message: string }[] }
        | undefined;
      return data?.errors ?? [];
    }
    throw error;
  }
  throw new Error("expected the call to throw, and it returned");
}

/** The error a caller can act on: a validation failure carrying a path. */
function validationPaths(run: () => unknown): string[] {
  return validationIssues(run).map(issue => issue.path);
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

  it("refuses a column name of 63 characters that is more than 63 bytes, and accepts one of 63 bytes", () => {
    // PostgreSQL's limit is in bytes, and an accented letter is two of them
    // in UTF-8: this name is 63 characters and 64 bytes, so PostgreSQL would
    // keep a shortened name nothing declared.
    const overByOne = `é${"c".repeat(62)}`;
    expect(overByOne).toHaveLength(63);
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id(), [overByOne]: col.text() })
      )
    ).toEqual([`t.${overByOne}`]);
    expect(() =>
      defineTable("t", { id: col.id(), [`é${"c".repeat(61)}`]: col.text() })
    ).not.toThrow();
  });

  it("refuses a resolved column name past 63 characters, and accepts 63", () => {
    // PostgreSQL truncates past 63 and MySQL refuses past 64, so only 63 is
    // stored as written everywhere.
    expect(() =>
      defineTable("t", { id: col.id(), ["c".repeat(63)]: col.text() })
    ).not.toThrow();
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id(), ["c".repeat(64)]: col.text() })
      )
    ).toEqual([`t.${"c".repeat(64)}`]);
    // The SQL name is what is bounded: a 44-character camelCase key
    // snake-cases to 66.
    const key = "aB".repeat(22);
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id(), [key]: col.text() })
      )
    ).toEqual([`t.${key}`]);
  });

  it("refuses a foreign key action MySQL cannot create, or one no dialect names, on either side", () => {
    const declare = (actions: { onDelete?: string; onUpdate?: string }) =>
      defineTable(
        "t",
        { id: col.id(), ownerId: col.shortText({ nullable: true }) },
        {
          foreignKeys: [
            {
              columns: ["ownerId"],
              references: { table: "users", columns: ["id"] },
              // A plugin in JavaScript passes whatever string it holds.
              ...(actions as object),
            },
          ],
        }
      );
    for (const action of ["set default", "SET NULL", "delete"]) {
      expect(validationPaths(() => declare({ onDelete: action }))).toEqual([
        "t.foreignKeys[0]",
      ]);
      expect(validationPaths(() => declare({ onUpdate: action }))).toEqual([
        "t.foreignKeys[0]",
      ]);
    }
    for (const action of ["cascade", "set null", "restrict", "no action"]) {
      const [fk] = declare({ onDelete: action, onUpdate: action }).foreignKeys;
      expect([fk?.onDelete, fk?.onUpdate]).toEqual([action, action]);
    }
    const [omitted] = declare({}).foreignKeys;
    expect([omitted?.onDelete, omitted?.onUpdate]).toEqual([
      "no action",
      "no action",
    ]);
  });

  it("refuses set null on either side when a key column is not nullable, and accepts it when every one is", () => {
    // MySQL refuses the key when the table is created (ERROR 1830);
    // PostgreSQL and SQLite accept it and fail when the action fires.
    const declare = (
      actions: { onDelete?: "set null"; onUpdate?: "set null" },
      orgNullable: boolean
    ) =>
      defineTable(
        "t",
        {
          id: col.id(),
          ownerId: col.shortText({ nullable: true }),
          orgId: col.shortText({ nullable: orgNullable }),
        },
        {
          foreignKeys: [
            {
              columns: ["ownerId", "orgId"],
              references: { table: "memberships", columns: ["user", "org"] },
              ...actions,
            },
          ],
        }
      );
    for (const actions of [
      { onDelete: "set null" as const },
      { onUpdate: "set null" as const },
    ]) {
      expect(validationPaths(() => declare(actions, false))).toEqual([
        "t.foreignKeys[0]",
      ]);
      const [fk] = declare(actions, true).foreignKeys;
      expect(fk?.columns).toEqual(["owner_id", "org_id"]);
    }
    expect(
      validationIssues(() => declare({ onDelete: "set null" }, false))[0]
        ?.message
    ).toMatch(/onDelete is "set null", and its column "orgId" is not nullable/);
  });

  it("refuses check SQL that quotes an identifier, outside a string literal", () => {
    const declare = (sql: string) =>
      defineTable(
        "t",
        { id: col.id(), qty: col.integer(), label: col.shortText() },
        { checks: [{ name: "ok", sql }] }
      );
    // MySQL reads "qty" as a string; PostgreSQL refuses a backtick.
    for (const sql of [
      '"qty" > 0',
      "`qty` > 0",
      "qty > 0 AND label <> 'it''s' AND \"label\" <> ''",
      "label <> 'open \"",
    ]) {
      expect(validationPaths(() => declare(sql))).toEqual(["t.checks[0]"]);
    }
    // Quotes inside a literal are text, `''` included.
    for (const sql of [
      "qty > 0",
      "label <> 'say \"hi\"'",
      "label <> 'it''s \"q\" and `b`'",
    ]) {
      expect(declare(sql).checks).toEqual([{ name: "ok", sql }]);
    }
  });

  it("refuses an index expression or predicate that quotes an identifier, and accepts a bare one", () => {
    const declare = (index: { expression?: string; where?: string }) =>
      defineTable(
        "t",
        { id: col.id(), email: col.shortText() },
        {
          indexes: [
            {
              columns: index.expression === undefined ? ["email"] : [],
              ...index,
            },
          ],
        }
      );
    for (const index of [
      { expression: 'lower("email")' },
      { expression: "lower(`email`)" },
      { where: '"email" IS NOT NULL' },
    ]) {
      expect(validationPaths(() => declare(index))).toEqual(["t.indexes[0]"]);
    }
    expect(declare({ expression: "lower(email)" }).indexes[0]?.expression).toBe(
      "lower(email)"
    );
    expect(declare({ where: "email <> 'a\"b'" }).indexes[0]?.where).toBe(
      "email <> 'a\"b'"
    );
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

  it("refuses a decimal default wider than the column's precision leaves room for", () => {
    // DECIMAL(3,1) holds two digits before the point: PostgreSQL and MySQL
    // refuse 123.4 as its default, and SQLite, ignoring both, accepts it.
    const declare = (value: number) =>
      defineTable("t", {
        id: col.id(),
        price: col.decimal(3, 1, { default: value }),
      });
    expect(validationPaths(() => declare(123.4))).toEqual(["t.price"]);
    expect(validationPaths(() => declare(-123))).toEqual(["t.price"]);
    // The boundary is precision minus scale, signs aside.
    expect(() => declare(99.9)).not.toThrow();
    expect(() => declare(-99.9)).not.toThrow();
    expect(() => declare(0.5)).not.toThrow();
  });

  it("refuses a numeric default that is not a finite number", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        validationPaths(() =>
          defineTable("t", {
            id: col.id(),
            price: col.decimal(10, 2, { default: value }),
            count: col.integer(),
          })
        )
      ).toEqual(["t.price"]);
      expect(
        validationPaths(() =>
          defineTable("t", {
            id: col.id(),
            count: col.integer({ default: value }),
          })
        )
      ).toEqual(["t.count"]);
    }
  });

  it("refuses a generated or on-update value the compiler would not apply", () => {
    // A builder is plain data, so a hand-written one can carry anything; an
    // unknown value compiled to a column nothing ever filled.
    const hand = (extra: Record<string, unknown>) =>
      ({ ...col.shortText(), ...extra }) as ReturnType<typeof col.shortText>;
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id(), ref: hand({ generated: "uuidv4" }) })
      )
    ).toEqual(["t.ref"]);
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id(), ref: hand({ onUpdate: "later" }) })
      )
    ).toEqual(["t.ref"]);
    // Known values on a column that cannot hold them.
    expect(
      validationPaths(() =>
        defineTable("t", {
          id: { ...col.varchar(20), generated: "uuidv7" },
        })
      )
    ).toEqual(["t.id"]);
    expect(
      validationPaths(() =>
        defineTable("t", { id: col.id(), at: hand({ onUpdate: "now" }) })
      )
    ).toEqual(["t.at"]);
    // And the shapes the DSL itself produces.
    expect(() =>
      defineTable("t", {
        id: col.id(),
        ref: hand({ generated: "uuidv7" }),
        ...col.timestamps(),
      })
    ).not.toThrow();
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

  describe("a default the column cannot hold on every dialect", () => {
    /** A table `t` declaring the one column `c`, as a thunk to judge. */
    const declare = (column: ColumnBuilder) => () =>
      defineTable("t", { id: col.id(), c: column });

    it("refuses a uuid default that is not a canonical UUID, and accepts one", () => {
      // PostgreSQL's native uuid refuses the first two outright; MySQL's
      // char(36) and SQLite's text store them. The upper-case form PostgreSQL
      // accepts and writes back lower-cased, so the diff never sees it equal.
      for (const value of [
        "not-a-uuid",
        "0190c4c2-7f3a-7b9e-8d1a-3c5e7f9a1b2",
        "0190C4C2-7F3A-7B9E-8D1A-3C5E7F9A1B2C",
      ]) {
        expect(validationPaths(declare(col.uuid({ default: value })))).toEqual([
          "t.c",
        ]);
      }
      expect(
        declare(col.uuid({ default: "0190c4c2-7f3a-7b9e-8d1a-3c5e7f9a1b2c" }))
      ).not.toThrow();
    });

    it("refuses a text default wider than its column declares on MySQL, at the boundary", () => {
      // Each is refused by MySQL and stored by SQLite; a char(n) and a
      // shortText are refused by PostgreSQL too. `text` is varchar(255) on
      // MySQL.
      const cases: [(value: string) => ColumnBuilder, number][] = [
        [value => col.text({ default: value }), 255],
        [value => col.shortText({ default: value }), 255],
        [value => col.varchar(8, { default: value }), 8],
        [value => col.char(2, { default: value }), 2],
      ];
      for (const [make, width] of cases) {
        expect(declare(make("x".repeat(width)))).not.toThrow();
        expect(validationPaths(declare(make("x".repeat(width + 1))))).toEqual([
          "t.c",
        ]);
      }
      // Counted in characters, as the column counts them, not UTF-16 units.
      expect(declare(col.varchar(2, { default: "😀😀" }))).not.toThrow();
      // Unbounded on every dialect.
      expect(
        declare(col.longText({ default: "x".repeat(70_000) }))
      ).not.toThrow();
    });

    it("refuses a NUL character in a string default", () => {
      expect(
        validationPaths(declare(col.longText({ default: "a\u0000b" })))
      ).toEqual(["t.c"]);
    });

    it("refuses an integer default that is fractional or out of the column's range, at the boundary", () => {
      const cases: [(value: number) => ColumnBuilder, number, number][] = [
        [value => col.smallint({ default: value }), -32_768, 32_767],
        [
          value => col.integer({ default: value }),
          -2_147_483_648,
          2_147_483_647,
        ],
        [
          value => col.bigint({ default: value }),
          Number.MIN_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
        ],
      ];
      for (const [make, min, max] of cases) {
        expect(declare(make(min))).not.toThrow();
        expect(declare(make(max))).not.toThrow();
        expect(validationPaths(declare(make(min - 1)))).toEqual(["t.c"]);
        expect(validationPaths(declare(make(max + 1)))).toEqual(["t.c"]);
        expect(validationPaths(declare(make(1.5)))).toEqual(["t.c"]);
      }
    });

    it("refuses a real default outside a 4-byte float's range", () => {
      expect(declare(col.real({ default: 3.4e38 }))).not.toThrow();
      // Past the largest value, and so small it underflows to zero.
      for (const value of [1e39, -1e39, 1e-50]) {
        expect(validationPaths(declare(col.real({ default: value })))).toEqual([
          "t.c",
        ]);
      }
      expect(declare(col.real({ default: 0 }))).not.toThrow();
      // A double holds it.
      expect(declare(col.double({ default: 1e39 }))).not.toThrow();
    });

    it("refuses a default whose type is not the column's, which each dialect reads differently", () => {
      // A plugin in JavaScript passes whatever it holds; the types below are
      // what the typed builders already refuse.
      const mismatched: ColumnBuilder[] = [
        col.integer({ default: "1" as never }),
        col.text({ default: 1 as never }),
        col.shortText({ default: true as never }),
        col.boolean({ default: "true" as never }),
        col.timestamp({ default: "2024-01-01" as never }),
        col.bytes({ default: "00" as never }),
        col.text({ default: { token: "now" } as never }),
      ];
      for (const column of mismatched) {
        expect(validationPaths(declare(column))).toEqual(["t.c"]);
      }
      // The current-timestamp token is a timestamp's default.
      expect(declare(col.timestamps().createdAt)).not.toThrow();
    });
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
