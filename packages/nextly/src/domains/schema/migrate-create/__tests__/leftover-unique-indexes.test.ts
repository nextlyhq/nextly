/**
 * Which older unique indexes a migration file drops for a field that stops being unique
 * (`leftoverUniqueDrops`): one holding the column under a name Nextly did not make, by name and
 * only where it stands, and under a column the same change renames; never Nextly's own, one no
 * statement drops by name, or one on a column the table still holds unique or drops. A table that
 * cannot be read, or a name no statement can quote, is said.
 */
import { describe, expect, it, vi } from "vitest";

import type { Operation, TableSpec } from "../../pipeline/diff/types";
import {
  leftoverUniqueDrops,
  leftoverUniqueNotice,
} from "../leftover-unique-indexes";

const OWN = "uq_dc_posts_code";
const LEFTOVER = "posts_code_key";

/** Nextly's own unique index on `code` dropped: the field stops being unique. */
const stopsUnique: Operation = {
  type: "drop_index",
  tableName: "dc_posts",
  index: { name: OWN, columns: ["code"], unique: true },
};

/** `dc_posts` as the file leaves it: `code` kept, with `extra` indexes. */
const posts = (extra: TableSpec["indexes"] = []): TableSpec =>
  ({
    name: "dc_posts",
    columns: [
      { name: "id", type: "text", nullable: false },
      { name: "code", type: "text", nullable: true },
    ],
    indexes: extra,
  }) as TableSpec;

const live = (names: (string | null)[]) => async () =>
  new Map([["code", names]]);

