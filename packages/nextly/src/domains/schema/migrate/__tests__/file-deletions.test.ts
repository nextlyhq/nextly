/**
 * Which deletions `fileDeletions` reads from a statement list, per dialect,
 * asserted on the whole list against fake live facts.
 *
 * The facts answer EXACTLY by lower-cased name, so a reader that forgets to
 * fold a quoted or backtick name asks for a name the fake does not have. Each
 * cell is chosen so the plausible broken readers give a different list: one
 * that reads a header comment or a string literal instead of the code, one
 * that reads a SQLite rebuild as the drop of its table, one that ignores the
 * cascades a removal of rows reaches (or names nothing when they cannot be
 * read), and one that counts an UPDATE as a deletion.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import type { Deletion } from "../data-loss-consent";
import {
  fileDeletions,
  runDeletions,
  type DeletionFacts,
  type NulledColumn,
} from "../file-deletions";

/** What the fake database answers, every name lower-case. */
interface Facts {
  /** Per table, what a DELETE cascades to; a table left out cascades nowhere. Undefined: unreadable. */
  cascade?: Record<string, readonly string[] | undefined>;
  /** Per table, what PostgreSQL's TRUNCATE CASCADE empties; as `cascade`. */
  truncate?: Record<string, readonly string[] | undefined>;
  /** Per table, each live column and its declared type as SQLite reports it. */
  columns?: Record<string, Record<string, string>>;
  /** Per table, the columns a DELETE blanks through SET NULL keys; as `cascade`. */
  nulled?: Record<string, readonly NulledColumn[] | undefined>;
  /** The user-defined functions, or "unreadable"; none when left out. */
  functions?: readonly string[] | "unreadable";
  /** Judge a rebuild of an unseen table as `migrate:check` does. */
  deferred?: boolean;
}

/** Live facts answering exactly from `facts`, with no case folding. */
function fake(facts: Facts = {}): DeletionFacts {
  const answer =
    (map: Record<string, readonly string[] | undefined> | undefined) =>
    (table: string) => (map !== undefined && table in map ? map[table] : []);
  const tables = Object.entries(facts.columns ?? {});
  const nulled = facts.nulled;
  return {
    cascadeFrom: answer(facts.cascade),
    truncateCascadeFrom: answer(facts.truncate),
    nulledBy: table =>
      nulled !== undefined && table in nulled ? nulled[table] : [],
    ...(facts.functions === "unreadable"
      ? {}
      : { userFunctions: new Set(facts.functions ?? []) }),
    ...(facts.deferred === true ? { unseenRebuild: "deferred" as const } : {}),
    liveColumns: new Map(
      tables.map(([table, columns]) => [table, new Set(Object.keys(columns))])
    ),
    liveColumnTypes: new Map(
      tables.map(([table, columns]) => [
        table,
        new Map(Object.entries(columns)),
      ])
    ),
  };
}

const read = (
  dialect: SupportedDialect,
  statements: string[],
  facts?: Facts
): Deletion[] => fileDeletions(statements, dialect, fake(facts));

const table = (name: string): Deletion => ({ kind: "table", table: name });
const column = (on: string, name: string): Deletion => ({
  kind: "column",
  table: on,
  column: name,
});
const rows = (name: string): Deletion => ({ kind: "rows", table: name });
const unnamed = (description: string): Deletion => ({
  kind: "unnamed",
  description,
});
/** The deletion an unread statement stands for, fingerprinted by its text. */
const unreadAs = (description: string, statement: string): Deletion => ({
  kind: "unnamed",
  description,
  fingerprint: createHash("sha256").update(statement).digest("hex"),
});

