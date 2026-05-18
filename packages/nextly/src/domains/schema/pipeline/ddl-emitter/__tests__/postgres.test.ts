import { describe, it, expect } from "vitest";

import type { Operation } from "../../diff/types";
import { emitPostgresDdl } from "../postgres";

describe("emitPostgresDdl — add_column", () => {
  it("nullable column, no default", () => {
    const op: Operation = {
      type: "add_column",
      tableName: "dc_authors",
      column: { name: "age", type: "integer", nullable: true },
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "dc_authors" ADD COLUMN "age" integer`,
    ]);
  });

  it("NOT NULL column with a default", () => {
    const op: Operation = {
      type: "add_column",
      tableName: "dc_authors",
      column: {
        name: "status",
        type: "varchar(20)",
        nullable: false,
        default: "'draft'",
      },
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "dc_authors" ADD COLUMN "status" varchar(20) NOT NULL DEFAULT 'draft'`,
    ]);
  });

  it("function default (e.g. now())", () => {
    const op: Operation = {
      type: "add_column",
      tableName: "dc_authors",
      column: {
        name: "created_at",
        type: "timestamp",
        nullable: false,
        default: "now()",
      },
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "dc_authors" ADD COLUMN "created_at" timestamp NOT NULL DEFAULT now()`,
    ]);
  });

  it("quotes identifiers containing a double quote", () => {
    const op: Operation = {
      type: "add_column",
      tableName: `weird"table`,
      column: { name: `weird"col`, type: "text", nullable: true },
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "weird""table" ADD COLUMN "weird""col" text`,
    ]);
  });

  it("still emits nothing for pre-resolution-handled ops", () => {
    const drop: Operation = {
      type: "drop_column",
      tableName: "dc_authors",
      columnName: "old",
      columnType: "text",
    };
    expect(emitPostgresDdl(drop)).toEqual([]);
  });
});

describe("emitPostgresDdl — add_table", () => {
  // The collection-table contract verified against a real Builder-made
  // table on Neon (see Phase 4 plan, Task 8 background):
  //   - "id" is the PRIMARY KEY (text, NOT NULL, no default)
  //   - canonical indexes: UNIQUE btree on slug, btree DESC on created_at
  //   - regular column tail otherwise

  it("emits CREATE TABLE with PK on id, NOT NULLs, and defaults", () => {
    const op: Operation = {
      type: "add_table",
      table: {
        name: "dc_authors",
        columns: [
          { name: "id", type: "text", nullable: false },
          { name: "title", type: "text", nullable: false },
          {
            name: "created_at",
            type: "timestamp",
            nullable: true,
            default: "now()",
          },
        ],
      },
    };
    const sql = emitPostgresDdl(op);
    // The CREATE TABLE is the first statement; indexes follow.
    expect(sql[0]).toContain(`CREATE TABLE "dc_authors"`);
    expect(sql[0]).toContain(`"id" text PRIMARY KEY NOT NULL`);
    expect(sql[0]).toContain(`"title" text NOT NULL`);
    expect(sql[0]).toContain(`"created_at" timestamp DEFAULT now()`);
  });

  it("emits canonical idx_<table>_slug UNIQUE index when slug column is present", () => {
    const op: Operation = {
      type: "add_table",
      table: {
        name: "dc_authors",
        columns: [
          { name: "id", type: "text", nullable: false },
          { name: "slug", type: "text", nullable: false },
        ],
      },
    };
    const sql = emitPostgresDdl(op);
    const slugIdx = sql.find(s => s.includes("idx_dc_authors_slug"));
    expect(slugIdx).toBeDefined();
    expect(slugIdx).toContain(`CREATE UNIQUE INDEX`);
    expect(slugIdx).toContain(`"dc_authors"`);
    expect(slugIdx).toContain(`USING btree ("slug")`);
  });

  it("emits canonical idx_<table>_created_at DESC btree when created_at column is present", () => {
    const op: Operation = {
      type: "add_table",
      table: {
        name: "dc_authors",
        columns: [
          { name: "id", type: "text", nullable: false },
          {
            name: "created_at",
            type: "timestamp",
            nullable: true,
            default: "now()",
          },
        ],
      },
    };
    const sql = emitPostgresDdl(op);
    const caIdx = sql.find(s => s.includes("idx_dc_authors_created_at"));
    expect(caIdx).toBeDefined();
    expect(caIdx).toContain(`CREATE INDEX`);
    expect(caIdx).toContain(`USING btree ("created_at" DESC)`);
  });

  it("does not emit slug/created_at indexes when those columns are absent", () => {
    const op: Operation = {
      type: "add_table",
      table: {
        name: "dc_minimal",
        columns: [{ name: "id", type: "text", nullable: false }],
      },
    };
    const sql = emitPostgresDdl(op);
    // Only the CREATE TABLE — no index statements.
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain(`CREATE TABLE "dc_minimal"`);
  });
});
