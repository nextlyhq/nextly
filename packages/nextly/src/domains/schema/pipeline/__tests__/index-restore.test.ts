/**
 * Indexes are restored after a rebuild, and only after a rebuild.
 *
 * SQLite applies most column changes by building `__new_<table>`, copying the
 * rows, dropping the original and renaming the copy into place. The
 * replacement is built from a Drizzle schema that declares no secondary
 * indexes, so the table's indexes go with the one that was dropped.
 *
 * The restore therefore has to fire for that pattern — and must not fire for
 * anything else. PostgreSQL and MySQL alter in place and keep their indexes,
 * and re-creating an index that already exists is not harmless: MySQL has no
 * `CREATE INDEX IF NOT EXISTS`, so a duplicate key name aborts the apply,
 * after MySQL has already auto-committed the DDL ahead of it.
 */
import { describe, expect, it } from "vitest";

import type { NextlySchemaSnapshot } from "../diff/types";
import { indexRestoreStatements } from "../index-restore";

const desired: NextlySchemaSnapshot = {
  tables: [
    {
      name: "dc_posts",
      columns: [{ name: "id", type: "text", nullable: false }],
      indexes: [
        { name: "idx_dc_posts_slug", columns: ["slug"], unique: true },
        {
          name: "idx_dc_posts_created_at",
          columns: ["created_at"],
          unique: false,
        },
      ],
    },
    {
      name: "dc_tags",
      columns: [{ name: "id", type: "text", nullable: false }],
      indexes: [{ name: "idx_dc_tags_slug", columns: ["slug"], unique: true }],
    },
  ],
};

const REBUILD = [
  'CREATE TABLE "__new_dc_posts" ("id" text PRIMARY KEY)',
  'INSERT INTO "__new_dc_posts" SELECT * FROM "dc_posts"',
  'DROP TABLE "dc_posts"',
  'ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"',
];

describe("index restore", () => {
  it("restores the rebuilt table's indexes", () => {
    const out = indexRestoreStatements(desired, "sqlite", REBUILD);

    expect(out).toHaveLength(2);
    expect(out.every(s => /CREATE\s+(UNIQUE\s+)?INDEX/i.test(s))).toBe(true);
    expect(out.every(s => s.includes("dc_posts"))).toBe(true);
  });

  it("leaves tables the batch did not rebuild alone", () => {
    // dc_tags has indexes in the desired schema but was not rebuilt here.
    const out = indexRestoreStatements(desired, "sqlite", REBUILD);

    expect(out.some(s => s.includes("dc_tags"))).toBe(false);
  });

  it("emits nothing for an in-place ALTER on postgres", () => {
    // The op still marks the table as affected, which is why scoping on
    // "affected" rather than "rebuilt" recreated live indexes.
    const out = indexRestoreStatements(desired, "postgresql", [
      'ALTER TABLE "dc_posts" ADD COLUMN "x" text',
    ]);

    expect(out).toEqual([]);
  });

  it("emits nothing for an in-place ALTER on mysql", () => {
    // The dialect with no IF NOT EXISTS, where a duplicate key name aborts an
    // apply whose earlier DDL has already auto-committed.
    const out = indexRestoreStatements(desired, "mysql", [
      "ALTER TABLE `dc_posts` ADD COLUMN `x` text",
      "ALTER TABLE `dc_posts` MODIFY COLUMN `title` varchar(255)",
    ]);

    expect(out).toEqual([]);
  });

  it("matches the rename however the dialect writes it", () => {
    const shapes = [
      [
        "CREATE TABLE `__new_dc_posts` (`id` text)",
        "ALTER TABLE `__new_dc_posts` RENAME TO `dc_posts`",
      ],
      [
        "CREATE TABLE __new_dc_posts (id text)",
        "ALTER TABLE __new_dc_posts RENAME TO dc_posts",
      ],
      // Schema-qualified, which drizzle-kit emits and the destructive scanner
      // already accepts. Missing it would leave the rebuilt table without its
      // indexes in exactly the case this exists to cover.
      [
        'CREATE TABLE "main"."__new_dc_posts" ("id" text)',
        'ALTER TABLE "main"."__new_dc_posts" RENAME TO "dc_posts"',
      ],
      [
        "CREATE TABLE main.__new_dc_posts (id text)",
        "ALTER TABLE main.__new_dc_posts RENAME TO dc_posts",
      ],
    ];
    for (const shape of shapes) {
      expect(indexRestoreStatements(desired, "sqlite", shape)).toHaveLength(2);
    }
  });

  it("ignores a rename with no matching create", () => {
    // `DROP TABLE x; ALTER TABLE __new_x RENAME TO x` builds nothing and
    // copies nothing, so the rows are gone. Reading it as a rebuild would
    // both restore indexes onto a table that lost its data and, in the
    // destructive guard that shares this detection, excuse the drop.
    const out = indexRestoreStatements(desired, "sqlite", [
      'DROP TABLE "dc_posts"',
      'ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"',
    ]);

    expect(out).toEqual([]);
  });

  it("ignores a rename that does not restore the original name", () => {
    // `__new_x` renaming to something else is not a rebuild of `x`, so it must
    // not trigger a restore against a table that was never replaced.
    const out = indexRestoreStatements(desired, "sqlite", [
      'CREATE TABLE "__new_dc_posts" ("id" text)',
      'ALTER TABLE "__new_dc_posts" RENAME TO "dc_archive"',
    ]);

    expect(out).toEqual([]);
  });

  it("emits nothing when the rebuilt table tracks no indexes", () => {
    // `undefined` means the snapshot never tracked indexes, which is not the
    // same as the table having none.
    const untracked: NextlySchemaSnapshot = {
      tables: [
        {
          name: "dc_posts",
          columns: [{ name: "id", type: "text", nullable: false }],
        },
      ],
    };

    expect(indexRestoreStatements(untracked, "sqlite", REBUILD)).toEqual([]);
  });

  it("creates an index the diff asked for even with no rebuild", () => {
    // On SQLite and MySQL nothing else does: the fast-path emitter is
    // PostgreSQL-only, and the schema handed to drizzle-kit declares no
    // dynamic-table indexes, so an index-only diff would apply zero
    // statements and report success with the index still missing.
    const out = indexRestoreStatements(
      desired,
      "sqlite",
      [],
      [
        {
          type: "add_index",
          tableName: "dc_tags",
          index: { name: "idx_dc_tags_slug", columns: ["slug"], unique: true },
        },
      ]
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toContain("idx_dc_tags_slug");
  });

  it("emits a rebuilt table's index once when the diff also asks for it", () => {
    const out = indexRestoreStatements(desired, "sqlite", REBUILD, [
      {
        type: "add_index",
        tableName: "dc_posts",
        index: {
          name: "idx_dc_posts_slug",
          columns: ["slug"],
          unique: true,
        },
      },
    ]);

    expect(out.filter(s => s.includes("idx_dc_posts_slug"))).toHaveLength(1);
  });
});
