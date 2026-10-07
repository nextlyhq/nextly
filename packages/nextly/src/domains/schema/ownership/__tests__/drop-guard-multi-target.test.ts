/**
 * A DROP naming more than one table must be judged on ALL of them, and the
 * reader has to find every table the DATABASE would drop, read the way the
 * dialect it runs on reads it.
 *
 * `DROP TABLE a, b` is one statement and two tables. The parser read only the
 * first, so a module entitled to drop `a` could take `b` with it — belonging
 * to another stream, with the guard approving the statement because the name
 * it looked at was the legitimate one. The repository's own integration setup
 * writes comma-separated drops, so this shape is not hypothetical.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  assertNoForeignDrops,
  tablesDroppedBy,
  UnparsableDropTarget,
} from "../drop-guard";
import { splitSqlStatements } from "../../migrate/split-sql";
import { sqliteTableRebuildStatements } from "../../pipeline/sql-templates/sqlite-rebuild";
import type { OwnerRecord } from "../owner-registry";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

const owners = new Map<string, OwnerRecord>([
  [
    "app_notes",
    {
      tableName: "app_notes",
      ownerKind: "app",
      ownerId: "app",
      migratedBy: "app",
      ownerVersion: null,
      schemaVersion: null,
      state: "active",
    },
  ],
]);

function guard(statements: string[], dialect: SupportedDialect): void {
  assertNoForeignDrops({
    statements,
    stream: "plugin:fx",
    owners,
    dialect,
    source: "plugin:fx/001",
  });
}

describe.each(DIALECTS)("tablesDroppedBy on %s", dialect => {
  it("names every table in a comma-separated drop", () => {
    expect(
      tablesDroppedBy(["DROP TABLE IF EXISTS fx__notes, app_notes"], dialect)
    ).toEqual(["fx__notes", "app_notes"]);
  });

  it("still reads a single drop, with its qualifier and quotes", () => {
    // The control: the common shape has to keep working. MySQL reads
    // `"..."` as a name under ANSI_QUOTES, so it is accepted there too.
    expect(
      tablesDroppedBy(['DROP TABLE "public"."fx__notes"'], dialect)
    ).toEqual(["fx__notes"]);
  });

  it("allows the CASCADE / RESTRICT tail rather than reading it as a table", () => {
    expect(tablesDroppedBy(["DROP TABLE fx__notes CASCADE;"], dialect)).toEqual(
      ["fx__notes"]
    );
  });
});

describe.each(DIALECTS)("comments in a DROP on %s", dialect => {
  it("reads the table behind a block comment", () => {
    // `DROP TABLE app_notes /* note */` parsed to a target carrying the
    // comment, which matched no owner row — and a table with no owner is
    // waved through, so the comment dropped somebody else's table past the
    // guard.
    expect(
      tablesDroppedBy(["DROP TABLE app_notes /* keep this */"], dialect)
    ).toEqual(["app_notes"]);
  });

  it("reads a commented target inside a comma-separated drop", () => {
    expect(
      tablesDroppedBy(["DROP TABLE fx__notes, /* and */ app_notes"], dialect)
    ).toEqual(["fx__notes", "app_notes"]);
  });

  it("refuses a commented drop of a foreign table", () => {
    expect(() => guard(["DROP TABLE app_notes /* sneaky */"], dialect)).toThrow(
      /different owner/i
    );
  });

  it("refuses a target it cannot read at all, rather than waving it through", () => {
    // Failing CLOSED: an unreadable name carried through to the owner lookup
    // would be treated as nobody's table and allowed.
    expect(() => tablesDroppedBy(["DROP TABLE (SELECT 1)"], dialect)).toThrow(
      UnparsableDropTarget
    );
  });
});

describe.each(DIALECTS)("assertNoForeignDrops on %s", dialect => {
  it("refuses a multi-target drop that takes a foreign table with it", () => {
    expect(() => guard(["DROP TABLE fx__notes, app_notes"], dialect)).toThrow(
      /different owner/i
    );
  });

  it("allows a multi-target drop of tables this stream owns", () => {
    // The control. A guard that refused every multi-target statement would
    // pass the case above while breaking legitimate migrations.
    expect(() =>
      guard(["DROP TABLE fx__notes, fx__tags"], dialect)
    ).not.toThrow();
  });
});

/**
 * Shapes that read the same on every dialect. Each either hid a real target
 * from an earlier reader or made it read the wrong name — and a wrong name
 * matches no owner row, which is an approval.
 */
describe.each(DIALECTS)("what %s would drop", dialect => {
  it.each([
    [
      "a comment before the DROP",
      "/* x */ DROP TABLE app_notes",
      ["app_notes"],
    ],
    [
      "a line comment before it",
      "-- note\nDROP TABLE app_notes",
      ["app_notes"],
    ],
    // PostgreSQL ends a line comment at a carriage return too.
    [
      "a line comment ended by a carriage return",
      "-- note\rDROP TABLE app_notes",
      ["app_notes"],
    ],
    ["lower case and a trailing ;", "drop table app_notes;", ["app_notes"]],
    [
      "tabs and newlines between every token",
      'DROP\tTABLE\n  IF\n EXISTS\t"app_notes"\n CASCADE ;',
      ["app_notes"],
    ],
    [
      "a comment between DROP and TABLE",
      "DROP/**/TABLE app_notes",
      ["app_notes"],
    ],
    [
      "MySQL's DROP TEMPORARY TABLE",
      "DROP TEMPORARY TABLE app_notes",
      ["app_notes"],
    ],
    [
      "MySQL's DROP TABLES synonym",
      "DROP TABLES fx__notes, app_notes",
      ["fx__notes", "app_notes"],
    ],
    // PostgreSQL folds an unquoted name, so this drops `app_notes`.
    ["an upper-case name", "DROP TABLE APP_NOTES", ["app_notes"]],
    [
      "space around the qualifier dot",
      "DROP TABLE public . app_notes",
      ["app_notes"],
    ],
    [
      "a qualified, quoted name and RESTRICT",
      'DROP TABLE "public"."app_notes" RESTRICT',
      ["app_notes"],
    ],
    ["a doubled quote inside a name", 'DROP TABLE "we""ird"', ['we"ird']],
    // A second statement in the same string runs on a multi-statement driver.
    [
      "a DROP after another statement",
      "SELECT 1; DROP TABLE app_notes",
      ["app_notes"],
    ],
    // `'-- '` is a string, not a comment.
    [
      "a comment marker inside a string",
      "SELECT '-- '; DROP TABLE app_notes",
      ["app_notes"],
    ],
    [
      "a block comment split across two strings",
      "SELECT '/*'; DROP TABLE app_notes; SELECT '*/'",
      ["app_notes"],
    ],
    // Comment markers inside a quoted name are part of the name.
    [
      "comment markers inside quoted names",
      'DROP TABLE "fx/*", app_notes, "*/"',
      ["fx/*", "app_notes", "*/"],
    ],
    // Non-ASCII continues a bare name in every dialect; stopping at it ended
    // the list before the database did.
    [
      "a non-ASCII name before a comma",
      "DROP TABLE fx__notesé, app_notes",
      ["fx__notesé", "app_notes"],
    ],
    // On PostgreSQL the `$$` body is read as code; on MySQL and SQLite `$$`
    // is an ordinary word, so the DROP between them is read either way.
    [
      "a DROP inside a function body",
      "CREATE FUNCTION f() RETURNS void AS $$ BEGIN DROP TABLE app_notes; END $$ LANGUAGE plpgsql",
      ["app_notes"],
    ],
    ["an upper-case rebuild twin", "DROP TABLE __NEW_app_notes", ["app_notes"]],
  ])("reads %s", (_shape, statement, expected) => {
    expect(tablesDroppedBy([statement], dialect)).toEqual(expected);
  });

  it.each([
    // PostgreSQL's U&"..." is one identifier, spelled with escapes; anywhere
    // else `U&` is a name followed by an operator.
    ["a unicode-escaped name", 'DROP TABLE U&"\\0061pp_notes"'],
    ["an unterminated quoted name", 'DROP TABLE "app_notes'],
    ["an unterminated string", "SELECT 'x; DROP TABLE app_notes"],
    ["an unterminated block comment", "DROP TABLE app_notes /* x"],
    ["a list ending in a comma", "DROP TABLE fx__notes,"],
    ["a DROP naming nothing", "DROP TABLE"],
    ["a qualifier with no table", "DROP TABLE public."],
    // Text the reader did not understand after the list is refused rather
    // than ignored: it may be more of the list, in a form this cannot read.
    ["unread text after the list", "DROP TABLE app_notes garbage"],
    ["a name after CASCADE", "DROP TABLE fx__notes CASCADE app_notes"],
    // All three remove tables without naming one, so no owner lookup can
    // judge them.
    ["DROP SCHEMA", "DROP SCHEMA public CASCADE"],
    ["DROP DATABASE", "DROP DATABASE nextly"],
    ["DROP OWNED", "DROP OWNED BY nextly_app"],
  ])("refuses %s", (_shape, statement) => {
    expect(() => tablesDroppedBy([statement], dialect)).toThrow(
      UnparsableDropTarget
    );
  });

  it.each([
    "ALTER TABLE app_notes DROP COLUMN body",
    "ALTER TABLE app_notes DROP CONSTRAINT fk_app_notes_author",
    "DROP INDEX idx_app_notes_title",
    "DROP VIEW app_notes_view",
    "DROP SEQUENCE app_notes_id_seq",
    "CREATE TABLE backdrop (drop_table int, dropped boolean)",
    "SELECT 1",
    // Text inside a string literal is data, never a drop.
    "INSERT INTO fx__notes VALUES ('how to drop table salt')",
    "COMMENT ON TABLE fx__notes IS 'drop table app_notes'",
    "INSERT INTO fx__notes VALUES ('it''s; DROP TABLE app_notes')",
  ])("reads no table and does not refuse: %s", statement => {
    expect(tablesDroppedBy([statement], dialect)).toEqual([]);
  });

  it("does not refuse a migration that only mentions a drop in a string", () => {
    expect(() =>
      guard(
        [
          "INSERT INTO fx__notes VALUES ('how to drop table salt')",
          "COMMENT ON TABLE fx__notes IS 'drop table app_notes'",
        ],
        dialect
      )
    ).not.toThrow();
  });
});

describe("shapes each dialect reads differently", () => {
  it.each<[SupportedDialect, string[] | "refused"]>([
    ["postgresql", "refused"],
    ["mysql", ["app_notes"]],
    ["sqlite", ["app_notes"]],
  ])("a backtick-quoted name on %s", (dialect, expected) => {
    // A backtick quotes a name in MySQL and SQLite; PostgreSQL has no such
    // quoting, so nothing readable follows TABLE.
    const read = () =>
      tablesDroppedBy(["DROP TABLE IF EXISTS `app_notes`;"], dialect);
    if (expected === "refused") expect(read).toThrow(UnparsableDropTarget);
    else expect(read()).toEqual(expected);
  });

  it.each<[SupportedDialect, string[] | "refused"]>([
    ["postgresql", "refused"],
    ["mysql", "refused"],
    ["sqlite", ["app_notes"]],
  ])("a bracketed name on %s", (dialect, expected) => {
    const read = () => tablesDroppedBy(["DROP TABLE [app_notes]"], dialect);
    if (expected === "refused") expect(read).toThrow(UnparsableDropTarget);
    else expect(read()).toEqual(expected);
  });

  it.each<[SupportedDialect, string[] | "refused"]>([
    ["postgresql", "refused"],
    ["mysql", "refused"],
    ["sqlite", ["app_notes"]],
  ])("a single-quoted name on %s", (dialect, expected) => {
    // SQLite accepts a string literal where a name is expected; elsewhere it
    // is a string, which is not a table name.
    const read = () => tablesDroppedBy(["DROP TABLE 'app_notes'"], dialect);
    if (expected === "refused") expect(read).toThrow(UnparsableDropTarget);
    else expect(read()).toEqual(expected);
  });

  describe("nested block comments", () => {
    const statement = "DROP TABLE /* /* */ fx__notes */ app_notes";

    it("reads the table PostgreSQL drops, past a nested comment", () => {
      // PostgreSQL nests block comments: the whole `/* /* */ fx__notes */`
      // is one comment, and the statement drops `app_notes`.
      expect(tablesDroppedBy([statement], "postgresql")).toEqual(["app_notes"]);
      expect(() => guard([statement], "postgresql")).toThrow(
        /different owner/i
      );
    });

    it.each<SupportedDialect>(["mysql", "sqlite"])(
      "refuses it on %s, where the first */ ends the comment",
      dialect => {
        // The comment ends at the first `*/`, which leaves
        // `fx__notes */ app_notes`: a name followed by text that is neither
        // a list separator nor the end of the statement, so it is refused.
        expect(() => tablesDroppedBy([statement], dialect)).toThrow(
          UnparsableDropTarget
        );
      }
    );
  });

  describe("MySQL line comments", () => {
    it("reads MySQL's --1 as arithmetic, not a comment", () => {
      expect(
        tablesDroppedBy(["SELECT 1--1; DROP TABLE app_notes"], "mysql")
      ).toEqual(["app_notes"]);
    });

    it.each<SupportedDialect>(["postgresql", "sqlite"])(
      "reads --1 as a comment on %s, so nothing after it runs",
      dialect => {
        expect(
          tablesDroppedBy(["SELECT 1--1; DROP TABLE app_notes"], dialect)
        ).toEqual([]);
      }
    );

    it("reads # as a comment on MySQL, inside a list and after it", () => {
      expect(tablesDroppedBy(["DROP TABLE app_notes # x"], "mysql")).toEqual([
        "app_notes",
      ]);
      expect(
        tablesDroppedBy(["DROP TABLE fx__notes # x\n, app_notes"], "mysql")
      ).toEqual(["fx__notes", "app_notes"]);
      expect(
        tablesDroppedBy(["SELECT 1 # ; DROP TABLE app_notes"], "mysql")
      ).toEqual([]);
    });

    it.each<SupportedDialect>(["postgresql", "sqlite"])(
      "does not read # as a comment on %s",
      dialect => {
        // In PostgreSQL `#` is an operator, so the drop after it runs.
        expect(
          tablesDroppedBy(["SELECT 1 # 2; DROP TABLE app_notes"], dialect)
        ).toEqual(["app_notes"]);
        expect(() =>
          tablesDroppedBy(["DROP TABLE app_notes # x"], dialect)
        ).toThrow(UnparsableDropTarget);
      }
    );
  });

  describe("MySQL executable comments", () => {
    it.each([
      // MySQL EXECUTES the body of `/*! */`, so this drops both tables.
      ["one in the list", "DROP TABLE fx__notes /*!, app_notes */"],
      ["a versioned one", "DROP TABLE fx__notes /*!50001 , app_notes */"],
      ["a DROP wholly inside one", "/*!50001 DROP TABLE app_notes */"],
      ["a MariaDB one", "DROP TABLE fx__notes /*M!, app_notes */"],
    ])("refuses %s on MySQL", (_shape, statement) => {
      expect(() => tablesDroppedBy([statement], "mysql")).toThrow(
        UnparsableDropTarget
      );
    });

    it.each<SupportedDialect>(["postgresql", "sqlite"])(
      "reads it as the ordinary comment it is on %s",
      dialect => {
        expect(
          tablesDroppedBy(["DROP TABLE fx__notes /*!, app_notes */"], dialect)
        ).toEqual(["fx__notes"]);
      }
    );

    it("does not refuse the marker inside a string", () => {
      expect(tablesDroppedBy(["SELECT '/*!'"], "mysql")).toEqual([]);
    });
  });

  describe("backslashes in strings", () => {
    it.each([
      ["a single-quoted string", "SELECT 'it\\'s'; DROP TABLE app_notes"],
      ["a double-quoted string", 'SELECT "a\\"; DROP TABLE app_notes'],
      ["an escaped backslash before the quote", "SELECT 'a\\\\'"],
    ])(
      "refuses a backslash before the closing quote in %s on MySQL",
      (_shape, statement) => {
        // Whether the string ends there depends on NO_BACKSLASH_ESCAPES.
        expect(() => tablesDroppedBy([statement], "mysql")).toThrow(
          UnparsableDropTarget
        );
      }
    );

    it("reads a MySQL backslash anywhere else as either setting reads it", () => {
      expect(
        tablesDroppedBy(["SELECT 'a\\nb'; DROP TABLE app_notes"], "mysql")
      ).toEqual(["app_notes"]);
    });

    it("refuses one in a PostgreSQL plain string, which standard_conforming_strings decides", () => {
      expect(() =>
        tablesDroppedBy(
          ["SELECT 'it\\' ' DROP TABLE app_notes; -- '"],
          "postgresql"
        )
      ).toThrow(UnparsableDropTarget);
    });

    it("honours backslash escapes in a PostgreSQL E'' string", () => {
      expect(
        tablesDroppedBy(
          ["SELECT E'it\\'s'; DROP TABLE app_notes"],
          "postgresql"
        )
      ).toEqual(["app_notes"]);
      expect(
        tablesDroppedBy(
          ["SELECT E'it\\'s; DROP TABLE app_notes'"],
          "postgresql"
        )
      ).toEqual([]);
    });

    it("treats a SQLite backslash as an ordinary character", () => {
      expect(
        tablesDroppedBy(["SELECT 'a\\'; DROP TABLE app_notes"], "sqlite")
      ).toEqual(["app_notes"]);
    });
  });
});

