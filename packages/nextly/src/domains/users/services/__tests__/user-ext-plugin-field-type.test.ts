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

// The registry is a module-global singleton; clear it after each test so a
// type registered here never leaks into a later test's column mapping.
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

  it("gives a json-storage field a SQLite column that round-trips", () => {
    registerFieldType({
      type: "chart",
      storage: "json",
      component: "c",
      surfaces: ["users"],
    });

    const table = new UserExtSchemaService("sqlite").generateRuntimeSchema([
      field("chart"),
    ]);

    // SQLite holds JSON as text, so the column has to carry the mode that
    // serializes on write and parses on read. Plain text would store a live
    // object as `[object Object]` and hand back a string.
    const column = (table as unknown as Record<string, { score?: unknown }>)
      .score as { mapToDriverValue?: (value: unknown) => unknown } | undefined;

    expect(column).toBeDefined();
    expect(column?.mapToDriverValue?.({ a: 1 })).toBe('{"a":1}');
  });

  it("reads back a row written before the column encoded JSON", () => {
    registerFieldType({
      type: "chart2",
      storage: "json",
      component: "c",
      surfaces: ["users"],
    });

    const table = new UserExtSchemaService("sqlite").generateRuntimeSchema([
      field("chart2"),
    ]);
    const column = (table as unknown as Record<string, { score?: unknown }>)
      .score as
      | { mapFromDriverValue?: (value: unknown) => unknown }
      | undefined;

    // Such a row was legal while this column was plain text. Decoding it
    // unconditionally throws, and the read path treats a failed user_ext query
    // as a missing table — so one legacy row would empty every custom field on
    // that user.
    expect(column?.mapFromDriverValue?.("hello")).toBe("hello");
    expect(column?.mapFromDriverValue?.('{"a":1}')).toEqual({ a: 1 });
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

  it("skips a registered type not enabled on the users surface", () => {
    // Registration alone is not authorization: an entries-only type must never
    // be mapped to a user column even though getFieldType() would resolve it.
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "c",
      surfaces: ["entries"],
    });
    const sql = new UserExtSchemaService("postgresql").generateMigrationSQL([
      field("rating"),
    ]);
    expect(sql).not.toMatch(/"score"/);
  });
});
