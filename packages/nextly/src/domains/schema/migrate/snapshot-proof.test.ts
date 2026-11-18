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
import type { LiveSchema } from "./statement-judgement";

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
  const everything: LiveSchema = {
    hasTable: () => true,
    hasColumn: () => true,
    hasIndex: () => true,
    hasConstraint: () => true,
    usable: () => true,
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
    const live: LiveSchema = {
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