describe("tables dropped", () => {
  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "names each table a DROP TABLE drops on %s, and none it created first",
    dialect => {
      expect(
        read(dialect, [
          "CREATE TABLE scratch (id integer)",
          "INSERT INTO scratch (id) SELECT id FROM posts",
          "DROP TABLE IF EXISTS Posts, scratch, pages",
        ])
      ).toEqual([table("posts"), table("pages")]);
    }
  );

  it("counts a table created IF NOT EXISTS as live: it may have been there", () => {
    expect(
      read("postgresql", [
        "CREATE TABLE IF NOT EXISTS posts (id integer)",
        "DROP TABLE posts",
      ])
    ).toEqual([table("posts")]);
  });

  it("names a table dropped under a name the file renamed it to by its live name", () => {
    expect(
      read("postgresql", [
        "ALTER TABLE posts RENAME TO old_posts",
        "DROP TABLE old_posts",
      ])
    ).toEqual([table("posts")]);
    expect(
      read("mysql", ["RENAME TABLE `posts` TO `old`", "DROP TABLE `old`"])
    ).toEqual([table("posts")]);
  });

  it("reads MariaDB's CREATE OR REPLACE TABLE as the drop it starts with", () => {
    expect(
      read("mysql", ["CREATE OR REPLACE TABLE posts (id integer)"])
    ).toEqual([table("posts")]);
  });

  it("reads the statements, never a header comment above them", () => {
    expect(
      read("postgresql", [
        "-- nextly:destructive none\n-- drops nothing\nDROP TABLE posts",
      ])
    ).toEqual([table("posts")]);
    expect(
      read("postgresql", [
        "-- DROP TABLE posts\nSELECT 1",
        "/* DELETE */ SELECT 2",
      ])
    ).toEqual([]);
  });
});

describe("columns dropped or converted", () => {
  it("names each column of a multi-clause DROP COLUMN, and no constraint or index", () => {
    expect(
      read("postgresql", [
        'ALTER TABLE posts DROP COLUMN a, DROP COLUMN IF EXISTS "B", DROP CONSTRAINT posts_fk',
      ])
    ).toEqual([column("posts", "a"), column("posts", "b")]);
    expect(
      read("mysql", [
        "ALTER TABLE `posts` DROP `a`, DROP INDEX posts_ix, DROP FOREIGN KEY posts_fk",
      ])
    ).toEqual([column("posts", "a")]);
    expect(read("sqlite", ["ALTER TABLE posts DROP COLUMN a"])).toEqual([
      column("posts", "a"),
    ]);
  });

  it("names a column dropped under a name the file renamed it to by its live name", () => {
    expect(
      read("postgresql", [
        "ALTER TABLE posts RENAME COLUMN a TO b",
        "ALTER TABLE posts DROP COLUMN b",
      ])
    ).toEqual([column("posts", "a")]);
  });

  it("names a column whose type PostgreSQL changes, and not one whose default changes", () => {
    expect(
      read("postgresql", [
        "ALTER TABLE posts ALTER COLUMN title TYPE varchar(10) USING title::varchar",
        "ALTER TABLE posts ALTER body SET DATA TYPE text",
        "ALTER TABLE posts ALTER COLUMN slug SET DEFAULT 'DROP'",
        "ALTER TABLE posts ALTER COLUMN slug DROP NOT NULL",
      ])
    ).toEqual([column("posts", "title"), column("posts", "body")]);
  });

  it("names a column MySQL's MODIFY or CHANGE restates, CHANGE by its old name", () => {
    expect(
      read("mysql", [
        "ALTER TABLE posts MODIFY COLUMN title text NOT NULL",
        "ALTER TABLE posts CHANGE COLUMN a b varchar(10)",
        "ALTER TABLE posts DROP COLUMN b",
        "ALTER TABLE posts ALTER COLUMN slug SET DEFAULT 'x'",
      ])
    ).toEqual([column("posts", "title"), column("posts", "a")]);
  });

  it("names nothing for a column added", () => {
    expect(
      read("postgresql", [
        "ALTER TABLE posts ADD COLUMN body text DEFAULT replace('a', 'b', 'c')",
      ])
    ).toEqual([]);
  });
});

