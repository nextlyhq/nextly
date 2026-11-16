/**
 * A field group's fields inside a group with no name are columns of its row, on every route that
 * builds the table: the creator's CREATE, its runtime Drizzle table, and the desired table a Builder
 * save, `migrate:create` and reconcile diff from. All three read the one walk
 * (`fieldsStoredOnRow`), so they name the same user columns, and a group nested inside another
 * group with no name is looked through as well.
 *
 * `title` beside the group is the control: a column every route has always made. The field group
 * placed inside the group is the other control: its instances are rows of its own table, so it
 * has no column on any route.
 *
 * The runtime table built from a table's held columns (`heldColumns`) leaves out a field inside a
 * group with no name whose column the table does not hold yet, so a field group made before such
 * fields were stored is read as before until its next save adds them. A field beside the group is
 * never left out.
 */
import { getColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { buildDesiredTableFromComponentFields } from "../../../schema/pipeline/diff/build-from-fields";
import { FieldGroupSchemaService } from "../field-group-schema-service";

const FIELDS = [
  { name: "title", type: "text" },
  {
    type: "group",
    label: "Layout",
    fields: [
      { name: "note", type: "text" },
      { name: "seal", type: "component", component: "seal" },
      {
        type: "group",
        label: "Inner",
        fields: [{ name: "issuedOn", type: "date" }],
      },
    ],
  },
  // A named group keeps its fields inside its own JSON column.
  { name: "extra", type: "group", fields: [{ name: "hidden", type: "text" }] },
] as unknown as FieldConfig[];

/** The user columns, in a stable order. */
const USER_COLUMNS = ["extra", "issued_on", "note", "title"];

const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

/** Every column a table declares that is not one of a field group's system columns. */
function userColumns(columns: string[], dialect: string): string[] {
  const system = new Set(
    buildDesiredTableFromComponentFields("comp_badge", [], dialect as never, {
      builtBy: "fieldGroup",
    }).columns.map(column => column.name)
  );
  return columns.filter(column => !system.has(column)).sort();
}

describe.each(DIALECTS)(
  "a field group's fields inside a group with no name on %s",
  dialect => {
    const service = new FieldGroupSchemaService(dialect);

    it("are columns of the creator's CREATE", () => {
      const sql = service.generateMigrationSQL("comp_badge", FIELDS);
      const created = service
        .identifiersIn(sql.split("--> statement-breakpoint")[0] ?? "")
        .filter(name => name !== "comp_badge");
      expect(userColumns(created, dialect)).toEqual(USER_COLUMNS);
    });

    it("are columns of the runtime table", () => {
      const table = service.generateRuntimeSchema("comp_badge", FIELDS, {
        typeColumn: STORAGE_FORMAT.columns.type,
      }) as Table;
      const columns = Object.values(getColumns(table)).map(c => c.name);
      expect(userColumns(columns, dialect)).toEqual(USER_COLUMNS);
    });

    it("are columns of the desired table", () => {
      const desired = buildDesiredTableFromComponentFields(
        "comp_badge",
        FIELDS as never,
        dialect,
        { builtBy: "fieldGroup" }
      );
      expect(
        userColumns(
          desired.columns.map(column => column.name),
          dialect
        )
      ).toEqual(USER_COLUMNS);
    });

    it("are left out of a runtime table built from a table that does not hold them yet", () => {
      const table = service.generateRuntimeSchema("comp_badge", FIELDS, {
        typeColumn: STORAGE_FORMAT.columns.type,
        // The table as an earlier version made it: the system columns, and a column for each
        // field beside the group, `note` among the laid-out ones only.
        heldColumns: [
          ...buildDesiredTableFromComponentFields("comp_badge", [], dialect, {
            builtBy: "fieldGroup",
          }).columns.map(column => column.name),
          "title",
          "extra",
          "note",
        ],
      }) as Table;
      const columns = Object.values(getColumns(table)).map(c => c.name);
      expect(userColumns(columns, dialect)).toEqual(["extra", "note", "title"]);
    });

    it("never leaves out a field beside the group", () => {
      const table = service.generateRuntimeSchema("comp_badge", FIELDS, {
        typeColumn: STORAGE_FORMAT.columns.type,
        heldColumns: [],
      }) as Table;
      const columns = Object.values(getColumns(table)).map(c => c.name);
      expect(userColumns(columns, dialect)).toEqual(["extra", "title"]);
    });
  }
);
