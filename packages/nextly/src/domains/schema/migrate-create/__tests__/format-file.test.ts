// F11 PR 3: format-file tests.

import { describe, expect, it } from "vitest";

import {
  formatBlankFile,
  formatMigrationFile,
  formatTimestamp,
  slugify,
} from "../format-file.js";

describe("formatMigrationFile", () => {
  const NOW = new Date("2026-04-29T15:45:00.123Z");

  it("emits header with collections + dialect + UP body", () => {
    const out = formatMigrationFile({
      name: "add_excerpt",
      dialect: "postgresql",
      sqlStatements: ['ALTER TABLE "dc_posts" ADD COLUMN "excerpt" text'],
      collections: ["posts"],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    expect(out).toContain("-- Migration: add_excerpt");
    expect(out).toContain("-- Collections: posts");
    expect(out).toContain("-- Generated at: 2026-04-29T15:45:00.123Z");
    expect(out).toContain("-- Dialect: PostgreSQL");
    expect(out).toContain("-- UP");
    expect(out).toContain('ALTER TABLE "dc_posts" ADD COLUMN "excerpt" text;');
  });

  it("DOES NOT emit a -- DOWN section (Q4=A: forward-only)", () => {
    const out = formatMigrationFile({
      name: "add_excerpt",
      dialect: "postgresql",
      sqlStatements: ['ALTER TABLE "dc_posts" ADD COLUMN "excerpt" text'],
      collections: ["posts"],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    expect(out).not.toContain("-- DOWN");
  });

  it("appends `;` to each SQL statement", () => {
    const out = formatMigrationFile({
      name: "two_statements",
      dialect: "postgresql",
      sqlStatements: [
        'ALTER TABLE "dc_posts" ADD COLUMN "a" text',
        'ALTER TABLE "dc_posts" ADD COLUMN "b" text',
      ],
      collections: ["posts"],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    const matches = out.match(/;/g);
    expect(matches?.length).toBe(2);
  });

  it("omits empty collection / single / component lines", () => {
    const out = formatMigrationFile({
      name: "no_metadata",
      dialect: "mysql",
      sqlStatements: ["SELECT 1"],
      collections: [],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    expect(out).not.toContain("-- Collections:");
    expect(out).not.toContain("-- Singles:");
    expect(out).not.toContain("-- Components:");
    expect(out).not.toContain("-- UserExt:");
  });

  it("includes UserExt line when hasUserExt=true", () => {
    const out = formatMigrationFile({
      name: "user_ext_change",
      dialect: "postgresql",
      sqlStatements: ['ALTER TABLE "user_ext" ADD COLUMN "bio" text'],
      collections: [],
      singles: [],
      components: [],
      hasUserExt: true,
      now: NOW,
    });
    expect(out).toContain("-- UserExt: user_ext");
  });

  it("comma-separates multiple collections", () => {
    const out = formatMigrationFile({
      name: "multi",
      dialect: "postgresql",
      sqlStatements: ["SELECT 1"],
      collections: ["posts", "comments"],
      singles: [],
      components: [],
      hasUserExt: false,
      now: NOW,
    });
    expect(out).toContain("-- Collections: posts, comments");
  });
});

describe("formatBlankFile", () => {
  it("emits a -- UP section but no body and no DOWN", () => {
    const out = formatBlankFile(
      "custom_seed",
      "postgresql",
      new Date("2026-04-29T00:00:00Z")
    );
    expect(out).toContain("-- UP");
    expect(out).not.toContain("-- DOWN");
    expect(out).toContain("-- Migration: custom_seed");
    expect(out).toContain("-- Dialect: PostgreSQL");
  });
});

describe("formatTimestamp", () => {
  it("matches YYYYMMDD_HHMMSS_mmm pattern", () => {
    const t = formatTimestamp(new Date("2026-04-29T15:45:00.123Z"));
    expect(t).toBe("20260429_154500_123");
  });

  it("zero-pads single-digit components", () => {
    const t = formatTimestamp(new Date("2026-01-02T03:04:05.006Z"));
    expect(t).toBe("20260102_030405_006");
  });
});

describe("slugify", () => {
  it("lowercases", () => {
    expect(slugify("AddExcerpt")).toBe("addexcerpt");
  });

  it("collapses non-alphanumeric runs to single underscore", () => {
    expect(slugify("rename: title -> name")).toBe("rename_title_name");
  });

  it("trims leading/trailing underscores", () => {
    expect(slugify("__hello__")).toBe("hello");
  });

  it("handles empty input", () => {
    expect(slugify("")).toBe("");
  });
});