describe("rows removed", () => {
  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "names a DELETE's table with or without a condition, once, on %s",
    dialect => {
      expect(
        read(dialect, [
          "DELETE FROM posts WHERE id = 1",
          "DELETE FROM posts",
          "DELETE FROM pages",
        ])
      ).toEqual([rows("posts"), rows("pages")]);
    }
  );

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "names nothing for an UPDATE, which keeps its rows, on %s",
    dialect => {
      expect(
        read(
          dialect,
          [
            "UPDATE posts SET title = replace(title, 'a', 'b') WHERE id = 1",
            "INSERT INTO posts (id) VALUES (1)",
          ],
          { cascade: { posts: ["comments"] } }
        )
      ).toEqual([]);
    }
  );

  it("names each table TRUNCATE empties on PostgreSQL and MySQL, and none on SQLite, which has no TRUNCATE", () => {
    expect(
      read("postgresql", ["TRUNCATE TABLE posts, ONLY pages RESTART IDENTITY"])
    ).toEqual([rows("posts"), rows("pages")]);
    expect(read("mysql", ["TRUNCATE TABLE `posts`"])).toEqual([rows("posts")]);
    expect(read("sqlite", ["TRUNCATE posts"])).toEqual([]);
  });

  it("names a REPLACE INTO's table on MySQL, and not an INSERT that updates on a duplicate", () => {
    expect(
      read("mysql", [
        "REPLACE INTO posts (id, title) VALUES (1, 'a')",
        "INSERT INTO pages (id) VALUES (1) ON DUPLICATE KEY UPDATE id = id",
      ])
    ).toEqual([rows("posts")]);
    expect(
      read("sqlite", ["INSERT OR REPLACE INTO posts (id) VALUES (1)"])
    ).toEqual([rows("posts")]);
  });

  it("names every table a DELETE's cascades reach, as the facts give them", () => {
    expect(
      read("postgresql", ["DELETE FROM a WHERE id = 1"], {
        cascade: { a: ["b", "c"] },
      })
    ).toEqual([rows("a"), rows("b"), rows("c")]);
  });

  it("stands for cascades that could not be read with a deletion only blanket consent covers", () => {
    expect(
      read("mysql", ["DELETE FROM a"], { cascade: { a: undefined } })
    ).toEqual([
      rows("a"),
      unnamed(
        "rows removed from tables a's foreign keys cascade to, which could not be read"
      ),
    ]);
  });

  it("fails closed for a table the live database does not have yet, whose keys nobody can read", () => {
    // `readDeletionFacts` answers undefined for such a table; the reader
    // turns that into the deletion only blanket consent covers.
    expect(
      read("postgresql", ["DELETE FROM created_by_an_earlier_file"], {
        cascade: { created_by_an_earlier_file: undefined },
      })
    ).toEqual([
      rows("created_by_an_earlier_file"),
      unnamed(
        "rows removed from tables created_by_an_earlier_file's foreign keys cascade to, which could not be read"
      ),
    ]);
  });

  it("names what PostgreSQL's TRUNCATE CASCADE empties, and nothing more for a TRUNCATE without it", () => {
    const facts = {
      truncate: { a: ["b", "d"] },
      cascade: { a: ["never"] },
    };
    expect(read("postgresql", ["TRUNCATE a CASCADE"], facts)).toEqual([
      rows("a"),
      rows("b"),
      rows("d"),
    ]);
    expect(read("postgresql", ["TRUNCATE a"], facts)).toEqual([rows("a")]);
    expect(
      read("postgresql", ["TRUNCATE a CASCADE"], { truncate: { a: undefined } })
    ).toEqual([
      rows("a"),
      unnamed(
        "rows removed from tables TRUNCATE a CASCADE also empties, which could not be read"
      ),
    ]);
  });
});

