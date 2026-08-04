/**
 * A column is more than its type. Creating a table attaches NOT NULL, uniqueness, a foreign key
 * and an index to it; adding the same field to a table that already exists went through a
 * different path that attached only some of them, so a collection that gained a field by an edit
 * did not enforce what the identical collection created from scratch did.
 *
 * The property is asserted first and the individual repairs after it: for one field definition,
 * the table CREATE produces and the table ADD-to-an-empty-table produces must carry the same
 * attachments. Every gap here violated that one rule, so pinning the four cases alone would let
 * the fifth arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  DynamicCollectionSchemaService,
  type SupportedDialect,
} from "../services/dynamic-collection-schema-service";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];
const TABLE = "dc_probe";

const service = (dialect: SupportedDialect) =>
  new DynamicCollectionSchemaService(undefined, dialect);

const field = (overrides: Record<string, unknown>): FieldDefinition =>
  ({ required: false, ...overrides }) as unknown as FieldDefinition;

/**
 * Identifier quoting differs per dialect and says nothing about what is attached, so it is
 * removed before anything is read. Every name this compares is generated from a snake_case
 * column, so nothing ambiguous survives the strip.
 */
const unquote = (sql: string) => sql.replace(/["`]/g, "");

/** What a column carries, read from whichever form the generator emitted it in. */
interface Attachments {
  notNull: boolean;
  unique: boolean;
  referencesTable: string | null;
  indexed: boolean;
}

/** A plain (non-unique) index on this column, in either generator's spelling. */
function hasPlainIndex(sql: string, column: string): boolean {
  return new RegExp(
    `CREATE INDEX (?:IF NOT EXISTS )?\\S+ ON ${TABLE}\\(${column}\\)`
  ).test(sql);
}

/**
 * The refusal, read the way a client reads it.
 *
 * A validation error carries the generic "Validation failed." as its message and the part that
 * names the field in its public data, which is what the envelope hands the admin. Asserting on
 * `.message` would pass for any validation error at all and say nothing about this one.
 */
function refusalMessages(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (!(error instanceof NextlyError)) throw error;
    const data = error.publicData as
      | { errors?: { path?: string; code?: string; message?: string }[] }
      | undefined;
    return (data?.errors ?? []).map(e => `${e.path} ${e.code} ${e.message}`);
  }
  return [];
}

function referencedTable(sql: string, column: string): string | null {
  const match = sql.match(
    new RegExp(`FOREIGN KEY \\(${column}\\) REFERENCES (\\S+?)\\(id\\)`)
  );
  return match ? match[1] : null;
}

function createAttachments(rawSql: string, column: string): Attachments {
  const sql = unquote(rawSql);
  const body = sql.slice(sql.indexOf("(") + 1, sql.indexOf("\n);"));
  const line =
    body
      .split(",\n")
      .map(part => part.trim())
      .find(part => part.startsWith(`${column} `)) ?? "";
  return {
    notNull: /\bNOT NULL\b/.test(line),
    unique: /\bUNIQUE\b/.test(line),
    referencesTable: referencedTable(sql, column),
    indexed: hasPlainIndex(sql, column),
  };
}

function alterAttachments(rawSql: string, column: string): Attachments {
  const sql = unquote(rawSql);
  const addLine =
    sql.split("\n").find(line => line.includes(`ADD COLUMN ${column} `)) ?? "";
  return {
    notNull: /\bNOT NULL\b/.test(addLine),
    unique:
      new RegExp(`ADD CONSTRAINT \\S+ UNIQUE \\(${column}\\)`).test(sql) ||
      new RegExp(
        `CREATE UNIQUE INDEX (?:IF NOT EXISTS )?\\S+ ON ${TABLE}\\(${column}\\)`
      ).test(sql),
    referencesTable: referencedTable(sql, column),
    indexed: hasPlainIndex(sql, column),
  };
}

/**
 * The field shapes whose attachments differ from one another. Every one is added to an EMPTY
 * table, which is the only state in which the two paths are comparable at all: a table with rows
 * cannot receive a required column that states no backfill, by design.
 */
const SHAPES: { label: string; definition: FieldDefinition }[] = [
  {
    label: "an optional many-to-one relationship",
    definition: field({
      name: "author",
      type: "relationship",
      options: { target: "authors", relationType: "manyToOne" },
    }),
  },
  {
    label: "a required many-to-one relationship",
    definition: field({
      name: "author",
      type: "relationship",
      required: true,
      options: { target: "authors", relationType: "manyToOne" },
    }),
  },
  {
    label: "a one-to-one relationship",
    definition: field({
      name: "profile",
      type: "relationship",
      options: { target: "profiles", relationType: "oneToOne" },
    }),
  },
  {
    label: "a unique text field",
    definition: field({ name: "sku", type: "text", unique: true }),
  },
  {
    label: "an indexed text field",
    definition: field({ name: "slugAlias", type: "text", index: true }),
  },
  {
    label: "a required text field",
    definition: field({ name: "headline", type: "text", required: true }),
  },
  {
    label: "an indexed number field",
    definition: field({ name: "rank", type: "number", index: true }),
  },
  {
    label: "a plain optional text field",
    definition: field({ name: "note", type: "text" }),
  },
];

describe.each(DIALECTS)(
  "CREATE and ADD-to-empty agree on what a column carries (%s)",
  dialect => {
    it.each(SHAPES)("$label", ({ definition }) => {
      const svc = service(dialect);
      const column = definition.name.replace(
        /[A-Z]/g,
        c => `_${c.toLowerCase()}`
      );

      const created = createAttachments(
        svc.generateMigrationSQL(TABLE, [definition]),
        column
      );
      const added = alterAttachments(
        svc.generateAlterTableMigration(TABLE, [], [definition], {
          tableHasRows: false,
        }),
        column
      );

      expect(added.notNull).toBe(created.notNull);
      expect(added.indexed).toBe(created.indexed);

      if (definition.unique !== true && created.unique) {
        // A one-to-one's uniqueness is the one attachment the two paths cannot yet agree on,
        // and the disagreement is older than either of them: CREATE writes it inline, where the
        // dialect names the index; the desired schema the diff compares against declares a
        // NON-unique index for the same field. A named constraint here would be a third
        // spelling that the next diff proposes dropping. Asserted rather than skipped, so
        // converging them makes this fail and say so.
        expect(added.unique).toBe(false);
      } else {
        expect(added.unique).toBe(created.unique);
      }

      if (dialect === "sqlite" && created.referencesTable !== null) {
        // SQLite attaches a foreign key only in a CREATE TABLE: there is no statement that adds
        // one to a table that already exists, short of rebuilding it. Asserted rather than
        // skipped so the day a rebuild lands, this stops being true and says so.
        expect(added.referencesTable).toBeNull();
      } else {
        expect(added.referencesTable).toBe(created.referencesTable);
      }
    });
  }
);

describe("the attachments the ADD path used to lose", () => {
  it.each(DIALECTS)(
    "does not add a third spelling of a one-to-one's uniqueness (%s)",
    dialect => {
      const oneToOne = field({
        name: "profile",
        type: "relationship",
        options: { target: "profiles", relationType: "oneToOne" },
      });
      const sql = service(dialect).generateAlterTableMigration(
        TABLE,
        [],
        [oneToOne],
        { tableHasRows: false }
      );
      // The desired schema declares a non-unique index for this field, so a named unique
      // constraint here is drift the next diff proposes dropping.
      expect(alterAttachments(sql, "profile").unique).toBe(false);
    }
  );

  it.each(DIALECTS)(
    "still applies an EXPLICIT unique flag, which the desired schema does model (%s)",
    dialect => {
      const sql = service(dialect).generateAlterTableMigration(
        TABLE,
        [],
        [field({ name: "sku", type: "text", unique: true })],
        { tableHasRows: false }
      );
      expect(alterAttachments(sql, "sku").unique).toBe(true);
    }
  );

  it.each(DIALECTS)(
    "leaves a many-to-one column non-unique, so uniqueness is read from the cardinality and not attached to every relationship (%s)",
    dialect => {
      const manyToOne = field({
        name: "author",
        type: "relationship",
        options: { target: "authors", relationType: "manyToOne" },
      });
      const sql = service(dialect).generateAlterTableMigration(
        TABLE,
        [],
        [manyToOne],
        { tableHasRows: false }
      );
      expect(alterAttachments(sql, "author").unique).toBe(false);
    }
  );

  it.each(DIALECTS)("indexes a newly added indexed field (%s)", dialect => {
    const indexed = field({ name: "rank", type: "number", index: true });
    const sql = service(dialect).generateAlterTableMigration(
      TABLE,
      [],
      [indexed],
      { tableHasRows: false }
    );
    expect(hasPlainIndex(unquote(sql), "rank")).toBe(true);
  });

  it.each(DIALECTS)(
    "does not index a newly added field that asked for none (%s)",
    dialect => {
      const plain = field({ name: "note", type: "text" });
      const sql = service(dialect).generateAlterTableMigration(
        TABLE,
        [],
        [plain],
        { tableHasRows: false }
      );
      expect(hasPlainIndex(unquote(sql), "note")).toBe(false);
    }
  );

  it.each(DIALECTS)(
    "creates the index for a new indexed field exactly once (%s)",
    dialect => {
      const indexed = field({ name: "rank", type: "number", index: true });
      const sql = unquote(
        service(dialect).generateAlterTableMigration(TABLE, [], [indexed], {
          tableHasRows: false,
        })
      );
      const matches = sql.match(
        new RegExp(
          `CREATE INDEX (?:IF NOT EXISTS )?\\S+ ON ${TABLE}\\(rank\\)`,
          "g"
        )
      );
      expect(matches).toHaveLength(1);
    }
  );

  it.each(DIALECTS)(
    "still toggles the index on a field that already existed (%s)",
    dialect => {
      const before = field({ name: "rank", type: "number" });
      const after = field({ name: "rank", type: "number", index: true });
      const sql = unquote(
        service(dialect).generateAlterTableMigration(TABLE, [before], [after], {
          tableHasRows: true,
        })
      );
      expect(hasPlainIndex(sql, "rank")).toBe(true);
      expect(sql).not.toContain("ADD COLUMN rank");
    }
  );
});

describe("an index the dialect can actually accept", () => {
  it("indexes a mysql text column by prefix, which is the only form mysql accepts", () => {
    const sql = unquote(
      service("mysql").generateAlterTableMigration(
        TABLE,
        [],
        [field({ name: "note", type: "text", index: true })],
        { tableHasRows: false }
      )
    );
    // Without a key length MySQL rejects the statement outright: "BLOB/TEXT column used in key
    // specification without a key length".
    expect(sql).toContain("ON dc_probe(note(191))");
  });

  it("indexes a mysql varchar column whole, so the prefix is not applied to everything", () => {
    const sql = unquote(
      service("mysql").generateAlterTableMigration(
        TABLE,
        [],
        [
          field({
            name: "author",
            type: "relationship",
            options: { target: "authors", relationType: "manyToOne" },
          }),
        ],
        { tableHasRows: false }
      )
    );
    expect(sql).toContain("ON dc_probe(author)");
    expect(sql).not.toContain("author(191)");
  });

  it.each(["postgresql", "sqlite"] as const)(
    "indexes the whole value where the dialect allows it (%s)",
    dialect => {
      const sql = unquote(
        service(dialect).generateAlterTableMigration(
          TABLE,
          [],
          [field({ name: "note", type: "text", index: true })],
          { tableHasRows: false }
        )
      );
      expect(sql).toContain("ON dc_probe(note)");
    }
  );

  it.each(DIALECTS)(
    "drops an index with the statement its dialect accepts, not one with a stray table clause (%s)",
    dialect => {
      const before = field({ name: "rank", type: "number", index: true });
      const after = field({ name: "rank", type: "number" });
      const sql = unquote(
        service(dialect).generateAlterTableMigration(TABLE, [before], [after], {
          tableHasRows: true,
          indexNames: new Set(["idx_dc_probe_rank"]),
        })
      );
      expect(sql).toContain("DROP INDEX");
      if (dialect === "mysql") {
        expect(sql).toContain("DROP INDEX idx_dc_probe_rank ON dc_probe;");
      } else {
        // `DROP INDEX <name> ON <table>` is a syntax error on both PostgreSQL and SQLite.
        expect(sql).toContain("DROP INDEX IF EXISTS idx_dc_probe_rank;");
        expect(sql).not.toMatch(/DROP INDEX[^;]*ON dc_probe/);
      }
    }
  );

  it("does not drop an index the live table does not carry", () => {
    const indexed = field({
      name: "author",
      type: "relationship",
      options: { target: "authors", relationType: "manyToOne" },
    });
    // A relationship column added before this path indexed them has no index. MySQL cannot
    // express `DROP INDEX IF EXISTS`, so dropping one that is absent aborts the migration
    // before the statements after it, and the field metadata is then saved for DDL that never
    // ran. Which columns are indexed is not derivable from the field, so it is read.
    const sql = unquote(
      service("mysql").generateAlterTableMigration(TABLE, [indexed], [], {
        foreignKeysByColumn: new Map(),
        indexNames: new Set<string>(),
      })
    );
    expect(sql).not.toContain("DROP INDEX");
    expect(sql).toContain("DROP COLUMN");
  });

  it("drops an index the live table does carry", () => {
    const indexed = field({
      name: "author",
      type: "relationship",
      options: { target: "authors", relationType: "manyToOne" },
    });
    const sql = unquote(
      service("mysql").generateAlterTableMigration(TABLE, [indexed], [], {
        foreignKeysByColumn: new Map(),
        indexNames: new Set(["idx_dc_probe_author"]),
      })
    );
    expect(sql).toContain("DROP INDEX idx_dc_probe_author ON dc_probe;");
  });

  it("removes the index before the column it names, which is what sqlite requires", () => {
    const indexed = field({
      name: "author",
      type: "relationship",
      options: { target: "authors", relationType: "manyToOne" },
    });
    const sql = unquote(
      service("sqlite").generateAlterTableMigration(TABLE, [indexed], [], {
        foreignKeysByColumn: new Map(),
        indexNames: new Set(["idx_dc_probe_author"]),
      })
    );
    // SQLite refuses DROP COLUMN while an index still references the column, and reports it as
    // a missing column inside the index rather than as the removal it refused.
    expect(sql.indexOf("DROP INDEX")).toBeGreaterThan(-1);
    expect(sql.indexOf("DROP INDEX")).toBeLessThan(sql.indexOf("DROP COLUMN"));
  });
});

describe("a required column that no value can backfill", () => {
  const requiredRelationship = field({
    name: "author",
    type: "relationship",
    required: true,
    options: { target: "authors", relationType: "manyToOne" },
  });

  it.each(DIALECTS)(
    "refuses the edit when the table already holds rows (%s)",
    dialect => {
      const reported = refusalMessages(() =>
        service(dialect).generateAlterTableMigration(
          TABLE,
          [],
          [requiredRelationship],
          { tableHasRows: true }
        )
      );
      expect(reported).toHaveLength(1);
      expect(reported[0]).toContain("fields.author");
      expect(reported[0]).toContain("REQUIRED_COLUMN_NEEDS_BACKFILL");
      // The refusal has to say what to do instead, or it is only a wall.
      expect(reported[0]).toMatch(/optional/);
    }
  );

  it.each(DIALECTS)(
    "refuses when the caller did not look, rather than guessing the table is empty (%s)",
    dialect => {
      const reported = refusalMessages(() =>
        service(dialect).generateAlterTableMigration(
          TABLE,
          [],
          [requiredRelationship]
        )
      );
      expect(reported).toHaveLength(1);
      expect(reported[0]).toContain("REQUIRED_COLUMN_NEEDS_BACKFILL");
    }
  );

  it.each(DIALECTS)(
    "emits a plain NOT NULL with no default when the table is empty (%s)",
    dialect => {
      const sql = unquote(
        service(dialect).generateAlterTableMigration(
          TABLE,
          [],
          [requiredRelationship],
          { tableHasRows: false }
        )
      );
      expect(sql).toContain("ADD COLUMN author");
      expect(sql).toMatch(/ADD COLUMN author[^;]*NOT NULL/);
      // The statement this replaces. No dialect accepts it: PostgreSQL reports the nulls it
      // found, MySQL calls the default invalid, and SQLite writes the column and then refuses
      // every insert that omits it.
      expect(sql).not.toMatch(/NOT NULL\s+DEFAULT NULL/);
    }
  );

  it.each(DIALECTS)(
    "still backfills a required column whose type states a value, so the refusal is not blanket (%s)",
    dialect => {
      const sql = unquote(
        service(dialect).generateAlterTableMigration(
          TABLE,
          [],
          [field({ name: "headline", type: "text", required: true })],
          { tableHasRows: true }
        )
      );
      expect(sql).toMatch(/ADD COLUMN headline[^;]*NOT NULL DEFAULT ''/);
    }
  );

  it.each(DIALECTS)(
    "adds an OPTIONAL relationship to a table with rows, which is the path the refusal points at (%s)",
    dialect => {
      const sql = unquote(
        service(dialect).generateAlterTableMigration(
          TABLE,
          [],
          [
            field({
              name: "author",
              type: "relationship",
              options: { target: "authors", relationType: "manyToOne" },
            }),
          ],
          { tableHasRows: true }
        )
      );
      expect(sql).toContain("ADD COLUMN author");
      expect(sql).not.toMatch(/ADD COLUMN author[^;]*NOT NULL/);
    }
  );
});

describe("removing a column that a foreign key references", () => {
  const relationship = field({
    name: "author",
    type: "relationship",
    options: { target: "authors", relationType: "manyToOne" },
  });
  const withForeignKey = {
    foreignKeysByColumn: new Map([["author", ["fk_dc_probe_author"]]]),
  };

  it("names and drops the constraint before the column on mysql", () => {
    const sql = unquote(
      service("mysql").generateAlterTableMigration(
        TABLE,
        [relationship],
        [],
        withForeignKey
      )
    );
    expect(sql).toContain("DROP FOREIGN KEY fk_dc_probe_author");
    expect(sql.indexOf("DROP FOREIGN KEY")).toBeLessThan(
      sql.indexOf("DROP COLUMN")
    );
  });

  it("drops only the column on postgresql, which removes the dependent constraint itself", () => {
    const sql = unquote(
      service("postgresql").generateAlterTableMigration(
        TABLE,
        [relationship],
        [],
        withForeignKey
      )
    );
    expect(sql).toContain("DROP COLUMN IF EXISTS author");
    expect(sql).not.toContain("DROP CONSTRAINT");
  });

  it("refuses on sqlite, where the constraint cannot be removed without rebuilding the table", () => {
    const reported = refusalMessages(() =>
      service("sqlite").generateAlterTableMigration(
        TABLE,
        [relationship],
        [],
        withForeignKey
      )
    );
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("fields.author");
    expect(reported[0]).toContain("FOREIGN_KEY_DROP_UNSUPPORTED");
  });

  it("drops a sqlite relationship column that carries no foreign key, which is every one added by an edit", () => {
    const sql = unquote(
      service("sqlite").generateAlterTableMigration(TABLE, [relationship], [], {
        foreignKeysByColumn: new Map(),
      })
    );
    expect(sql).toContain("DROP COLUMN author");
  });

  it.each(DIALECTS)(
    "drops a plain column with no constraint statement at all (%s)",
    dialect => {
      const sql = unquote(
        service(dialect).generateAlterTableMigration(
          TABLE,
          [field({ name: "note", type: "text" })],
          [],
          { foreignKeysByColumn: new Map() }
        )
      );
      expect(sql).toContain("DROP COLUMN");
      expect(sql).not.toContain("FOREIGN KEY");
    }
  );
});
