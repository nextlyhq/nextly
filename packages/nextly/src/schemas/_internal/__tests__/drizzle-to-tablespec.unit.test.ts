/**
 * Unit test for the Drizzle-table → TableSpec converter used by getCoreSchema().
 *
 * @module schemas/_internal/__tests__/drizzle-to-tablespec.unit.test
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import { describe, it, expect } from "vitest";
import { pgTable, text, integer } from "drizzle-orm/pg-core";

import { drizzleTableToTableSpec } from "../drizzle-to-tablespec";

describe("drizzleTableToTableSpec", () => {
  it("converts a basic Postgres table to TableSpec", () => {
    const userTable = pgTable("users_test", {
      id: text("id").primaryKey(),
      age: integer("age"),
    });

    const spec = drizzleTableToTableSpec(userTable);

    expect(spec.name).toBe("users_test");
    expect(spec.columns).toHaveLength(2);

    const idColumn = spec.columns.find(c => c.name === "id");
    expect(idColumn).toMatchObject({
      name: "id",
      nullable: false,
    });

    const ageColumn = spec.columns.find(c => c.name === "age");
    expect(ageColumn).toMatchObject({
      name: "age",
      nullable: true,
    });
  });

  it("captures column defaults as strings", () => {
    const tbl = pgTable("defaults_test", {
      flag: integer("flag").notNull().default(0),
      name: text("name").notNull().default("anon"),
    });

    const spec = drizzleTableToTableSpec(tbl);

    expect(spec.columns.find(c => c.name === "flag")?.default).toBe("0");
    expect(spec.columns.find(c => c.name === "name")?.default).toBe("anon");
  });
});
