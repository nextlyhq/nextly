/**
 * The values a key added over an existing column is judged against: the target's rows where the
 * target exists (a core table such as `users` included, which the managed snapshot does not
 * carry), and none at all where this apply creates it.
 */
import { describe, expect, it } from "vitest";

import type { ForeignKeySpec, Operation } from "../diff/types";
import { refuseKeysRowsWouldBreak } from "../key-move-refusal";
import type { DesiredSchema } from "../types";

const key: ForeignKeySpec = {
  name: "fk_dc_notes_owner",
  columns: ["owner"],
  referencesTable: "users",
  referencesColumns: ["id"],
  onDelete: "set null",
  onUpdate: "no action",
};
const desired: DesiredSchema = {
  collections: {
    notes: {
      slug: "notes",
      tableName: "dc_notes",
      fields: [{ name: "owner", type: "relationship" }] as never,
    },
  },
  singles: {},
  components: {},
};
// The managed snapshot: the notes, never `users`.
const live = {
  tables: [
    {
      name: "dc_notes",
      columns: [{ name: "owner", type: "text", nullable: true }],
    },
  ],
};

/** A SQLite connection that answers every count with `n`, recording what each query names. */
function counting(n: number) {
  const asked: string[] = [];
  return {
    asked,
    db: {
      all: (query: unknown) => {
        asked.push(JSON.stringify(query));
        return [{ n }];
      },
    },
  };
}

describe("refuseKeysRowsWouldBreak", () => {
  it("checks the values against a target outside the managed snapshot, such as users", async () => {
    const { db, asked } = counting(0);
    await expect(
      refuseKeysRowsWouldBreak({
        db,
        dialect: "sqlite",
        desired,
        live,
        operations: [
          { type: "add_foreign_key", tableName: "dc_notes", foreignKey: key },
        ],
      })
    ).resolves.toBeUndefined();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('"users"');
  });

  it("counts every value against a target this apply creates, which has no rows yet", async () => {
    const { db, asked } = counting(2);
    const operations: Operation[] = [
      {
        type: "add_table",
        table: { name: "users", columns: [] },
      } as Operation,
      { type: "add_foreign_key", tableName: "dc_notes", foreignKey: key },
    ];
    await expect(
      refuseKeysRowsWouldBreak({
        db,
        dialect: "sqlite",
        desired,
        live,
        operations,
      })
    ).rejects.toThrow();
    expect(asked[0]).not.toContain('"users"');
  });

  it("reads a target column this apply renames under the name it has now", async () => {
    const { db, asked } = counting(0);
    const operations: Operation[] = [
      {
        type: "rename_column",
        tableName: "dc_codes",
        fromColumn: "code",
        toColumn: "external_code",
        fromType: "text",
        toType: "text",
      },
      {
        type: "add_foreign_key",
        tableName: "dc_notes",
        foreignKey: {
          ...key,
          referencesTable: "dc_codes",
          referencesColumns: ["external_code"],
        },
      },
    ];
    await refuseKeysRowsWouldBreak({
      db,
      dialect: "sqlite",
      desired,
      live,
      operations,
    });
    expect(asked[0]).toContain('"code"');
    expect(asked[0]).not.toContain('"external_code"');
  });

  it("counts every value against a target column this apply adds, which holds none yet", async () => {
    const { db, asked } = counting(1);
    const operations: Operation[] = [
      {
        type: "add_column",
        tableName: "dc_codes",
        column: { name: "external_code", type: "text", nullable: true },
      },
      {
        type: "add_foreign_key",
        tableName: "dc_notes",
        foreignKey: {
          ...key,
          referencesTable: "dc_codes",
          referencesColumns: ["external_code"],
        },
      },
    ];
    await expect(
      refuseKeysRowsWouldBreak({
        db,
        dialect: "sqlite",
        desired,
        live,
        operations,
      })
    ).rejects.toThrow();
    expect(asked[0]).not.toContain('"external_code"');
  });

  it("leaves a key whose column this apply retypes to the database, asking nothing", async () => {
    const { db, asked } = counting(5);
    const operations: Operation[] = [
      {
        type: "change_column_type",
        tableName: "dc_notes",
        columnName: "owner",
        fromType: "integer",
        toType: "text",
      } as Operation,
      { type: "add_foreign_key", tableName: "dc_notes", foreignKey: key },
    ];
    await expect(
      refuseKeysRowsWouldBreak({
        db,
        dialect: "sqlite",
        desired,
        live,
        operations,
      })
    ).resolves.toBeUndefined();
    expect(asked).toEqual([]);
  });
});
