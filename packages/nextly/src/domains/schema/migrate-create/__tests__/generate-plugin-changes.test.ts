/**
 * `migrate:create --plugin` on a table that already exists: a column added to
 * a table with rows, and a change a dialect cannot make in place.
 *
 * The SQLite cases run the generated statements against a real database
 * (better-sqlite3) holding rows, because the failures they guard against
 * happen only there: SQLite accepts the same statement on an empty table.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { currentTimestampSql } from "../../../../lib/system-columns";
import {
  migrationChecksum,
  type PluginMigration,
} from "../../migrate/plugin/plugin-migration";
import type { ColumnSpec, TableSpec } from "../../pipeline/diff/types";
import { generateSQL } from "../../pipeline/sql-templates/index";

import {
  buildBlankPluginMigration,
  buildPluginMigration,
  generatePluginMigration,
} from "../generate-plugin";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

const ID: ColumnSpec = {
  name: "id",
  type: "varchar(36)",
  nullable: false,
  primaryKey: true,
};
const LABEL: ColumnSpec = {
  name: "label",
  type: "varchar(255)",
  nullable: false,
};

function events(extra: ColumnSpec[] = [], indexed?: string): TableSpec {
  return {
    name: "acme__events",
    columns: [ID, LABEL, ...extra],
    indexes: indexed
      ? [
          {
            name: `acme__events_${indexed}_idx`,
            columns: [indexed],
            unique: false,
          },
        ]
      : [],
  };
}

/** `col.timestamps()`'s created_at, as each dialect renders it. */
function createdAt(dialect: SupportedDialect): ColumnSpec {
  return {
    name: "created_at",
    type: { postgresql: "timestamptz", mysql: "datetime", sqlite: "integer" }[
      dialect
    ],
    nullable: false,
    default: currentTimestampSql(dialect),
  };
}

function everyDialect(
  table: (dialect: SupportedDialect) => TableSpec
): Record<SupportedDialect, TableSpec[]> {
  return {
    postgresql: [table("postgresql")],
    mysql: [table("mysql")],
    sqlite: [table("sqlite")],
  };
}

function generate(
  version: number,
  tables: Record<SupportedDialect, TableSpec[]>,
  existing: PluginMigration[]
) {
  return buildPluginMigration({
    pluginName: "acme",
    schemaVersion: version,
    name: `v${version}`,
    now: new Date(Date.UTC(2026, 9, 1, 0, 0, version)),
    tablesByDialect: tables,
    existing,
  });
}

/** Run a module's SQLite statements as the migration runner does. */
function apply(db: Database.Database, statements: readonly string[]): void {
  db.pragma("foreign_keys = OFF");
  db.transaction(() => {
    for (const statement of statements) db.exec(statement);
  })();
  db.pragma("foreign_keys = ON");
}

/** The module with the author's SQL in place of a dialect's empty lists. */
function written(
  migration: PluginMigration,
  dialect: SupportedDialect,
  up: string[],
  down: string[]
): PluginMigration {
  const { checksum: _generated, ...content } = migration;
  const edited = {
    ...content,
    dialects: { ...content.dialects, [dialect]: { up, down } },
  };
  return { ...edited, checksum: migrationChecksum(edited) };
}

const v1 = generate(
  1,
  everyDialect(() => events()),
  []
)!.module;

