/**
 * Uniqueness is a NAMED index, and a table's shape does not depend on when its column arrived.
 *
 * A column-level `UNIQUE` inside `CREATE TABLE` is anonymous: the server names the index behind it,
 * and on SQLite that is an internal `sqlite_autoindex_*` no statement can reference. Nothing can
 * describe such an index afterwards, so the desired schema — which declares `uq_<table>_<column>` —
 * disagreed with every table carrying one, and no `DROP INDEX` could clear it before dropping its
 * column.
 *
 * The add-column path already emitted `uq_<table>_<column>`; these pin that CREATE now agrees.
 *
 * Scope: these read the emitted DDL. Whether an apply still proposes a rebuild is a property of
 * drizzle-kit's differ against a whole live database, which no fixture here holds; the e2e suite
 * covers it, and recreates its database on every run so it exercises this path.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import {
  MAX_INDEX_NAME_LENGTH,
  indexNameForColumn,
  uniqueIndexNameForColumn,
} from "../../../schema/services/index-name";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

type Dialect = "postgresql" | "mysql" | "sqlite";
const DIALECTS: Dialect[] = ["postgresql", "mysql", "sqlite"];

const ddlFor = (dialect: Dialect, fields: FieldDefinition[]): string =>
  new DynamicCollectionSchemaService(undefined, dialect).generateMigrationSQL(
    "dc_widgets",
    fields,
    { hasStatus: false }
  );

/**
 * A declared unique field.
 *
 * Deliberately NOT `slug`: every generated table already carries a system UNIQUE index on that
 * column, so a field-level unique index there would be a second index over the same column and is
 * correctly withheld. A fixture on `slug` would therefore test the excluded case while appearing
 * to test the general one. `email` renders as `varchar` on MySQL, so it is keyable on all three
 * dialects and the assertions hold everywhere rather than on the one dialect that agrees.
 */
const uniqueField = [
  { name: "email", type: "email", required: true, unique: true },
] as unknown as FieldDefinition[];

/**
 * The column definition line for a field, with the index statements excluded.
 *
 * Asserting `UNIQUE` is absent from the whole DDL would be wrong: `CREATE UNIQUE INDEX` contains the
 * word, so the naive check passes only while the fix is broken and fails once it works.
 */
function columnLineFor(sql: string, column: string): string {
  const line = sql
    .split("\n")
    .find(
      l =>
        l.includes(`\`${column}\``) ||
        (l.includes(`"${column}"`) && !/CREATE\s+(UNIQUE\s+)?INDEX/i.test(l))
    );
  return line ?? "";
}

describe("a field declared unique", () => {
  it.each(DIALECTS)("gets a named unique index on %s", dialect => {
    const sql = ddlFor(dialect, uniqueField);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*uq_dc_widgets_email/i);
  });

  it.each(DIALECTS)(
    "no longer carries an inline UNIQUE on its column on %s",
    dialect => {
      const sql = ddlFor(dialect, uniqueField);
      const column = columnLineFor(sql, "email");

      // The column line must exist, or this passes by finding nothing — the failure mode where a
      // test is satisfied because its subject is absent rather than because it is correct.
      expect(column, "the column is in the DDL").toContain("email");
      expect(column, "and carries no anonymous constraint").not.toMatch(
        /\bUNIQUE\b/i
      );
    }
  );

  it.each(DIALECTS)(
    "names the index the way the add-column path already does on %s",
    dialect => {
      // `uq_<table>_<column>` is not a new convention: it is what a column added to an existing
      // table has always produced, and what the desired schema declares. Agreeing on it is the
      // entire fix — a different-but-consistent name would still drift from the snapshot.
      expect(ddlFor(dialect, uniqueField)).toContain("uq_dc_widgets_email");
    }
  );
});

