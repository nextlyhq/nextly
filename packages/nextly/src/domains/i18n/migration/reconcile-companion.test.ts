import { describe, it, expect } from "vitest";

import {
  buildCompanionReconcileSql,
  type CompanionFieldLike,
} from "./reconcile-companion";

// Shared reconciler used by every schema path (builder-canvas apply + programmatic
// update) to keep a localized collection's `_locales` companion in sync. These tests
// pin the four cases that matter: fresh create, incremental add, drop, and no-op.
const text = (name: string): CompanionFieldLike => ({ name, type: "text" });
const num = (name: string): CompanionFieldLike => ({ name, type: "number" });

describe("buildCompanionReconcileSql", () => {
  it("creates the companion (CREATE TABLE) when it does not yet exist", () => {
    const sql = buildCompanionReconcileSql({
      slug: "posts",
      tableName: "dc_posts",
      oldLocalized: [],
      newLocalized: [text("body")],
      dialect: "postgres",
      status: false,
      companionExists: false,
    });
    expect(sql).toContain("CREATE TABLE");
    expect(sql).toContain("dc_posts_locales");
    expect(sql).toContain("body");
    // System per-locale columns are part of the companion shape.
    expect(sql).toContain("_parent");
    expect(sql).toContain("_locale");
  });

  it("adds a per-locale _status column when the collection has Draft/Published", () => {
    const sql = buildCompanionReconcileSql({
      slug: "posts",
      tableName: "dc_posts",
      oldLocalized: [],
      newLocalized: [text("body")],
      dialect: "postgres",
      status: true,
      companionExists: false,
    });
    expect(sql).toContain("_status");
  });

  it("returns empty when a localized collection has no translatable fields yet", () => {
    // Fresh localized collection created with only non-localized fields — nothing to store
    // per-language, so no companion is created.
    const sql = buildCompanionReconcileSql({
      slug: "posts",
      tableName: "dc_posts",
      oldLocalized: [],
      newLocalized: [],
      dialect: "postgres",
      status: false,
      companionExists: false,
    });
    expect(sql).toBe("");
  });

  it("ALTERs ADD COLUMN for a newly-translatable field when the companion exists", () => {
    const sql = buildCompanionReconcileSql({
      slug: "posts",
      tableName: "dc_posts",
      oldLocalized: [text("body")],
      newLocalized: [text("body"), text("summary")],
      dialect: "postgres",
      status: false,
      companionExists: true,
    });
    expect(sql).toContain("ALTER TABLE");
    expect(sql).toContain("ADD COLUMN");
    expect(sql).toContain("summary");
    // Untouched columns are not re-added.
    expect(sql).not.toContain("body");
  });

  it("ALTERs DROP COLUMN for a removed translatable field when the companion exists", () => {
    const sql = buildCompanionReconcileSql({
      slug: "posts",
      tableName: "dc_posts",
      oldLocalized: [text("body"), text("summary")],
      newLocalized: [text("body")],
      dialect: "postgres",
      status: false,
      companionExists: true,
    });
    expect(sql).toContain("DROP COLUMN");
    expect(sql).toContain("summary");
  });

  it("returns empty when the existing companion needs no column changes", () => {
    const sql = buildCompanionReconcileSql({
      slug: "posts",
      tableName: "dc_posts",
      oldLocalized: [text("body")],
      newLocalized: [text("body")],
      dialect: "postgres",
      status: false,
      companionExists: true,
    });
    expect(sql).toBe("");
  });

  it("ignores non-localized fields (only translatable ones reach the companion)", () => {
    // `num` fields are not text-like; deriveCompanionSpec/fieldToLocalizedColumnSpec skip them.
    const sql = buildCompanionReconcileSql({
      slug: "posts",
      tableName: "dc_posts",
      oldLocalized: [],
      newLocalized: [num("views")],
      dialect: "postgres",
      status: false,
      companionExists: false,
    });
    expect(sql).toBe("");
  });
});
