import { describe, expect, it } from "vitest";

import {
  MANAGED_TABLE_PREFIXES_REGEX,
  isManagedTable,
} from "../managed-tables.js";

describe("MANAGED_TABLE_PREFIXES_REGEX", () => {
  it("matches dynamic-collection tables", () => {
    expect(MANAGED_TABLE_PREFIXES_REGEX.test("dc_posts")).toBe(true);
    expect(MANAGED_TABLE_PREFIXES_REGEX.test("dc_users")).toBe(true);
  });

  it("matches single tables", () => {
    expect(MANAGED_TABLE_PREFIXES_REGEX.test("single_homepage")).toBe(true);
  });

  it("matches component tables", () => {
    expect(MANAGED_TABLE_PREFIXES_REGEX.test("comp_button")).toBe(true);
  });

  it("does NOT match nextly internal tables", () => {
    expect(MANAGED_TABLE_PREFIXES_REGEX.test("nextly_meta")).toBe(false);
    expect(MANAGED_TABLE_PREFIXES_REGEX.test("dynamic_collections")).toBe(
      false
    );
  });

  it("does NOT match arbitrary user tables", () => {
    expect(MANAGED_TABLE_PREFIXES_REGEX.test("users")).toBe(false);
    expect(MANAGED_TABLE_PREFIXES_REGEX.test("orders")).toBe(false);
  });

  it("anchored to start (no false matches in middle of name)", () => {
    expect(MANAGED_TABLE_PREFIXES_REGEX.test("user_dc_posts")).toBe(false);
  });
});

describe("isManagedTable", () => {
  it("returns true for managed prefixes", () => {
    expect(isManagedTable("dc_posts")).toBe(true);
    expect(isManagedTable("single_homepage")).toBe(true);
    expect(isManagedTable("comp_button")).toBe(true);
  });

  it("returns false for non-managed names", () => {
    expect(isManagedTable("nextly_meta")).toBe(false);
    expect(isManagedTable("users")).toBe(false);
    expect(isManagedTable("")).toBe(false);
  });
});
