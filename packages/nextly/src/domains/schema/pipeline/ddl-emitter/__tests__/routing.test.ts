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

  // SQLite/MySQL fast-path the purely-additive subset. Beyond speed this
  // is a crash guard: drizzle-kit v1 has no introspection filter on these
  // dialects, so a live table absent from the desired schema (UI-created
  // entities, `_locales` companions) paired against a "created" table
  // crashes its rename resolver (`resolver(table) was called without a
  // HintsHandler`). Additive applies must therefore never reach the kit.
  it("returns true for additive ops on sqlite and mysql", () => {
    const addTable: Operation = {
      type: "add_table",
      table: {
        name: "dc_new",
        columns: [{ name: "id", type: "text", nullable: false }],
        indexes: [],
      },
    };
    expect(canEmitWithoutDrizzleKit([addCol, addTable], "sqlite")).toBe(true);
    expect(canEmitWithoutDrizzleKit([addCol, addTable], "mysql")).toBe(true);
  });

  it("returns false for change_* ops on sqlite and mysql (kit owns rebuilds)", () => {
    const changeType: Operation = {
      type: "change_column_type",
      tableName: "dc_authors",
      columnName: "age",
      fromType: "text",
      toType: "integer",
    };
    expect(canEmitWithoutDrizzleKit([changeType], "sqlite")).toBe(false);
    expect(canEmitWithoutDrizzleKit([changeType], "mysql")).toBe(false);
    // Mixed lists degrade to the kit as a whole.
    expect(canEmitWithoutDrizzleKit([addCol, changeType], "sqlite")).toBe(
      false
    );
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

  it("returns true for an empty op list on every dialect (no DDL needed)", () => {
    // A zero-op apply must never reach drizzle-kit: on SQLite/MySQL the
    // kit introspects the whole live DB and can crash its rename resolver
    // on tables outside the desired schema even when our diff decided
    // nothing needs to change (repeated HMR no-op applies hit exactly
    // this). Our own diff is the authority for "no DDL is needed".
    expect(canEmitWithoutDrizzleKit([], "mysql")).toBe(true);
    expect(canEmitWithoutDrizzleKit([], "sqlite")).toBe(true);
  });
});
