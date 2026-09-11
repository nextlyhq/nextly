/**
 * What becomes of a many-to-many field's junction table when the field goes,
 * moves, is renamed, or its collection is dropped.
 *
 * The CREATE half has long existed: adding a many-to-many field emits its
 * junction table. Nothing emitted the other half, so a removed field left its
 * junction standing with every link in it — unread, and inherited by any
 * field later added under the same name — and a rename created a fresh empty
 * junction while orphaning the full one. Each case below asserts the exact
 * statement, on every dialect, because the migration author writes SQL text
 * and the three dialects quote differently.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";

type Dialect = "postgresql" | "mysql" | "sqlite";
const DIALECTS: Dialect[] = ["postgresql", "mysql", "sqlite"];

const q = (dialect: Dialect, name: string): string =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

const manyToMany = (
  name: string,
  target = "tags",
  extra: Record<string, unknown> = {}
): FieldDefinition => ({
  name,
  type: "relationship",
  options: { relationType: "manyToMany", target, ...extra },
});

const manyToOne = (name: string, target = "tags"): FieldDefinition => ({
  name,
  type: "relationship",
  options: { relationType: "manyToOne", target },
});

const text = (name: string): FieldDefinition => ({ name, type: "text" });

/** The generated junction name for `dc_posts.<field> -> dc_tags`. */
const junction = (field: string): string => `dc_posts_dc_tags_${field}`;

describe.each(DIALECTS)("junction table lifecycle on %s", dialect => {
  const service = () => new DynamicCollectionSchemaService(undefined, dialect);

  describe("a removed many-to-many field", () => {
    it("drops its junction table", () => {
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [text("title"), manyToMany("tags")],
        [text("title")]
      );
      expect(sql).toContain(
        `DROP TABLE IF EXISTS ${q(dialect, junction("tags"))};`
      );
      // Nothing on the parent: the field never had a column there.
      expect(sql).not.toContain("DROP COLUMN");
    });

    it("drops the junction the author named, when the field named one", () => {
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [manyToMany("tags", "tags", { junctionTable: "post_tag_links" })],
        []
      );
      expect(sql).toContain(
        `DROP TABLE IF EXISTS ${q(dialect, "post_tag_links")};`
      );
      expect(sql).not.toContain(junction("tags"));
    });

    it("leaves a junction alone when its field stays", () => {
      // The control: the drop is about removal, not about being many-to-many.
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [manyToMany("tags")],
        [manyToMany("tags")]
      );
      expect(sql).not.toContain("DROP TABLE");
    });
  });

  describe("a many-to-many field moved to a storage class with a column", () => {
    it("drops the junction and adds the column", () => {
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [manyToMany("tags")],
        [manyToOne("tags")]
      );
      expect(sql).toContain(
        `DROP TABLE IF EXISTS ${q(dialect, junction("tags"))};`
      );
      expect(sql).toContain("ADD COLUMN");
    });
  });

  describe("a renamed many-to-many field", () => {
    it("renames the junction table, and neither creates nor drops one", () => {
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [manyToMany("tags")],
        [manyToMany("categories")]
      );
      expect(sql).toContain(
        `ALTER TABLE ${q(dialect, junction("tags"))} RENAME TO ${q(dialect, junction("categories"))};`
      );
      expect(sql).not.toContain("CREATE TABLE");
      expect(sql).not.toContain("DROP TABLE");
    });

    it("emits nothing for the pair when the author's junction name is unchanged", () => {
      const named = { junctionTable: "post_tag_links" };
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [manyToMany("tags", "tags", named)],
        [manyToMany("categories", "tags", named)]
      );
      expect(sql).not.toContain("RENAME TO");
      expect(sql).not.toContain("CREATE TABLE");
      expect(sql).not.toContain("DROP TABLE");
    });

    it("still renames alongside unrelated edits in the same save", () => {
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [text("summary"), manyToMany("tags")],
        [text("summary"), text("subtitle"), manyToMany("categories")]
      );
      expect(sql).toContain(
        `ALTER TABLE ${q(dialect, junction("tags"))} RENAME TO ${q(dialect, junction("categories"))};`
      );
      expect(sql).toContain("ADD COLUMN");
      expect(sql).not.toContain("DROP TABLE");
    });

    it("is a remove and an add, not a rename, when the target differs", () => {
      // The old links point at tags; they cannot be the new field's links.
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [manyToMany("tags", "tags")],
        [manyToMany("authors", "authors")]
      );
      expect(sql).toContain(
        `DROP TABLE IF EXISTS ${q(dialect, junction("tags"))};`
      );
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
      expect(sql).not.toContain("RENAME TO");
    });

    it("refuses two renames in one save by name rather than guessing the pairing", () => {
      // A wrong pairing hands one field the other's links, so the author
      // renames one per save — the same posture as a field-group rename.
      try {
        service().generateAlterTableMigration(
          "dc_posts",
          [manyToMany("tags"), manyToMany("topics")],
          [manyToMany("labels"), manyToMany("subjects")]
        );
        expect.unreachable("expected a refusal");
      } catch (error) {
        const data = (
          error as { publicData?: { errors?: { code?: string }[] } }
        ).publicData;
        expect(data?.errors?.[0]?.code).toBe("MANY_TO_MANY_RENAME_AMBIGUOUS");
      }
    });
  });

  describe("a dropped collection", () => {
    it("drops its own junction tables before the companion and the main table", () => {
      const { migrationSQL } = service().generateDropTableMigration(
        "posts",
        "dc_posts",
        [text("title"), manyToMany("tags"), manyToMany("authors", "authors")]
      );
      const at = (needle: string): number => {
        const index = migrationSQL.indexOf(needle);
        expect(index, needle).toBeGreaterThan(-1);
        return index;
      };
      const tags = at(`DROP TABLE IF EXISTS ${q(dialect, junction("tags"))};`);
      const authors = at(
        `DROP TABLE IF EXISTS ${q(dialect, "dc_authors_dc_posts_authors")};`
      );
      const companion = at(
        `DROP TABLE IF EXISTS ${q(dialect, "dc_posts_locales")};`
      );
      const main = at(`DROP TABLE IF EXISTS ${q(dialect, "dc_posts")}`);
      expect(Math.max(tags, authors)).toBeLessThan(companion);
      expect(companion).toBeLessThan(main);
    });

    it("drops nothing extra for a collection with no many-to-many field", () => {
      const { migrationSQL } = service().generateDropTableMigration(
        "posts",
        "dc_posts",
        [text("title"), manyToOne("author", "authors")]
      );
      expect(migrationSQL.match(/DROP TABLE/g)).toHaveLength(2);
    });
  });
});