describe("a one-to-one relationship", () => {
  const oneToOne = [
    {
      name: "profile",
      type: "relationship",
      options: { target: "profiles", relationType: "oneToOne" },
    },
  ] as unknown as FieldDefinition[];

  it.each(DIALECTS)("keeps its inline UNIQUE on %s", dialect => {
    // Deliberately unchanged. Its cardinality has NO other enforcement — no constraint on the
    // add-column path, no unique index in the desired schema, no runtime check — so moving it to a
    // named index without also changing what the desired schema declares would silently let a
    // one-to-one hold duplicates.
    const column = columnLineFor(ddlFor(dialect, oneToOne), "profile");
    expect(column).toMatch(/\bUNIQUE\b/i);
  });

  it.each(DIALECTS)("does NOT get a uq_ index on %s", dialect => {
    // The desired schema declares a one-to-one's index as NON-unique. Emitting a unique one here
    // would be a third spelling of the same property, and the next diff would propose dropping it.
    expect(ddlFor(dialect, oneToOne)).not.toContain("uq_dc_widgets_profile");
  });
});

describe("a unique field MySQL cannot key", () => {
  const uniqueText = [
    { name: "sku", type: "textarea", unique: true },
  ] as unknown as FieldDefinition[];

  it("keeps the inline constraint rather than an index it would reject", () => {
    // MySQL refuses to key a TEXT column without a length, and refuses BOTH spellings alike, so
    // this field has never been creatable there. The inline form fails the CREATE atomically, which
    // is what it has always done. Emitting a separate index instead would create the table first
    // and fail on the index — leaving a collection installed without its uniqueness, past a
    // statement MySQL has already auto-committed.
    const sql = ddlFor("mysql", uniqueText);
    expect(columnLineFor(sql, "sku")).toMatch(/\bUNIQUE\b/i);
    expect(sql, "and no index it cannot accept").not.toContain(
      "uq_dc_widgets_sku"
    );
  });

  it("still gets the named index on dialects that can key text", () => {
    // The control. Withholding it everywhere would satisfy the case above while abandoning the fix.
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const sql = ddlFor(dialect, uniqueText);
      expect(sql).toContain("uq_dc_widgets_sku");
      expect(columnLineFor(sql, "sku")).not.toMatch(/\bUNIQUE\b/i);
    }
  });

  it("still gets the named index on MySQL when the column IS keyable", () => {
    // A bounded column is keyable, so the rule is about the column type and not about the dialect.
    const bounded = [
      { name: "email", type: "email", required: true, unique: true },
    ] as unknown as FieldDefinition[];
    expect(ddlFor("mysql", bounded)).toContain("uq_dc_widgets_email");
  });
});

describe("the unique index name", () => {
  it("is derived from the shared helper, so it stays within the identifier limit", () => {
    // Composed directly, `uq_<table>_<column>` runs past 63 characters for names near their limits:
    // MySQL refuses the identifier outright and PostgreSQL truncates it, leaving a created index
    // whose name disagrees with the one the desired schema declares.
    const longTable = `dc_${"a".repeat(48)}`;
    const longColumn = "b".repeat(48);
    const sql = new DynamicCollectionSchemaService(
      undefined,
      "postgresql"
    ).generateMigrationSQL(
      longTable,
      [{ name: longColumn, type: "text", unique: true }] as never,
      { hasStatus: false }
    );
    const name =
      sql.match(/CREATE UNIQUE INDEX (?:IF NOT EXISTS )?"([^"]+)"/)?.[1] ?? "";
    expect(name, "an index name was emitted").not.toBe("");
    expect(
      name.length,
      "within the identifier limit MySQL enforces and PostgreSQL truncates at"
    ).toBeLessThanOrEqual(63);
    expect(name.startsWith("uq_"), "and still marked as the unique one").toBe(
      true
    );
  });

  it("stays DISTINCT for two long columns that share a prefix", () => {
    // Length alone is not the property. A plain truncation also produces a name within the limit —
    // and produces the SAME name for both of these, so a repair renaming pre-existing objects onto
    // the convention would collide two constraints on exactly the long generated tables that
    // motivated the naming. The shared helper reserves a hash of the WHOLE logical name for this.
    const table =
      "dc_a_very_long_collection_name_that_a_schema_builder_can_produc";
    const shared = "a".repeat(58);
    const first = uniqueIndexNameForColumn(table, `${shared}_one`);
    const second = uniqueIndexNameForColumn(table, `${shared}_two`);

    expect(first.length).toBeLessThanOrEqual(MAX_INDEX_NAME_LENGTH);
    expect(second.length).toBeLessThanOrEqual(MAX_INDEX_NAME_LENGTH);
    expect(
      first.slice(0, 55),
      "the readable part is identical, which is what makes this the hard case"
    ).toBe(second.slice(0, 55));
    expect(first, "and the names still differ").not.toBe(second);
  });
});