describe("PostgreSQL dollar-quoted bodies", () => {
  it.each([
    ["a DO block", "DO $$ BEGIN DROP TABLE app_notes; END $$"],
    ["a tagged body", "DO $fn$ BEGIN DROP TABLE app_notes; END $fn$"],
    ["a body with no statement end", "SELECT $$DROP TABLE app_notes$$"],
    [
      "a body nested in another",
      "DO $outer$ BEGIN PERFORM $inner$x$inner$; DROP TABLE app_notes; END $outer$",
    ],
  ])("reads the DROP in %s", (_shape, statement) => {
    expect(tablesDroppedBy([statement], "postgresql")).toEqual(["app_notes"]);
  });

  it("does not read a positional parameter as a delimiter", () => {
    expect(
      tablesDroppedBy(["SELECT $1; DROP TABLE app_notes"], "postgresql")
    ).toEqual(["app_notes"]);
  });

  it("refuses an unterminated body", () => {
    expect(() =>
      tablesDroppedBy(["DO $$ BEGIN DROP TABLE app_notes;"], "postgresql")
    ).toThrow(UnparsableDropTarget);
  });

  it("ends a DROP's list at the body's edge", () => {
    expect(
      tablesDroppedBy(
        ["DO $$ BEGIN DROP TABLE fx__notes; END $$; SELECT app_notes"],
        "postgresql"
      )
    ).toEqual(["fx__notes"]);
  });
});

