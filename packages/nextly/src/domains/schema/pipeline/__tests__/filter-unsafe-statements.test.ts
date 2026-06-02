import { describe, it, expect, vi, afterEach } from "vitest";

import { getDialectTables } from "../../../../database/index";

import {
  drizzleTableNames,
  filterUnsafeStatements,
} from "../filter-unsafe-statements";

afterEach(() => vi.restoreAllMocks());

describe("drizzleTableNames", () => {
  it("returns SQL table names (not JS export keys) and skips non-tables", () => {
    const names = drizzleTableNames(getDialectTables("sqlite"));
    // SQL names, derived from Symbol.for('drizzle:Name'):
    expect(names).toContain("dynamic_collections");
    expect(names).toContain("email_templates");
    expect(names).toContain("users");
    // Export keys (camelCase) must NOT appear:
    expect(names).not.toContain("dynamicCollections");
    expect(names).not.toContain("emailTemplates");
    // Relations exports are not tables and must be excluded:
    expect(names).not.toContain("dynamicCollectionsRelations");
  });
});

describe("filterUnsafeStatements", () => {
  it("blocks DROP TABLE for a table NOT in the desired set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = filterUnsafeStatements(
      ["DROP TABLE `dc_articles`", 'CREATE TABLE "users" ("id" text)'],
      ["users"]
    );
    expect(out).toEqual(['CREATE TABLE "users" ("id" text)']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Blocked DROP TABLE "dc_articles"')
    );
  });

  it("ALLOWS DROP TABLE for a table IN the desired set (rebuild pattern)", () => {
    const out = filterUnsafeStatements(
      ["DROP TABLE `dynamic_collections`"],
      ["dynamic_collections"]
    );
    expect(out).toEqual(["DROP TABLE `dynamic_collections`"]);
  });
});