describe("a column added to a table that has rows", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    apply(db, v1.dialects.sqlite.up);
    db.exec(
      `INSERT INTO "acme__events" ("id", "label") VALUES ('e1', 'first'), ('e2', 'second')`
    );
  });
  afterEach(() => db.close());

  it("is refused by ALTER TABLE on SQLite when its default is the current time", () => {
    // The statement a column add renders to on its own: what the module
    // shipped before, and what SQLite refuses once the table has rows.
    expect(() =>
      db.exec(
        generateSQL(
          {
            type: "add_column",
            tableName: "acme__events",
            column: createdAt("sqlite"),
          },
          "sqlite"
        )
      )
    ).toThrow(/non-constant default/);
  });

  it("is added on SQLite by rebuilding the table, every row taking the default", () => {
    const v2 = generate(
      2,
      everyDialect(dialect => events([createdAt(dialect)], "created_at")),
      [v1]
    )!;
    expect(v2.handWritten).toEqual([]);

    apply(db, v2.module.dialects.sqlite.up);
    const rows = db
      .prepare(
        `SELECT "id", "label", "created_at" FROM "acme__events" ORDER BY "id"`
      )
      .all() as { id: string; label: string; created_at: number }[];
    expect(rows.map(row => [row.id, row.label])).toEqual([
      ["e1", "first"],
      ["e2", "second"],
    ]);
    for (const row of rows) expect(typeof row.created_at).toBe("number");
    // The index on the new column, which the rebuild creates once the
    // column exists.
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'acme__events' AND sql IS NOT NULL`
        )
        .all()
    ).toEqual([{ name: "acme__events_created_at_idx" }]);

    apply(db, v2.module.dialects.sqlite.down);
    expect(
      db.prepare(`SELECT * FROM "acme__events" ORDER BY "id"`).all()
    ).toEqual([
      { id: "e1", label: "first" },
      { id: "e2", label: "second" },
    ]);
  });

  it("is refused on every dialect when it is NOT NULL with no default", () => {
    const flag: ColumnSpec = { name: "flag", type: "int", nullable: false };
    expect(() =>
      generate(
        2,
        everyDialect(() => events([flag])),
        [v1]
      )
    ).toThrow(
      expect.objectContaining({
        code: "PLUGIN_MIGRATION_ADDS_UNFILLABLE_COLUMN",
        message: expect.stringMatching(/acme__events\.flag .*--blank/),
      })
    );
    // The same column with a default, or nullable, is generated and applies.
    for (const fillable of [
      { ...flag, default: "0" },
      { ...flag, nullable: true },
    ]) {
      const v2 = generate(
        2,
        everyDialect(() => events([fillable])),
        [v1]
      )!;
      apply(db, v2.module.dialects.sqlite.up);
      apply(db, v2.module.dialects.sqlite.down);
    }
  });
});

describe("a change a dialect cannot make in place", () => {
  const score = (type: string, nullable = true): ColumnSpec => ({
    name: "score",
    type,
    nullable,
  });
  const before = generate(
    2,
    everyDialect(() => events([score("int")])),
    [v1]
  )!.module;

  it("is written for its author's SQL, recording both sides, and the stream moves on", async () => {
    const declared = everyDialect(() => events([score("varchar(20)")]));
    const v3 = generate(3, declared, [v1, before])!;

    // SQLite cannot change a column's type in place; the others can.
    expect(v3.handWritten).toEqual(["sqlite"]);
    expect(v3.module.dialects.sqlite).toEqual({ up: [], down: [] });
    expect(v3.module.dialects.postgresql.up.length).toBeGreaterThan(0);
    expect(v3.module.dialects.mysql.up.length).toBeGreaterThan(0);
    for (const dialect of DIALECTS) {
      expect(v3.module.before[dialect]).toEqual(before.snapshot[dialect]);
      expect(v3.module.snapshot[dialect]).toEqual({
        tables: declared[dialect],
      });
    }

    // Written hand-sealed, so the SQL the author adds keeps it intact.
    const dir = await mkdtemp(join(tmpdir(), "nextly-plugin-handwritten-"));
    try {
      const result = await generatePluginMigration({
        pluginName: "acme",
        schemaVersion: 3,
        name: "v3",
        now: new Date(Date.UTC(2026, 9, 1, 0, 0, 3)),
        tablesByDialect: declared,
        existing: [v1, before],
        migrationsDir: dir,
      });
      expect(result?.handWritten).toEqual(["sqlite"]);
      expect(await readFile(result!.modulePath, "utf-8")).toContain(
        "checksum: migrationChecksum(content),"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    // Once the author writes it, the next generation starts from the
    // changed shape and finds nothing to do.
    const filled = written(
      v3.module,
      "sqlite",
      [`-- the author's rebuild of "acme__events"`],
      []
    );
    expect(generate(4, declared, [v1, before, filled])).toBeNull();
  });

  it("generates a nullability change on every dialect", () => {
    // MySQL restates the column from its live catalog when the module runs, and SQLite rebuilds the
    // table to the declared shape; neither is left to the author any more.
    const v3 = generate(
      3,
      everyDialect(() => events([score("int", false)])),
      [v1, before]
    )!;
    expect(v3.handWritten).toEqual([]);
    expect(v3.module.dialects.mysql.up.join("\n")).toMatch(
      /MODIFY COLUMN `score` ', COLUMN_TYPE[\s\S]*' NOT NULL'/
    );
    expect(v3.module.dialects.mysql.down.join("\n")).toMatch(
      /MODIFY COLUMN `score` ', COLUMN_TYPE[\s\S]*' NULL'/
    );
    expect(v3.module.dialects.sqlite.up.join("\n")).toMatch(
      /CREATE TABLE "__new_acme__events" \([\s\S]*"score" int NOT NULL/
    );
    expect(v3.module.dialects.postgresql.up.length).toBeGreaterThan(0);
  });
});

describe("a blank module", () => {
  it("records the declared change for the SQL its author writes, so a rename can be carried", () => {
    const renamed = everyDialect(() =>
      events([{ name: "title", type: "varchar(255)", nullable: true }])
    );
    const withNote = generate(
      2,
      everyDialect(() =>
        events([{ name: "note", type: "varchar(255)", nullable: true }])
      ),
      [v1]
    )!.module;

    // Generated, the rename is a drop and an add, and refused.
    expect(() => generate(3, renamed, [v1, withNote])).toThrow(
      expect.objectContaining({ code: "PLUGIN_MIGRATION_DROPS_CREATED_SCHEMA" })
    );

    const blank = buildBlankPluginMigration({
      pluginName: "acme",
      schemaVersion: 3,
      name: "rename_note",
      now: new Date(Date.UTC(2026, 9, 1, 0, 0, 3)),
      tablesByDialect: renamed,
      existing: [v1, withNote],
    });
    for (const dialect of DIALECTS) {
      expect(blank.dialects[dialect]).toEqual({ up: [], down: [] });
      expect(blank.before[dialect]).toEqual(withNote.snapshot[dialect]);
      expect(blank.snapshot[dialect]).toEqual({ tables: renamed[dialect] });
    }

    // A recorded change moves the schema, so its version must move too.
    expect(() =>
      buildBlankPluginMigration({
        pluginName: "acme",
        schemaVersion: 2,
        name: "rename_note",
        tablesByDialect: renamed,
        existing: [v1, withNote],
      })
    ).toThrow(
      expect.objectContaining({ code: "PLUGIN_SCHEMA_VERSION_NOT_ADVANCED" })
    );

    const filled = DIALECTS.reduce(
      (migration, dialect) =>
        written(
          migration,
          dialect,
          [`ALTER TABLE "acme__events" RENAME COLUMN "note" TO "title"`],
          [`ALTER TABLE "acme__events" RENAME COLUMN "title" TO "note"`]
        ),
      blank
    );
    expect(generate(4, renamed, [v1, withNote, filled])).toBeNull();
  });
});
