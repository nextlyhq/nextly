// A field whose type changes is written, on SQLite, as the rebuild of its table the generator
// already writes for a nullability or check change: SQLite has no statement that changes a
// column's type, and the file used to refuse the change instead.

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSqlSections } from "../../migrate/sql-sections";
import { generateMigration, type MinimalConfigEntity } from "../generate";

const posts = (type: string): MinimalConfigEntity => ({
  slug: "posts",
  tableName: "dc_posts",
  fields: [{ name: "code", type }],
});

describe("a field's type changed on SQLite", () => {
  it("rebuilds its table to the new type, and back on the way down", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nextly-sqlite-type-"));
    const run = (entity: MinimalConfigEntity, name: string, minute: number) =>
      generateMigration({
        name,
        dialect: "sqlite",
        migrationsDir: dir,
        collections: [entity],
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date(Date.UTC(2026, 10, 6, 12, minute)),
      });
    await run(posts("text"), "one", 1);

    const result = await run(posts("number"), "two", 2);

    expect(result).not.toBeNull();
    const { upSql, downSql } = parseSqlSections(
      await readFile(result!.sqlPath, "utf-8")
    );
    expect(upSql).toMatch(
      /CREATE TABLE "__new_dc_posts"[\s\S]*"code" (integer|real|numeric)/
    );
    expect(upSql).toMatch(/INSERT INTO "__new_dc_posts"[\s\S]*FROM "dc_posts"/);
    expect(upSql).toMatch(/ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"/);
    expect(downSql).toMatch(/CREATE TABLE "__new_dc_posts"[\s\S]*"code" text/);
  });
});
