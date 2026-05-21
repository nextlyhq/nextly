import { describe, it, expect } from "vitest";

import type { Operation } from "../../diff/types";
import { canEmitWithoutDrizzleKit } from "../index";

const addCol: Operation = {
  type: "add_column",
  tableName: "dc_authors",
  column: { name: "age", type: "integer", nullable: true },
};

describe("canEmitWithoutDrizzleKit", () => {
  it("returns true for postgresql when every op is a supported add_column", () => {
    expect(canEmitWithoutDrizzleKit([addCol], "postgresql")).toBe(true);
  });

  // Regression: rext-site-v2 / dc_case_studies (May 2026).
  // change_column_type used to fall through to drizzle-kit, which then
  // silently declined non-implicit casts like text → jsonb. Owning these
  // ops in the fast path is what closes the silent-skip surface.
  it("returns true for change_column_type on postgresql", () => {
    const changeType: Operation = {
      type: "change_column_type",
      tableName: "dc_case_studies",
      columnName: "hero_section",
      fromType: "text",
      toType: "jsonb",
    };
    expect(canEmitWithoutDrizzleKit([changeType], "postgresql")).toBe(true);
  });

  it("returns true for change_column_nullable on postgresql", () => {
    const changeNull: Operation = {
      type: "change_column_nullable",
      tableName: "dc_authors",
      columnName: "email",
      fromNullable: true,
      toNullable: false,
    };
    expect(canEmitWithoutDrizzleKit([changeNull], "postgresql")).toBe(true);
  });

  it("returns true for change_column_default on postgresql", () => {
    const changeDefault: Operation = {
      type: "change_column_default",
      tableName: "dc_authors",
      columnName: "status",
      fromDefault: "'draft'",
      toDefault: "'published'",
    };
    expect(canEmitWithoutDrizzleKit([changeDefault], "postgresql")).toBe(true);
  });

  it("returns true for a mixed list of fast-path-eligible ops", () => {
    const changeType: Operation = {
      type: "change_column_type",
      tableName: "dc_case_studies",
      columnName: "hero_section",
      fromType: "text",
      toType: "jsonb",
    };
    expect(canEmitWithoutDrizzleKit([addCol, changeType], "postgresql")).toBe(
      true
    );
  });

  it("returns false if any op is outside the fast-path set (mixed list)", () => {
    const renameTable: Operation = {
      type: "rename_table",
      fromName: "a",
      toName: "b",
    };
    expect(canEmitWithoutDrizzleKit([addCol, renameTable], "postgresql")).toBe(
      false
    );
  });

  it("returns false for non-postgresql dialects", () => {
    expect(canEmitWithoutDrizzleKit([addCol], "mysql")).toBe(false);
    expect(canEmitWithoutDrizzleKit([addCol], "sqlite")).toBe(false);
  });

  // Regression: rext-site-v2 / test_verify_fix (May 2026).
  // A textarea -> richText field change is metadata-only on Postgres
  // (both map to a `text` column) so our diff produced zero ops. The
  // previous behaviour delegated empty-ops applies to drizzle-kit,
  // which then re-introspected the live DB on its own and emitted a
  // destructive `DROP INDEX "<table>_pkey"` for an unrelated managed
  // table, failing the whole transaction. Trusting our own diff for
  // "no DDL is needed" closes that surface.
  it("returns true for an empty op list on postgresql (no DDL needed)", () => {
    expect(canEmitWithoutDrizzleKit([], "postgresql")).toBe(true);
  });

  it("returns false for an empty op list on non-postgresql dialects", () => {
    // mysql / sqlite still go through drizzle-kit; the fast in-memory
    // emitter is PG-only.
    expect(canEmitWithoutDrizzleKit([], "mysql")).toBe(false);
    expect(canEmitWithoutDrizzleKit([], "sqlite")).toBe(false);
  });
});
