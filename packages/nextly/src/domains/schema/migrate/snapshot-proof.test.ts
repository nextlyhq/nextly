/**
 * The rule for recording a pending app file applied without running it: each condition, and the
 * first condition for each kind of statement it names.
 *
 * @module domains/schema/migrate/snapshot-proof.test
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { SchemaEventRow } from "../events/schema-events-repository";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { generateStatements } from "../pipeline/sql-templates";
import { schemaVersionStoreSql } from "../schema-version";

import {
  danglingOnAddedKeys,
  proveStatements,
  refuseUnlessProven,
  statementsShownBySnapshot,
} from "./snapshot-proof";
import type { LiveSchemaWithColumnFacts } from "./statement-judgement";

const posts = (
  ...columns: string[]
): NextlySchemaSnapshot["tables"][number] => ({
  name: "dc_posts",
  columns: [
    { name: "id", type: "text", nullable: false },
    ...columns.map(name => ({ name, type: "text", nullable: true })),
  ],
  indexes: [{ name: "dc_posts_title_idx", columns: ["title"], unique: false }],
});

const sides = {
  before: { tables: [posts("title")] },
  target: { tables: [posts("title", "slug")] },
};

/** Whether the snapshot shows the one statement, alone in its file. */
function shown(
  statement: string,
  dialect: SupportedDialect = "postgresql"
): boolean {
  return (
    statementsShownBySnapshot([statement], dialect, sides)[0].status === "shown"
  );
}

const CHECKSUM = "ab".repeat(32);

