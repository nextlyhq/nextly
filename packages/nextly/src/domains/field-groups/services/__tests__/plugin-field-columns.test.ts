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
  it("emits a column for the type's storage primitive", () => {
    registerRating();
    const sql = new FieldGroupSchemaService("postgresql").generateMigrationSQL(
      "comp_hero",
      ratingField
    );

    expect(sql).toContain("score");
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