/**
 * A rename carries a table's identity to a new name, so a later drop of that
 * name is a drop of the original table — which no owner row names by the new
 * name, and so was approved.
 */
describe("renames before a drop", () => {
  describe.each(DIALECTS)("on %s", dialect => {
    it("judges a drop of a renamed table as a drop of the original", () => {
      const statements = [
        "ALTER TABLE app_notes RENAME TO zz",
        "DROP TABLE zz",
      ];
      expect(tablesDroppedBy(statements, dialect)).toEqual(["app_notes", "zz"]);
      expect(() => guard(statements, dialect)).toThrow(/different owner/i);
    });

    it("follows a rename inside the same statement text", () => {
      expect(
        tablesDroppedBy(
          ["ALTER TABLE app_notes RENAME TO zz; DROP TABLE zz"],
          dialect
        )
      ).toEqual(["app_notes", "zz"]);
    });

    it("resolves a chain of renames to the first name", () => {
      expect(
        tablesDroppedBy(
          [
            "ALTER TABLE app_notes RENAME TO b",
            'ALTER TABLE IF EXISTS "b" RENAME TO c',
            "DROP TABLE c",
          ],
          dialect
        )
      ).toEqual(["app_notes", "c"]);
    });

    it("leaves a drop of an unrenamed table alone", () => {
      expect(
        tablesDroppedBy(
          ["ALTER TABLE fx__a RENAME TO fx__b", "DROP TABLE fx__c"],
          dialect
        )
      ).toEqual(["fx__c"]);
    });

    it("refuses a table rename whose new name cannot be read", () => {
      expect(() =>
        tablesDroppedBy(["ALTER TABLE app_notes RENAME TO (x)"], dialect)
      ).toThrow(UnparsableDropTarget);
    });
  });

  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER TABLE fx__notes RENAME COLUMN app_notes TO body"],
    ["postgresql", "ALTER TABLE fx__notes RENAME app_notes TO body"],
    ["postgresql", "ALTER TABLE ONLY fx__notes RENAME CONSTRAINT c1 TO c2"],
    ["sqlite", "ALTER TABLE fx__notes RENAME COLUMN app_notes TO body"],
    ["sqlite", "ALTER TABLE fx__notes RENAME app_notes TO body"],
    ["mysql", "ALTER TABLE fx__notes RENAME COLUMN app_notes TO body"],
    ["mysql", "ALTER TABLE fx__notes RENAME INDEX i1 TO i2"],
    ["mysql", "ALTER TABLE fx__notes RENAME KEY k1 TO k2"],
  ])(
    "does not take a column, constraint or index rename for a table rename on %s: %s",
    (dialect, rename) => {
      expect(
        tablesDroppedBy([rename, "DROP TABLE fx__notes"], dialect)
      ).toEqual(["fx__notes"]);
      expect(() =>
        guard([rename, "DROP TABLE fx__notes"], dialect)
      ).not.toThrow();
    }
  );

  it.each([
    ["RENAME TABLE", "RENAME TABLE app_notes TO zz"],
    [
      "RENAME TABLE with a list",
      "RENAME TABLE fx__a TO fx__b, app_notes TO zz",
    ],
    [
      "RENAME TABLE chained in one list",
      "RENAME TABLE app_notes TO yy, yy TO zz",
    ],
    ["ALTER TABLE ... RENAME AS", "ALTER TABLE app_notes RENAME AS zz"],
    ["ALTER TABLE ... RENAME <name>", "ALTER TABLE app_notes RENAME `zz`"],
    [
      "a rename after another clause",
      "ALTER TABLE app_notes ADD COLUMN c INT, RENAME TO zz",
    ],
  ])("follows MySQL's %s", (_shape, rename) => {
    expect(tablesDroppedBy([rename, "DROP TABLE zz"], "mysql")).toEqual([
      "app_notes",
      "zz",
    ]);
  });
});