describe("SQLite rebuilds", () => {
  const live = {
    columns: {
      posts: { id: "integer", title: "text", body: "varchar(64)" },
    },
  };
  /** A rebuild of posts as the pipeline writes it, with `twin` and `copy` replaceable. */
  const rebuild = (
    twin = "`id` integer PRIMARY KEY NOT NULL, `title` text NOT NULL, `body` VARCHAR (64)",
    copy:
      | string
      | null = 'INSERT INTO `__new_posts`("id", "title", "body") SELECT "id", "title", "body" FROM `posts`'
  ) => [
    "PRAGMA foreign_keys=OFF",
    `CREATE TABLE \`__new_posts\` (${twin}, CONSTRAINT posts_ck CHECK (length(title) > 0))`,
    ...(copy === null ? [] : [copy]),
    "DROP TABLE `posts`",
    "ALTER TABLE `__new_posts` RENAME TO `posts`",
    "PRAGMA foreign_keys=ON",
  ];

  it("names nothing for a rebuild that carries every column, copies every row and converts nothing", () => {
    expect(read("sqlite", rebuild(), live)).toEqual([]);
  });

  it("names only the column a rebuild leaves out, never the table", () => {
    expect(
      read(
        "sqlite",
        rebuild(
          "`id` integer PRIMARY KEY NOT NULL, `title` text NOT NULL",
          'INSERT INTO `__new_posts`("id", "title") SELECT "id", "title" FROM `posts`'
        ),
        live
      )
    ).toEqual([column("posts", "body")]);
  });

  it("names the rows of a rebuild whose copy filters them, or that copies none", () => {
    expect(
      read(
        "sqlite",
        rebuild(
          undefined,
          'INSERT INTO `__new_posts`("id", "title", "body") SELECT "id", "title", "body" FROM `posts` WHERE id > 10'
        ),
        live
      )
    ).toEqual([rows("posts")]);
    expect(read("sqlite", rebuild(undefined, null), live)).toEqual([
      rows("posts"),
    ]);
  });

  it("names a column the rebuild converts to another type", () => {
    expect(
      read(
        "sqlite",
        rebuild(
          "`id` integer PRIMARY KEY NOT NULL, `title` integer NOT NULL, `body` varchar(64)"
        ),
        live
      )
    ).toEqual([column("posts", "title")]);
  });

  it("names a column whose copy fills it from something else", () => {
    expect(
      read(
        "sqlite",
        rebuild(
          undefined,
          'INSERT INTO `__new_posts`("id", "title", "body") SELECT "id", "title", \'\' FROM `posts`'
        ),
        live
      )
    ).toEqual([column("posts", "body")]);
  });

  it("names nothing for the twin dropped again after the rename", () => {
    expect(
      read("sqlite", [...rebuild(), "DROP TABLE IF EXISTS `__new_posts`"], live)
    ).toEqual([]);
  });

  it("reads a rebuild of a table whose live columns were not read as the drop it then is", () => {
    expect(read("sqlite", rebuild())).toEqual([table("posts")]);
  });

  it("reads the same statements on PostgreSQL as the drop they are there", () => {
    // PostgreSQL quotes names with double quotes, not backticks.
    const statements = rebuild()
      .slice(1, -1)
      .map(statement => statement.replaceAll("`", '"'));
    expect(read("postgresql", statements, live)).toEqual([table("posts")]);
  });
});

