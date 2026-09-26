/**
 * A virtual field on a component owns no column, on every route that builds
 * the component's table.
 *
 * The pipeline's desired component table asks the column descriptor and gets
 * nothing for a virtual field. The component service builds its own CREATE,
 * its own runtime Drizzle table and its own ALTER plan; each of those giving
 * the field a column made the table depend on the route that created it, and
 * made a runtime table that declares a column the pipeline never created,
 * which every select then names. A `required` virtual field is the sharpest
 * case: as a column it becomes NOT NULL, and the write that omits it fails.
 *
 * `headline` is the control in every case: an ordinary field that must keep
 * its column, so the virtual field's absence is the rule and not an empty
 * table.
 */
import { getColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { FieldGroupSchemaService } from "../field-group-schema-service";

const FIELDS = [
  { name: "headline", type: "text" },
  { name: "previewLine", type: "text", virtual: true, required: true },
  { name: "summary", type: "group", fields: [], options: { virtual: true } },
] as unknown as FieldConfig[];

const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

describe.each(DIALECTS)("a virtual component field on %s", dialect => {
  const service = new FieldGroupSchemaService(dialect);

  it("gets no column in the CREATE", () => {
    const sql = service.generateMigrationSQL("comp_hero", FIELDS);

    expect(sql).toMatch(/headline/);
    expect(sql).not.toMatch(/preview_line/);
    expect(sql).not.toMatch(/summary/);
  });

  it("is not declared by the runtime table", () => {
    const table = service.generateRuntimeSchema("comp_hero", FIELDS, {
      typeColumn: STORAGE_FORMAT.columns.type,
    }) as Table;
    const columns = Object.values(getColumns(table)).map(c => c.name);

    expect(columns).toContain("headline");
    expect(columns).not.toContain("preview_line");
    expect(columns).not.toContain("summary");
  });

  it("is not added by the ALTER when a component gains it", () => {
    const sql = service.generateAlterTableMigration(
      "comp_hero",
      [{ name: "title", type: "text" }] as unknown as FieldConfig[],
      [{ name: "title", type: "text" }, ...FIELDS] as FieldConfig[]
    );

    expect(sql).toMatch(/ADD COLUMN .?headline/);
    expect(sql).not.toMatch(/preview_line/);
    expect(sql).not.toMatch(/summary/);
  });
});

describe.each(DIALECTS)(
  "a many-to-many relationship on a %s component",
  dialect => {
    // A collection keeps these links in a junction table, so the column
    // descriptor gives the field no column. A component has no junction: the
    // value lives on the instance row, so the component's table keeps it.
    const service = new FieldGroupSchemaService(dialect);
    const fields = [
      {
        name: "tags",
        type: "relationship",
        options: { target: "tags", relationType: "manyToMany" },
      },
    ] as unknown as FieldConfig[];

    it("keeps its column in the CREATE and the runtime table", () => {
      expect(service.generateMigrationSQL("comp_hero", fields)).toMatch(/tags/);
      const table = service.generateRuntimeSchema("comp_hero", fields, {
        typeColumn: STORAGE_FORMAT.columns.type,
      }) as Table;
      expect(Object.values(getColumns(table)).map(c => c.name)).toContain(
        "tags"
      );
    });
  }
);
