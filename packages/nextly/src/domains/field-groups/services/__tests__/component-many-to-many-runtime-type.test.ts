/**
 * A component's many-to-many column is a uuid on PostgreSQL in the runtime table, the same type the
 * creating SQL writes.
 *
 * The drizzle-kit creation route builds the component table from this runtime table. If it wrote
 * text while the desired schema says uuid, the next preview would propose a text-to-uuid conversion
 * on a table nobody changed.
 */
import { getColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { FieldGroupSchemaService } from "../field-group-schema-service";

const MANY_TO_MANY = [
  {
    name: "tags",
    type: "relationship",
    options: { target: "tags", relationType: "manyToMany" },
  },
] as unknown as FieldConfig[];

describe("a component many-to-many in the runtime table", () => {
  it("is a uuid column on PostgreSQL, as the creating SQL writes it", () => {
    const table = new FieldGroupSchemaService(
      "postgresql"
    ).generateRuntimeSchema("comp_hero", MANY_TO_MANY, {
      typeColumn: STORAGE_FORMAT.columns.type,
    }) as Table;
    const tags = Object.values(getColumns(table)).find(c => c.name === "tags");
    expect(tags?.columnType).toBe("PgUUID");
  });
});
