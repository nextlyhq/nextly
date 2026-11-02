// Which migration files are an earlier Schema Builder's, by their whole
// signature: (a) the Builder's name, (b) no snapshot beside it, (c) none of
// migrate:create's header lines, (d) every statement changes only its entity's
// own tables, its own registry row among them. One case per condition, each
// with a file that meets the other three, so a classifier that skips any one
// condition fails here. The registry statements come from the builder the old
// files were written with, on both dialect syntaxes.
import { describe, expect, it } from "vitest";

import type { UiSchemaEntity } from "../../../../schemas/_zod/ui-schema";
import { buildCollectionMetadataUpsert } from "../../ui-schema/metadata-sql";
import {
  classifyMigrationFile,
  type MigrationFileFacts,
} from "../old-builder-files";

const BREAK = "\n--> statement-breakpoint\n";
const entity = (slug: string): UiSchemaEntity =>
  ({ slug, fields: [] }) as unknown as UiSchemaEntity;

type Dialect = "postgresql" | "mysql";
const q = (name: string, dialect: Dialect) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** A create file as the Builder wrote it: table, translations, a join table, its own registry row. */
function createFile(
  slug: string,
  dialect: Dialect,
  registrySlug = slug
): string {
  const table = `dc_${slug.replace(/-/g, "_")}`;
  return [
    `-- Create dynamic collection: ${table}\nCREATE TABLE ${q(table, dialect)} (${q("id", dialect)} text PRIMARY KEY);`,
    `CREATE TABLE ${q(`${table}_locales`, dialect)} (${q("id", dialect)} text PRIMARY KEY);`,
    `CREATE TABLE ${q(`dc_authors_${table}_tags`, dialect)} (${q("id", dialect)} text PRIMARY KEY);`,
    buildCollectionMetadataUpsert(entity(registrySlug), dialect),
  ].join(BREAK);
}

const facts = (
  over: Partial<MigrationFileFacts> & { name: string; content: string }
): MigrationFileFacts => ({
  hasSnapshot: false,
  dialect: "postgresql",
  ...over,
});

