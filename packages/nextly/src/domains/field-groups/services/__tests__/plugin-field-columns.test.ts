/**
 * A plugin-typed field on a field group reaches the table.
 *
 * The generated component interface includes these fields, and the schema
 * pipeline creates their columns through `getColumnDescriptor`, which resolves
 * plugin types. The component service builds its own DDL and its own Drizzle
 * table, and both skipped anything failing the built-in-only guard — so the
 * column could exist while nothing could read or write it.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../../schema/field-types/field-type-registry";
import { FieldGroupSchemaService } from "../field-group-schema-service";

afterEach(() => {
  clearFieldTypes();
});

const ratingField = [
  { name: "score", type: "star-rating" },
] as unknown as FieldConfig[];

function registerRating(): void {
  registerFieldType({
    type: "star-rating",
    storage: "number",
    component: "@acme/ratings/admin#StarRating",
    surfaces: ["entries", "singles", "components"],
  });
}

describe("plugin field types on a field group", () => {
  it("emits a column of the type's storage primitive", () => {
    registerRating();
    const sql = new FieldGroupSchemaService("postgresql").generateMigrationSQL(
      "comp_hero",
      ratingField
    );

    // The SQL type, not just the name: a column mapped to text would satisfy a
    // presence check while storing the wrong thing.
    expect(sql).toMatch(
      /"score"\s+(?:INTEGER|BIGINT|REAL|DOUBLE PRECISION|NUMERIC)/i
    );
  });

  it("alters an existing column when a field changes to a plugin type", () => {
    registerRating();
    const sql = new FieldGroupSchemaService(
      "postgresql"
    ).generateAlterTableMigration(
      "comp_hero",
      [{ name: "score", type: "text" }] as unknown as FieldConfig[],
      ratingField
    );

    // The type as well as the statement: an ALTER to TEXT would satisfy a check
    // that only looked for the keyword while leaving the column unchanged.
    expect(sql).toMatch(
      /ALTER COLUMN "score" TYPE\s+(?:INTEGER|BIGINT|REAL|DOUBLE PRECISION|NUMERIC)/i
    );
  });

  it("does not let a plugin option reshape the column", () => {
    registerFieldType({
      type: "metric",
      storage: "number",
      component: "@acme/metric/admin#Metric",
      surfaces: ["entries", "singles", "components"],
    });

    // `dbType` is how a built-in number states it wants exact decimal storage.
    // Here it is the plugin type's own option, which core does not interpret —
    // reading it would give this field a decimal column in a component while
    // the canonical descriptor kept mapping the primitive to an integer.
    const sql = new FieldGroupSchemaService("postgresql").generateMigrationSQL(
      "comp_hero",
      [
        { name: "score", type: "metric", dbType: "decimal" },
      ] as unknown as FieldConfig[]
    );

    expect(sql).not.toMatch(/"score"\s+(?:NUMERIC|DECIMAL)/i);
    expect(sql).toMatch(/"score"\s+(?:INTEGER|BIGINT)/i);
  });

  it("omits it when the type is not registered", () => {
    // An unregistered type is not a plugin field, and guessing a column for it
    // would be worse than leaving it out.
    const sql = new FieldGroupSchemaService("postgresql").generateMigrationSQL(
      "comp_hero",
      ratingField
    );

    expect(sql).not.toContain("score");
  });
});