describe("foreign keys and columns the list itself adds", () => {
  it("follows a cascade key an earlier statement adds, naming the live child's rows", () => {
    for (const dialect of ["postgresql", "mysql"] as const) {
      expect(
        read(dialect, [
          "ALTER TABLE comments ADD CONSTRAINT fk FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE",
          "DELETE FROM posts WHERE draft",
        ])
      ).toEqual([rows("posts"), rows("comments")]);
    }
  });

  it("names the key columns a SET NULL or SET DEFAULT key blanks, live or added", () => {
    expect(
      read("postgresql", ["DELETE FROM authors"], {
        nulled: { authors: [{ table: "posts", column: "author_id" }] },
      })
    ).toEqual([rows("authors"), column("posts", "author_id")]);
    expect(
      read("postgresql", [
        "ALTER TABLE posts ADD COLUMN editor_id integer REFERENCES authors (id) ON DELETE SET NULL",
        "DELETE FROM authors",
      ])
    ).toEqual([rows("authors")]);
    expect(
      read("mysql", [
        "ALTER TABLE posts ADD FOREIGN KEY fk_editor (editor_id) REFERENCES authors (id) ON DELETE SET DEFAULT",
        "DELETE FROM authors",
      ])
    ).toEqual([rows("authors"), column("posts", "editor_id")]);
  });

  it("follows an added cascade from a table the list made into a live child", () => {
    expect(
      read("postgresql", [
        "CREATE TABLE drafts (id integer PRIMARY KEY)",
        "ALTER TABLE posts ADD CONSTRAINT fk FOREIGN KEY (draft_id) REFERENCES drafts (id) ON DELETE CASCADE",
        "DELETE FROM drafts",
      ])
    ).toEqual([rows("posts")]);
  });

  it("ignores a key added before nothing removes rows, and one that does nothing on delete", () => {
    expect(
      read("postgresql", [
        "DELETE FROM posts",
        "ALTER TABLE comments ADD CONSTRAINT fk FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE",
        "ALTER TABLE tags ADD CONSTRAINT fk FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE RESTRICT",
      ])
    ).toEqual([rows("posts")]);
  });

  it("asks nothing for a column the list adds and drops again, renamed or not", () => {
    expect(
      read("postgresql", [
        "ALTER TABLE posts ADD COLUMN tmp text",
        "ALTER TABLE posts RENAME COLUMN tmp TO scratch",
        "ALTER TABLE posts DROP COLUMN scratch",
        "ALTER TABLE posts ADD COLUMN IF NOT EXISTS other text",
        "ALTER TABLE posts ALTER COLUMN other TYPE integer",
      ])
    ).toEqual([]);
    expect(read("postgresql", ["ALTER TABLE posts DROP COLUMN tmp"])).toEqual([
      column("posts", "tmp"),
    ]);
  });

  it("gives a name back to its live table once the temporary table shadowing it is dropped", () => {
    expect(
      read("postgresql", [
        "CREATE TEMP TABLE posts AS SELECT * FROM posts WHERE draft",
        "DELETE FROM posts",
        "DROP TABLE posts",
        "DELETE FROM posts WHERE id = 1",
      ])
    ).toEqual([rows("posts")]);
  });
});

describe("MySQL statements that drop rows or data without saying so", () => {
  it("reads ALTER IGNORE TABLE and DISCARD TABLESPACE as statements that may delete", () => {
    const ignore = "ALTER IGNORE TABLE users ADD UNIQUE INDEX (email)";
    const discard = "ALTER TABLE users DISCARD TABLESPACE";
    expect(read("mysql", [ignore, discard])).toEqual([
      unreadAs(
        "ALTER IGNORE TABLE USERS ADD UNIQUE INDEX (not read, may delete data)",
        ignore
      ),
      unreadAs(
        "ALTER TABLE USERS DISCARD TABLESPACE (not read, may delete data)",
        discard
      ),
    ]);
  });
});

describe("SELECT calling a function", () => {
  const purge = "SELECT purge_old_posts()";
  const label = "SELECT PURGE_OLD_POSTS (calls a function, may delete data)";

  it("stands for a call to a user-defined function, which runs code, with a fingerprinted deletion", () => {
    expect(
      read("postgresql", [purge], { functions: ["purge_old_posts"] })
    ).toEqual([unreadAs(label, purge)]);
  });

  it("asks nothing for a built-in, setval, or a pg_catalog call", () => {
    expect(
      read(
        "postgresql",
        [
          "SELECT count(*) FROM posts",
          "SELECT setval('posts_id_seq', 10)",
          "SELECT pg_catalog.set_config('search_path', '', false)",
        ],
        { functions: ["purge_old_posts"] }
      )
    ).toEqual([]);
  });

  it("stands for a call to a function the list itself defines, and for any call when the functions were not read", () => {
    const create =
      "CREATE OR REPLACE FUNCTION purge_old_posts() RETURNS void AS $$ DELETE FROM posts $$ LANGUAGE sql";
    expect(read("postgresql", [create, purge])).toEqual([
      unreadAs(label, purge),
    ]);
    expect(read("postgresql", [purge], { functions: "unreadable" })).toEqual([
      unreadAs(label, purge),
    ]);
  });
});

