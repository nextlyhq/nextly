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

describe("emitPostgresDdl — change_column_type", () => {
  // Regression: rext-site-v2 / dc_case_studies (May 2026).
  // Before this case was implemented, change_column_type ops routed to
  // drizzle-kit's pushSchema which silently declined non-implicit casts
  // like text → jsonb. The journal still recorded success. Owning the
  // SQL here makes the change either run or fail loudly.
  it("emits ALTER COLUMN SET DATA TYPE with an explicit USING cast", () => {
    const op: Operation = {
      type: "change_column_type",
      tableName: "dc_case_studies",
      columnName: "hero_section",
      fromType: "text",
      toType: "jsonb",
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "dc_case_studies" ALTER COLUMN "hero_section" ` +
        `SET DATA TYPE jsonb USING "hero_section"::jsonb`,
    ]);
  });

  it("uses the toType in both SET DATA TYPE and the USING cast", () => {
    // The USING expression dispatches the (sourceType → targetType) cast
    // Postgres has registered. Routing through `::<targetType>` keeps
    // the contract identical for every direction (text→jsonb, jsonb→text,
    // varchar→int, …) — Postgres errors loudly on missing casts.
    const op: Operation = {
      type: "change_column_type",
      tableName: "dc_authors",
      columnName: "age",
      fromType: "text",
      toType: "integer",
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "dc_authors" ALTER COLUMN "age" ` +
        `SET DATA TYPE integer USING "age"::integer`,
    ]);
  });

  it("quotes identifiers containing a double quote in the USING expression too", () => {
    const op: Operation = {
      type: "change_column_type",
      tableName: `weird"table`,
      columnName: `weird"col`,
      fromType: "text",
      toType: "jsonb",
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "weird""table" ALTER COLUMN "weird""col" ` +
        `SET DATA TYPE jsonb USING "weird""col"::jsonb`,
    ]);
  });
});

describe("emitPostgresDdl — change_column_nullable", () => {
  it("emits SET NOT NULL when toggling to non-nullable", () => {
    const op: Operation = {
      type: "change_column_nullable",
      tableName: "dc_authors",
      columnName: "email",
      fromNullable: true,
      toNullable: false,
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "dc_authors" ALTER COLUMN "email" SET NOT NULL`,
    ]);
  });

  it("emits DROP NOT NULL when relaxing to nullable", () => {
    const op: Operation = {
      type: "change_column_nullable",
      tableName: "dc_authors",
      columnName: "email",
      fromNullable: false,
      toNullable: true,
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "dc_authors" ALTER COLUMN "email" DROP NOT NULL`,
    ]);
  });
});

describe("emitPostgresDdl — change_column_default", () => {
  it("emits SET DEFAULT with a raw expression when toDefault is provided", () => {
    const op: Operation = {
      type: "change_column_default",
      tableName: "dc_authors",
      columnName: "status",
      fromDefault: "'draft'",
      toDefault: "'published'",
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "dc_authors" ALTER COLUMN "status" SET DEFAULT 'published'`,
    ]);
  });

  it("emits DROP DEFAULT when toDefault is undefined", () => {
    const op: Operation = {
      type: "change_column_default",
      tableName: "dc_authors",
      columnName: "status",
      fromDefault: "'draft'",
      toDefault: undefined,
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "dc_authors" ALTER COLUMN "status" DROP DEFAULT`,
    ]);
  });

  it("passes function defaults through verbatim", () => {
    // The default expression is owned by build-from-fields and matches
    // what introspection returns; the emitter never quotes or rewrites.
    const op: Operation = {
      type: "change_column_default",
      tableName: "dc_authors",
      columnName: "created_at",
      fromDefault: undefined,
      toDefault: "now()",
    };
    expect(emitPostgresDdl(op)).toEqual([
      `ALTER TABLE "dc_authors" ALTER COLUMN "created_at" SET DEFAULT now()`,
    ]);
  });
});