describe("dynamically built statements", () => {
  it.each<[SupportedDialect, string]>([
    ["postgresql", "EXECUTE 'DROP TABLE ' || 'app_notes'"],
    ["postgresql", "DO $$ BEGIN EXECUTE 'DROP TABLE ' || 'app_notes'; END $$"],
    // `function` is not reserved in PL/pgSQL, so it can be a variable
    // holding SQL; only CREATE TRIGGER's `EXECUTE FUNCTION f()` is exempt.
    [
      "postgresql",
      "DO $$ DECLARE function text := 'DROP TABLE app_notes'; BEGIN EXECUTE function; END $$",
    ],
    ["postgresql", "PREPARE p AS SELECT 1"],
    ["mysql", "PREPARE s FROM 'DROP TABLE app_notes'"],
    ["mysql", "EXECUTE s"],
    ["sqlite", "EXECUTE s"],
  ])("refuses on %s: %s", (dialect, statement) => {
    try {
      tablesDroppedBy([statement], dialect);
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(UnparsableDropTarget);
      expect((error as UnparsableDropTarget).reason).toMatch(
        /dynamically built statement cannot be judged/
      );
    }
  });

  it.each([
    "CREATE TRIGGER trg BEFORE UPDATE ON fx__notes FOR EACH ROW EXECUTE FUNCTION fx_touch()",
    "CREATE OR REPLACE TRIGGER trg AFTER INSERT ON fx__notes FOR EACH ROW EXECUTE PROCEDURE public.fx_touch()",
    "GRANT EXECUTE ON FUNCTION fx_touch() TO app_role",
    "GRANT SELECT, EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_role",
    "REVOKE EXECUTE ON FUNCTION fx_touch() FROM PUBLIC",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_role",
  ])("allows %s", statement => {
    expect(tablesDroppedBy([statement], "postgresql")).toEqual([]);
  });

  it("allows MySQL's EXECUTE privilege", () => {
    expect(
      tablesDroppedBy(["GRANT EXECUTE ON PROCEDURE db.p TO 'u'@'%'"], "mysql")
    ).toEqual([]);
  });
});