describe("a rebuild migrate:check cannot see", () => {
  const rebuild = (copy: string) => [
    "CREATE TABLE `__new_posts` (`id` integer PRIMARY KEY, `title` text NOT NULL)",
    copy,
    "DROP TABLE `posts`",
    "ALTER TABLE `__new_posts` RENAME TO `posts`",
  ];

  it("asks nothing when the copy carries every declared column and every row", () => {
    expect(
      read(
        "sqlite",
        rebuild(
          'INSERT INTO `__new_posts`("id", "title") SELECT "id", "title" FROM `posts`'
        ),
        { deferred: true }
      )
    ).toEqual([]);
  });

  it("names it as one the run judges otherwise, never as the drop of the table", () => {
    expect(
      read(
        "sqlite",
        rebuild(
          'INSERT INTO `__new_posts`("id", "title") SELECT "id", "title" FROM `posts` WHERE "id" > 1'
        ),
        { deferred: true }
      )
    ).toEqual([
      unnamed("posts rebuilt (may delete data, checked at run time)"),
    ]);
  });
});

describe("a run of files", () => {
  // The rebuild the generator writes when a field of posts becomes required.
  const rebuildPosts = [
    "CREATE TABLE `__new_posts` (`id` integer PRIMARY KEY NOT NULL, `title` text NOT NULL)",
    'INSERT INTO `__new_posts`("id", "title") SELECT "id", "title" FROM `posts`',
    "DROP TABLE `posts`",
    "ALTER TABLE `__new_posts` RENAME TO `posts`",
  ];
  const createPosts = [
    "CREATE TABLE `posts` (`id` integer PRIMARY KEY NOT NULL, `title` text)",
  ];
  const run = (
    dialect: SupportedDialect,
    files: string[][],
    facts?: Facts
  ): Deletion[][] => runDeletions(files, dialect, fake(facts));

  it("asks nothing for a rebuild of a table an earlier file of the run creates, on a fresh database", () => {
    // No live posts: read alone, the rebuild would be the drop of a table
    // whose columns are unknown.
    expect(read("sqlite", rebuildPosts)).toEqual([table("posts")]);
    expect(run("sqlite", [createPosts, rebuildPosts])).toEqual([[], []]);
  });

  it("names a live table a later file's rebuild narrows, under the file that does it", () => {
    const live = {
      columns: { posts: { id: "integer", title: "text", body: "text" } },
    };
    expect(
      run(
        "sqlite",
        [["CREATE TABLE `tags` (`id` integer)"], rebuildPosts],
        live
      )
    ).toEqual([[], [column("posts", "body")]]);
  });

  it("follows a live table an earlier file renames, naming it by its live name", () => {
    const live = {
      columns: { posts: { id: "integer", title: "text", body: "text" } },
    };
    const rebuildArticles = rebuildPosts.map(statement =>
      statement.replaceAll("posts", "articles")
    );
    expect(
      run(
        "sqlite",
        [["ALTER TABLE `posts` RENAME TO `articles`"], rebuildArticles],
        live
      )
    ).toEqual([[], [column("posts", "body")]]);
  });

  it("names on PostgreSQL and MySQL what each file deletes, under the file, as one file read alone does", () => {
    for (const dialect of ["postgresql", "mysql"] as const) {
      const first = ["DELETE FROM posts WHERE id = 1"];
      const second = ["ALTER TABLE posts DROP COLUMN body", "DROP TABLE posts"];
      expect(run(dialect, [first, second])).toEqual([
        read(dialect, first),
        read(dialect, second),
      ]);
      expect(run(dialect, [first, second])).toEqual([
        [rows("posts")],
        [column("posts", "body"), table("posts")],
      ]);
    }
  });

  it("names nothing a file deletes from a table an earlier file of the run creates", () => {
    expect(
      run("postgresql", [
        ["CREATE TABLE posts (id integer)"],
        ["DROP TABLE posts"],
      ])
    ).toEqual([[], []]);
  });
});

