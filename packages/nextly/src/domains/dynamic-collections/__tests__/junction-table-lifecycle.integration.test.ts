/**
 * The junction lifecycle statements, applied to a real database.
 *
 * The unit suite pins the SQL text; this pins what the text DOES: a renamed
 * many-to-many field keeps every link it had, a removed one leaves no table
 * behind, and a dropped collection takes its junctions with it. Run on
 * SQLite, whose `ALTER TABLE … RENAME TO` and `DROP TABLE IF EXISTS` are
 * spelled as PostgreSQL's and MySQL's are; the three dialect legs of the
 * migration runner cover the rest.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";

const manyToMany = (name: string): FieldDefinition => ({
  name,
  type: "relationship",
  options: { relationType: "manyToMany", target: "tags" },
});

const title: FieldDefinition = { name: "title", type: "text" };

describe("junction table lifecycle on a real SQLite database", () => {
  let db: Database.Database;
  const service = new DynamicCollectionSchemaService(undefined, "sqlite");

  /**
   * Apply migration text the way `CollectionFileManager.runMigration` applies
   * it: split on the breakpoint, drop comment lines, `exec` each chunk.
   */
  const apply = (sql: string): void => {
    for (const chunk of sql.split("--> statement-breakpoint")) {
      const statement = chunk
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (statement.length > 0) db.exec(statement);
    }
  };

  const tables = (): string[] =>
    (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all() as { name: string }[]
    ).map(r => r.name);

  beforeEach(() => {
    db = new Database(":memory:");
    // The adapter runs every migration with foreign keys enforced; so does
    // this, or the junction's constraints would be text the test never meets.
    db.pragma("foreign_keys = ON");
    // Both collections from the production create path, which builds the
    // many-to-many field's junction along with its table — the same columns,
    // keys and foreign keys a deployment has, not a sketch of them.
    apply(service.generateMigrationSQL("dc_tags", []));
    apply(
      service.generateMigrationSQL("dc_posts", [title, manyToMany("tags")])
    );
    db.exec(
      "INSERT INTO dc_tags (id, title, slug) VALUES ('t1', 'one', 'one'), ('t2', 'two', 'two')"
    );
    db.exec(
      "INSERT INTO dc_posts (id, slug, title) VALUES ('p1', 'one', 'one')"
    );
    db.exec(
      "INSERT INTO dc_posts_dc_tags_tags (id, posts_id, tags_id) VALUES ('l1', 'p1', 't1'), ('l2', 'p1', 't2')"
    );
  });

  afterEach(() => {
    db.close();
  });

  it("keeps every link across a rename of the field", () => {
    apply(
      service.generateAlterTableMigration(
        "dc_posts",
        [title, manyToMany("tags")],
        [title, manyToMany("categories")]
      )
    );
    expect(tables()).toEqual([
      "dc_posts",
      "dc_posts_dc_tags_categories",
      "dc_tags",
    ]);
    const links = db
      .prepare(
        "SELECT tags_id FROM dc_posts_dc_tags_categories WHERE posts_id = 'p1' ORDER BY tags_id"
      )
      .all() as { tags_id: string }[];
    expect(links.map(l => l.tags_id)).toEqual(["t1", "t2"]);
  });

  it("frees the old attachment names on rename, so a field reusing the old name is indexed", () => {
    apply(
      service.generateAlterTableMigration(
        "dc_posts",
        [title, manyToMany("tags")],
        [title, manyToMany("categories")]
      )
    );
    // A new field under the old name: CREATE spells the old index names, which
    // must be free or `IF NOT EXISTS` would find them on the renamed table
    // and leave this junction unindexed.
    apply(
      service.generateAlterTableMigration(
        "dc_posts",
        [title, manyToMany("categories")],
        [title, manyToMany("categories"), manyToMany("tags")]
      )
    );
    const indexes = db
      .prepare(
        "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_dc_posts_dc_tags_%' ORDER BY name"
      )
      .all() as { name: string; tbl_name: string }[];
    expect(indexes).toEqual([
      {
        name: "idx_dc_posts_dc_tags_categories_posts",
        tbl_name: "dc_posts_dc_tags_categories",
      },
      {
        name: "idx_dc_posts_dc_tags_categories_tags",
        tbl_name: "dc_posts_dc_tags_categories",
      },
      {
        name: "idx_dc_posts_dc_tags_tags_posts",
        tbl_name: "dc_posts_dc_tags_tags",
      },
      {
        name: "idx_dc_posts_dc_tags_tags_tags",
        tbl_name: "dc_posts_dc_tags_tags",
      },
    ]);
  });

  it("leaves no junction behind when the field is removed", () => {
    apply(
      service.generateAlterTableMigration(
        "dc_posts",
        [title, manyToMany("tags")],
        [title]
      )
    );
    expect(tables()).toEqual(["dc_posts", "dc_tags"]);
  });

  it("does not hand a re-added field the links its predecessor had", () => {
    // The hazard the removal exists to close: `CREATE TABLE IF NOT EXISTS`
    // would otherwise keep the old table, links and all, for the new field.
    apply(
      service.generateAlterTableMigration(
        "dc_posts",
        [title, manyToMany("tags")],
        [title]
      )
    );
    apply(
      service.generateAlterTableMigration(
        "dc_posts",
        [title],
        [title, manyToMany("tags")]
      )
    );
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM dc_posts_dc_tags_tags")
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("takes the collection's junctions with it when the collection is dropped", () => {
    apply(
      service.generateDropTableMigration("posts", "dc_posts", [
        title,
        manyToMany("tags"),
      ]).migrationSQL
    );
    expect(tables()).toEqual(["dc_tags"]);
  });
});
