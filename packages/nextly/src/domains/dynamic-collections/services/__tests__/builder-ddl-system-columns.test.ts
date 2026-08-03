/**
 * The Schema Builder's DDL creates exactly the system columns the descriptor defines.
 *
 * The descriptor exists so the runtime Drizzle schema and the diff's `desired` snapshot cannot
 * drift apart. This generator is the third consumer, and it used to restate the set as per-dialect
 * SQL strings, so a system column added to the descriptor reached the runtime schema and never
 * reached the physical table. The generated SELECT then named a column that did not exist and
 * every read of the entity failed.
 *
 * Asserted as set equality against `getSystemColumnDescriptors` rather than against a list of
 * today's column names: a test naming the columns would keep passing while the next one added
 * goes missing, which is the failure being prevented.
 */
import { describe, expect, it } from "vitest";

import { getSystemColumnDescriptors } from "../../../schema/services/field-column-descriptor";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import type { SupportedDialect } from "../../../schema/services/field-column-descriptor";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** Column names in the CREATE TABLE body, read back from the generated statement. */
function columnNamesIn(sql: string): string[] {
  const createTable = sql.slice(sql.indexOf("("), sql.lastIndexOf(")"));
  const names: string[] = [];
  for (const line of createTable.split("\n")) {
    // Quoted leading identifier only, so CONSTRAINT / FOREIGN KEY lines contribute nothing.
    const match = /^\s*[`"]([a-z0-9_]+)[`"]\s+\S/i.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

const userField = (name: string): FieldDefinition =>
  ({ name, type: "text" }) as FieldDefinition;

describe.each(DIALECTS)("builder DDL system columns (%s)", dialect => {
  const service = () => new DynamicCollectionSchemaService(undefined, dialect);

  it.each([
    { label: "collection with status", hasStatus: true, isSingle: false },
    { label: "collection without status", hasStatus: false, isSingle: false },
    { label: "single with status", hasStatus: true, isSingle: true },
  ])(
    "creates exactly the descriptor set: $label",
    ({ hasStatus, isSingle }) => {
      const tableName = isSingle ? "single_thing" : "dc_thing";
      const sql = service().generateMigrationSQL(
        tableName,
        [userField("body")],
        {
          hasStatus,
          isSingle,
        }
      );

      const expected = getSystemColumnDescriptors(dialect, {
        hasTitleField: false,
        hasSlugField: false,
        hasStatus,
        isSingle,
      }).map(c => c.name);

      const present = columnNamesIn(sql);
      // Set equality both ways: a missing column is the bug this prevents, and an extra one means
      // the generator is still inventing system columns of its own.
      expect(present.filter(n => n !== "body").sort()).toEqual(
        [...expected].sort()
      );
    }
  );

  it("omits title and slug when the user defines them", () => {
    // The descriptor drops both when the user owns them, and the generator has its own reason to
    // do so; if the two disagree the table gets a duplicate column and CREATE TABLE fails.
    const sql = service().generateMigrationSQL(
      "dc_thing",
      [userField("title"), userField("slug")],
      { hasStatus: false }
    );

    const expected = getSystemColumnDescriptors(dialect, {
      hasTitleField: true,
      hasSlugField: true,
      hasStatus: false,
      isSingle: false,
    }).map(c => c.name);

    expect(columnNamesIn(sql).sort()).toEqual(
      [...expected, "title", "slug"].sort()
    );
  });

  it("treats a `single_` table as a single even when the flag is omitted", () => {
    // The runtime schema and the diff derive this from the table name, so a caller that passes
    // no flag must not get an owner column the other two paths do not expect.
    const sql = service().generateMigrationSQL("single_thing", [], {
      hasStatus: false,
    });
    expect(columnNamesIn(sql)).not.toContain("created_by");
  });

  it("renders each system column's type, default and constraints", () => {
    // Set equality alone would pass if every column were emitted as bare `text`. This pins the
    // rendering itself against the descriptor's own values.
    const sql = service().generateMigrationSQL("dc_thing", [], {
      hasStatus: true,
    });

    for (const column of getSystemColumnDescriptors(dialect, {
      hasTitleField: false,
      hasSlugField: false,
      hasStatus: true,
      isSingle: false,
    })) {
      const line = sql
        .split("\n")
        .find(l => new RegExp(`^\\s*[\`"]${column.name}[\`"]\\s`).test(l));
      expect(line).toBeDefined();
      if (column.default !== undefined) {
        expect(line).toContain(`DEFAULT ${column.default}`);
      }
      if (column.primaryKey) expect(line).toContain("PRIMARY KEY");
      // Nullable columns must not be constrained; a NOT NULL the descriptor does not declare is
      // exactly the divergence that made the diff propose a change on every reconcile.
      expect(line?.includes("NOT NULL")).toBe(!column.nullable);
    }
  });
});

describe.each(DIALECTS)("builder lifecycle toggle (%s)", dialect => {
  const service = () => new DynamicCollectionSchemaService(undefined, dialect);

  /** The columns the descriptor gains when the draft/publish lifecycle is enabled. */
  const lifecycleColumns = (isSingle: boolean) => {
    const off = new Set(
      getSystemColumnDescriptors(dialect, {
        hasTitleField: false,
        hasSlugField: false,
        hasStatus: false,
        isSingle,
      }).map(c => c.name)
    );
    return getSystemColumnDescriptors(dialect, {
      hasTitleField: false,
      hasSlugField: false,
      hasStatus: true,
      isSingle,
    })
      .map(c => c.name)
      .filter(n => !off.has(n));
  };

  it.each([
    { label: "collection", table: "dc_thing", isSingle: false },
    { label: "single", table: "single_thing", isSingle: true },
  ])(
    "adds every lifecycle column when enabling: $label",
    ({ table, isSingle }) => {
      // Enabling the lifecycle must create every column the runtime schema starts selecting. Naming
      // only `status` here left the marker expected by the schema and created by nothing, so the
      // next read referenced a column the toggle had never added.
      const sql = service().generateAlterTableMigration(table, [], [], {
        wasStatus: false,
        hasStatus: true,
      });

      for (const name of lifecycleColumns(isSingle)) {
        expect(sql).toContain(`ADD COLUMN`);
        expect(sql.includes(`"${name}"`) || sql.includes(`\`${name}\``)).toBe(
          true
        );
      }
    }
  );

  it.each([
    { label: "collection", table: "dc_thing", isSingle: false },
    { label: "single", table: "single_thing", isSingle: true },
  ])(
    "drops every lifecycle column when disabling: $label",
    ({ table, isSingle }) => {
      const sql = service().generateAlterTableMigration(table, [], [], {
        wasStatus: true,
        hasStatus: false,
      });

      for (const name of lifecycleColumns(isSingle)) {
        expect(sql).toContain("DROP COLUMN");
        expect(sql.includes(`"${name}"`) || sql.includes(`\`${name}\``)).toBe(
          true
        );
      }
    }
  );

  it("leaves the table alone when the lifecycle does not change", () => {
    const sql = service().generateAlterTableMigration("dc_thing", [], [], {
      wasStatus: true,
      hasStatus: true,
    });
    expect(sql).not.toContain("DROP COLUMN");
    expect(sql).not.toContain("first_published_at");
  });
});
