/**
 * An icon field on a component gets the column the canonical descriptor names, on every route that
 * builds the component's table.
 *
 * The desired schema the diff compares a live component table against is read from
 * `getComponentRowColumnDescriptor`. The component service builds its own CREATE and its own
 * runtime Drizzle table, so each of those is compared with the descriptor here, type, name and
 * nullability alike: a CREATE that bounded the column where the descriptor does not would leave
 * every later diff proposing to change a column nobody touched.
 */
import { getColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { getComponentRowColumnDescriptor } from "../../../schema/services/field-column-descriptor";
import { FieldGroupSchemaService } from "../field-group-schema-service";

const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

// A camelCase name, so the column name is converted rather than agreeing by coincidence.
const FIELDS = [
  { name: "badgeIcon", type: "icon" },
  { name: "markerIcon", type: "icon", required: true },
] as const;

function described(
  field: (typeof FIELDS)[number],
  dialect: (typeof DIALECTS)[number]
) {
  const descriptor = getComponentRowColumnDescriptor(
    field as unknown as FieldDefinition,
    dialect,
    "fieldGroup"
  );
  if (!descriptor) throw new Error(`no descriptor for ${field.name}`);
  return descriptor;
}

describe.each(DIALECTS)("an icon field on a %s component", dialect => {
  const service = new FieldGroupSchemaService(dialect);
  const fields = FIELDS as unknown as FieldConfig[];

  it.each(FIELDS)("$name is created as the descriptor's column", field => {
    const descriptor = described(field, dialect);
    const columnType = service.columnTypeFor(
      field as unknown as Parameters<typeof service.columnTypeFor>[0]
    );

    // Compared case-blind: SQL spells a type in either case, and `VARCHAR(255)` against `text` is
    // the difference that matters, not `TEXT` against `text`.
    expect(columnType?.toLowerCase()).toBe(descriptor.dialectType);

    const quote = dialect === "mysql" ? "`" : '"';
    const line = service
      .generateMigrationSQL("comp_hero", fields)
      .split("\n")
      .find(l => l.trim().startsWith(`${quote}${descriptor.name}${quote}`));
    expect(line?.trim().replace(/,$/, "").toLowerCase()).toBe(
      `${quote}${descriptor.name}${quote} ${descriptor.dialectType}` +
        (descriptor.nullable ? "" : " not null")
    );
  });

  it.each(FIELDS)(
    "$name is declared by the runtime table as the descriptor's column",
    field => {
      const descriptor = described(field, dialect);
      const table = service.generateRuntimeSchema("comp_hero", fields, {
        typeColumn: STORAGE_FORMAT.columns.type,
      }) as Table;
      const column = getColumns(table)[field.name];

      expect(column?.name).toBe(descriptor.name);
      expect(column?.getSQLType()).toBe(descriptor.dialectType);
      expect(column?.notNull).toBe(!descriptor.nullable);
    }
  );
});