describe.each<Dialect>(["postgresql", "mysql"])(
  "classifyMigrationFile on %s",
  dialect => {
    const old = (name: string, content: string) =>
      classifyMigrationFile(facts({ name, content, dialect }));

    it("recognises a create file with its own tables and its own registry row", () => {
      expect(
        old("1730000000000_create_posts.sql", createFile("posts", dialect))
      ).toEqual({
        kind: "old-builder",
        entity: "posts",
      });
    });

    it("recognises each name kind on its own entity's tables", () => {
      const t = q("dc_posts", dialect);
      expect(
        old(
          "1730000000001_update_posts.sql",
          `ALTER TABLE ${t} ADD COLUMN ${q("x", dialect)} text;`
        ).kind
      ).toBe("old-builder");
      expect(
        old(
          "1730000000002_i18n_posts.sql",
          `CREATE TABLE ${q("dc_posts_locales", dialect)} (${q("id", dialect)} text);`
        ).kind
      ).toBe("old-builder");
      expect(
        old(
          "1730000000003_status_posts.sql",
          `ALTER TABLE ${t} ADD COLUMN ${q("status", dialect)} text;`
        ).kind
      ).toBe("old-builder");
      expect(
        old(
          "1730000000004_drop_posts.sql",
          [
            `DROP TABLE IF EXISTS ${q("dc_authors_dc_posts_tags", dialect)};`,
            `DROP TABLE IF EXISTS ${q("dc_posts_locales", dialect)};`,
            `DROP TABLE IF EXISTS ${t};`,
          ].join("\n")
        ).kind
      ).toBe("old-builder");
      expect(
        old(
          "1730000000005_drop_comp_hero.sql",
          `DROP TABLE IF EXISTS ${q("comp_hero", dialect)};`
        )
      ).toEqual({
        kind: "old-builder",
        entity: "hero",
      });
    });

    it("maps a dashed slug to its underscored table", () => {
      expect(
        old(
          "1730000000006_create_blog-posts.sql",
          createFile("blog-posts", dialect)
        ).kind
      ).toBe("old-builder");
    });

    it("(b) a snapshot beside it makes it partial, lacking only that", () => {
      expect(
        classifyMigrationFile(
          facts({
            name: "1730000000000_create_posts.sql",
            content: createFile("posts", dialect),
            dialect,
            hasSnapshot: true,
          })
        )
      ).toEqual({ kind: "partial", lacks: ["snapshot"] });
    });

    it.each(["-- UP", "-- Collections: posts", "-- Entity scope: touched"])(
      "(c) the migrate:create header line %j makes it partial, lacking only that",
      header => {
        expect(
          old(
            "1730000000000_create_posts.sql",
            `${header}\n${createFile("posts", dialect)}`
          )
        ).toEqual({
          kind: "partial",
          lacks: ["header"],
        });
      }
    );

    it("(d) another entity's registry row makes it partial, lacking scope", () => {
      expect(
        old(
          "1730000000000_create_posts.sql",
          createFile("posts", dialect, "comments")
        )
      ).toEqual({
        kind: "partial",
        lacks: ["scope"],
      });
    });

    it.each([
      ["another entity's table", "dc_comments"],
      ["a table that only starts with its own", "dc_posts_archive"],
      ["a core table", "nextly_users"],
    ])(
      "(d) a statement on %s makes it partial, lacking scope",
      (_name, table) => {
        expect(
          old(
            "1730000000000_create_posts.sql",
            `${createFile("posts", dialect)}${BREAK}ALTER TABLE ${q(table, dialect)} ADD COLUMN ${q("x", dialect)} text;`
          )
        ).toEqual({ kind: "partial", lacks: ["scope"] });
      }
    );

    it("(d) a name that gives no entity its statements change makes it partial", () => {
      expect(
        old("1730000000000_create_nothing.sql", createFile("posts", dialect))
      ).toEqual({
        kind: "partial",
        lacks: ["scope"],
      });
    });

    it("(d) a statement it cannot read makes it partial", () => {
      expect(
        old(
          "1730000000000_create_posts.sql",
          `${createFile("posts", dialect)}${BREAK}GRANT ALL ON ${q("dc_posts", dialect)} TO someone;`
        )
      ).toEqual({
        kind: "partial",
        lacks: ["scope"],
      });
    });

    it("names every part a file lacks, not only the first", () => {
      expect(
        classifyMigrationFile(
          facts({
            name: "1730000000000_create_posts.sql",
            content: `-- UP\n${createFile("posts", dialect, "comments")}`,
            dialect,
            hasSnapshot: true,
          })
        )
      ).toEqual({ kind: "partial", lacks: ["snapshot", "header", "scope"] });
    });
  }
);

describe("(a) the name", () => {
  const ordinary = (name: string) =>
    classifyMigrationFile(
      facts({ name, content: createFile("posts", "postgresql") })
    );

  it.each([
    ["a migrate:create name", "20261102_101010_123_create_posts.sql"],
    ["twelve digits", "173000000000_create_posts.sql"],
    ["fourteen digits", "17300000000000_create_posts.sql"],
    ["a verb the Builder never wrote", "1730000000000_alter_posts.sql"],
    ["not a .sql file", "1730000000000_create_posts.txt"],
  ])("%s is an ordinary file, whatever it holds", (_name, name) => {
    expect(ordinary(name)).toEqual({ kind: "ordinary" });
  });

  it("a migrate:create-named file whose snapshot is gone stays ordinary", () => {
    expect(
      classifyMigrationFile(
        facts({
          name: "20261102_101010_123_posts.sql",
          content: '-- UP\nCREATE TABLE "dc_posts" ("id" text);',
          hasSnapshot: false,
        })
      )
    ).toEqual({ kind: "ordinary" });
  });
});
