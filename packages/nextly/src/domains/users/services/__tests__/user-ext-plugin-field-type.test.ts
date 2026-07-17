/**
 * A plugin-contributed user field must get a real column keyed off the plugin's
 * declared storage primitive — not be silently skipped or defaulted to text.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../schema/field-types/field-type-registry";
import type { UserFieldConfig } from "../../../../users/config/types";
import { UserExtSchemaService } from "../user-ext-schema-service";

afterEach(() => clearFieldTypes());

/** A user field of an arbitrary (plugin) type. */
function field(type: string): UserFieldConfig {
  return { name: "score", label: "Score", type } as unknown as UserFieldConfig;
}

describe("UserExtSchemaService — plugin field types", () => {
  it("maps a plugin field to a column from its storage primitive", () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "c",
      surfaces: ["users"],
    });
    const sql = new UserExtSchemaService("postgresql").generateMigrationSQL([
      field("rating"),
    ]);
    // A numeric storage primitive yields a REAL column, not TEXT, and the
    // column is present (not skipped).
    expect(sql).toMatch(/"score"\s+REAL/i);
    expect(sql).not.toMatch(/"score"\s+TEXT/i);
  });

  it("maps a boolean-storage plugin field to a boolean column", () => {
    registerFieldType({
      type: "flag",
      storage: "boolean",
      component: "c",
      surfaces: ["users"],
    });
    const sql = new UserExtSchemaService("postgresql").generateMigrationSQL([
      field("flag"),
    ]);
    expect(sql).toMatch(/"score"\s+BOOLEAN/i);
  });

  it("skips an unregistered non-built-in type (no column)", () => {
    const sql = new UserExtSchemaService("postgresql").generateMigrationSQL([
      field("mystery"),
    ]);
    expect(sql).not.toMatch(/"score"/);
  });
});
