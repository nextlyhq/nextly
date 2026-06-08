// Contract test for drizzle-kit/api's pushSchema result shape.
// What: calls the real SQLite pushSchema against an in-memory DB and asserts
// the result object still has the four fields our PushSchemaPipeline relies on
// (hasDataLoss, warnings, statementsToExecute, apply).
// Why: drizzle-kit/api is undocumented. If a Drizzle upgrade (including the
// future v1 move) changes this shape, this test fails loudly instead of the
// pipeline breaking silently in production.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, it, expect } from "vitest";

import { getSQLiteDrizzleKit } from "../drizzle-kit-lazy";

// A minimal table so pushSchema has something to diff against an empty DB.
const contractSample = sqliteTable("contract_sample", {
  id: text("id").primaryKey(),
  title: text("title"),
});

describe("drizzle-kit/api contract (SQLite)", () => {
  it("pushSchema returns the four fields our pipeline depends on", async () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);
    const kit = await getSQLiteDrizzleKit();

    const result = await kit.pushSchema(
      { contract_sample: contractSample },
      db
    );

    expect(typeof result.hasDataLoss).toBe("boolean");
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.statementsToExecute)).toBe(true);
    expect(typeof result.apply).toBe("function");

    sqlite.close();
  });

  it("statementsToExecute contains the CREATE TABLE for a brand-new table", async () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);
    const kit = await getSQLiteDrizzleKit();

    const result = await kit.pushSchema(
      { contract_sample: contractSample },
      db
    );

    const joined = result.statementsToExecute.join("\n").toLowerCase();
    expect(joined).toContain("create table");
    expect(joined).toContain("contract_sample");

    sqlite.close();
  });
});