describe("refusing what it cannot read", () => {
  it("refuses an executable-comment drop of a foreign table end to end", () => {
    expect(() =>
      guard(["DROP TABLE fx__notes /*!, app_notes */"], "mysql")
    ).toThrow(UnparsableDropTarget);
  });

  it.each(DIALECTS)(
    "refuses an upper-case drop of a foreign table on %s",
    dialect => {
      expect(() => guard(["DROP TABLE APP_NOTES"], dialect)).toThrow(
        /different owner/i
      );
    }
  );

  it.each(DIALECTS)(
    "refuses a drop hidden after another statement on %s",
    dialect => {
      expect(() => guard(["SELECT 1; DROP TABLE app_notes"], dialect)).toThrow(
        /different owner/i
      );
    }
  );

  it("reaches the operator as the foreign-drop refusal, naming the file", () => {
    // The CLI prints a NextlyError's public message and log context; a plain
    // Error would print as an unexpected failure with a stack instead.
    try {
      guard(["DROP TABLE fx__notes /*!, app_notes */"], "mysql");
      expect.unreachable("must throw");
    } catch (error) {
      expect(NextlyError.is(error)).toBe(true);
      const refusal = error as NextlyError;
      expect(refusal.code).toBe("DROP_OF_FOREIGN_TABLE");
      expect(refusal.logContext).toMatchObject({
        source: "plugin:fx/001",
        statement: "DROP TABLE fx__notes /*!, app_notes */",
      });
      expect(String(refusal.logContext?.reason)).toMatch(/executable comment/);
    }
  });
});

