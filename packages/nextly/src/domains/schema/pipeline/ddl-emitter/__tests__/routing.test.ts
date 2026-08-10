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

  it("keeps drop_index fast-path-eligible (routing only; pre-resolution executes it)", () => {
    // drop_index is executed by executePreResolutionOps, but an apply of
    // additive ops plus index drops must still take the fast path — falling
    // back to drizzle-kit's re-introspection re-opens the `_pkey` incident
    // surface below.
    const dropIndex: Operation = {
      type: "drop_index",
      tableName: "dc_authors",
      index: {
        name: "idx_dc_authors_avatar",
        columns: ["avatar"],
        unique: false,
      },
    };
    expect(canEmitWithoutDrizzleKit([addCol, dropIndex], "postgresql")).toBe(
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

  // `drop_index` is now a PRE-RESOLUTION op, so the emitter produces nothing
  // for it — but it must still keep the apply on the fast path. The executor
  // runs inside `runApply` on both routes, so the drop happens either way;
  // what routing decides is whether drizzle-kit ALSO gets invoked, and on
  // SQLite/MySQL that is the introspection crash this fast path exists to
  // avoid. A drop_index-only apply emitting zero statements is the expected
  // shape, not a reason to fall back.
  it("keeps a drop_index-only apply on the fast path (executor owns the drop)", () => {
    const dropIndex: Operation = {
      type: "drop_index",
      tableName: "dc_authors",
      index: {
        name: "idx_dc_authors_email",
        columns: ["email"],
        unique: false,
      },
    };
    expect(canEmitWithoutDrizzleKit([dropIndex], "sqlite")).toBe(true);
    expect(canEmitWithoutDrizzleKit([dropIndex], "mysql")).toBe(true);
    expect(canEmitWithoutDrizzleKit([dropIndex], "postgresql")).toBe(true);
  });

  it("sends a standalone add_index to drizzle-kit on MySQL only", () => {
    // MySQL needs a key length to index a TEXT column, and an add_index op
    // carries column NAMES with no types — so that apply belongs to the kit,
    // which introspects them. SQLite indexes the whole value and is fine.
    const addIndex: Operation = {
      type: "add_index",
      tableName: "dc_notes",
      index: { name: "idx_dc_notes_body", columns: ["body"], unique: false },
    };
    expect(canEmitWithoutDrizzleKit([addIndex], "mysql")).toBe(false);
    expect(canEmitWithoutDrizzleKit([addIndex], "sqlite")).toBe(true);
    // An add_table brings its own columns, so MySQL keeps that one.
    const addTable: Operation = {
      type: "add_table",
      table: {
        name: "dc_notes",
        columns: [{ name: "id", type: "varchar(36)", nullable: false }],
      },
    };
    expect(canEmitWithoutDrizzleKit([addTable], "mysql")).toBe(true);
  });

  // A prefix on a NON-unique index changes only how much of the value is
  // indexed. On a UNIQUE index it constrains the DATA — `col(191)` rejects
  // two rows differing only past character 191 — so MySQL cannot express the
  // author's intent through this emitter and the apply goes to drizzle-kit.
  it("sends an add_table with a UNIQUE index on a TEXT column to drizzle-kit on MySQL", () => {
    const uniqueOnText: Operation = {
      type: "add_table",
      table: {
        name: "dc_notes",
        columns: [
          {
            name: "id",
            type: "varchar(36)",
            nullable: false,
            primaryKey: true,
          },
          { name: "body", type: "text", nullable: true },
        ],
        indexes: [
          { name: "uq_dc_notes_body", columns: ["body"], unique: true },
        ],
      },
    };
    expect(canEmitWithoutDrizzleKit([uniqueOnText], "mysql")).toBe(false);
    // SQLite indexes the whole value, so uniqueness there means what it says.
    expect(canEmitWithoutDrizzleKit([uniqueOnText], "sqlite")).toBe(true);
  });

  // The counterpart to the case above, and the reason the fallback is scoped
  // to UNIQUE rather than to TEXT: on a non-unique index the 191-character
  // prefix decides only how much of the value MySQL indexes — lookup coverage,
  // invisible to callers and identical to what the Builder's own DDL emits for
  // these columns. No row is rejected for it, so there is nothing to hand to
  // drizzle-kit and no reason to leave the fast path.
  it("keeps a non-unique TEXT index, and a unique index on a sized column", () => {
    const nonUniqueOnText: Operation = {
      type: "add_table",
      table: {
        name: "dc_notes",
        columns: [
          {
            name: "id",
            type: "varchar(36)",
            nullable: false,
            primaryKey: true,
          },
          { name: "body", type: "text", nullable: true },
        ],
        indexes: [
          { name: "idx_dc_notes_body", columns: ["body"], unique: false },
        ],
      },
    };
    expect(canEmitWithoutDrizzleKit([nonUniqueOnText], "mysql")).toBe(true);

    // The canonical unique slug index must NOT be pushed off the fast path:
    // a sized column takes no prefix, so its uniqueness is already exact.
    const uniqueOnVarchar: Operation = {
      type: "add_table",
      table: {
        name: "dc_notes",
        columns: [
          {
            name: "id",
            type: "varchar(36)",
            nullable: false,
            primaryKey: true,
          },
          { name: "slug", type: "varchar(255)", nullable: false },
        ],
        indexes: [
          { name: "uq_dc_notes_slug", columns: ["slug"], unique: true },
        ],
      },
    };
    expect(canEmitWithoutDrizzleKit([uniqueOnVarchar], "mysql")).toBe(true);
  });
});