describe("statements not read", () => {
  it("stands for a procedural block, whatever it holds, with an unnamed deletion", () => {
    expect(
      read("postgresql", [
        "DO $$ BEGIN EXECUTE 'DROP TABLE ' || 'posts'; END $$",
        "CALL purge_posts()",
      ])
    ).toEqual([
      unreadAs(
        "DO (not read, may delete data)",
        "DO $$ BEGIN EXECUTE 'DROP TABLE ' || 'posts'; END $$"
      ),
      unreadAs(
        "CALL PURGE_POSTS (not read, may delete data)",
        "CALL purge_posts()"
      ),
    ]);
  });

  it("keeps two different unread statements under one label apart, and one statement read twice as one", () => {
    const keep = "DO $$ BEGIN DELETE FROM drafts WHERE false; END $$";
    const purge = "DO $$ BEGIN DELETE FROM posts; END $$";
    const found = read("postgresql", [keep, purge, keep]);
    expect(found).toEqual([
      unreadAs("DO (not read, may delete data)", keep),
      unreadAs("DO (not read, may delete data)", purge),
    ]);
  });

  it("names nothing for a string literal that spells a deletion", () => {
    expect(
      read("postgresql", [
        "INSERT INTO notes (body) VALUES ('DROP TABLE users; DELETE FROM posts')",
        "COMMENT ON TABLE posts IS 'TRUNCATE me'",
      ])
    ).toEqual([]);
  });

  it("stands for a DROP ... CASCADE of a type and for an unread DROP, and names nothing for definitions dropped plainly", () => {
    expect(
      read("postgresql", [
        "DROP TYPE mood CASCADE",
        "DROP TYPE colour",
        "DROP VIEW posts_view",
        "DROP INDEX posts_ix",
        "ALTER TYPE address DROP ATTRIBUTE zip",
        "GRANT SELECT ON posts TO reader",
      ])
    ).toEqual([
      unreadAs(
        "DROP TYPE MOOD CASCADE (not read, may delete data)",
        "DROP TYPE mood CASCADE"
      ),
      unreadAs(
        "ALTER TYPE ADDRESS DROP ATTRIBUTE ZIP (not read, may delete data)",
        "ALTER TYPE address DROP ATTRIBUTE zip"
      ),
    ]);
  });

  it("reads MySQL's DROP SCHEMA, which drops a database's tables, as unread, and PostgreSQL's as a definition", () => {
    expect(read("mysql", ["DROP SCHEMA archive"])).toEqual([
      unreadAs(
        "DROP SCHEMA ARCHIVE (not read, may delete data)",
        "DROP SCHEMA archive"
      ),
    ]);
    expect(read("postgresql", ["DROP SCHEMA archive"])).toEqual([]);
  });

  it("stands for a schema-qualified table, which may reach another table, with an unnamed deletion", () => {
    expect(
      read("postgresql", [
        "DROP TABLE archive.posts",
        'DELETE FROM "archive"."pages"',
        "ALTER TABLE archive.posts ADD COLUMN body text",
      ])
    ).toEqual([
      unreadAs(
        "DROP TABLE ARCHIVE.POSTS (not read, may delete data)",
        "DROP TABLE archive.posts"
      ),
      unreadAs(
        'DELETE FROM "archive" . "pages" (not read, may delete data)',
        'DELETE FROM "archive"."pages"'
      ),
    ]);
  });
});