/**
 * A rename takes a table away from the name its owner row records. Once one
 * module has renamed `app_notes` to `mine`, a later module — or the plugin's
 * uninstall DOWN — dropping `mine` is judged by a name nobody claims, so the
 * rename itself is what has to be refused.
 */
describe("renaming another owner's table", () => {
  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER TABLE app_notes RENAME TO mine"],
    ["sqlite", "ALTER TABLE app_notes RENAME TO mine"],
    ["mysql", "ALTER TABLE app_notes RENAME TO mine"],
    ["mysql", "RENAME TABLE app_notes TO mine"],
    ["mysql", "ALTER TABLE app_notes RENAME AS mine"],
    ["postgresql", "ALTER TABLE IF EXISTS ONLY public.app_notes SET SCHEMA x"],
    // Behind a rename this stream is entitled to, in the same text.
    [
      "postgresql",
      "ALTER TABLE fx__a RENAME TO fx__b; ALTER TABLE app_notes RENAME TO t1",
    ],
  ])("is refused on %s: %s", (dialect, statement) => {
    try {
      guard([statement], dialect);
      expect.unreachable("must throw");
    } catch (error) {
      expect(NextlyError.is(error)).toBe(true);
      const refusal = error as NextlyError;
      expect(refusal.code).toBe("DROP_OF_FOREIGN_TABLE");
      expect(refusal.logContext).toMatchObject({
        table: "app_notes",
        renamedBy: "plugin:fx",
        belongsTo: "app",
        source: "plugin:fx/001",
      });
    }
  });

  it.each<[SupportedDialect, string]>([
    ["postgresql", "ALTER TABLE fx__notes RENAME TO fx__archive"],
    ["sqlite", 'ALTER TABLE "__new_fx__notes" RENAME TO "fx__notes"'],
    ["mysql", "RENAME TABLE fx__notes TO fx__archive"],
    ["postgresql", "ALTER TABLE fx__notes SET SCHEMA archive"],
    // Column and index renames on the foreign table rename no table.
    ["postgresql", "ALTER TABLE app_notes RENAME COLUMN a TO b"],
    ["mysql", "ALTER TABLE app_notes RENAME INDEX i1 TO i2"],
  ])(
    "leaves a rename that takes no foreign table alone on %s: %s",
    (dialect, statement) => {
      // The control: the same guard, owners and stream, with the renamed table
      // one this stream owns or nobody claims.
      expect(() => guard([statement], dialect)).not.toThrow();
    }
  );
});