/** The refusal `refuseUnlessProven` throws for these statements and attempt, or undefined. */
function refusal(args: {
  statements: string[];
  sha256?: string;
  recordedChecksum?: string;
  attempt?: Pick<SchemaEventRow, "status">;
}): NextlyError | undefined {
  try {
    refuseUnlessProven({
      file: {
        filename: "20261116_add_slug.sql",
        sha256: args.sha256 ?? CHECKSUM,
      },
      proof: {
        statements: statementsShownBySnapshot(
          args.statements,
          "postgresql",
          sides
        ),
        recordedChecksum: args.recordedChecksum ?? CHECKSUM,
      },
      attempt: args.attempt,
    });
    return undefined;
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
}

const ADD_SLUG = 'ALTER TABLE "dc_posts" ADD COLUMN "slug" text';
const BACKFILL = `UPDATE "dc_posts" SET "slug" = 'untitled'`;

describe("refuseUnlessProven", () => {
  it("lets a file through when all three conditions hold", () => {
    expect(refusal({ statements: [ADD_SLUG] })).toBeUndefined();
  });

  describe("first condition: every statement shown by the snapshot", () => {
    it("refuses a file holding a statement the snapshot does not show, naming it", () => {
      const error = refusal({ statements: [ADD_SLUG, BACKFILL] });
      expect(error?.code).toBe("NEXTLY_MIGRATION_NOT_PROVEN");
      expect(error?.publicMessage).toContain(
        "its snapshot does not show what 1 statement does"
      );
      expect(error?.publicMessage).toContain(
        '1. ALTER TABLE "dc_posts" ADD COLUMN "slug" text (the database has it)'
      );
      expect(error?.publicMessage).toContain(
        '2. UPDATE "dc_posts" SET "slug" = (not shown by its snapshot)'
      );
      expect(error?.publicMessage).toContain(
        "`nextly migrate:resolve --applied 20261116_add_slug`"
      );
    });

    it("never carries a string literal's content into the refusal", () => {
      const error = refusal({ statements: [BACKFILL] });
      expect(error?.publicMessage).not.toContain("untitled");
    });
  });

  describe("second condition: the checksum its snapshot recorded", () => {
    it("refuses an edited file, marking every statement not proven", () => {
      const error = refusal({
        statements: [ADD_SLUG],
        sha256: "cd".repeat(32),
      });
      expect(error?.publicMessage).toContain(
        "it has changed since its snapshot was written (checksum cdcdcdcdcdcd…, the snapshot recorded abababababab…)"
      );
      // The column is in the database whatever the edit did, so it is never offered to be run again.
      expect(error?.publicMessage).toContain(
        '1. ALTER TABLE "dc_posts" ADD COLUMN "slug" text (the database has it)'
      );
      expect(error?.publicMessage).toContain(
        "Check that what the file does is in the database, then record the file"
      );
    });

    it("refuses a file whose snapshot records no checksum", () => {
      const error = refusal({
        statements: [ADD_SLUG],
        recordedChecksum: "",
      });
      expect(error?.publicMessage).toContain(
        "its snapshot records no checksum to show it is the file the snapshot was written with"
      );
    });
  });

  describe("third condition: no unresolved attempt", () => {
    it("refuses a file whose last attempt failed, on any dialect", () => {
      const error = refusal({
        statements: [ADD_SLUG],
        attempt: { status: "failed" },
      });
      expect(error?.publicMessage).toContain("its last attempt failed");
    });

    it("refuses a file whose last attempt recorded no outcome", () => {
      const error = refusal({
        statements: [ADD_SLUG],
        attempt: { status: "in_progress" },
      });
      expect(error?.publicMessage).toContain(
        "its last attempt recorded no outcome"
      );
    });
  });
});

describe("statementsShownBySnapshot: the live database's own word", () => {
  const INDEX =
    'CREATE UNIQUE INDEX "dc_posts_slug_key" ON "dc_posts" ("slug")';
  const judged = (
    verdict: "done" | "not_done" | "unknown",
    reason?: "mixed" | "undone"
  ) => [
    {
      number: 1,
      label: "",
      verdict,
      ...(reason === undefined ? {} : { reason }),
    },
  ];

  it("is not proven where the database does not stand as the statement leaves it", () => {
    // An index left invalid by an interrupted concurrent build, or a constraint not validated:
    // the snapshot comparison cannot see either; the judgement can.
    for (const verdict of [judged("not_done"), judged("unknown", "mixed")]) {
      expect(
        statementsShownBySnapshot([INDEX], "postgresql", sides, verdict)[0]
          .status
      ).toBe("not-done");
    }
  });

  it("stays proven where the judgement agrees or cannot tell", () => {
    for (const verdict of [judged("done"), judged("unknown", "undone"), []]) {
      expect(
        statementsShownBySnapshot([INDEX], "postgresql", sides, verdict)[0]
          .status
      ).toBe("shown");
    }
  });

  it("names such a statement in the refusal", () => {
    let error: unknown;
    try {
      refuseUnlessProven({
        file: { filename: "20261116_add_slug.sql", sha256: CHECKSUM },
        proof: {
          statements: statementsShownBySnapshot(
            [INDEX],
            "postgresql",
            sides,
            judged("not_done")
          ),
          recordedChecksum: CHECKSUM,
        },
        attempt: undefined,
      });
    } catch (thrown) {
      error = thrown;
    }
    expect((error as NextlyError).publicMessage).toContain(
      'CREATE UNIQUE INDEX "dc_posts_slug_key" ON "dc_posts" (the database does not stand as it leaves it)'
    );
  });
});

describe("statementsShownBySnapshot: what fails the first condition", () => {
  it.each([
    ["an UPDATE", BACKFILL],
    ["an INSERT", `INSERT INTO "dc_posts" ("id") VALUES ('p1')`],
    ["a DELETE", `DELETE FROM "dc_posts" WHERE "slug" IS NULL`],
    ["a TRUNCATE", `TRUNCATE "dc_posts"`],
    ["a SELECT", `SELECT count(*) FROM "dc_posts"`],
    [
      "a table created from a query",
      `CREATE TABLE "dc_posts" AS SELECT * FROM "old"`,
    ],
    [
      "a trigger",
      `CREATE TRIGGER "slug_t" BEFORE INSERT ON "dc_posts" FOR EACH ROW EXECUTE FUNCTION f()`,
    ],
    ["a view", `CREATE VIEW "posts_v" AS SELECT * FROM "dc_posts"`],
    [
      "a function",
      `CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql`,
    ],
    ["a procedure", `CREATE PROCEDURE p() LANGUAGE SQL AS $$ SELECT 1 $$`],
    ["a sequence", `CREATE SEQUENCE "posts_seq"`],
    ["an extension", `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`],
    ["a type", `CREATE TYPE "mood" AS ENUM ('a', 'b')`],
    ["a grant", `GRANT SELECT ON "dc_posts" TO reporting`],
    ["a revoke", `REVOKE SELECT ON "dc_posts" FROM reporting`],
    ["a comment", `COMMENT ON TABLE "dc_posts" IS 'posts'`],
    ["a procedural block", `DO $$ BEGIN PERFORM 1; END $$`],
    ["a call", `CALL p()`],
    ["row-level security", `ALTER TABLE "dc_posts" ENABLE ROW LEVEL SECURITY`],
    ["a table owner", `ALTER TABLE "dc_posts" OWNER TO admin`],
    [
      "a column's statistics",
      `ALTER TABLE "dc_posts" ALTER COLUMN "slug" SET STATISTICS 100`,
    ],
    ["the search path", `SET search_path = other`],
    ["a statement it cannot read", `VACUUM "dc_posts"`],
  ])("%s", (_kind, statement) => {
    expect(shown(statement)).toBe(false);
  });

  it("a column type change whose USING rewrites the values by an expression", () => {
    expect(
      shown(
        'ALTER TABLE "dc_posts" ALTER COLUMN "slug" TYPE integer USING ("slug"::integer * 100)'
      )
    ).toBe(false);
    expect(
      shown(
        'ALTER TABLE "dc_posts" ALTER COLUMN "slug" TYPE integer USING length("title")'
      )
    ).toBe(false);
  });

  it("an exclusion constraint, which the snapshot does not record", () => {
    expect(
      shown(
        'ALTER TABLE "dc_posts" ADD CONSTRAINT "no_overlap" EXCLUDE USING gist ("slug" WITH =)'
      )
    ).toBe(false);
  });

  it("MySQL's DROP INDEX ... ON of an index neither side records", () => {
    expect(
      shown("DROP INDEX `posts_fulltext_body` ON `dc_posts`", "mysql")
    ).toBe(false);
    expect(
      shown("DROP INDEX `dc_posts_title_idx` ON `dc_posts`", "mysql")
    ).toBe(true);
  });

  it("MySQL table options and SET GLOBAL", () => {
    expect(shown("ALTER TABLE `dc_posts` ENGINE = MyISAM", "mysql")).toBe(
      false
    );
    expect(shown("SET GLOBAL foreign_key_checks = 0", "mysql")).toBe(false);
  });

  describe("a table neither side of the snapshot holds", () => {
    it.each([
      ['CREATE TABLE "audit" ("id" text)'],
      ['ALTER TABLE "audit" ADD COLUMN "at" text'],
      ['DROP TABLE "audit"'],
      ['CREATE INDEX "audit_at_idx" ON "audit" ("at")'],
      ['DROP INDEX "audit_at_idx"'],
    ])("%s", statement => {
      expect(shown(statement)).toBe(false);
    });
  });

  it("a quoted name in another case is another table on PostgreSQL", () => {
    expect(shown('ALTER TABLE "DC_POSTS" ADD COLUMN "slug" text')).toBe(false);
  });
});

describe("statementsShownBySnapshot: what passes the first condition", () => {
  it.each([
    ['CREATE TABLE "dc_posts" ("id" text PRIMARY KEY, "title" text)'],
    ['CREATE UNIQUE INDEX "dc_posts_slug_key" ON "dc_posts" ("slug")'],
    ['DROP INDEX IF EXISTS "dc_posts_title_idx"'],
    ['DROP TABLE "dc_posts"'],
    [ADD_SLUG],
    ['ALTER TABLE "dc_posts" DROP COLUMN "title"'],
    ['ALTER TABLE "dc_posts" RENAME COLUMN "title" TO "heading"'],
    ['ALTER TABLE "dc_posts" ALTER COLUMN "slug" SET NOT NULL'],
    ['ALTER TABLE "dc_posts" ALTER COLUMN "slug" DROP DEFAULT'],
    [
      'ALTER TABLE "dc_posts" ALTER COLUMN "slug" SET DATA TYPE varchar(255) USING "slug"::varchar(255)',
    ],
    [
      'ALTER TABLE "dc_posts" ADD CONSTRAINT "dc_posts_slug_check" CHECK ("slug" <> \'\')',
    ],
    ['ALTER TABLE "dc_posts" DROP CONSTRAINT "dc_posts_slug_check"'],
    ['ALTER TABLE "dc_posts" VALIDATE CONSTRAINT "dc_posts_slug_check"'],
    ["SET LOCAL lock_timeout = '5s'"],
  ])("%s", statement => {
    expect(shown(statement)).toBe(true);
  });

  it("a column type change cast as the generator writes it", () => {
    expect(
      shown(
        'ALTER TABLE "dc_posts" ALTER COLUMN "slug" SET DATA TYPE numeric(10, 2) USING "slug"::numeric(10, 2)'
      )
    ).toBe(true);
    expect(
      shown('ALTER TABLE "dc_posts" ALTER COLUMN "slug" TYPE text USING "slug"')
    ).toBe(true);
  });

  it("a table built under another name and moved into place, in each reader's spelling", () => {
    const pg = [
      'CREATE TABLE "tmp_posts" ("id" text)',
      'DROP TABLE "dc_posts"',
      'ALTER TABLE IF EXISTS "tmp_posts" RENAME TO "dc_posts"',
    ];
    expect(
      statementsShownBySnapshot(pg, "postgresql", sides).map(
        s => s.status === "shown"
      )
    ).toEqual([true, true, true]);
    const mysql = [
      "CREATE TABLE `tmp_posts` (`id` varchar(36))",
      "DROP TABLE `dc_posts`",
      "RENAME TABLE `tmp_posts` TO `dc_posts`",
    ];
    expect(
      statementsShownBySnapshot(mysql, "mysql", sides).map(
        s => s.status === "shown"
      )
    ).toEqual([true, true, true]);
  });

  it("MySQL's MODIFY, CHANGE, index clauses and RENAME TABLE", () => {
    for (const statement of [
      "ALTER TABLE `dc_posts` MODIFY COLUMN `slug` varchar(255) NOT NULL",
      "ALTER TABLE `dc_posts` CHANGE COLUMN `title` `heading` text",
      "ALTER TABLE `dc_posts` ADD UNIQUE INDEX `dc_posts_slug_key` (`slug`)",
      "ALTER TABLE `dc_posts` DROP FOREIGN KEY `dc_posts_author_fk`",
      "ALTER TABLE `dc_posts` DROP INDEX `dc_posts_title_idx`, DROP CHECK `c`",
    ]) {
      expect(shown(statement, "mysql"), statement).toBe(true);
    }
  });

  it("a registry row migrate:create writes for an entity whose table the snapshot holds", () => {
    expect(
      shown(
        `UPDATE "dynamic_collections" SET "label" = 'Posts' WHERE "slug" = 'posts'`
      )
    ).toBe(true);
    // Another entity's row is data like any other.
    expect(
      shown(
        `UPDATE "dynamic_collections" SET "label" = 'Pages' WHERE "slug" = 'pages'`
      )
    ).toBe(false);
  });

  it("the stored schema version moved after the file's registry rows, as the generator writes it", () => {
    const row = `UPDATE "dynamic_collections" SET "label" = 'Posts' WHERE "slug" = 'posts'`;
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const version = schemaVersionStoreSql(dialect);
      const statuses = (statements: string[]) =>
        statementsShownBySnapshot(statements, dialect, sides).map(
          proof => proof.status
        );
      const ownRow = dialect === "mysql" ? row.replace(/"/g, "`") : row;
      expect(statuses([ownRow, version]), dialect).toEqual(["shown", "shown"]);
      // As the splitter hands it over, without its closing semicolon.
      expect(statuses([ownRow, version.replace(/;$/, "")]), dialect).toEqual([
        "shown",
        "shown",
      ]);
      // Alone, before the row, or beside another entity's row, it is a write the snapshot does
      // not show: only a file's own registry rows bring it.
      expect(statuses([version]), dialect).toEqual(["unshown"]);
      expect(statuses([version, ownRow]), dialect).toEqual([
        "unshown",
        "shown",
      ]);
      expect(
        statuses([ownRow.replace(/posts/g, "pages"), version]),
        dialect
      ).toEqual(["unshown", "unshown"]);
      // Any other write to the same table is not it.
      expect(
        statuses([ownRow, version.replace("+ 1", "+ 2")]),
        dialect
      ).toEqual(["shown", "unshown"]);
    }
  });

  it("a SQLite table rebuild, its guard and its sequence carry, as the generator writes them", () => {
    const statements = [
      'CREATE TABLE "__nextly_swap_dc_posts_guard" ("foreign_keys" INTEGER NOT NULL, CONSTRAINT "refusal" CHECK ("foreign_keys" = 0))',
      'INSERT INTO "__nextly_swap_dc_posts_guard" ("foreign_keys") SELECT (SELECT "foreign_keys" FROM pragma_foreign_keys)',
      'DROP TABLE "__nextly_swap_dc_posts_guard"',
      "INSERT INTO sqlite_sequence (name, seq) SELECT '__new_dc_posts', seq FROM sqlite_sequence WHERE name = 'dc_posts'",
      'CREATE TABLE "__new_dc_posts" ("id" text NOT NULL, "title" text, "slug" text)',
      'INSERT INTO "__new_dc_posts" ("id", "title") SELECT "id", "title" FROM "dc_posts"',
      'DROP TABLE "dc_posts"',
      'ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"',
      'CREATE INDEX "dc_posts_title_idx" ON "dc_posts" ("title")',
      "PRAGMA foreign_key_check",
    ];
    expect(
      statementsShownBySnapshot(statements, "sqlite", sides).map(
        s => s.status === "shown"
      )
    ).toEqual(statements.map(() => true));
  });

  it("every statement the generator writes for a nullability change on each dialect", () => {
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const statements = generateStatements(
        [
          {
            type: "change_column_nullable",
            tableName: "dc_posts",
            columnName: "title",
            fromNullable: true,
            toNullable: false,
          },
        ],
        dialect,
        sides.target.tables
      );
      const read = statementsShownBySnapshot(statements, dialect, sides);
      expect(
        read
          .filter(statement => statement.status !== "shown")
          .map(s => s.label),
        dialect
      ).toEqual([]);
    }
  });
});

describe("proveStatements: rows a statement fills with its default", () => {
  /** A live schema holding every object, each usable: the statements' schema effect is there. */
  const everything: LiveSchemaWithColumnFacts = {
    hasTable: () => true,
    hasColumn: () => true,
    hasIndex: () => true,
    hasConstraint: () => true,
    usable: () => true,
    untrackedSettings: () => [],
    settingsReadable: () => true,
    generatesKey: () => true,
    identityMode: () => undefined,
    checkEnforced: () => true,
    keyDeferrability: () => "not",
    indexShape: () => "plain",
    counterCovers: () => true,
  };

  /** The statuses `proveStatements` gives, with `nulls` NULL rows in every column it counts. */
  async function prove(
    statements: string[],
    dialect: SupportedDialect,
    nulls: number
  ): Promise<{ statuses: string[]; counted: string[] }> {
    const counted: string[] = [];
    const proofs = await proveStatements({
      statements,
      dialect,
      sides,
      live: {
        schema: everything,
        nullsIn: (table, column) => {
          counted.push(`${table}.${column}`);
          return Promise.resolve(nulls);
        },
      },
    });
    return { statuses: proofs.map(proof => proof.status), counted };
  }

  const ADD_NOTE = `ALTER TABLE "dc_posts" ADD COLUMN "note" varchar(32) DEFAULT 'n'`;

  it("counts the rows under the name a later statement of the file leaves the column with", async () => {
    const { counted } = await prove(
      [ADD_NOTE, 'ALTER TABLE "dc_posts" RENAME COLUMN "note" TO "slug"'],
      "postgresql",
      0
    );
    expect(counted).toEqual(["dc_posts.slug"]);
    // A column a later statement drops has no rows left to count.
    const dropped = await prove(
      [ADD_NOTE, 'ALTER TABLE "dc_posts" DROP COLUMN "note"'],
      "postgresql",
      3
    );
    expect(dropped.counted).toEqual([]);
  });

  it("is not proven where rows it would have filled are still NULL", async () => {
    expect(await prove([ADD_NOTE], "postgresql", 2)).toEqual({
      statuses: ["unfilled"],
      counted: ["dc_posts.note"],
    });
  });

  it("is proven where no row is NULL there: filled by db:sync, or an empty table", async () => {
    expect((await prove([ADD_NOTE], "postgresql", 0)).statuses).toEqual([
      "shown",
    ]);
  });

  it("counts nothing for a NOT NULL column, or a default of NULL, which leave no row to fill", async () => {
    expect(
      await prove(
        [
          `ALTER TABLE "dc_posts" ADD COLUMN "state" varchar(32) NOT NULL DEFAULT 'draft'`,
          `ALTER TABLE "dc_posts" ADD COLUMN "note" varchar(32) DEFAULT NULL`,
          'ALTER TABLE "dc_posts" ADD COLUMN "slug" text',
        ],
        "postgresql",
        5
      )
    ).toEqual({ statuses: ["shown", "shown", "shown"], counted: [] });
  });

  it("passes a rebuild's copy of the table's own rows, counting the columns it leaves to their defaults", async () => {
    // At the file's end the twin is gone and the table stands in its place.
    const live: LiveSchemaWithColumnFacts = {
      ...everything,
      hasTable: name => !name.startsWith("__new_"),
    };
    const block = (copy: string) => [
      `CREATE TABLE "__new_dc_posts" ("id" text NOT NULL, "title" text, "note" text DEFAULT 'n')`,
      copy,
      'DROP TABLE "dc_posts"',
      'ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"',
    ];
    const OWN_ROWS =
      'INSERT INTO "__new_dc_posts" ("id", "title") SELECT "id", "title" FROM "dc_posts"';
    const prove = async (statements: string[], nulls: number) => {
      const counted: string[] = [];
      const proofs = await proveStatements({
        statements,
        dialect: "sqlite",
        sides,
        live: {
          schema: live,
          nullsIn: (table, column) => {
            counted.push(`${table}.${column}`);
            return Promise.resolve(nulls);
          },
        },
      });
      return { statuses: proofs.map(proof => proof.status), counted };
    };
    expect(await prove(block(OWN_ROWS), 0)).toEqual({
      statuses: ["shown", "shown", "shown", "shown"],
      counted: ["dc_posts.note"],
    });
    expect((await prove(block(OWN_ROWS), 1)).statuses).toEqual([
      "shown",
      "unfilled",
      "shown",
      "shown",
    ]);
    // Rows of the file's own put into the twin outlive it once it is moved into place.
    expect(
      (
        await prove(
          block(`INSERT INTO "__new_dc_posts" ("id") VALUES ('seeded')`),
          0
        )
      ).statuses
    ).toEqual(["shown", "unshown", "shown", "shown"]);
  });

  it("names such a statement in the refusal", async () => {
    let error: unknown;
    try {
      refuseUnlessProven({
        file: { filename: "20261116_add_note.sql", sha256: CHECKSUM },
        proof: {
          statements: await proveStatements({
            statements: [ADD_NOTE],
            dialect: "postgresql",
            sides,
            live: { schema: everything, nullsIn: () => Promise.resolve(3) },
          }),
          recordedChecksum: CHECKSUM,
        },
        attempt: undefined,
      });
    } catch (thrown) {
      error = thrown;
    }
    const message = (error as NextlyError).publicMessage;
    expect(message).toContain(
      "the database holds rows 1 statement would have filled with its default, still NULL"
    );
    expect(message).toContain(
      'ALTER TABLE "dc_posts" ADD COLUMN "note" varchar (rows it fills with its default are still NULL)'
    );
  });
});

describe("constraints a file adds that the database holds but does not enforce", () => {
  const fk = {
    name: "dc_posts_author_fk",
    columns: ["author"],
    referencesTable: "users",
    referencesColumns: ["id"],
    onDelete: "no action" as const,
    onUpdate: "no action" as const,
  };
  const withKey = {
    before: { tables: [] },
    target: { tables: [{ ...posts("title"), foreignKeys: [fk] }] },
  };

  it("does not prove a CREATE TABLE whose inline foreign key the database has not validated", async () => {
    const statuses = async (validated: boolean) =>
      (
        await proveStatements({
          statements: [
            'CREATE TABLE "dc_posts" ("id" text PRIMARY KEY, "title" text, "author" text, CONSTRAINT "dc_posts_author_fk" FOREIGN KEY ("author") REFERENCES "users" ("id"))',
          ],
          dialect: "postgresql",
          sides: withKey,
          live: {
            schema: {
              hasTable: () => true,
              hasColumn: () => true,
              hasIndex: () => true,
              hasConstraint: () => true,
              usable: object =>
                validated ||
                !(object.kind === "constraint" && object.name === fk.name),
              untrackedSettings: () => [],
              settingsReadable: () => true,
              generatesKey: () => true,
              identityMode: () => undefined,
              checkEnforced: () => true,
              keyDeferrability: () => "not",
              indexShape: () => "plain",
              counterCovers: () => true,
            },
            nullsIn: () => Promise.resolve(0),
          },
        })
      ).map(proof => proof.status);
    expect(await statuses(false)).toEqual(["not-done"]);
    expect(await statuses(true)).toEqual(["shown"]);
  });

  it("refuses rows dangling through a foreign key the file adds, and only those", () => {
    const dangling = [
      { table: "dc_posts", parent: "users", rows: 2 },
      { table: "dc_pages", parent: "users", rows: 5 },
    ];
    expect(danglingOnAddedKeys(withKey, dangling)).toEqual([dangling[0]]);
    // A key the database already had is not the file's: its rows do not refuse it.
    expect(
      danglingOnAddedKeys(
        { before: withKey.target, target: withKey.target },
        dangling
      )
    ).toEqual([]);
    let error: unknown;
    try {
      refuseUnlessProven({
        file: { filename: "20261116_add_author.sql", sha256: CHECKSUM },
        proof: {
          statements: [],
          recordedChecksum: CHECKSUM,
          dangling: [dangling[0]],
        },
        attempt: undefined,
      });
    } catch (thrown) {
      error = thrown;
    }
    expect((error as NextlyError).publicMessage).toContain(
      "the database holds 2 row(s) referencing rows that do not exist through a foreign key it adds (dc_posts → users)"
    );
  });
});

/** A live schema holding every object, each usable, with the column facts a case gives. */
const liveWith = (facts: {
  settings?: readonly string[];
  /** Whether the table's column settings can be read at all: not on an NDB table. */
  readable?: boolean;
  generatesKey?: boolean;
  /** The mode of every identity column the database holds. */
  identity?: "always" | "by-default";
  /** A column the database no longer has: the earlier name of one a `CHANGE` renamed. */
  gone?: string;
  /** Whether every check the database holds is enforced. */
  enforced?: boolean;
  /** How every foreign key the database holds defers its check. */
  deferrability?: "not" | "immediate" | "deferred";
  /** How every index the database holds is built; `null` for one the read did not find. */
  index?: "plain" | "other" | null;
  /** Whether every AUTOINCREMENT counter covers its table's rows. */
  counter?: boolean;
  /** Whether every constraint the database holds is validated. */
  validated?: boolean;
}): LiveSchemaWithColumnFacts => ({
  hasTable: () => true,
  hasColumn: (_table, column) => column !== facts.gone,
  hasIndex: () => true,
  hasConstraint: () => true,
  usable: () => facts.validated ?? true,
  checkEnforced: () => facts.enforced ?? true,
  keyDeferrability: () => facts.deferrability ?? "not",
  indexShape: () =>
    facts.index === null ? undefined : (facts.index ?? "plain"),
  counterCovers: () => facts.counter ?? true,
  untrackedSettings: () => facts.settings ?? [],
  settingsReadable: () => facts.readable ?? true,
  generatesKey: () => facts.generatesKey ?? true,
  identityMode: () => facts.identity,
});

/** The statuses `proveStatements` gives one MySQL or PostgreSQL file against `schema`. */
async function statusesAgainst(
  statements: string[],
  dialect: SupportedDialect,
  schema: LiveSchemaWithColumnFacts,
  between: typeof sides = sides
): Promise<string[]> {
  const proofs = await proveStatements({
    statements,
    dialect,
    sides: between,
    live: { schema, nullsIn: () => Promise.resolve(0) },
  });
  return proofs.map(proof => proof.status);
}

describe("a MySQL column restated by MODIFY or CHANGE", () => {
  const MODIFY = "ALTER TABLE `dc_posts` MODIFY COLUMN `slug` varchar(500)";
  const CHANGE = "ALTER TABLE `dc_posts` CHANGE COLUMN `title` `slug` text";

  it("is not proven where the live column keeps a setting the statement would reset", async () => {
    // The column already has the file's type, with a collation and a comment set by hand: a run
    // of the file would put both back, so a record without running leaves another database.
    const kept = liveWith({
      settings: ["COLLATE utf8mb4_bin", "COMMENT"],
      gone: "title",
    });
    expect(await statusesAgainst([MODIFY], "mysql", kept)).toEqual(["keeps"]);
    expect(await statusesAgainst([CHANGE], "mysql", kept)).toEqual(["keeps"]);
  });

  it("asks about the column as the statement leaves it named", async () => {
    const asked: string[] = [];
    const schema: LiveSchemaWithColumnFacts = {
      ...liveWith({ gone: "title" }),
      untrackedSettings: (table, column) => {
        asked.push(`${table}.${column}`);
        return [];
      },
    };
    await statusesAgainst([MODIFY], "mysql", schema);
    await statusesAgainst([CHANGE], "mysql", schema);
    expect(asked).toEqual(["dc_posts.slug", "dc_posts.slug"]);
  });

  it("reads the column past a condition written before the table or the column", async () => {
    const asked: string[] = [];
    const schema: LiveSchemaWithColumnFacts = {
      ...liveWith({}),
      untrackedSettings: (table, column) => {
        asked.push(`${table}.${column}`);
        return ["COMMENT"];
      },
    };
    for (const statement of [
      "ALTER TABLE IF EXISTS `dc_posts` MODIFY COLUMN `slug` varchar(500)",
      "ALTER TABLE `dc_posts` MODIFY COLUMN IF EXISTS `slug` varchar(500)",
    ]) {
      const [status] = await statusesAgainst([statement], "mysql", schema);
      // Shown or not, never recorded with the column unasked.
      expect(status === "keeps" || status === "unshown", statement).toBe(true);
    }
    expect(asked.every(each => each === "dc_posts.slug")).toBe(true);
  });

  it("is not shown on a table whose column settings cannot be read", async () => {
    // An NDB table's columns carry a format and a storage the catalog read here does not report,
    // and a restatement resets them like any other setting.
    expect(
      await statusesAgainst([MODIFY], "mysql", liveWith({ readable: false }))
    ).toEqual(["unshown"]);
  });

  it("is proven where the live column holds nothing the statement would reset", async () => {
    expect(await statusesAgainst([MODIFY], "mysql", liveWith({}))).toEqual([
      "shown",
    ]);
  });

  it("is not shown where the clause states what the snapshot does not record", () => {
    for (const tail of [
      "varchar(500) AFTER `title`",
      "varchar(500) FIRST",
      "varchar(500) COLLATE utf8mb4_bin",
      "varchar(500) CHARACTER SET latin1",
      "varchar(500) COMMENT 'by hand'",
      "varchar(500) INVISIBLE",
      "timestamp ON UPDATE CURRENT_TIMESTAMP",
      "int AUTO_INCREMENT",
      "int GENERATED ALWAYS AS (1) STORED",
      "point SRID 4326",
      "int DEFAULT (1) INVISIBLE",
      "int DEFAULT (1) FIRST",
      "int NOT NULL DEFAULT (1) COMMENT 'by hand'",
      "datetime(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
      "int DEFAULT",
      "varchar(500) NOT SECONDARY",
      "bigint SERIAL DEFAULT VALUE",
      "national varchar(500)",
    ]) {
      const statement = `ALTER TABLE \`dc_posts\` MODIFY COLUMN \`slug\` ${tail}`;
      expect(shown(statement, "mysql"), statement).toBe(false);
    }
    // What the generator writes of a restated column stays shown: type, nullability, default.
    for (const tail of [
      "varchar(500)",
      "varchar(500) NOT NULL DEFAULT 'first'",
      "text NULL",
      "bigint unsigned NOT NULL DEFAULT 0",
      "decimal(10,2) DEFAULT -1.5",
      "datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)",
      "json DEFAULT (JSON_ARRAY())",
      "binary(16) NULL DEFAULT NULL",
      "double precision",
      "enum('first','after') NOT NULL DEFAULT 'after'",
    ]) {
      const statement = `ALTER TABLE \`dc_posts\` MODIFY COLUMN \`slug\` ${tail}`;
      expect(shown(statement, "mysql"), statement).toBe(true);
    }
  });

  it("names such a statement and its reason in the refusal", async () => {
    const proofs = await proveStatements({
      statements: [MODIFY],
      dialect: "mysql",
      sides,
      live: {
        schema: liveWith({ settings: ["COMMENT"] }),
        nullsIn: () => Promise.resolve(0),
      },
    });
    let error: unknown;
    try {
      refuseUnlessProven({
        file: { filename: "20261116_widen_slug.sql", sha256: CHECKSUM },
        proof: { statements: proofs, recordedChecksum: CHECKSUM },
        attempt: undefined,
      });
    } catch (thrown) {
      error = thrown;
    }
    const message = (error as NextlyError).publicMessage;
    expect(message).toContain(
      "the database's columns keep settings 1 statement would reset"
    );
    expect(message).toContain(
      "ALTER TABLE `dc_posts` MODIFY COLUMN `slug` varchar (the column keeps settings it would reset)"
    );
  });
});

describe("a key the database assigns, on a table the file creates", () => {
  const counters = {
    name: "counters",
    columns: [
      { name: "id", type: "int4", nullable: false, autoIncrement: true },
      { name: "label", type: "text", nullable: true },
    ],
  };
  const creating = {
    before: { tables: [] },
    target: { tables: [counters] },
  };
  const CREATES: Array<[SupportedDialect, string]> = [
    [
      "postgresql",
      'CREATE TABLE "counters" ("id" serial PRIMARY KEY, "label" text)',
    ],
    [
      "postgresql",
      'CREATE TABLE "counters" ("id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, "label" text)',
    ],
    [
      "mysql",
      "CREATE TABLE `counters` (`id` int NOT NULL AUTO_INCREMENT PRIMARY KEY, `label` text)",
    ],
  ];

  it("is not proven where the live table's key is a plain column", async () => {
    // The table made by hand with an ordinary integer key: every insert leaving the key out
    // fails there, where the file's own table assigns it.
    for (const [dialect, create] of CREATES) {
      expect(
        await statusesAgainst(
          [create],
          dialect,
          liveWith({ generatesKey: false }),
          creating
        ),
        create
      ).toEqual(["not-done"]);
    }
  });

  it("is proven where the database assigns the key in the way declared", async () => {
    for (const [dialect, create] of CREATES) {
      expect(
        await statusesAgainst(
          [create],
          dialect,
          liveWith({
            generatesKey: true,
            identity: create.includes("IDENTITY") ? "always" : undefined,
          }),
          creating
        ),
        create
      ).toEqual(["shown"]);
    }
  });

  it("does not take an identity column for the serial key a file declares", async () => {
    // Both read as an integer the database assigns; an identity column refuses a written value
    // a serial one takes.
    expect(
      await statusesAgainst(
        [CREATES[0][1]],
        "postgresql",
        liveWith({ generatesKey: true, identity: "always" }),
        creating
      )
    ).toEqual(["not-done"]);
  });

  it("asks the same of a key a file adds to a table it changes", async () => {
    const ADDS: Array<[SupportedDialect, string]> = [
      ["postgresql", 'ALTER TABLE "dc_posts" ADD COLUMN "position" serial'],
      [
        "mysql",
        "ALTER TABLE `dc_posts` ADD COLUMN `position` int NOT NULL AUTO_INCREMENT UNIQUE",
      ],
    ];
    for (const [dialect, add] of ADDS) {
      expect(
        await statusesAgainst(
          [add],
          dialect,
          liveWith({ generatesKey: false })
        ),
        add
      ).toEqual(["not-done"]);
      expect(
        await statusesAgainst([add], dialect, liveWith({ generatesKey: true })),
        add
      ).toEqual(["shown"]);
    }
  });

  it("reads MySQL's SERIAL DEFAULT VALUE as a key the database assigns", async () => {
    expect(
      await statusesAgainst(
        [
          "CREATE TABLE `counters` (`id` bigint unsigned SERIAL DEFAULT VALUE, `label` text)",
        ],
        "mysql",
        liveWith({ generatesKey: false }),
        creating
      )
    ).toEqual(["not-done"]);
  });

  it("does not take a name or a constraint for a key the database assigns", async () => {
    const never = liveWith({ generatesKey: false });
    for (const [statement, between] of [
      [
        'CREATE TABLE "counters" ("id" integer PRIMARY KEY, "label" text REFERENCES identity (id))',
        creating,
      ],
      [
        'CREATE TABLE "counters" ("id" integer PRIMARY KEY, "label" text CHECK (identity > 0))',
        creating,
      ],
      [
        'ALTER TABLE "dc_posts" ADD CONSTRAINT serial CHECK ("title" <> \'\')',
        sides,
      ],
    ] as const) {
      expect(
        await statusesAgainst([statement], "postgresql", never, between),
        statement
      ).toEqual(["shown"]);
    }
  });

  /** A live schema whose only assigned key is `table.column`, noting each one asked about. */
  const assignedOnly = (table: string, column: string) => {
    const asked: string[] = [];
    const schema: LiveSchemaWithColumnFacts = {
      ...liveWith({}),
      hasColumn: (_table, name) => name !== "position",
      generatesKey: (on, name) => {
        asked.push(`${on}.${name}`);
        return on === table && name === column;
      },
    };
    return { schema, asked };
  };

  it("asks about a key under the name later statements of the file leave it with", async () => {
    const ADD = 'ALTER TABLE "dc_posts" ADD COLUMN "position" serial';
    const RENAME = 'ALTER TABLE "dc_posts" RENAME COLUMN "position" TO "slug"';
    // The column the file ends with is a plain integer: the key is not assigned there.
    const plain = assignedOnly("dc_posts", "title");
    expect(
      await statusesAgainst([ADD, RENAME], "postgresql", plain.schema)
    ).toEqual(["not-done", "shown"]);
    expect(plain.asked).toEqual(["dc_posts.slug"]);
    // The same file against a database that assigns it under its last name.
    const assigned = assignedOnly("dc_posts", "slug");
    expect(
      await statusesAgainst([ADD, RENAME], "postgresql", assigned.schema)
    ).toEqual(["shown", "shown"]);
  });

  it("follows a key through a renamed table, and MySQL's CHANGE", async () => {
    const renamedTable = assignedOnly("dc_pages", "position");
    expect(
      await statusesAgainst(
        [
          'ALTER TABLE "dc_posts" ADD COLUMN "position" serial',
          'ALTER TABLE "dc_posts" RENAME TO "dc_pages"',
        ],
        "postgresql",
        {
          ...renamedTable.schema,
          hasColumn: () => true,
          // The table stands under its new name alone.
          hasTable: name => name !== "dc_posts",
        },
        {
          before: sides.before,
          target: {
            tables: [...sides.target.tables, { ...posts(), name: "dc_pages" }],
          },
        }
      )
    ).toEqual(["shown", "shown"]);
    expect(renamedTable.asked).toEqual(["dc_pages.position"]);
  });

  it("follows every pair of a chained table rename, in order", async () => {
    const asked: string[] = [];
    const schema: LiveSchemaWithColumnFacts = {
      ...liveWith({}),
      untrackedSettings: (table, column) => {
        asked.push(`${table}.${column}`);
        return ["COMMENT"];
      },
    };
    // The table restated ends under the other's name: `dc_posts` to `tmp`, then `tmp` to
    // `dc_pages`, within one statement.
    const [status] = await statusesAgainst(
      [
        "ALTER TABLE `dc_posts` MODIFY COLUMN `slug` varchar(500)",
        "RENAME TABLE `dc_posts` TO `tmp`, `dc_pages` TO `dc_posts`, `tmp` TO `dc_pages`",
      ],
      "mysql",
      schema
    );
    expect(asked).toEqual(["dc_pages.slug"]);
    expect(status).toBe("keeps");
  });

  it("asks about a key made on a table the file later renames into place", async () => {
    const STAGED = [
      'CREATE TABLE "tmp_counters" ("id" serial PRIMARY KEY, "label" text)',
      'ALTER TABLE "tmp_counters" RENAME TO "counters"',
    ];
    const live = (assigned: boolean) => {
      const { schema, asked } = assignedOnly(
        assigned ? "counters" : "elsewhere",
        "id"
      );
      return {
        asked,
        schema: {
          ...schema,
          hasColumn: () => true,
          hasTable: (name: string) => name !== "tmp_counters",
        },
      };
    };
    const plain = live(false);
    expect(
      await statusesAgainst(STAGED, "postgresql", plain.schema, creating)
    ).toEqual(["not-done", "shown"]);
    expect(plain.asked).toEqual(["counters.id"]);
    expect(
      await statusesAgainst(STAGED, "postgresql", live(true).schema, creating)
    ).toEqual(["shown", "shown"]);
  });

  it("asks nothing of a key a later statement of the file makes plain", async () => {
    const CREATE =
      'CREATE TABLE "counters" ("id" serial PRIMARY KEY, "label" text)';
    for (const [dialect, statements] of [
      [
        "postgresql",
        [CREATE, 'ALTER TABLE "counters" ALTER COLUMN "id" DROP DEFAULT'],
      ],
      [
        "postgresql",
        [
          'CREATE TABLE "counters" ("id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, "label" text)',
          'ALTER TABLE "counters" ALTER COLUMN "id" DROP IDENTITY',
        ],
      ],
      [
        "mysql",
        [
          "ALTER TABLE `dc_posts` ADD COLUMN `position` int NOT NULL AUTO_INCREMENT UNIQUE",
          "ALTER TABLE `dc_posts` CHANGE COLUMN `position` `slug` int NOT NULL",
        ],
      ],
    ] as const) {
      const plain = assignedOnly("elsewhere", "id");
      // The statement that had the database assign the key is proven without asking: the file
      // itself leaves the column plain. (`DROP IDENTITY` is its own statement to prove, and the
      // snapshot records no identity to show it by.)
      const [made] = await statusesAgainst(
        [...statements],
        dialect,
        plain.schema,
        dialect === "mysql" ? sides : creating
      );
      expect(made, statements[1]).toBe("shown");
      expect(plain.asked, statements[1]).toEqual([]);
    }
  });

  it("holds an identity column to the mode the file declares", async () => {
    const identity = (mode: string) =>
      `CREATE TABLE "counters" ("id" integer GENERATED ${mode} AS IDENTITY PRIMARY KEY, "label" text)`;
    for (const [declared, live, status] of [
      ["ALWAYS", "always", "shown"],
      ["ALWAYS", "by-default", "not-done"],
      ["BY DEFAULT", "by-default", "shown"],
      ["BY DEFAULT", "always", "not-done"],
    ] as const) {
      expect(
        await statusesAgainst(
          [identity(declared)],
          "postgresql",
          liveWith({ identity: live }),
          creating
        ),
        `${declared} against ${live}`
      ).toEqual([status]);
    }
  });

  it("asks nothing of a key a later statement of the file drops", async () => {
    const dropped = assignedOnly("dc_posts", "title");
    expect(
      await statusesAgainst(
        [
          'ALTER TABLE "dc_posts" ADD COLUMN "position" serial',
          'ALTER TABLE "dc_posts" DROP COLUMN "position"',
        ],
        "postgresql",
        dropped.schema
      )
    ).toEqual(["shown", "shown"]);
    expect(dropped.asked).toEqual([]);
  });

  it("asks nothing of a key the file leaves plain, or of SQLite's rowid key", async () => {
    const never = liveWith({ generatesKey: false });
    expect(
      await statusesAgainst(
        ['CREATE TABLE "counters" ("id" integer PRIMARY KEY, "label" text)'],
        "postgresql",
        never,
        creating
      )
    ).toEqual(["shown"]);
    expect(
      await statusesAgainst(
        ['CREATE TABLE "counters" ("id" integer PRIMARY KEY, "label" text)'],
        "sqlite",
        never,
        creating
      )
    ).toEqual(["shown"]);
  });
});

describe("rows dangling through one of two keys between the same tables", () => {
  const key = (name: string, column: string) => ({
    name,
    columns: [column],
    referencesTable: "users",
    referencesColumns: ["id"],
    onDelete: "no action" as const,
    onUpdate: "no action" as const,
  });
  const author = key("fk_dc_posts_author", "author");
  const editor = key("fk_dc_posts_editor", "editor");
  const between = {
    before: { tables: [{ ...posts("title"), foreignKeys: [author] }] },
    target: { tables: [{ ...posts("title"), foreignKeys: [author, editor] }] },
  };

  it("does not blame the added key for rows dangling through the one the database had", () => {
    const throughAuthor = {
      table: "dc_posts",
      parent: "users",
      rows: 3,
      columns: ["author"],
    };
    const throughEditor = { ...throughAuthor, rows: 1, columns: ["editor"] };
    expect(danglingOnAddedKeys(between, [throughAuthor])).toEqual([]);
    expect(
      danglingOnAddedKeys(between, [throughAuthor, throughEditor])
    ).toEqual([throughEditor]);
  });

  it("tells two keys from the same column to different columns of the parent apart", () => {
    const toId = key("fk_dc_posts_author", "author");
    const toEmail = {
      ...key("fk_dc_posts_author_email", "author"),
      referencesColumns: ["email"],
    };
    const twoTargets = {
      before: { tables: [{ ...posts("title"), foreignKeys: [toId] }] },
      target: { tables: [{ ...posts("title"), foreignKeys: [toId, toEmail] }] },
    };
    const through = (referencesColumns: string[]) => ({
      table: "dc_posts",
      parent: "users",
      rows: 2,
      columns: ["author"],
      referencesColumns,
    });
    // Rows dangling through the key the database had are not the added key's.
    expect(danglingOnAddedKeys(twoTargets, [through(["id"])])).toEqual([]);
    expect(danglingOnAddedKeys(twoTargets, [through(["email"])])).toEqual([
      through(["email"]),
    ]);
  });

  it("still reads a count that names no key by its table pair", () => {
    const unnamed = { table: "dc_posts", parent: "users", rows: 3 };
    expect(danglingOnAddedKeys(between, [unnamed])).toEqual([unnamed]);
    const unread = { ...unnamed, columns: [] };
    expect(danglingOnAddedKeys(between, [unread])).toEqual([unread]);
  });
});

describe("what a hand-made database can hold under the names a file writes", () => {
  const one = async (
    statement: string,
    dialect: SupportedDialect,
    facts: Parameters<typeof liveWith>[0],
    later: string[] = []
  ) =>
    (await statusesAgainst([statement, ...later], dialect, liveWith(facts)))[0];

  it("a constraint a file validates must be validated in the database", async () => {
    const VALIDATE =
      'ALTER TABLE "dc_posts" VALIDATE CONSTRAINT "dc_posts_author_fk"';
    expect(await one(VALIDATE, "postgresql", { validated: false })).toBe(
      "not-done"
    );
    expect(await one(VALIDATE, "postgresql", { validated: true })).toBe(
      "shown"
    );
    // One a later statement of the file drops is not asked about.
    expect(
      await one(VALIDATE, "postgresql", { validated: false }, [
        'ALTER TABLE "dc_posts" DROP CONSTRAINT "dc_posts_author_fk"',
      ])
    ).toBe("shown");
  });

  it("a MySQL check is held to the enforcement the file declares", async () => {
    const ADD =
      "ALTER TABLE `dc_posts` ADD CONSTRAINT `dc_posts_title_ck` CHECK (`title` <> '')";
    for (const [statement, enforced, status] of [
      [ADD, true, "shown"],
      // Altered by hand to NOT ENFORCED under the file's name: there, and checking nothing.
      [ADD, false, "not-done"],
      [`${ADD} NOT ENFORCED`, false, "shown"],
      [`${ADD} NOT ENFORCED`, true, "not-done"],
      [`${ADD} ENFORCED`, false, "not-done"],
      [
        "CREATE TABLE `dc_posts` (`id` varchar(36) PRIMARY KEY, `title` text, CONSTRAINT `dc_posts_title_ck` CHECK (`title` <> ''))",
        false,
        "not-done",
      ],
    ] as const) {
      expect(await one(statement, "mysql", { enforced }), statement).toBe(
        status
      );
    }
    // One a later statement of the file drops is not asked about, and the table is followed.
    expect(
      await one(ADD, "mysql", { enforced: false }, [
        "ALTER TABLE `dc_posts` DROP CHECK `dc_posts_title_ck`",
      ])
    ).toBe("shown");
  });

  it("a PostgreSQL foreign key is held to the deferrability the file declares", async () => {
    const ADD =
      'ALTER TABLE "dc_posts" ADD CONSTRAINT "dc_posts_author_fk" FOREIGN KEY ("title") REFERENCES "dc_posts" ("id")';
    for (const [tail, live, status] of [
      ["", "not", "shown"],
      // Made by hand DEFERRABLE under the file's name.
      ["", "immediate", "not-done"],
      ["", "deferred", "not-done"],
      [" NOT DEFERRABLE", "not", "shown"],
      [" DEFERRABLE", "immediate", "shown"],
      [" DEFERRABLE INITIALLY IMMEDIATE", "immediate", "shown"],
      [" DEFERRABLE INITIALLY DEFERRED", "deferred", "shown"],
      [" DEFERRABLE INITIALLY DEFERRED", "immediate", "not-done"],
      [" DEFERRABLE", "not", "not-done"],
    ] as const) {
      expect(
        await one(`${ADD}${tail}`, "postgresql", { deferrability: live }),
        `${tail} against ${live}`
      ).toBe(status);
    }
    // MySQL has no deferrable keys, and SQLite's are not read: neither is asked.
    expect(
      await one(
        "ALTER TABLE `dc_posts` ADD CONSTRAINT `dc_posts_author_fk` FOREIGN KEY (`title`) REFERENCES `dc_posts` (`id`)",
        "mysql",
        { deferrability: "deferred" }
      )
    ).toBe("shown");
  });

  it("an index a file creates must be a plain one in the database", async () => {
    const CREATE = 'CREATE INDEX "dc_posts_slug_idx" ON "dc_posts" ("slug")';
    const ADD = "ALTER TABLE `dc_posts` ADD INDEX `dc_posts_slug_idx` (`slug`)";
    for (const [statement, dialect] of [
      [CREATE, "postgresql"],
      [CREATE, "sqlite"],
      [ADD, "mysql"],
      [
        "CREATE UNIQUE INDEX `dc_posts_slug_idx` ON `dc_posts` (`slug`)",
        "mysql",
      ],
    ] as const) {
      expect(await one(statement, dialect, { index: "plain" }), statement).toBe(
        "shown"
      );
      // Made by hand under the file's name, descending or by another method.
      expect(await one(statement, dialect, { index: "other" }), statement).toBe(
        "not-done"
      );
      // One the read did not find is not taken for a plain one.
      expect(await one(statement, dialect, { index: null }), statement).toBe(
        "not-done"
      );
    }
    // One a later statement of the file drops is not asked about.
    expect(
      await one(CREATE, "postgresql", { index: "other" }, [
        'DROP INDEX "dc_posts_slug_idx"',
      ])
    ).toBe("shown");
  });

  it("an index statement that states a direction, a NULL order or a method is not shown", () => {
    for (const [statement, dialect] of [
      ['CREATE INDEX "i" ON "dc_posts" ("slug" DESC)', "postgresql"],
      ['CREATE INDEX "i" ON "dc_posts" ("slug" NULLS FIRST)', "postgresql"],
      ['CREATE INDEX "i" ON "dc_posts" USING hash ("slug")', "postgresql"],
      ['CREATE INDEX "i" ON "dc_posts" ("slug" DESC)', "sqlite"],
      ["CREATE INDEX `i` ON `dc_posts` (`slug` DESC)", "mysql"],
      ["CREATE INDEX `i` USING HASH ON `dc_posts` (`slug`)", "mysql"],
      ["CREATE FULLTEXT INDEX `i` ON `dc_posts` (`slug`)", "mysql"],
      ["ALTER TABLE `dc_posts` ADD INDEX `i` (`slug` DESC)", "mysql"],
      ["ALTER TABLE `dc_posts` ADD INDEX `i` USING HASH (`slug`)", "mysql"],
    ] as const) {
      expect(shown(statement, dialect), statement).toBe(false);
    }
    // The plain statements the generator writes stay shown, a key prefix and a predicate included.
    for (const [statement, dialect] of [
      ['CREATE INDEX IF NOT EXISTS "i" ON "dc_posts" ("slug")', "postgresql"],
      [
        'CREATE UNIQUE INDEX "i" ON "dc_posts" ("slug") WHERE "slug" IS NOT NULL',
        "postgresql",
      ],
      ['CREATE INDEX "i" ON "dc_posts" ((lower("slug")))', "postgresql"],
      ["CREATE INDEX `i` ON `dc_posts` (`slug`(191))", "mysql"],
      ["ALTER TABLE `dc_posts` ADD UNIQUE INDEX `i` (`slug`)", "mysql"],
    ] as const) {
      expect(shown(statement, dialect), statement).toBe(true);
    }
  });

  it("a SQLite rebuild's sequence carry needs a counter that covers the table's rows", async () => {
    const REBUILD = [
      "INSERT INTO sqlite_sequence (name, seq) SELECT '__new_dc_posts', seq FROM sqlite_sequence WHERE name = 'dc_posts'",
      'CREATE TABLE "__new_dc_posts" ("id" text NOT NULL, "title" text, "slug" text)',
      'INSERT INTO "__new_dc_posts" ("id", "title") SELECT "id", "title" FROM "dc_posts"',
      'DROP TABLE "dc_posts"',
      'ALTER TABLE "__new_dc_posts" RENAME TO "dc_posts"',
    ];
    const asked: string[] = [];
    const live = (covers: boolean): LiveSchemaWithColumnFacts => ({
      ...liveWith({}),
      counterCovers: table => {
        asked.push(table);
        return covers;
      },
    });
    expect((await statusesAgainst(REBUILD, "sqlite", live(false)))[0]).toBe(
      "not-done"
    );
    expect((await statusesAgainst(REBUILD, "sqlite", live(true)))[0]).toBe(
      "shown"
    );
    // Asked of the table the counter is carried for, under the name the file leaves it with.
    expect(new Set(asked)).toEqual(new Set(["dc_posts"]));
  });

  it("a same-name foreign key of another shape counts as one the file adds", () => {
    const key = (referencesTable: string) => ({
      name: "fk_dc_posts_author",
      columns: ["author"],
      referencesTable,
      referencesColumns: ["id"],
      onDelete: "no action" as const,
      onUpdate: "no action" as const,
    });
    const retargeted = {
      before: { tables: [{ ...posts("title"), foreignKeys: [key("users")] }] },
      target: {
        tables: [{ ...posts("title"), foreignKeys: [key("accounts")] }],
      },
    };
    const dangling = {
      table: "dc_posts",
      parent: "accounts",
      rows: 2,
      columns: ["author"],
      referencesColumns: ["id"],
    };
    expect(danglingOnAddedKeys(retargeted, [dangling])).toEqual([dangling]);
    // The same key on both sides is not the file's.
    expect(
      danglingOnAddedKeys(
        { before: retargeted.target, target: retargeted.target },
        [dangling]
      )
    ).toEqual([]);
  });
});
