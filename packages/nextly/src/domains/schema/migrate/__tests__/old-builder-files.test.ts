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

// A bulk delete as the Builder names it: how many collections, then the first
// 12 hex digits of the SHA-256 of their names joined by commas, the names
// listed in its first line. The digests are pinned, so a change of the
// format fails here rather than agreeing with itself.
const BULK_HEADER = "-- Drop dynamic collections: ";
const POSTS_PAGES = "1730000000007_drop_2_collections_2ea79a92430d.sql";
const POSTS_TAGS = "1730000000016_drop_2_collections_a1124e786bf5.sql";

const facts = (
  over: Partial<MigrationFileFacts> & { name: string; content: string }
): MigrationFileFacts => ({
  hasSnapshot: false,
  hasDialectVariant: false,
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

    // The Builder never wrote a dialect variant: a variant is a migration as
    // any, and a base file with one beside it is the variant's migration too.
    it("reads a dialect variant of a Builder name as an ordinary file", () => {
      expect(
        old(
          "1730000000000_create_posts.mysql.sql",
          createFile("posts", dialect)
        )
      ).toEqual({ kind: "ordinary" });
    });

    it("(b) a dialect variant beside it makes it partial, lacking only that", () => {
      expect(
        classifyMigrationFile(
          facts({
            name: "1730000000000_create_posts.sql",
            content: createFile("posts", dialect),
            dialect,
            hasDialectVariant: true,
          })
        )
      ).toEqual({ kind: "partial", lacks: ["variant"] });
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

  it("recognises a bulk delete that drops only its named collections' tables", () => {
    expect(
      old(
        POSTS_PAGES,
        `${BULK_HEADER}posts, pages\n${drop(
          "dc_authors_dc_posts_tags",
          "dc_posts_locales",
          "dc_posts",
          "dc_pages"
        )}`
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
    // A collection's table the header does not name: another collection's.
    ["a collection it does not name", () => drop("dc_posts", "dc_comments")],
  ])("a bulk delete with %s is partial", (_name, content) => {
    expect(
      old(POSTS_PAGES, `${BULK_HEADER}posts, pages\n${content()}`)
    ).toEqual({
      kind: "partial",
      lacks: ["scope"],
    });
  });

  // The name's count and digest are derived from the header's names, so a
  // file whose three disagree was not written by the Builder: it may drop
  // anything under a name that looks like a bulk delete.
  it.each([
    [
      "the digest of other names",
      POSTS_TAGS,
      `${BULK_HEADER}comments, pages\n`,
      ["dc_comments", "dc_pages"],
    ],
    ["no header", POSTS_TAGS, "", ["dc_comments"]],
    [
      "a header naming more collections than its count",
      POSTS_TAGS,
      `${BULK_HEADER}posts, tags, comments\n`,
      ["dc_posts", "dc_tags", "dc_comments"],
    ],
    [
      "a count other than its names'",
      "1730000000007_drop_3_collections_a1124e786bf5.sql",
      `${BULK_HEADER}posts, tags\n`,
      ["dc_posts", "dc_tags"],
    ],
    [
      "one collection, which the Builder names by its slug",
      "1730000000007_drop_1_collections_a44f1b975171.sql",
      "-- Drop dynamic collection: posts\n",
      ["dc_posts"],
    ],
  ])("a bulk delete with %s is partial", (_name, name, header, tables) => {
    expect(old(name, `${header}${drop(...tables)}`)).toEqual({
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
    // Each collection's custom junction names, as its own fields declare them.
    const declared = new Map([["posts", new Set(["post_tag_links"])]]);
    const classify = (
      name: string,
      content: string,
      junctions?: ReadonlyMap<string, ReadonlySet<string>>
    ) =>
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

    // An update touching a custom junction nothing declares stays partial: no
    // name in it ties the table to the collection.
    const alter = `ALTER TABLE ${q("post_tag_links", dialect)} ADD COLUMN ${q("x", dialect)} text;`;
    it.each([
      ["no names are declared", undefined],
      [
        "the name is not among them",
        new Map([["posts", new Set(["other_links"])]]),
      ],
      // Declared, but by another collection's field: not this entity's own.
      [
        "another collection declares it",
        new Map([["authors", new Set(["post_tag_links"])]]),
      ],
    ])("keeps an update file partial when %s", (_n, junctions) => {
      expect(
        classify("1730000000014_update_posts.sql", alter, junctions)
      ).toEqual({ kind: "partial", lacks: ["scope"] });
    });

    it("ignores an update to the entity's own declared junction", () => {
      expect(
        classify("1730000000014_update_posts.sql", alter, declared)
      ).toEqual({ kind: "old-builder", entity: "posts" });
    });

    // A delete removes the collection from the manifest, so its custom
    // junction is declared by nothing once the drop file exists. In a drop
    // file, a table dropped alongside the entity's own main table is the
    // entity's when its name can be no other entity's and no core table's.
    const dropping = (...tables: string[]) =>
      tables.map(t => `DROP TABLE IF EXISTS ${q(t, dialect)};`).join("\n");

    it("ignores a delete that drops an undeclared junction with its table", () => {
      expect(
        classify(
          "1730000000012_drop_posts.sql",
          dropping("dc_posts", "post_tag_links")
        )
      ).toEqual({ kind: "old-builder", entity: "posts" });
    });

    it.each([
      ["the entity's own table is not dropped with it", ["post_tag_links"]],
      ["the other table is another collection's", ["dc_posts", "dc_comments"]],
      ["the other table is a field group's", ["dc_posts", "comp_hero"]],
      ["the other table is a core table", ["dc_posts", "users"]],
      ["the other table is the user-field table", ["dc_posts", "user_ext"]],
    ])("keeps a delete partial when %s", (_n, tables) => {
      expect(
        classify("1730000000012_drop_posts.sql", dropping(...tables))
      ).toEqual({ kind: "partial", lacks: ["scope"] });
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

// An `_i18n_` file that turned translation off kept the values first: the
// shared archive, created if absent, and the entity's own values copied into
// it under its own slug. Only in an `_i18n_` file, and only for its entity.
describe("an old _i18n_ file that archives translations", () => {
  const archive = (slug: string, from: string) =>
    [
      `CREATE TABLE IF NOT EXISTS "nextly_i18n_archive" ("id" serial PRIMARY KEY, "collection" text)`,
      `CREATE INDEX IF NOT EXISTS "nextly_i18n_archive_lookup_idx" ON "nextly_i18n_archive" ("collection")`,
      `INSERT INTO "nextly_i18n_archive" ("collection", "entity_kind", "entry_id", "locale", "field", "value") ` +
        `SELECT '${slug}', 'collection', src."_parent", src."_locale", 'title', src."title" ` +
        `FROM "${from}" src WHERE src."_locale" <> 'en'`,
      `DROP TABLE IF EXISTS "dc_posts_locales"`,
    ].join(`;${BREAK}`) + ";";
  const classify = (name: string, content: string) =>
    classifyMigrationFile(facts({ name, content, dialect: "postgresql" }));

  it.each([
    ["an _i18n_ file", "1730000000015_i18n_posts.sql"],
    // A field moved out of translation while localization stays on.
    ["an _update_ file", "1730000000015_update_posts.sql"],
  ])("ignores the archive of the entity's own values in %s", (_n, name) => {
    expect(classify(name, archive("posts", "dc_posts_locales"))).toEqual({
      kind: "old-builder",
      entity: "posts",
    });
  });

  it.each([
    [
      "under another entity's slug",
      "1730000000015_i18n_posts.sql",
      archive("comments", "dc_posts_locales"),
    ],
    [
      "from another entity's table",
      "1730000000015_i18n_posts.sql",
      archive("posts", "dc_comments_locales"),
    ],
    [
      "in a create file",
      "1730000000015_create_posts.sql",
      archive("posts", "dc_posts_locales"),
    ],
  ])("is partial for an archive %s", (_n, name, content) => {
    expect(classify(name, content)).toEqual({
      kind: "partial",
      lacks: ["scope"],
    });
  });
});

// A delete of several collections drops their custom junctions in the same
// bulk file: a table dropped alongside the `dc_` tables is one of theirs when
// its name can be no other entity's and no core table's.
describe("a bulk delete with a custom junction", () => {
  const bulk = (...tables: string[]) =>
    classifyMigrationFile(
      facts({
        name: POSTS_TAGS,
        content: `${BULK_HEADER}posts, tags\n${tables
          .map(t => `DROP TABLE IF EXISTS "${t}";`)
          .join("\n")}`,
      })
    );

  it("ignores the drop of the collections and their junction", () => {
    expect(bulk("dc_posts", "dc_tags", "post_tag_links").kind).toBe(
      "old-builder"
    );
  });

  it.each([
    ["the junction without any collection", ["post_tag_links"]],
    ["a core table", ["dc_posts", "users"]],
    ["a field group's table", ["dc_posts", "comp_hero"]],
  ])("is partial for %s", (_n, tables) => {
    expect(bulk(...tables)).toEqual({ kind: "partial", lacks: ["scope"] });
  });
});

// An index on a column whose name holds an underscore reads two ways:
// `idx_dc_posts_publish_date` is dc_posts' `publish_date` or a table
// `dc_posts_publish`'s `date`. A longer reading defeats the entity's own
// only when that table is declared; with nothing declared, any table named
// like an entity's defeats it, which fails closed.
describe("an index whose column holds an underscore", () => {
  const drop = (index: string, declaredTables?: Set<string>) =>
    classifyMigrationFile(
      facts({
        name: "1730000000017_update_posts.sql",
        content: `ALTER TABLE "dc_posts" DROP COLUMN "publish_date";${BREAK}DROP INDEX IF EXISTS "${index}";`,
        ...(declaredTables ? { declaredTables } : {}),
      })
    );
  const declared = new Set(["dc_posts", "dc_posts_archive"]);

  it("is the entity's when the longer table is not declared", () => {
    expect(drop("idx_dc_posts_publish_date", declared)).toEqual({
      kind: "old-builder",
      entity: "posts",
    });
  });

  it("is not the entity's while the longer table is declared", () => {
    expect(drop("idx_dc_posts_archive_title", declared)).toEqual({
      kind: "partial",
      lacks: ["scope"],
    });
  });

  it("is not the entity's when nothing is declared", () => {
    expect(drop("idx_dc_posts_publish_date")).toEqual({
      kind: "partial",
      lacks: ["scope"],
    });
  });
});

// A junction's table is named after the tables it joins, so another collection's main table can
// read as one: `posts-dc-comments-secret` makes `dc_posts_dc_comments_secret`, which reads as a
// junction of `dc_posts`. While that table is declared, it is that collection's, not a junction.
describe("a junction-shaped name that is another collection's table", () => {
  const update = (declaredTables?: Set<string>) =>
    classifyMigrationFile(
      facts({
        name: "1730000000018_update_posts.sql",
        content: `ALTER TABLE "dc_posts_dc_comments_secret" ADD COLUMN "x" text;`,
        ...(declaredTables ? { declaredTables } : {}),
      })
    );

  it("is not the entity's while that table is declared", () => {
    expect(
      update(new Set(["dc_posts", "dc_posts_dc_comments_secret"]))
    ).toEqual({ kind: "partial", lacks: ["scope"] });
  });

  it("is the entity's junction while no collection declares that table", () => {
    expect(update(new Set(["dc_posts"]))).toEqual({
      kind: "old-builder",
      entity: "posts",
    });
  });
});

// A quoted name in another case is another table on PostgreSQL: a file altering "DC_POSTS" is not
// the posts collection's.
describe("a quoted table name in another case", () => {
  it("makes an update file partial", () => {
    expect(
      classifyMigrationFile(
        facts({
          name: "1730000000019_update_posts.sql",
          content: `ALTER TABLE "DC_POSTS" ADD COLUMN "x" text;`,
        })
      )
    ).toEqual({ kind: "partial", lacks: ["scope"] });
  });
});
