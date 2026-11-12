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
  /** Per table, the events its triggers fire on, any of which is code it carries; none when left out. Undefined: unreadable. */
  triggers?: Record<
    string,
    readonly ("delete" | "truncate" | "insert" | "update")[] | undefined
  >;
  /** Per table, its inheritance descendants and partitions; none when left out. Undefined: unreadable. */
  descendants?: Record<string, readonly string[] | undefined>;
  /** Per table, whether a CHECK on it calls a non-system function, which a column conversion runs; none when left out. */
  rewrite?: Record<string, boolean | undefined>;
  /** The tables the database has before the run, beyond those `columns` names; "unreadable" for none known. */
  live?: readonly string[] | "unreadable";
  /**
   * MySQL: per table in `columns`, the columns whose character set is not the table's default;
   * none when left out. "unreadable": not read for any table.
   */
  charsets?: Record<string, readonly string[]> | "unreadable";
  /**
   * Per table in `columns`, the columns that are NOT NULL; every other one is nullable.
   * "unreadable": not read for any table.
   */
  notNull?: Record<string, readonly string[]> | "unreadable";
}

/** Live facts answering exactly from `facts`, with no case folding. */
function fake(facts: Facts = {}): DeletionFacts {
  const answer =
    (map: Record<string, readonly string[] | undefined> | undefined) =>
    (table: string) => (map !== undefined && table in map ? map[table] : []);
  const tables = Object.entries(facts.columns ?? {});
  const nulled = facts.nulled;
  const triggers = facts.triggers;
  return {
    cascadeFrom: answer(facts.cascade),
    truncateCascadeFrom: answer(facts.truncate),
    nulledBy: table =>
      nulled !== undefined && table in nulled ? nulled[table] : [],
    // A table left out carries no code; one mapped to undefined is unreadable.
    hiddenCode: (table, on) => {
      if (on === "rewrite") {
        return facts.rewrite !== undefined && table in facts.rewrite
          ? facts.rewrite[table]
          : false;
      }
      return triggers !== undefined && table in triggers
        ? triggers[table] === undefined
          ? undefined
          : triggers[table].length > 0
        : false;
    },
    descendantsOf: answer(facts.descendants),
    liveTable: table =>
      facts.live === "unreadable"
        ? undefined
        : (facts.live ?? []).includes(table) || table in (facts.columns ?? {}),
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
    ...(facts.notNull === "unreadable"
      ? {}
      : {
          liveNotNull: new Map(
            tables.map(([table]) => {
              const notNull = facts.notNull as
                | Record<string, readonly string[]>
                | undefined;
              return [table, new Set(notNull?.[table] ?? [])];
            })
          ),
        }),
    ...(facts.charsets === "unreadable"
      ? {}
      : {
          otherCharsets: new Map(
            tables.map(([table]) => {
              const charsets = facts.charsets as
                | Record<string, readonly string[]>
                | undefined;
              return [table, new Set(charsets?.[table] ?? [])];
            })
          ),
        }),
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

describe("a string column widened", () => {
  // Live types as introspection spells them; `body` is already TEXT.
  const posts = {
    columns: {
      posts: {
        title: "varchar(255)",
        slug: "varchar(20)",
        body: "text",
        a: "varchar(255)",
      },
    },
    // `slug` is NOT NULL already, so restating it NOT NULL tightens nothing.
    notNull: { posts: ["slug"] },
  };

  it("names nothing for a MySQL widening to TEXT or a longer VARCHAR, nor for TEXT restated", () => {
    expect(
      read(
        "mysql",
        [
          "ALTER TABLE `posts` MODIFY COLUMN `title` text NULL",
          "ALTER TABLE posts MODIFY slug varchar(40) NOT NULL DEFAULT 'x'",
          "ALTER TABLE posts MODIFY COLUMN body TEXT",
          "ALTER TABLE posts CHANGE COLUMN a b text",
        ],
        posts
      )
    ).toEqual([]);
  });

  it("still names a MySQL narrowing, and TEXT to VARCHAR", () => {
    expect(
      read(
        "mysql",
        [
          "ALTER TABLE posts MODIFY COLUMN slug varchar(10)",
          "ALTER TABLE posts MODIFY COLUMN body varchar(255)",
          "ALTER TABLE posts MODIFY COLUMN title mediumint",
        ],
        posts
      )
    ).toEqual([
      column("posts", "slug"),
      column("posts", "body"),
      column("posts", "title"),
    ]);
  });

  it("still names a MySQL widening that names a character set or collation, or whose column's character set is not its table's", () => {
    expect(
      read(
        "mysql",
        [
          "ALTER TABLE posts MODIFY COLUMN title text CHARACTER SET latin1",
          "ALTER TABLE posts MODIFY COLUMN slug varchar(40) COLLATE latin1_bin",
          "ALTER TABLE posts MODIFY COLUMN a text",
        ],
        { ...posts, charsets: { posts: ["a"] } }
      )
    ).toEqual([
      column("posts", "title"),
      column("posts", "slug"),
      column("posts", "a"),
    ]);
    // Character sets that could not be read leave a widening judged as any type change.
    expect(
      read("mysql", ["ALTER TABLE posts MODIFY COLUMN title text"], {
        ...posts,
        charsets: "unreadable",
      })
    ).toEqual([column("posts", "title")]);
  });

  it("still names a MySQL restatement that makes a nullable column NOT NULL, which a non-strict server fills with ''", () => {
    expect(
      read(
        "mysql",
        [
          "ALTER TABLE posts MODIFY COLUMN title varchar(255) NOT NULL",
          "ALTER TABLE posts MODIFY COLUMN a text PRIMARY KEY",
        ],
        posts
      )
    ).toEqual([column("posts", "title"), column("posts", "a")]);
    // The same restatement of a column already NOT NULL tightens nothing.
    expect(
      read(
        "mysql",
        ["ALTER TABLE posts MODIFY COLUMN title varchar(255) NOT NULL"],
        { ...posts, notNull: { posts: ["title"] } }
      )
    ).toEqual([]);
    // Nullability that could not be read leaves it judged as any type change.
    expect(
      read(
        "mysql",
        ["ALTER TABLE posts MODIFY COLUMN slug varchar(40) NOT NULL"],
        {
          ...posts,
          notNull: "unreadable",
        }
      )
    ).toEqual([column("posts", "slug")]);
  });

  it("judges a second change against the type the first gave, not the live one", () => {
    expect(
      read(
        "mysql",
        [
          "ALTER TABLE posts MODIFY COLUMN title varchar(300)",
          "ALTER TABLE posts MODIFY COLUMN title varchar(280)",
        ],
        posts
      )
    ).toEqual([column("posts", "title")]);
  });

  it("names nothing for a PostgreSQL widening cast plainly, and still names a narrowing or another conversion", () => {
    expect(
      read(
        "postgresql",
        [
          'ALTER TABLE "posts" ALTER COLUMN "title" TYPE text USING "title"::text',
          "ALTER TABLE posts ALTER COLUMN slug TYPE varchar(40) USING slug::varchar(40)",
          "ALTER TABLE posts ALTER body SET DATA TYPE text",
        ],
        posts
      )
    ).toEqual([]);
    expect(
      read(
        "postgresql",
        [
          "ALTER TABLE posts ALTER COLUMN slug TYPE varchar(10) USING slug",
          "ALTER TABLE posts ALTER COLUMN title TYPE text USING lower(title)",
          "ALTER TABLE posts ALTER COLUMN body TYPE varchar(255) USING body::varchar(255)",
        ],
        posts
      )
    ).toEqual([
      column("posts", "slug"),
      column("posts", "title"),
      column("posts", "body"),
    ]);
  });

  it("names a widened column whose live type is not known", () => {
    expect(
      read("mysql", ["ALTER TABLE posts MODIFY COLUMN title text"])
    ).toEqual([column("posts", "title")]);
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

/** The deletion a row change stands for when its table carries code (a trigger, a rule, a default or check calling a function). */
const carries = (change: string, table: string): Deletion =>
  unnamed(
    `${change} ${table} run code the table carries (a trigger, a rule, or a default or check calling a function), which may delete other data`
  );
/** As `carries`, when what the table carries could not be read. */
const mayCarry = (change: string, table: string): Deletion =>
  unnamed(
    `${change} ${table} may run code the table carries, which could not be read`
  );
/** A statement after the run defined code, which only blanket consent covers. */
const afterCode = (label: string, statement: string): Deletion =>
  unreadAs(
    `${label} (the run defined code before it, not read, may delete data)`,
    statement
  );

describe("code a table carries, when a row change reaches it", () => {
  const removed = (table: string) => carries("rows removed from", table);
  const written = (table: string) => carries("rows written to", table);

  it("stands for any trigger on a table whose rows a DELETE, a REPLACE, an INSERT OR REPLACE or a TRUNCATE removes", () => {
    const triggers = { posts: ["update"] as const };
    expect(
      read("postgresql", ["DELETE FROM posts WHERE id = 1"], { triggers })
    ).toEqual([rows("posts"), removed("posts")]);
    expect(
      read("mysql", ["REPLACE INTO posts (id) VALUES (1)"], { triggers })
    ).toEqual([rows("posts"), removed("posts"), written("posts")]);
    expect(
      read("sqlite", ["INSERT OR REPLACE INTO posts (id) VALUES (1)"], {
        triggers,
      })
    ).toEqual([rows("posts"), removed("posts"), written("posts")]);
    expect(
      read("postgresql", ["TRUNCATE posts CASCADE"], { triggers })
    ).toEqual([rows("posts"), removed("posts")]);
    // A table carrying nothing asks nothing beyond its rows.
    expect(read("postgresql", ["DELETE FROM pages"], { triggers })).toEqual([
      rows("pages"),
    ]);
  });

  it("names a DDL deletion on a table with an updated_at trigger, and asks blanket consent for a removal of its rows", () => {
    const triggers = { posts: ["update"] as const };
    expect(
      read("postgresql", ["ALTER TABLE posts DROP COLUMN body"], { triggers })
    ).toEqual([column("posts", "body")]);
    expect(read("postgresql", ["DROP TABLE posts"], { triggers })).toEqual([
      table("posts"),
    ]);
    expect(read("postgresql", ["DELETE FROM posts"], { triggers })).toEqual([
      rows("posts"),
      removed("posts"),
    ]);
  });

  it("stands for code on a table a write reaches, an upsert's included, and none on a table the list made", () => {
    expect(
      read("postgresql", ["INSERT INTO audit (id) VALUES (1)"], {
        triggers: { audit: ["delete"] },
      })
    ).toEqual([written("audit")]);
    expect(
      read(
        "postgresql",
        [
          "INSERT INTO posts (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id = 1",
        ],
        { triggers: { posts: ["update"] } }
      )
    ).toEqual([written("posts")]);
    expect(
      read("mysql", [
        "INSERT INTO plain (id) VALUES (1)",
        "CREATE TABLE scratch (id integer)",
        "INSERT INTO scratch (id) VALUES (1)",
      ])
    ).toEqual([]);
  });

  it("reads a SQLite conflict clause and a MySQL INSERT without INTO as the write they are", () => {
    const triggers = { posts: ["insert"] as const };
    for (const [dialect, statement] of [
      ["sqlite", "INSERT OR IGNORE INTO posts (id) VALUES (1)"],
      ["sqlite", "INSERT OR ROLLBACK INTO posts (id) VALUES (1)"],
      ["sqlite", "UPDATE OR ABORT posts SET title = 'x'"],
      ["mysql", "INSERT posts (id) VALUES (1)"],
    ] as const) {
      expect(read(dialect, [statement], { triggers }), statement).toEqual([
        written("posts"),
      ]);
    }
    // On a table carrying no code, the write asks nothing.
    expect(
      read("sqlite", ["INSERT OR IGNORE INTO pages (id) VALUES (1)"])
    ).toEqual([]);
  });

  it("stands for code on a child whose key a removal blanks through ON DELETE SET NULL", () => {
    expect(
      read("postgresql", ["DELETE FROM authors"], {
        nulled: { authors: [{ table: "bylines", column: "author_id" }] },
        triggers: { bylines: ["update"] },
      })
    ).toEqual([
      rows("authors"),
      column("bylines", "author_id"),
      carries("rows changed in", "bylines"),
    ]);
  });

  it("fails closed when what a table carries could not be read", () => {
    expect(
      read("mysql", ["DELETE FROM posts"], { triggers: { posts: undefined } })
    ).toEqual([rows("posts"), mayCarry("rows removed from", "posts")]);
    expect(
      read("mysql", ["INSERT INTO audit (id) VALUES (1)"], {
        triggers: { audit: undefined },
      })
    ).toEqual([mayCarry("rows written to", "audit")]);
  });

  it("asks blanket consent for a PostgreSQL column conversion on a table whose CHECK calls a function, and names its DROP COLUMN", () => {
    const facts = { rewrite: { posts: true } };
    expect(
      read(
        "postgresql",
        ["ALTER TABLE posts ALTER COLUMN body TYPE varchar(20)"],
        facts
      )
    ).toEqual([
      column("posts", "body"),
      unnamed(
        "converting a column of posts re-checks its CHECK constraints, which call a function and may delete other data"
      ),
    ]);
    expect(
      read("postgresql", ["ALTER TABLE posts DROP COLUMN body"], facts)
    ).toEqual([column("posts", "body")]);
  });
});

describe("code the run itself defines", () => {
  it("stands for every row change after the run defines code, a rule, a qualified function or a trigger on its own table", () => {
    const update = "UPDATE posts SET title = 'x'";
    expect(
      read("postgresql", [
        "CREATE RULE purge AS ON UPDATE TO posts DO ALSO DELETE FROM audit",
        update,
      ])
    ).toEqual([afterCode("UPDATE POSTS SET TITLE =", update)]);
    const remove = "DELETE FROM scratch";
    expect(
      read("postgresql", [
        "CREATE TABLE scratch (id integer)",
        "CREATE TRIGGER purge AFTER DELETE ON scratch FOR EACH ROW EXECUTE FUNCTION purge()",
        remove,
      ])
    ).toEqual([afterCode("DELETE FROM SCRATCH", remove)]);
    const call = "SELECT purge_old_posts()";
    expect(
      read("postgresql", [
        "CREATE FUNCTION public.purge_old_posts() RETURNS void AS $$ DELETE FROM posts $$ LANGUAGE sql",
        call,
      ])
    ).toEqual([
      unreadAs(
        "SELECT PURGE_OLD_POSTS (calls a function, may delete data)",
        call
      ),
    ]);
  });

  it("still names a DDL deletion after the run defines code", () => {
    expect(
      read("postgresql", [
        "CREATE FUNCTION tidy() RETURNS integer AS 'SELECT 1' LANGUAGE sql",
        "DROP TABLE posts",
      ])
    ).toEqual([table("posts")]);
  });
});

describe("a row change in a form the reader does not place", () => {
  it("stands for WITH … UPDATE, COPY … FROM, LOAD DATA and a multi-table UPDATE as statements it cannot read", () => {
    const withUpdate =
      "WITH stale AS (SELECT id FROM posts) UPDATE posts SET title = 'x' WHERE id IN (SELECT id FROM stale)";
    const copy = "COPY posts FROM STDIN";
    const load = "LOAD DATA INFILE '/tmp/posts.csv' INTO TABLE posts";
    const joined =
      "UPDATE posts p JOIN drafts d ON p.id = d.id SET p.title = d.title";
    expect(read("postgresql", [withUpdate, copy])).toEqual([
      unreadAs("WITH STALE AS (not read, may delete data)", withUpdate),
      unreadAs("COPY POSTS FROM STDIN (not read, may delete data)", copy),
    ]);
    expect(read("mysql", [load, joined])).toEqual([
      unreadAs("LOAD DATA INFILE (not read, may delete data)", load),
      unreadAs(
        "UPDATE POSTS P JOIN DRAFTS D ON P.ID = D.ID SET P.TITLE = D… (not read, may delete data)",
        joined
      ),
    ]);
    // A read stays a read.
    expect(
      read("postgresql", [
        "WITH recent AS (SELECT id FROM posts) SELECT count(*) FROM recent",
        "COPY posts TO STDOUT",
      ])
    ).toEqual([]);
  });
});

describe("a function named like a system one", () => {
  it("stands for a call to a user function called setval, as any other user function", () => {
    const call = "SELECT setval(1)";
    expect(read("mysql", [call], { functions: ["setval"] })).toEqual([
      unreadAs("SELECT SETVAL (calls a function, may delete data)", call),
    ]);
  });
});

describe("PostgreSQL inheritance children and partitions", () => {
  it("names the rows of every descendant a DELETE or TRUNCATE without ONLY reaches, and follows their cascades", () => {
    const facts = {
      descendants: { events: ["events_2025", "archive.events_2024"] },
      cascade: { events_2025: ["event_tags"] },
    };
    expect(read("postgresql", ["DELETE FROM events"], facts)).toEqual([
      rows("events"),
      rows("events_2025"),
      rows("archive.events_2024"),
      rows("event_tags"),
    ]);
    expect(read("postgresql", ["TRUNCATE events *"], facts)).toEqual([
      rows("events"),
      rows("events_2025"),
      rows("archive.events_2024"),
    ]);
  });

  it("names only the table itself under ONLY", () => {
    const facts = { descendants: { events: ["events_2025"] } };
    expect(read("postgresql", ["DELETE FROM ONLY events"], facts)).toEqual([
      rows("events"),
    ]);
    expect(
      read("postgresql", ["TRUNCATE ONLY events, events_2025"], facts)
    ).toEqual([rows("events"), rows("events_2025")]);
  });

  it("fails closed when the descendants could not be read", () => {
    expect(
      read("postgresql", ["DELETE FROM events"], {
        descendants: { events: undefined },
      })
    ).toEqual([
      rows("events"),
      unnamed(
        "rows removed from tables that inherit from events or partition it, which could not be read"
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
      read(
        "postgresql",
        [
          "ALTER TABLE posts ADD COLUMN editor_id integer REFERENCES authors (id) ON DELETE SET NULL",
          "DELETE FROM authors",
        ],
        { columns: { posts: { id: "integer" } } }
      )
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
      read(
        "postgresql",
        [
          "ALTER TABLE posts ADD COLUMN tmp text",
          "ALTER TABLE posts RENAME COLUMN tmp TO scratch",
          "ALTER TABLE posts DROP COLUMN scratch",
          "ALTER TABLE posts ADD COLUMN other text",
          "ALTER TABLE posts ALTER COLUMN other TYPE integer",
        ],
        { columns: { posts: { id: "integer", title: "text" } } }
      )
    ).toEqual([]);
    expect(read("postgresql", ["ALTER TABLE posts DROP COLUMN tmp"])).toEqual([
      column("posts", "tmp"),
    ]);
  });

  it("gives a name back to its live table once the temporary table shadowing it is renamed away, and holds the renamed one as the run's", () => {
    expect(
      read("postgresql", [
        "CREATE TEMP TABLE posts AS SELECT * FROM posts WHERE draft",
        "ALTER TABLE posts RENAME TO scratch",
        "DELETE FROM scratch",
        "DELETE FROM posts WHERE id = 1",
      ])
    ).toEqual([rows("posts")]);
  });

  it("names a column a conditional ADD COLUMN may have found already there, when it is dropped later", () => {
    expect(
      read("postgresql", [
        "ALTER TABLE posts ADD COLUMN IF NOT EXISTS summary text",
        "ALTER TABLE posts DROP COLUMN summary",
      ])
    ).toEqual([column("posts", "summary")]);
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

describe("what the run cannot be sure it created, or where a name points", () => {
  it("credits no creation of a table that already exists, since the file creating it may be adopted rather than run", () => {
    expect(
      read(
        "postgresql",
        ["CREATE TABLE posts (id integer)", "DROP TABLE posts"],
        {
          live: ["posts"],
        }
      )
    ).toEqual([table("posts")]);
    // Nor when whether it exists could not be read.
    expect(
      read(
        "postgresql",
        ["CREATE TABLE posts (id integer)", "DROP TABLE posts"],
        {
          live: "unreadable",
        }
      )
    ).toEqual([table("posts")]);
  });

  it("credits no added column a live table may already hold, or whose table's columns are unknown", () => {
    const steps = [
      "ALTER TABLE posts ADD COLUMN summary text",
      "ALTER TABLE posts DROP COLUMN summary",
    ];
    expect(
      read("postgresql", steps, {
        columns: { posts: { id: "integer", summary: "text" } },
      })
    ).toEqual([column("posts", "summary")]);
    expect(read("postgresql", steps, { live: ["posts"] })).toEqual([
      column("posts", "summary"),
    ]);
  });

  it("stands for a deletion through an unqualified name once the search path changed, as one it cannot place", () => {
    const remove = "DELETE FROM posts WHERE id = 1";
    expect(
      read("postgresql", ["SET LOCAL search_path TO archive", remove])
    ).toEqual([
      unreadAs(
        "DELETE FROM POSTS WHERE ID = 1 (search path changed, not read, may delete data)",
        remove
      ),
    ]);
  });

  it("reads MERGE as the writes and the removal of rows it makes", () => {
    const merge =
      "MERGE INTO posts p USING drafts d ON p.id = d.id WHEN MATCHED AND d.gone THEN DELETE WHEN MATCHED THEN UPDATE SET title = d.title WHEN NOT MATCHED THEN INSERT (id) VALUES (d.id)";
    expect(
      read("postgresql", [merge], { triggers: { posts: ["update"] } })
    ).toEqual([
      rows("posts"),
      carries("rows removed from", "posts"),
      carries("rows written to", "posts"),
    ]);
  });

  it("records a MySQL function or trigger created with a DEFINER", () => {
    const call = "SELECT purge_old()";
    expect(
      read("mysql", [
        "CREATE DEFINER = 'root'@'%' FUNCTION purge_old() RETURNS integer DETERMINISTIC RETURN 1",
        call,
      ])
    ).toEqual([
      unreadAs("SELECT PURGE_OLD (calls a function, may delete data)", call),
    ]);
    const insert = "INSERT INTO audit (id) VALUES (1)";
    expect(
      read("mysql", [
        "CREATE DEFINER = 'root'@'%' TRIGGER audit_trg AFTER INSERT ON audit FOR EACH ROW SET @x = 1",
        insert,
      ])
    ).toEqual([afterCode("INSERT INTO AUDIT", insert)]);
  });

  it("gives a name back to its live table once MySQL's DROP TEMPORARY TABLE drops the run's temporary table", () => {
    expect(
      read("mysql", [
        "CREATE TEMPORARY TABLE posts (id integer)",
        "DROP TEMPORARY TABLE posts",
        "DELETE FROM posts",
      ])
    ).toEqual([rows("posts")]);
    // Dropping a temporary table the run did not make deletes nothing it could name.
    expect(read("mysql", ["DROP TEMPORARY TABLE IF EXISTS scratch"])).toEqual(
      []
    );
  });

  it("stands for a deletion through a name once anything that changes name resolution ran", () => {
    const remove = "DELETE FROM posts WHERE id = 1";
    const unplaced = unreadAs(
      "DELETE FROM POSTS WHERE ID = 1 (search path changed, not read, may delete data)",
      remove
    );
    for (const moves of [
      "SET SCHEMA 'archive'",
      "SET SESSION search_path = archive",
      "RESET search_path",
      "RESET ALL",
      "SET ROLE archivist",
      "SET SESSION AUTHORIZATION archivist",
      "RESET ROLE",
      "DISCARD ALL",
    ]) {
      expect(read("postgresql", [moves, remove]), moves).toEqual([unplaced]);
    }
    // A setting that leaves names where they were moves nothing.
    expect(
      read("postgresql", ["SET LOCAL lock_timeout = '5s'", remove])
    ).toEqual([rows("posts")]);
  });

  it("asks the triggers of every descendant a PostgreSQL write without ONLY reaches", () => {
    const update = "UPDATE events SET seen = true";
    const facts = {
      descendants: { events: ["events_2024"] },
      triggers: { events_2024: ["update" as const] },
    };
    expect(read("postgresql", [update], facts)).toEqual([
      carries("rows written to", "events_2024"),
    ]);
    expect(
      read("postgresql", ["UPDATE ONLY events SET seen = true"], facts)
    ).toEqual([]);
    // Descendants that cannot be read may hold such a trigger.
    expect(
      read("postgresql", [update], { descendants: { events: undefined } })
    ).toEqual([
      unnamed(
        "rows written to tables that inherit from events or partition it, whose triggers could not be read"
      ),
    ]);
  });

  it("follows a partition attached or a table made to inherit earlier in the run into a later removal", () => {
    expect(
      read("postgresql", [
        "ALTER TABLE events ATTACH PARTITION events_2024 FOR VALUES FROM (0) TO (10)",
        "ALTER TABLE archive_events INHERIT events",
        "DELETE FROM events",
      ])
    ).toEqual([rows("events"), rows("events_2024"), rows("archive_events")]);
    expect(
      read("postgresql", [
        "ALTER TABLE events ATTACH PARTITION events_2024 FOR VALUES FROM (0) TO (10)",
        "DELETE FROM ONLY events",
      ])
    ).toEqual([rows("events")]);
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

describe("a call to a function that may delete, wherever a statement makes it", () => {
  const functions = ["purge_old_posts"];
  const calls = (label: string, statement: string) =>
    unreadAs(`${label} (calls a function, may delete data)`, statement);

  it("stands for a call in an INSERT, a VALUES, an UPDATE and a DELETE's condition", () => {
    const insert = "INSERT INTO audit VALUES (purge_old_posts())";
    const values = "VALUES (purge_old_posts())";
    const update = "UPDATE posts SET pruned = purge_old_posts()";
    const remove = "DELETE FROM drafts WHERE purge_old_posts() > 0";
    expect(
      read("postgresql", [insert, values, update, remove], { functions })
    ).toEqual([
      calls("INSERT INTO AUDIT VALUES", insert),
      calls("VALUES", values),
      calls("UPDATE POSTS SET PRUNED = PURGE_OLD_POSTS", update),
      rows("drafts"),
      calls("DELETE FROM DRAFTS WHERE PURGE_OLD_POSTS", remove),
    ]);
  });

  it("stands for a call to a quoted function name, on PostgreSQL and MySQL", () => {
    const pg = 'SELECT "purge_old_posts"()';
    const my = "SELECT `purge_old_posts`()";
    expect(read("postgresql", [pg], { functions })).toEqual([
      calls('SELECT "purge_old_posts"', pg),
    ]);
    expect(read("mysql", [my], { functions })).toEqual([
      calls('SELECT "purge_old_posts"', my),
    ]);
  });

  it("asks nothing for a function a statement only defines", () => {
    expect(
      read(
        "mysql",
        [
          "CREATE FUNCTION tidy() RETURNS integer DETERMINISTIC RETURN purge_old_posts()",
          "CREATE VIEW recent AS SELECT purge_old_posts() AS n",
        ],
        { functions }
      )
    ).toEqual([]);
  });
});

describe("a composite type's attribute converted", () => {
  it("reads ALTER TYPE … ALTER ATTRIBUTE … TYPE as a statement that may delete, since CASCADE rewrites typed tables", () => {
    const alter =
      "ALTER TYPE app_row ALTER ATTRIBUTE title TYPE varchar(20) CASCADE";
    expect(read("postgresql", [alter])).toEqual([
      unreadAs(
        "ALTER TYPE APP_ROW ALTER ATTRIBUTE TITLE TYPE VARCHAR (not read, may delete data)",
        alter
      ),
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
