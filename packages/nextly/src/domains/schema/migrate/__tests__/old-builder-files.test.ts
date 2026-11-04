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
            `${createFile("posts", dialect)};${BREAK}ALTER TABLE ${q(table, dialect)} ADD COLUMN ${q("x", dialect)} text;`
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

    it("(d) a statement run with its own registry row, for want of a ;, makes it partial", () => {
      // The runner splits at `;` only, so this ALTER runs as part of the upsert.
      expect(
        old(
          "1730000000000_create_posts.sql",
          `${createFile("posts", dialect)}${BREAK}ALTER TABLE ${q("nextly_users", dialect)} ADD COLUMN ${q("x", dialect)} text;`
        )
      ).toEqual({ kind: "partial", lacks: ["scope"] });
    });

    it("(d) a statement it cannot read makes it partial", () => {
      expect(
        old(
          "1730000000000_create_posts.sql",
          `${createFile("posts", dialect)};${BREAK}GRANT ALL ON ${q("dc_posts", dialect)} TO someone;`
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

// The drop files the old Builder wrote: one collection's, a field group's, a
// bulk delete of several collections, and the user-field table's. Each is old
// only when every statement is a DROP TABLE of tables the Builder owns.
describe.each<Dialect>(["postgresql", "mysql"])("drop files on %s", dialect => {
  const old = (name: string, content: string) =>
    classifyMigrationFile(facts({ name, content, dialect }));
  const drop = (...tables: string[]) =>
    tables.map(t => `DROP TABLE IF EXISTS ${q(t, dialect)};`).join("\n");

  it("recognises a bulk delete that drops only Builder collections' tables", () => {
    expect(
      old(
        "1730000000007_drop_2_collections_0123456789ab.sql",
        drop(
          "dc_authors_dc_posts_tags",
          "dc_posts_locales",
          "dc_posts",
          "dc_pages"
        )
      ).kind
    ).toBe("old-builder");
  });

  it.each([
    ["a table no collection owns", () => drop("dc_posts", "nextly_users")],
    [
      "a statement that is not a drop",
      () =>
        `${drop("dc_posts")}\nALTER TABLE ${q("dc_pages", dialect)} ADD COLUMN ${q("x", dialect)} text;`,
    ],
  ])("a bulk delete with %s is partial", (_name, content) => {
    expect(
      old("1730000000007_drop_2_collections_0123456789ab.sql", content())
    ).toEqual({
      kind: "partial",
      lacks: ["scope"],
    });
  });

  it("recognises the user-field table's drop, and only that table", () => {
    expect(old("1730000000008_drop_user_ext.sql", drop("user_ext")).kind).toBe(
      "old-builder"
    );
    expect(
      old("1730000000008_drop_user_ext.sql", drop("user_ext", "dc_posts"))
    ).toEqual({
      kind: "partial",
      lacks: ["scope"],
    });
  });

  // A collection's slug can spell another kind's drop name: slug `user_ext`
  // gives `_drop_user_ext`, slug `comp_news` gives `_drop_comp_news`. Each
  // reading the name allows is tried, and the file is old when it fits one.
  it.each([
    ["user_ext", "1730000000009_drop_user_ext.sql", "dc_user_ext"],
    ["comp_news", "1730000000010_drop_comp_news.sql", "dc_comp_news"],
  ])(
    "recognises the drop of a collection whose slug is %s",
    (slug, name, table) => {
      expect(old(name, drop(table))).toEqual({
        kind: "old-builder",
        entity: slug,
      });
    }
  );

  it("is partial when a drop mixes two readings of its name", () => {
    expect(
      old("1730000000009_drop_user_ext.sql", drop("user_ext", "dc_user_ext"))
    ).toEqual({ kind: "partial", lacks: ["scope"] });
  });

  it.each([
    ["a collection's", "1730000000004_drop_posts.sql", "dc_posts"],
    ["a field group's", "1730000000005_drop_comp_hero.sql", "comp_hero"],
  ])(
    "%s drop file with a statement that is not a drop is partial",
    (_n, name, table) => {
      expect(
        old(
          name,
          `${drop(table)}\nALTER TABLE ${q(table, dialect)} ADD COLUMN ${q("x", dialect)} text;`
        )
      ).toEqual({ kind: "partial", lacks: ["scope"] });
    }
  );

  it("a field group's drop of another field group's table is partial", () => {
    expect(
      old("1730000000005_drop_comp_hero.sql", drop("comp_footer"))
    ).toEqual({
      kind: "partial",
      lacks: ["scope"],
    });
  });
});

// A table-less DROP INDEX (PostgreSQL's and SQLite's form) names no table, so
// its table is traced from the index name: exactly the one-column index name,
// plain or unique, of one of the entity's own tables. A name that cannot be
// traced, or that another entity's table explains as well, makes the file
// partial.
describe.each(["postgresql", "sqlite"] as const)(
  "classifyMigrationFile on a dropped index, %s",
  dialect => {
    const update = (...statements: string[]) =>
      classifyMigrationFile(
        facts({
          name: "1730000000006_update_posts.sql",
          content: [
            `ALTER TABLE "dc_posts" DROP COLUMN "title";`,
            ...statements,
          ].join(BREAK),
          dialect,
        })
      );
    const ignored = { kind: "old-builder", entity: "posts" };
    const partial = { kind: "partial", lacks: ["scope"] };

    it.each([
      [
        "a plain index on its own table",
        `DROP INDEX IF EXISTS "idx_dc_posts_title";`,
      ],
      [
        "a unique index on its own table",
        `DROP INDEX IF EXISTS "uq_dc_posts_title";`,
      ],
      [
        "an index on its translation table",
        `DROP INDEX "idx_dc_posts_locales_title";`,
      ],
    ])("traces %s", (_n, sql) => {
      expect(update(sql)).toEqual(ignored);
    });

    // A junction's index names its junction, which may start with the other
    // side's table: the longest table the name traces to decides.
    it("traces a junction index whose name starts with the other side's table", () => {
      expect(
        update(`DROP INDEX IF EXISTS "idx_dc_authors_dc_posts_writers_posts";`)
      ).toEqual(ignored);
    });

    it.each([
      [
        "another entity's index",
        `DROP INDEX IF EXISTS "idx_dc_comments_title";`,
      ],
      [
        "a name another entity's table explains as well",
        `DROP INDEX IF EXISTS "idx_dc_posts_archive_title";`,
      ],
      [
        "an index name of no column",
        `DROP INDEX IF EXISTS "dc_posts_title_key";`,
      ],
      [
        "a name at the bound, which may be a cut one",
        `DROP INDEX IF EXISTS "idx_dc_posts_${"a".repeat(63 - "idx_dc_posts_".length)}";`,
      ],
      [
        "a drop that cascades",
        `DROP INDEX IF EXISTS "idx_dc_posts_title" CASCADE;`,
      ],
    ])("does not trace %s", (_n, sql) => {
      expect(update(sql)).toEqual(partial);
    });
  }
);

// A many-to-many field can name its own junction table, a name nothing ties
// to the collection. The names the configuration and the Builder's manifest
// declare are handed in and count as the entity's own; any other name stays
// partial, so a file touching it is never set aside on a guess.
describe.each<Dialect>(["postgresql", "mysql"])(
  "a declared junction table on %s",
  dialect => {
    const declared = new Set(["post_tag_links"]);
    const classify = (name: string, content: string, junctions?: Set<string>) =>
      classifyMigrationFile(
        facts({
          name,
          content,
          dialect,
          ...(junctions ? { declaredJunctions: junctions } : {}),
        })
      );
    const create = `CREATE TABLE ${q("dc_posts", dialect)} (${q("id", dialect)} text);${BREAK}CREATE TABLE ${q("post_tag_links", dialect)} (${q("id", dialect)} text);`;
    const drop = `DROP TABLE IF EXISTS ${q("dc_posts", dialect)};\nDROP TABLE IF EXISTS ${q("post_tag_links", dialect)};`;

    it("ignores a create file that builds a declared junction", () => {
      expect(
        classify("1730000000011_create_posts.sql", create, declared)
      ).toEqual({ kind: "old-builder", entity: "posts" });
    });

    it("ignores a drop file that drops a declared junction", () => {
      expect(classify("1730000000012_drop_posts.sql", drop, declared)).toEqual({
        kind: "old-builder",
        entity: "posts",
      });
    });

    it.each([
      ["no names are declared", undefined],
      ["the name is not among them", new Set(["other_links"])],
    ])("keeps the file partial when %s", (_n, junctions) => {
      expect(classify("1730000000012_drop_posts.sql", drop, junctions)).toEqual(
        { kind: "partial", lacks: ["scope"] }
      );
    });
  }
);

// Renames a Builder update writes: a junction's table and its indexes. A
// rename into another entity's address leaves the entity, so the file is
// partial; one whose both names are the entity's stays inside it.
describe("renames in an update file", () => {
  const update = (...statements: string[]) =>
    classifyMigrationFile(
      facts({
        name: "1730000000013_update_posts.sql",
        content: statements.join(BREAK),
        dialect: "postgresql",
      })
    );

  it("ignores a rename of the entity's junction and its index", () => {
    expect(
      update(
        `ALTER TABLE "dc_authors_dc_posts_writers" RENAME TO "dc_authors_dc_posts_editors";`,
        `ALTER INDEX "idx_dc_authors_dc_posts_writers_posts" RENAME TO "idx_dc_authors_dc_posts_editors_posts";`
      )
    ).toEqual({ kind: "old-builder", entity: "posts" });
  });

  it.each([
    [
      "a table into another entity's address",
      `ALTER TABLE "dc_posts" RENAME TO "dc_comments";`,
    ],
    [
      "an index into another entity's name",
      `ALTER INDEX "idx_dc_posts_title" RENAME TO "idx_dc_comments_title";`,
    ],
  ])("is partial for a rename of %s", (_n, sql) => {
    expect(update(sql)).toEqual({ kind: "partial", lacks: ["scope"] });
  });
});
