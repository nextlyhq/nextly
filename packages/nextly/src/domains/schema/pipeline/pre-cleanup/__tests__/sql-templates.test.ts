// Unit tests for per-dialect pre-cleanup SQL builders.

import { describe, it, expect } from "vitest";

import {
  buildDeleteNonconformingSql,
  buildProvideDefaultSql,
} from "../sql-templates.js";

describe("buildProvideDefaultSql", () => {
  it("PG: emits parameterized UPDATE with $1 placeholder", () => {
    const stmt = buildProvideDefaultSql({
      dialect: "postgresql",
      table: "dc_users",
      column: "email",
      value: "guest@example.com",
    });
    expect(stmt.sql).toMatch(/UPDATE "dc_users"/);
    expect(stmt.sql).toMatch(/SET "email" = \$1/);
    expect(stmt.sql).toMatch(/WHERE "email" IS NULL/);
    expect(stmt.params).toEqual(["guest@example.com"]);
  });

  it("MySQL: uses ? placeholder + backticks", () => {
    const stmt = buildProvideDefaultSql({
      dialect: "mysql",
      table: "dc_users",
      column: "email",
      value: "guest@example.com",
    });
    expect(stmt.sql).toMatch(/UPDATE `dc_users`/);
    expect(stmt.sql).toMatch(/SET `email` = \?/);
    expect(stmt.params).toEqual(["guest@example.com"]);
  });

  it("SQLite: uses ? placeholder + double quotes", () => {
    const stmt = buildProvideDefaultSql({
      dialect: "sqlite",
      table: "dc_users",
      column: "email",
      value: "guest@example.com",
    });
    expect(stmt.sql).toMatch(/UPDATE "dc_users"/);
    expect(stmt.sql).toMatch(/SET "email" = \?/);
    expect(stmt.params).toEqual(["guest@example.com"]);
  });

  it("rejects unsafe table identifiers", () => {
    expect(() =>
      buildProvideDefaultSql({
        dialect: "postgresql",
        table: "dc_users; DROP TABLE",
        column: "email",
        value: "x",
      })
    ).toThrow(/identifier/i);
  });

  it("rejects unsafe column identifiers", () => {
    expect(() =>
      buildProvideDefaultSql({
        dialect: "postgresql",
        table: "dc_users",
        column: 'email"; DROP --',
        value: "x",
      })
    ).toThrow(/identifier/i);
  });
});

describe("buildDeleteNonconformingSql", () => {
  it("PG: emits DELETE WHERE col IS NULL with double-quoted identifiers", () => {
    const stmt = buildDeleteNonconformingSql({
      dialect: "postgresql",
      table: "dc_users",
      column: "email",
    });
    expect(stmt.sql).toMatch(/DELETE FROM "dc_users" WHERE "email" IS NULL/);
    expect(stmt.params).toEqual([]);
  });

  it("MySQL: uses backticks", () => {
    const stmt = buildDeleteNonconformingSql({
      dialect: "mysql",
      table: "dc_users",
      column: "email",
    });
    expect(stmt.sql).toMatch(/DELETE FROM `dc_users` WHERE `email` IS NULL/);
  });

  it("rejects unsafe identifiers", () => {
    expect(() =>
      buildDeleteNonconformingSql({
        dialect: "postgresql",
        table: "; DROP TABLE",
        column: "email",
      })
    ).toThrow(/identifier/i);
  });
});
