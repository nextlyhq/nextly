/**
 * A Single's table carries no column DEFAULT from a field's default: the field's default is the
 * application's, applied when its document is written, as a collection's is and as the schema a
 * migration is written from says. A required field added to a Single that already has its row
 * fills that row and is then left with no default.
 *
 * The same generator writes a collection's table where no Builder save writer is set up, and that
 * path is unchanged: its field defaults stay column DEFAULTs. Each case pins both, so a change that
 * reached collections too, or reached Singles only partly, fails here.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  DynamicCollectionSchemaService,
  type SupportedDialect,
} from "../services/dynamic-collection-schema-service";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

const service = (dialect: SupportedDialect) =>
  new DynamicCollectionSchemaService(undefined, dialect);

const field = (overrides: Record<string, unknown>): FieldDefinition =>
  ({ required: false, ...overrides }) as unknown as FieldDefinition;

const TITLE = field({ name: "title", type: "text" });
/** A field carrying a default, as an API or code payload states one. */
const STATUS = field({ name: "status_label", type: "text", default: "draft" });
const RANK = field({ name: "rank", type: "number", required: true });

/**
 * The lines that mention `column`, quoting removed: one per statement, or per column of a CREATE
 * TABLE, whose other columns carry defaults of their own.
 */
const about = (sql: string, column: string) =>
  sql
    .replace(/["`]/g, "")
    .split(/;|\n/)
    .map(line => line.trim())
    .filter(line => line.includes(column));

describe.each(DIALECTS)("field defaults on %s", dialect => {
  it("creates a Single's table with no DEFAULT from a field's default, and a collection's with it", () => {
    const single = service(dialect).generateMigrationSQL(
      "single_hero",
      [TITLE, STATUS],
      { isSingle: true }
    );
    const collection = service(dialect).generateMigrationSQL("dc_posts", [
      TITLE,
      STATUS,
    ]);

    expect(about(single, "status_label").join(";")).not.toMatch(/DEFAULT/i);
    expect(about(collection, "status_label").join(";")).toMatch(
      /DEFAULT 'draft'/i
    );
  });

  it("adds a field with a default to a Single with no DEFAULT, and to a collection with it", () => {
    const single = service(dialect).generateAlterTableMigration(
      "single_hero",
      [TITLE],
      [TITLE, STATUS],
      { isSingle: true, tableHasRows: true }
    );
    const collection = service(dialect).generateAlterTableMigration(
      "dc_posts",
      [TITLE],
      [TITLE, STATUS],
      { tableHasRows: true }
    );

    expect(about(single, "status_label").join(";")).not.toMatch(/DEFAULT/i);
    expect(about(collection, "status_label").join(";")).toMatch(
      /DEFAULT 'draft'/i
    );
  });

  it("fills a Single's row when a required field is added, then leaves the column with no default", () => {
    const toNotNull: [string, boolean][] = [];
    const single = service(dialect).generateAlterTableMigration(
      "single_hero",
      [TITLE],
      [TITLE, RANK],
      {
        isSingle: true,
        tableHasRows: true,
        onSqliteNullability: (column, required) =>
          toNotNull.push([column, required]),
      }
    );
    const statements = about(single, "rank");

    if (dialect === "sqlite") {
      // SQLite can drop no default: the column is added open, filled, and made NOT NULL by the
      // rebuild the caller runs once these statements have.
      expect(statements[0]).toMatch(/ADD COLUMN rank/i);
      expect(statements[0]).not.toMatch(/DEFAULT|NOT NULL/i);
      expect(
        statements.some(s => /^UPDATE single_hero SET rank = 0/i.test(s))
      ).toBe(true);
      expect(toNotNull).toEqual([["rank", true]]);
      return;
    }
    // MySQL takes the fill as an expression, which any column accepts (`fillThenDropDefault`).
    expect(statements[0]).toMatch(
      dialect === "mysql"
        ? /ADD COLUMN rank .*NOT NULL DEFAULT \(0\)/i
        : /ADD COLUMN rank .*NOT NULL DEFAULT 0/i
    );
    expect(statements.at(-1)).toMatch(/ALTER COLUMN rank DROP DEFAULT/i);
  });

  it("leaves a collection's required field added as before, its default kept", () => {
    const collection = service(dialect).generateAlterTableMigration(
      "dc_posts",
      [TITLE],
      [TITLE, RANK],
      { tableHasRows: true }
    );
    const statements = about(collection, "rank");

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/ADD COLUMN rank .*NOT NULL DEFAULT 0/i);
  });
});

describe("a MySQL column restated by a Single's change", () => {
  it("carries no default for a Single, and keeps it for a collection", () => {
    const before = field({ ...STATUS });
    const after = field({ ...STATUS, required: true });
    const single = service("mysql").generateAlterTableMigration(
      "single_hero",
      [TITLE, before],
      [TITLE, after],
      { isSingle: true, tableHasRows: false }
    );
    const collection = service("mysql").generateAlterTableMigration(
      "dc_posts",
      [TITLE, before],
      [TITLE, after],
      { tableHasRows: false }
    );

    expect(about(single, "MODIFY COLUMN status_label").join(";")).not.toMatch(
      /DEFAULT/i
    );
    expect(about(collection, "MODIFY COLUMN status_label").join(";")).toMatch(
      /DEFAULT 'draft'/i
    );
  });
});