describe("the older unique indexes a file drops for a field that stops being unique", () => {
  it("drops one under a name Nextly did not make, by name and only where it stands, and names it", async () => {
    const warn = vi.fn();
    const sqlite = await leftoverUniqueDrops({
      operations: [stopsUnique],
      desired: [posts()],
      dialect: "sqlite",
      read: live([OWN, LEFTOVER]),
      warn,
    });
    expect(sqlite.statements).toEqual([`DROP INDEX IF EXISTS "${LEFTOVER}"`]);
    expect(sqlite.dropped).toEqual([
      { table: "dc_posts", column: "code", index: LEFTOVER },
    ]);
    expect(leftoverUniqueNotice(sqlite.dropped[0])).toContain(LEFTOVER);
    expect(warn).not.toHaveBeenCalled();

    const postgres = await leftoverUniqueDrops({
      operations: [stopsUnique],
      desired: [posts()],
      dialect: "postgresql",
      read: live([OWN, LEFTOVER]),
      warn,
    });
    expect(postgres.statements.join("\n")).toContain(
      `DROP CONSTRAINT IF EXISTS "${LEFTOVER}"`
    );
    expect(postgres.statements.join("\n")).toContain(
      `DROP INDEX IF EXISTS "${LEFTOVER}"`
    );

    const mysql = await leftoverUniqueDrops({
      operations: [stopsUnique],
      desired: [posts()],
      dialect: "mysql",
      read: live([OWN, LEFTOVER]),
      warn,
    });
    expect(mysql.statements[0]).toContain(`INDEX_NAME = '${LEFTOVER}'`);
  });

  it("drops neither Nextly's own index again, nor one no statement drops by name", async () => {
    const dropped = await leftoverUniqueDrops({
      operations: [stopsUnique],
      desired: [posts()],
      dialect: "sqlite",
      read: live([OWN.toUpperCase(), null]),
      warn: vi.fn(),
    });
    expect(dropped).toEqual({ statements: [], dropped: [] });
  });

  it("reads nothing, and drops nothing, where no field stops being unique", async () => {
    const read = vi.fn(live([OWN, LEFTOVER]));
    const stillUnique = await leftoverUniqueDrops({
      operations: [stopsUnique],
      // Still held unique by an index the table declares.
      desired: [posts([{ name: "uq_other", columns: ["code"], unique: true }])],
      dialect: "sqlite",
      read,
      warn: vi.fn(),
    });
    const columnGone = await leftoverUniqueDrops({
      operations: [stopsUnique],
      desired: [
        {
          ...posts(),
          columns: [{ name: "id", type: "text", nullable: false }],
        },
      ] as TableSpec[],
      dialect: "sqlite",
      read,
      warn: vi.fn(),
    });
    const tableGone = await leftoverUniqueDrops({
      operations: [stopsUnique],
      desired: [],
      dialect: "sqlite",
      read,
      warn: vi.fn(),
    });
    expect([stillUnique, columnGone, tableGone]).toEqual([
      { statements: [], dropped: [] },
      { statements: [], dropped: [] },
      { statements: [], dropped: [] },
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it("says so where the table cannot be read, naming what to drop by hand", async () => {
    const warn = vi.fn();
    const dropped = await leftoverUniqueDrops({
      operations: [stopsUnique],
      desired: [posts()],
      dialect: "sqlite",
      read: async () => undefined,
      warn,
    });
    expect(dropped).toEqual({ statements: [], dropped: [] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dc_posts"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(OWN));
  });

  it("follows a column the same change renames, reading it under its live name", async () => {
    const renamed: Operation = {
      type: "rename_column",
      tableName: "dc_posts",
      fromColumn: "code",
      toColumn: "ref",
      fromType: "text",
      toType: "text",
    };
    const asRef = (extra: TableSpec["indexes"] = []): TableSpec =>
      ({
        ...posts(extra),
        columns: [
          { name: "id", type: "text", nullable: false },
          { name: "ref", type: "text", nullable: true },
        ],
      }) as TableSpec;
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const dropped = await leftoverUniqueDrops({
        operations: [stopsUnique, renamed],
        desired: [asRef()],
        dialect,
        read: live([OWN, LEFTOVER]),
        warn: vi.fn(),
      });
      expect(dropped.dropped).toEqual([
        { table: "dc_posts", column: "code", index: LEFTOVER },
      ]);
      expect(dropped.statements.join("\n")).toContain(LEFTOVER);
    }
    // Still unique under its new name: nothing to drop.
    const stillUnique = await leftoverUniqueDrops({
      operations: [stopsUnique, renamed],
      desired: [
        asRef([{ name: "uq_dc_posts_ref", columns: ["ref"], unique: true }]),
      ],
      dialect: "sqlite",
      read: live([OWN, LEFTOVER]),
      warn: vi.fn(),
    });
    expect(stillUnique).toEqual({ statements: [], dropped: [] });
  });

  it("tells Nextly's own index from another by its exact name on PostgreSQL, where a quoted name keeps its case", async () => {
    const postgres = await leftoverUniqueDrops({
      operations: [stopsUnique],
      desired: [posts()],
      dialect: "postgresql",
      read: live([OWN, OWN.toUpperCase()]),
      warn: vi.fn(),
    });
    expect(postgres.dropped).toEqual([
      { table: "dc_posts", column: "code", index: OWN.toUpperCase() },
    ]);
    // MySQL and SQLite fold an index name's case: the same name is Nextly's own.
    for (const dialect of ["mysql", "sqlite"] as const) {
      const folded = await leftoverUniqueDrops({
        operations: [stopsUnique],
        desired: [posts()],
        dialect,
        read: live([OWN.toUpperCase()]),
        warn: vi.fn(),
      });
      expect(folded).toEqual({ statements: [], dropped: [] });
    }
  });

  it("says to drop by hand an index whose name holds the dialect's quote, which no statement here can name", async () => {
    for (const [dialect, name] of [
      ["postgresql", 'posts"code'],
      ["sqlite", 'posts"code'],
      ["mysql", "posts`code"],
    ] as const) {
      const warn = vi.fn();
      const dropped = await leftoverUniqueDrops({
        operations: [stopsUnique],
        desired: [posts()],
        dialect,
        read: live([OWN, name]),
        warn,
      });
      expect(dropped).toEqual({ statements: [], dropped: [] });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(name));
    }
  });
});
