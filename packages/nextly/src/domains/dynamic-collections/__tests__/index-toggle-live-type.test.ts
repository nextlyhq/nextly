/**
 * Turning an index on is judged by the column the table actually has.
 *
 * A repeater or group is created in the dialect's JSON type now, and stayed
 * text on a table created before. MySQL cannot index a JSON column at all, and
 * indexes a text one only by a prefix. So the same field toggled to `index`
 * needs a different answer on the two tables: no index on the new one, a
 * prefix index on the old one. The Builder's save reads the live column types
 * and hands them in; judged by the field alone, the toggle wrote a prefix
 * index MySQL refuses on a JSON column, failing the save.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  DynamicCollectionSchemaService,
  type SupportedDialect,
} from "../services/dynamic-collection-schema-service";

function toggleIndexOn(dialect: SupportedDialect, liveType: string): string {
  const before = [
    { name: "meta", type: "group", fields: [] },
  ] as unknown as FieldDefinition[];
  const after = [
    { name: "meta", type: "group", fields: [], index: true },
  ] as unknown as FieldDefinition[];
  return new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).generateAlterTableMigration("dc_probe", before, after, {
    liveColumnTypes: new Map([["meta", liveType]]),
  });
}

describe("toggling a repeater or group's index on", () => {
  it("adds no index on MySQL when the column is JSON, which MySQL cannot index", () => {
    expect(toggleIndexOn("mysql", "json")).not.toMatch(/CREATE INDEX/i);
  });

  it("adds a prefix index on MySQL when the column is the older text", () => {
    expect(toggleIndexOn("mysql", "text")).toMatch(
      /CREATE INDEX .*`meta`\(\d+\)/i
    );
  });

  it("adds an index on PostgreSQL, which indexes jsonb", () => {
    expect(toggleIndexOn("postgresql", "jsonb")).toMatch(
      /CREATE INDEX .*"meta"/i
    );
  });
});
