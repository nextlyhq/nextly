/**
 * Tests for database configuration
 */

import { describe, it, expect } from "vitest";

import { DATABASE_CONFIGS, DATABASE_LABELS } from "../prompts/database";

describe("DATABASE_CONFIGS", () => {
  it("should have correct PostgreSQL configuration", () => {
    expect(DATABASE_CONFIGS.postgresql).toEqual({
      adapter: "@revnixhq/adapter-postgres",
      databaseDriver: "pg",
      connectionUrl: "postgresql://user:password@localhost:5432/nextly",
      envExample: "postgresql://user:password@localhost:5432/nextly",
    });
  });

  it("should have correct MySQL configuration", () => {
    expect(DATABASE_CONFIGS.mysql).toEqual({
      adapter: "@revnixhq/adapter-mysql",
      databaseDriver: "mysql2",
      connectionUrl: "mysql://user:password@localhost:3306/nextly",
      envExample: "mysql://user:password@localhost:3306/nextly",
    });
  });

  it("should have correct SQLite configuration", () => {
    expect(DATABASE_CONFIGS.sqlite).toEqual({
      adapter: "@revnixhq/adapter-sqlite",
      databaseDriver: "better-sqlite3",
      connectionUrl: "file:./data/nextly.db",
      envExample: "file:./data/nextly.db",
    });
  });

  it("should have all three database types", () => {
    expect(Object.keys(DATABASE_CONFIGS)).toHaveLength(3);
    expect(DATABASE_CONFIGS).toHaveProperty("postgresql");
    expect(DATABASE_CONFIGS).toHaveProperty("mysql");
    expect(DATABASE_CONFIGS).toHaveProperty("sqlite");
  });
});

describe("DATABASE_LABELS", () => {
  it("should have labels for all database types", () => {
    expect(DATABASE_LABELS.sqlite.label).toBe("SQLite");
    expect(DATABASE_LABELS.sqlite.hint).toContain("trying out Nextly");
    expect(DATABASE_LABELS.postgresql.label).toBe("PostgreSQL");
    expect(DATABASE_LABELS.postgresql.hint).toContain("production");
    expect(DATABASE_LABELS.mysql.label).toBe("MySQL");
    expect(DATABASE_LABELS.mysql.hint).toContain("production");
  });
});