describe("removing a unique field", () => {
  const before = [
    { name: "sku", type: "text", unique: true },
  ] as unknown as FieldDefinition[];

  it.each(DIALECTS)("drops its index before its column on %s", dialect => {
    // SQLite refuses to drop a column an index still covers, and the index a unique field carries is
    // named `uq_`. A removal path that searched only the `idx_` spellings never found it, emitted the
    // column drop with the index in place, and the migration failed — the same "cannot drop a unique
    // column" outcome the named index was supposed to end.
    const service = new DynamicCollectionSchemaService(undefined, dialect);
    const indexName = `uq_dc_widgets_sku`;
    const sql = service.generateAlterTableMigration("dc_widgets", before, [], {
      indexNames: new Set([indexName]),
    });

    const dropIndexAt = sql.indexOf(indexName);
    const dropColumnAt = sql.search(/DROP COLUMN (?:IF EXISTS )?[`"]?sku/i);

    expect(dropIndexAt, "the unique index is dropped").toBeGreaterThan(-1);
    expect(dropColumnAt, "the column is dropped").toBeGreaterThan(-1);
    expect(
      dropIndexAt,
      "and the index goes first, which is the whole requirement"
    ).toBeLessThan(dropColumnAt);
  });
});

describe("a unique field on a type the dialect cannot index", () => {
  const jsonUnique = [
    { name: "payload", type: "json", unique: true },
  ] as unknown as FieldDefinition[];

  /**
   * Whether a unique index was emitted ON a given column.
   *
   * Scoped to the column on purpose: every generated table also carries a unique index on its
   * system `slug`, so a bare search for `CREATE UNIQUE INDEX` is satisfied by that one and would
   * report a split that never happened.
   */
  const hasUniqueIndexOn = (sql: string, column: string): boolean =>
    new RegExp(
      `CREATE UNIQUE INDEX (?:IF NOT EXISTS )?["\`][^"\`]*["\`] ON ["\`][^"\`]+["\`]\\(["\`]${column}["\`]\\)`,
      "i"
    ).test(sql);

  it("keeps the uniqueness inline on MySQL rather than splitting it out", () => {
    // MySQL cannot index a JSON column at all, so the split spelling fails on the CREATE UNIQUE
    // INDEX — AFTER the CREATE TABLE it follows has already been auto-committed, leaving a table
    // installed without the guarantee that was asked for. The inline form fails the CREATE itself,
    // which installs nothing.
    const sql = ddlFor("mysql", jsonUnique);

    expect(
      hasUniqueIndexOn(sql, "payload"),
      "no separate unique index is emitted for a type MySQL cannot key"
    ).toBe(false);
    expect(
      columnLineFor(sql, "payload"),
      "the uniqueness stays on the column, so a failure is atomic"
    ).toMatch(/UNIQUE/i);
  });

  it("still splits it out where the dialect can index the type", () => {
    // The positive control: without it the assertion above passes for any implementation that
    // stopped emitting unique indexes entirely, and for any typo in the matcher.
    expect(hasUniqueIndexOn(ddlFor("postgresql", jsonUnique), "payload")).toBe(
      true
    );
  });
});

describe("the attachments a create artefact is predicted to install", () => {
  it.each(DIALECTS)("include the unique index it emits on %s", dialect => {
    // A create that has not been deployed yet is described by this prediction rather than by
    // introspection. When the prediction omitted the unique index, an edit removing the field
    // emitted a bare DROP COLUMN, which SQLite refuses while the index still names the column.
    const service = new DynamicCollectionSchemaService(undefined, dialect);
    const { indexNames } = service.plannedAttachments(
      "dc_widgets",
      uniqueField
    );

    expect([...indexNames]).toContain("uq_dc_widgets_email");
  });

  it("omit it where the create emits none", () => {
    // Predicting an index MySQL never installs is the mirror defect: the later drop names an
    // absent index, and MySQL cannot express DROP INDEX IF EXISTS.
    const service = new DynamicCollectionSchemaService(undefined, "mysql");
    const { indexNames } = service.plannedAttachments("dc_widgets", [
      { name: "payload", type: "json", unique: true },
    ] as unknown as FieldDefinition[]);

    expect([...indexNames]).not.toContain("uq_dc_widgets_payload");
  });
});

/**
 * These names are PERSISTED. They are the actual identifiers of objects in every database this
 * code has created, so the function that produces them is a compatibility surface rather than a
 * pure convenience recomputed on demand.
 *
 * Length and distinctness are properties any correct implementation has. IDENTITY is a property
 * of THIS one, and it is the only property that protects databases already in the field: improve
 * the readable portion, move the truncation split, swap the hash or change its width, and every
 * one of those edits keeps length and distinctness green while renaming objects that already
 * exist under the old spelling.
 *
 * If a change here is deliberate, it is a MIGRATION and not a refactor: existing databases carry
 * the old names and something has to rename them. Update these values only together with that.
 */
describe("the generated names are pinned, because databases already hold them", () => {
  it.each([
    ["dc_widgets", "slug", "idx_dc_widgets_slug", "uq_dc_widgets_slug"],
    ["dc_widgets", "sku", "idx_dc_widgets_sku", "uq_dc_widgets_sku"],
    [
      "single_pinned",
      "slug",
      "idx_single_pinned_slug",
      "uq_single_pinned_slug",
    ],
    [
      `dc_${"a".repeat(48)}`,
      "b".repeat(48),
      `idx_dc_${"a".repeat(48)}_0azp87a`,
      `uq_dc_${"a".repeat(48)}_0azp87a`,
    ],
    [
      "dc_a_very_long_collection_name_that_a_schema_builder_can_produc",
      `${"a".repeat(58)}_one`,
      "idx_dc_a_very_long_collection_name_that_a_schema_builde_1wf0ecy",
      "uq_dc_a_very_long_collection_name_that_a_schema_builde_1wf0ecy",
    ],
  ])("%s.%s", (table, column, expectedIndex, expectedUnique) => {
    expect(indexNameForColumn(table, column)).toBe(expectedIndex);
    expect(uniqueIndexNameForColumn(table, column)).toBe(expectedUnique);
  });
});

describe("a field declaring unique on the slug column", () => {
  const uniqueSlug = [
    { name: "slug", type: "text", required: true, unique: true },
  ] as unknown as FieldDefinition[];

  const uniqueIndexTargets = (sql: string): string[] =>
    sql
      .split("\n")
      .filter(l => /CREATE UNIQUE INDEX/i.test(l))
      .map(l => l.match(/\(["`]?([^"`)]+)["`]?\)/)?.[1] ?? "");

  it.each(DIALECTS)("gets exactly ONE unique index on %s", dialect => {
    // Every generated table already carries a system UNIQUE index on `slug`. Emitting a
    // field-specific one as well puts two identical unique indexes on the column, which every
    // write then maintains, and the desired schema keeps only one — so a table disagrees with
    // its own snapshot the moment it is created and the next reconcile proposes a drop.
    const onSlug = uniqueIndexTargets(ddlFor(dialect, uniqueSlug)).filter(
      c => c === "slug"
    );

    expect(onSlug, "one unique index covers slug, not two").toHaveLength(1);
  });

  it.each(DIALECTS)(
    "and it is the system one, not a uq_ twin, on %s",
    dialect => {
      const sql = ddlFor(dialect, uniqueSlug);
      expect(sql).toContain(`${"idx"}_dc_widgets_slug`);
      expect(sql, "no second spelling of the same guarantee").not.toContain(
        "uq_dc_widgets_slug"
      );
    }
  );
});
