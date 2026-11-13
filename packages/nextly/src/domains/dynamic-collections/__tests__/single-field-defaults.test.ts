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

import { NextlyError } from "../../../errors/nextly-error";
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

  it("adds a field with a default to a Single filling its row once and keeping no DEFAULT, and to a collection with it", () => {
    const toNotNull: [string, boolean][] = [];
    const single = service(dialect).generateAlterTableMigration(
      "single_hero",
      [TITLE],
      [TITLE, STATUS],
      {
        isSingle: true,
        tableHasRows: true,
        onSqliteNullability: (column, required) =>
          toNotNull.push([column, required]),
      }
    );
    const collection = service(dialect).generateAlterTableMigration(
      "dc_posts",
      [TITLE],
      [TITLE, STATUS],
      { tableHasRows: true }
    );
    const statements = about(single, "status_label");
    // The entry already there gets the field's default, as the column default once gave it; the
    // column keeps none, and an optional field stays open.
    const fill =
      dialect === "mysql"
        ? `X'${Buffer.from("draft", "utf8").toString("hex")}'`
        : "'draft'";

    expect(statements.join(";")).not.toMatch(/NOT NULL/i);
    expect(statements.join(";")).toContain(fill);
    if (dialect === "sqlite") {
      expect(statements[0]).not.toMatch(/DEFAULT/i);
      expect(
        statements.some(s => /^UPDATE single_hero SET status_label = /i.test(s))
      ).toBe(true);
      expect(toNotNull).toEqual([]);
    } else {
      expect(statements.at(-1)).toMatch(
        /ALTER COLUMN status_label DROP DEFAULT/i
      );
    }
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

describe.each(DIALECTS)(
  "a Single's row filled for a required field on %s",
  dialect => {
    const added = (extra: FieldDefinition) =>
      service(dialect).generateAlterTableMigration(
        "single_hero",
        [TITLE],
        [TITLE, extra],
        { isSingle: true, tableHasRows: true, onSqliteNullability: () => {} }
      );

    it("takes a structured default as the field states it", () => {
      const sql = added(
        field({
          name: "settings",
          type: "json",
          required: true,
          defaultValue: { theme: "dark" },
        })
      );

      // MySQL writes a JSON default as a hex literal it converts back (`quoteExpressionSqlDefault`).
      const json = '{"theme":"dark"}';
      expect(sql).toContain(
        dialect === "mysql"
          ? `X'${Buffer.from(json, "utf8").toString("hex")}'`
          : json
      );
    });

    it("writes a JSON field's stated string as the JSON string it is", () => {
      const sql = added(
        field({
          name: "settings",
          type: "json",
          required: true,
          defaultValue: "hello",
        })
      );

      // The logical value "hello" is stored as the JSON text `"hello"`, never as bare `hello`.
      const json = JSON.stringify("hello");
      expect(sql).toContain(
        dialect === "mysql"
          ? `X'${Buffer.from(json, "utf8").toString("hex")}'`
          : `'${json}'`
      );
    });

    it("fills the row with an icon id the field states, and not with one no icon has", () => {
      const sql = added(
        field({
          name: "badge",
          type: "icon",
          required: true,
          default: "lucide:star",
        })
      );

      expect(sql).toContain(
        dialect === "mysql"
          ? `X'${Buffer.from("lucide:star", "utf8").toString("hex")}'`
          : "'lucide:star'"
      );
      expect(
        added(
          field({
            name: "badge",
            type: "icon",
            required: true,
            default: "Not An Icon!",
          })
        )
      ).not.toContain("Not An Icon!");
    });

    it("never writes a password field's stated default into the column", () => {
      const sql = added(
        field({
          name: "secret",
          type: "password",
          required: true,
          defaultValue: "hunter2",
        })
      );

      expect(sql).not.toContain("hunter2");
    });

    it("quotes a default holding an apostrophe", () => {
      const sql = added(
        field({
          name: "motto",
          type: "text",
          required: true,
          defaultValue: "Editor's pick",
        })
      );

      // MySQL takes the text as a hex literal, whose bytes carry no quote and no escape.
      expect(sql).toContain(
        dialect === "mysql"
          ? `X'${Buffer.from("Editor's pick", "utf8").toString("hex")}'`
          : "'Editor''s pick'"
      );
    });

    it("keeps a backslash before an apostrophe inside the value", () => {
      const stated = "x\\'; DROP TABLE single_hero; --";
      const sql = added(
        field({
          name: "motto",
          type: "text",
          required: true,
          defaultValue: stated,
        })
      );

      // Under MySQL's default mode a backslash escapes the quote after it, so a doubled quote
      // alone would end the literal there and run the rest as SQL.
      if (dialect === "mysql") {
        expect(sql).toContain(
          `X'${Buffer.from(stated, "utf8").toString("hex")}'`
        );
        expect(sql).not.toContain("DROP TABLE");
        return;
      }
      expect(sql).toContain(`'${stated.replace(/'/g, "''")}'`);
    });

    it("writes a stated date in the form the dialect stores it", () => {
      const at = new Date("2026-01-02T03:04:05.000Z");
      const sql = added(
        field({
          name: "launch",
          type: "date",
          required: true,
          defaultValue: at,
        })
      );

      const expected = {
        sqlite: String(Math.floor(at.getTime() / 1000)),
        mysql: "'2026-01-02 03:04:05.000'",
        postgresql: "'2026-01-02T03:04:05.000Z'",
      }[dialect];
      expect(sql).toContain(expected);
      expect(sql).not.toContain("GMT");
    });

    it("never fills the row with a relationship's stated id, which may name no row", () => {
      const add = () =>
        added(
          field({
            name: "featured",
            type: "relationship",
            relationTo: "posts",
            required: true,
            defaultValue: "row-that-is-not-there",
          })
        );

      // Refused as a required column with nothing to fill it, as before a default was read here.
      let codes: string[] = [];
      try {
        add();
      } catch (error) {
        if (!(error instanceof NextlyError)) throw error;
        const data = error.publicData as
          | { errors?: { code?: string }[] }
          | undefined;
        codes = (data?.errors ?? []).map(e => String(e.code));
      }
      expect(codes).toEqual(["REQUIRED_COLUMN_NEEDS_BACKFILL"]);
    });

    it("fills the row for a contributed type with its type's own value, not the stated one", () => {
      let sql = "";
      try {
        sql = added(
          field({
            name: "score",
            type: "acme-rating",
            required: true,
            defaultValue: "stated-by-the-field",
          })
        );
      } catch {
        // Refusing the change also writes nothing the type has not checked.
      }

      expect(sql).not.toContain("stated-by-the-field");
    });
  }
);

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