/**
 * PostgreSQL's DO runs its body. A dollar-quoted body is lexed as code; a
 * string-literal body is skipped as data, so a drop inside it would pass
 * unread.
 */
describe("a PostgreSQL DO block whose body is a string", () => {
  it.each([
    "DO 'BEGIN DROP TABLE app_notes; END'",
    "DO LANGUAGE plpgsql 'BEGIN DROP TABLE app_notes; END'",
    "DO E'BEGIN DROP TABLE app_notes; END'",
    "SELECT 1; DO 'BEGIN DROP TABLE app_notes; END'",
  ])("is refused: %s", statement => {
    try {
      tablesDroppedBy([statement], "postgresql");
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(UnparsableDropTarget);
      expect((error as UnparsableDropTarget).reason).toMatch(
        /body written as a string/
      );
    }
  });

  it.each([
    "DO $$ BEGIN PERFORM 1; END $$",
    "DO LANGUAGE plpgsql $body$ BEGIN PERFORM 1; END $body$",
    "DO $$ BEGIN PERFORM 1; END $$ LANGUAGE plpgsql",
  ])("reads a dollar-quoted body as before: %s", statement => {
    expect(tablesDroppedBy([statement], "postgresql")).toEqual([]);
  });

  it("does not apply MySQL's DO, which evaluates expressions", () => {
    expect(tablesDroppedBy(["DO RELEASE_LOCK('x')"], "mysql")).toEqual([]);
  });
});

/**
 * A routine's or trigger's body is code that runs later, when it is called
 * or fires — read like a `DO` or function body: a drop inside it is judged
 * as a drop by this migration.
 */
describe("drops inside a routine or trigger body", () => {
  const procedure = (drop: string) =>
    [
      "CREATE PROCEDURE fx_reset()",
      "BEGIN",
      "  DELETE FROM fx__notes;",
      `  ${drop};`,
      "END;",
    ].join("\n");

  it("refuses a MySQL procedure whose body drops another owner's table", () => {
    const statements = splitSqlStatements(
      procedure("DROP TABLE app_notes"),
      "mysql"
    );
    // One statement: the body is not split at its inner `;`.
    expect(statements).toHaveLength(1);
    expect(() => guard(statements, "mysql")).toThrow(/different owner/i);
  });

  it("allows one whose body drops only this stream's own table", () => {
    // The control: the same definition, dropping a table nobody else owns.
    const statements = splitSqlStatements(
      procedure("DROP TABLE IF EXISTS fx__scratch"),
      "mysql"
    );
    expect(() => guard(statements, "mysql")).not.toThrow();
  });

  it("refuses dynamic SQL inside a body, as anywhere else", () => {
    const statements = splitSqlStatements(procedure("EXECUTE stmt"), "mysql");
    expect(() => guard(statements, "mysql")).toThrow(UnparsableDropTarget);
  });
});

/**
 * SQLite changes a table's constraints by rebuilding it: a twin created,
 * the rows copied, the table dropped and the twin renamed back. A contributor
 * adding a check or a foreign key to a table it does not own emits exactly
 * that, and the table and its rows survive under the owner's name — so a
 * COMPLETE block is not a drop or rename of it. Anything less still is.
 */
