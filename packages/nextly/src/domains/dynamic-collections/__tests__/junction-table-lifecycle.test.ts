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

const asField = (f: Record<string, unknown>): FieldDefinition =>
  f as unknown as FieldDefinition;

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

    it("renames every attachment whose name embedded the old table name", () => {
      // Left as they were, the old index and constraint names would still be
      // taken when a later field reuses the old field name and CREATE spells
      // the same ones. Each dialect renames what it can and rebuilds the rest.
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [manyToMany("tags")],
        [manyToMany("categories")]
      );
      const from = junction("tags");
      const to = junction("categories");
      const expected: Record<Dialect, string[]> = {
        postgresql: [
          `ALTER INDEX "idx_${from}_posts" RENAME TO "idx_${to}_posts";`,
          `ALTER INDEX "idx_${from}_tags" RENAME TO "idx_${to}_tags";`,
          `ALTER TABLE "${to}" RENAME CONSTRAINT "fk_${from}_posts" TO "fk_${to}_posts";`,
          `ALTER TABLE "${to}" RENAME CONSTRAINT "fk_${from}_tags" TO "fk_${to}_tags";`,
          `ALTER TABLE "${to}" RENAME CONSTRAINT "uq_${from}_pair" TO "uq_${to}_pair";`,
        ],
        mysql: [
          `ALTER TABLE \`${to}\` RENAME INDEX \`idx_${from}_posts\` TO \`idx_${to}_posts\`;`,
          `ALTER TABLE \`${to}\` RENAME INDEX \`idx_${from}_tags\` TO \`idx_${to}_tags\`;`,
          `ALTER TABLE \`${to}\` RENAME INDEX \`uq_${from}_pair\` TO \`uq_${to}_pair\`;`,
          `ALTER TABLE \`${to}\` DROP FOREIGN KEY \`fk_${from}_posts\`, ADD CONSTRAINT \`fk_${to}_posts\` FOREIGN KEY (\`posts_id\`) REFERENCES \`dc_posts\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION;`,
          `ALTER TABLE \`${to}\` DROP FOREIGN KEY \`fk_${from}_tags\`, ADD CONSTRAINT \`fk_${to}_tags\` FOREIGN KEY (\`tags_id\`) REFERENCES \`dc_tags\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION;`,
        ],
        sqlite: [
          `DROP INDEX IF EXISTS "idx_${from}_posts";`,
          `CREATE INDEX IF NOT EXISTS "idx_${to}_posts" ON "${to}"("posts_id");`,
          `DROP INDEX IF EXISTS "idx_${from}_tags";`,
          `CREATE INDEX IF NOT EXISTS "idx_${to}_tags" ON "${to}"("tags_id");`,
        ],
      };
      for (const statement of expected[dialect]) {
        expect(sql).toContain(statement);
      }
      // The old spellings survive nowhere but in the rename statements.
      const withoutRenames = sql
        .split("--> statement-breakpoint")
        .filter(chunk => !/RENAME|DROP INDEX|DROP FOREIGN KEY/.test(chunk));
      expect(withoutRenames.join("\n")).not.toContain(from);
    });

    it("rebuilds the foreign keys, not renames them, when the same save edited the referential actions", () => {
      // A renamed constraint keeps its actions: the registry would record
      // `restrict` while the database went on cascading. PostgreSQL can rename
      // a foreign key and so must be told not to; MySQL re-declares one in any
      // case; SQLite cannot alter a constraint, so the links keep the table
      // they are in and the old actions with it, which is stated where the
      // statements are written.
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [manyToMany("tags")],
        [manyToMany("categories", "tags", { onDelete: "restrict" })]
      );
      const from = junction("tags");
      const to = junction("categories");
      const expected: Record<Dialect, string[]> = {
        postgresql: [
          `ALTER TABLE "${to}" DROP CONSTRAINT "fk_${from}_posts", ADD CONSTRAINT "fk_${to}_posts" FOREIGN KEY ("posts_id") REFERENCES "dc_posts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;`,
          `ALTER TABLE "${to}" DROP CONSTRAINT "fk_${from}_tags", ADD CONSTRAINT "fk_${to}_tags" FOREIGN KEY ("tags_id") REFERENCES "dc_tags"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;`,
          // The unique pair carries no action and is still renamed in place.
          `ALTER TABLE "${to}" RENAME CONSTRAINT "uq_${from}_pair" TO "uq_${to}_pair";`,
        ],
        mysql: [
          `ALTER TABLE \`${to}\` DROP FOREIGN KEY \`fk_${from}_posts\`, ADD CONSTRAINT \`fk_${to}_posts\` FOREIGN KEY (\`posts_id\`) REFERENCES \`dc_posts\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION;`,
          `ALTER TABLE \`${to}\` DROP FOREIGN KEY \`fk_${from}_tags\`, ADD CONSTRAINT \`fk_${to}_tags\` FOREIGN KEY (\`tags_id\`) REFERENCES \`dc_tags\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION;`,
          `ALTER TABLE \`${to}\` RENAME INDEX \`uq_${from}_pair\` TO \`uq_${to}_pair\`;`,
        ],
        sqlite: [`ALTER TABLE "${from}" RENAME TO "${to}";`],
      };
      const forbidden: Record<Dialect, string[]> = {
        postgresql: [`RENAME CONSTRAINT "fk_`, "ON DELETE CASCADE"],
        mysql: ["ON DELETE CASCADE"],
        sqlite: ["CONSTRAINT"],
      };
      for (const statement of expected[dialect]) {
        expect(sql).toContain(statement);
      }
      for (const fragment of forbidden[dialect]) {
        expect(sql).not.toContain(fragment);
      }
      // Still a rename: the links stay where they are on every dialect.
      expect(sql).not.toContain("CREATE TABLE");
      expect(sql).not.toContain("DROP TABLE");
    });

    it("is two drops and a create, not an ambiguous rename, when nothing pairs", () => {
      // Two removed, one added, and the added one points elsewhere: no
      // compatible pair exists, so nothing is renamed and nothing is refused.
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [manyToMany("tags", "tags"), manyToMany("authors", "authors")],
        [manyToMany("topics", "topics")]
      );
      expect(sql).toContain(
        `DROP TABLE IF EXISTS ${q(dialect, junction("tags"))};`
      );
      expect(sql).toContain(
        `DROP TABLE IF EXISTS ${q(dialect, "dc_authors_dc_posts_authors")};`
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

  describe("a save that renames a many-to-many and a field group together", () => {
    it("carries both: the junction rename and the group's association migration", () => {
      const sql = service().generateAlterTableMigration(
        "dc_posts",
        [
          manyToMany("tags"),
          asField({ name: "seo", type: "fieldGroup", fieldGroup: "seo" }),
        ],
        [
          manyToMany("categories"),
          asField({ name: "meta", type: "fieldGroup", fieldGroup: "seo" }),
        ],
        { fieldGroupTableNames: new Map([["seo", "comp_seo"]]) }
      );
      expect(sql).toContain(
        `ALTER TABLE ${q(dialect, junction("tags"))} RENAME TO ${q(dialect, junction("categories"))};`
      );
      expect(sql).toMatch(/["'`]_parent_field["'`] = 'meta'/);
      expect(sql).not.toContain("CREATE TABLE");
      expect(sql).not.toContain("DROP TABLE");
    });
  });

  describe("a localized many-to-many, which the column diff never sees", () => {
    it("is dropped and renamed from the full lists the caller hands over", () => {
      // The column diff of a localized collection receives only the shared
      // fields; a junction is not a column and must not vanish with the split.
      const removed = service().generateAlterTableMigration(
        "dc_posts",
        [text("title")],
        [text("title")],
        {
          junctionFields: {
            old: [
              text("title"),
              manyToMany("tags", "tags", { localized: true }),
            ],
            new: [text("title")],
          },
        }
      );
      expect(removed).toContain(
        `DROP TABLE IF EXISTS ${q(dialect, junction("tags"))};`
      );

      const renamed = service().generateAlterTableMigration(
        "dc_posts",
        [text("title")],
        [text("title")],
        {
          junctionFields: {
            old: [
              text("title"),
              manyToMany("tags", "tags", { localized: true }),
            ],
            new: [
              text("title"),
              manyToMany("categories", "tags", { localized: true }),
            ],
          },
        }
      );
      expect(renamed).toContain(
        `ALTER TABLE ${q(dialect, junction("tags"))} RENAME TO ${q(dialect, junction("categories"))};`
      );

      const added = service().generateAlterTableMigration(
        "dc_posts",
        [text("title")],
        [text("title")],
        {
          junctionFields: {
            old: [text("title")],
            new: [
              text("title"),
              manyToMany("tags", "tags", { localized: true }),
            ],
          },
        }
      );
      expect(added).toContain("CREATE TABLE IF NOT EXISTS");
      expect(added).toContain(junction("tags"));
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
