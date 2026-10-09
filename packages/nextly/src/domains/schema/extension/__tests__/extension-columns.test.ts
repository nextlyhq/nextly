/**
 * Columns on tables somebody else owns.
 *
 * Two rules carry the safety here, and they guard different failures. The
 * nullable-or-defaulted rule stops a migration that fails on exactly the
 * installations that have data. The core allowlist stops a column inside the
 * machinery that decides access or applies migrations.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { ResolvedColumn } from "../dsl";
import {
  assertAddableToExistingRows,
  assertMayAddColumns,
  assertMayOverride,
  assertOverrideCompatible,
  EXTENDABLE_CORE_TABLES,
} from "../extension-columns";

const column = (over: Partial<ResolvedColumn> = {}): ResolvedColumn => ({
  key: "x",
  name: "x",
  kind: "text",
  nullable: false,
  ...over,
});

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      return data?.errors?.[0]?.message ?? "";
    }
    throw error;
  }
  throw new Error("expected a refusal, and the call returned");
}

describe("adding to a table that already has rows", () => {
  it("accepts a nullable column", () => {
    expect(() =>
      assertAddableToExistingRows(column({ nullable: true }), "dc_posts")
    ).not.toThrow();
  });

  it("accepts a NOT NULL column with a default", () => {
    expect(() =>
      assertAddableToExistingRows(column({ default: "x" }), "dc_posts")
    ).not.toThrow();
  });

  it("accepts a generated column", () => {
    expect(() =>
      assertAddableToExistingRows(column({ generated: "uuidv7" }), "dc_posts")
    ).not.toThrow();
  });

  it("refuses NOT NULL with no default", () => {
    // Cannot be added to a populated table on any dialect, so it fails on
    // exactly the installations least able to absorb a failed deploy.
    expect(
      refusal(() => assertAddableToExistingRows(column(), "dc_posts"))
    ).toMatch(/NOT NULL with no default/);
  });
});

describe("which tables may take columns", () => {
  const app = { kind: "app" } as const;
  const plugin = { kind: "plugin", id: "fx" } as const;

  it("allows a caller its own tables", () => {
    expect(() =>
      assertMayAddColumns({ kind: "own" }, "fx__notes", plugin)
    ).not.toThrow();
  });

  it("allows entity tables, because the column is hidden", () => {
    expect(() =>
      assertMayAddColumns({ kind: "entity", slug: "posts" }, "dc_posts", plugin)
    ).not.toThrow();
  });

  it("allows an allowlisted core table", () => {
    for (const table of EXTENDABLE_CORE_TABLES) {
      expect(() =>
        assertMayAddColumns({ kind: "core", table }, table, app)
      ).not.toThrow();
    }
  });

  it("refuses a core table outside the allowlist", () => {
    // A column on RBAC or the ledger sits inside the machinery that decides
    // access or applies migrations. A broken RBAC extension fails OPEN; a
    // broken ledger one leaves a database nobody can migrate.
    for (const table of [
      "refresh_tokens",
      "nextly_schema_events",
      "nextly_schema_owners",
    ]) {
      expect(
        refusal(() => assertMayAddColumns({ kind: "core", table }, table, app))
      ).toMatch(/may not be extended/);
    }
  });

  it("names what IS extendable, so the refusal is actionable", () => {
    expect(
      refusal(() =>
        assertMayAddColumns(
          { kind: "core", table: "refresh_tokens" },
          "refresh_tokens",
          app
        )
      )
    ).toMatch(/users/);
  });

  it("refuses another owner's table until element-level ownership exists", () => {
    expect(
      refusal(() =>
        assertMayAddColumns(
          { kind: "foreign", owner: { kind: "plugin", id: "other" } },
          "other__widgets",
          plugin
        )
      )
    ).toMatch(/may not add columns/);
  });
});

describe("overrides", () => {
  it("allows the app to narrow text storage", () => {
    // Payload's `varchar('city', { length: 10 })` case.
    expect(() =>
      assertOverrideCompatible("text", "varchar", "dc_posts", "city")
    ).not.toThrow();
  });

  it("allows widening an integer", () => {
    expect(() =>
      assertOverrideCompatible("integer", "bigint", "dc_posts", "views")
    ).not.toThrow();
  });

  it("refuses crossing value families", () => {
    // The field's own validation would then describe a column that cannot
    // hold what it accepts.
    expect(
      refusal(() =>
        assertOverrideCompatible("text", "integer", "dc_posts", "title")
      )
    ).toMatch(/cannot be overridden/);
  });

  it("is the app's alone", () => {
    expect(() =>
      assertMayOverride({ kind: "app" }, "dc_posts", "city")
    ).not.toThrow();
    // A plugin overriding a field's storage changes what EVERY reader of that
    // field gets back, including the app that declared it.
    expect(
      refusal(() =>
        assertMayOverride({ kind: "plugin", id: "fx" }, "dc_posts", "city")
      )
    ).toMatch(/Only the app/);
  });
});