describe("a complete SQLite rebuild of another owner's table", () => {
  const create =
    'CREATE TABLE "__new_app_notes" ("id" TEXT PRIMARY KEY NOT NULL, "body" TEXT, CONSTRAINT "c" CHECK ("body" <> \'\'))';
  const copy =
    'INSERT INTO "__new_app_notes" ("id", "body") SELECT "id", "body" FROM "app_notes"';
  const drop = 'DROP TABLE "app_notes"';
  const rename = 'ALTER TABLE "__new_app_notes" RENAME TO "app_notes"';
  /** `app_notes` as the database holds it. */
  const live = (...columns: string[]) =>
    new Map([["app_notes", new Set(columns)]]);

  function guardLive(
    statements: string[],
    liveColumns: ReturnType<typeof live> | undefined,
    dialect: SupportedDialect = "sqlite"
  ) {
    assertNoForeignDrops({
      statements,
      stream: "plugin:fx",
      owners,
      dialect,
      source: "plugin:fx/001",
      liveColumns,
    });
  }

  it("is not taken as a drop or a rename of it when the twin keeps every live column", () => {
    expect(() =>
      guardLive(
        ["SELECT 1", create, copy, drop, rename, "SELECT 2"],
        live("id", "body")
      )
    ).not.toThrow();
  });

  it("is recognised as the pipeline renders it", () => {
    const statements = sqliteTableRebuildStatements({
      name: "app_notes",
      columns: [
        { name: "id", type: "text", nullable: false, primaryKey: true },
        { name: "status", type: "text", nullable: true },
      ],
      indexes: [],
      checks: [{ name: "status_enum", expression: "\"status\" IN ('a', 'b')" }],
    } as never);
    expect(() => guardLive(statements, live("id", "status"))).not.toThrow();
  });

  it("follows a column dropped before the rebuild in the same list", () => {
    // A contribution's DOWN: its column goes first, then the table is
    // rebuilt without the column or its check.
    expect(() =>
      guardLive(
        [
          'ALTER TABLE "app_notes" DROP COLUMN "status"',
          create,
          copy,
          drop,
          rename,
        ],
        live("id", "body", "status")
      )
    ).not.toThrow();
  });

  it("refuses a narrow twin after a multi-clause ALTER it cannot follow", () => {
    // The ALTER adds `x` and `y`; the twin declares neither. Were the ALTER
    // skipped, the tracked columns would still be `id`, `body` and the block
    // would pass while dropping both new columns with the old table.
    expect(() =>
      guardLive(
        [
          'ALTER TABLE "app_notes" ADD COLUMN "x" TEXT, ADD COLUMN "y" TEXT',
          create,
          copy,
          drop,
          rename,
        ],
        live("id", "body"),
        "postgresql"
      )
    ).toThrow(/different owner/i);
  });

  it.each([
    [
      "an ADD of a constraint",
      'ALTER TABLE "app_notes" ADD CONSTRAINT "k" UNIQUE ("id")',
    ],
    [
      "an ALTER it does not follow",
      'ALTER TABLE "app_notes" ALTER COLUMN "body" SET NOT NULL',
    ],
  ])("stops following the table after %s", (_shape, statement) => {
    expect(() =>
      guardLive(
        [statement, create, copy, drop, rename],
        live("id", "body"),
        "postgresql"
      )
    ).toThrow(/different owner/i);
  });

  it("refuses a twin that leaves out a live column", () => {
    // Everything the text shows is a complete block; only the live table
    // shows the rebuild would drop `secret` with the old table.
    expect(() =>
      guardLive([create, copy, drop, rename], live("id", "body", "secret"))
    ).toThrow(/different owner/i);
  });

  it("refuses a rebuild whose table's live columns were not read", () => {
    expect(() => guardLive([create, copy, drop, rename], undefined)).toThrow(
      /different owner/i
    );
  });

  it.each([
    ["a lone drop", [drop]],
    ["a lone rename of the twin", [create, rename]],
    ["a block without its copy", [create, drop, rename]],
    ["a block out of order", [create, copy, rename, drop]],
    [
      "a copy that filters rows",
      [create, `${copy} WHERE "body" IS NOT NULL`, drop, rename],
    ],
    [
      "a copy that leaves a declared column empty",
      [
        create,
        'INSERT INTO "__new_app_notes" ("id") SELECT "id" FROM "app_notes"',
        drop,
        rename,
      ],
    ],
    [
      "a copy from another table",
      [
        create,
        'INSERT INTO "__new_app_notes" ("id", "body") SELECT "id", "body" FROM "fx__notes"',
        drop,
        rename,
      ],
    ],
    [
      "a twin renamed to another name",
      [create, copy, drop, 'ALTER TABLE "__new_app_notes" RENAME TO "mine"'],
    ],
    ["a block sharing a statement", [create, copy, `${drop}; ${rename}`]],
  ])("still refuses %s", (_shape, statements) => {
    expect(() => guardLive(statements, live("id", "body"))).toThrow(
      /different owner/i
    );
  });
});
